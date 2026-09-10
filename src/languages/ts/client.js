'use strict';

const { groupChannels } = require('../../channel-groups');

// A conservative, ASCII-only check (same rules as the js/python backends' identifier
// validation). TS identifiers technically also allow `$`/unicode, but every real AsyncAPI
// channel id in practice is already camelCase ASCII, and this keeps generated code as plain
// `this.foo = ...` property assignments instead of always falling back to bracket notation.
function assertValidTsIdentifier(name, context) {
  if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)) {
    throw new Error(`${context}: "${name}" is not a valid TypeScript identifier`);
  }
  return name;
}

/** Last dotted segment of a proto package — also the generated module name (control.proto -> control.ts). */
function protoModuleOf(protoPackage) {
  return protoPackage.split('.').pop();
}

/** Sorted list of distinct proto module names (one per proto package). */
function protoModules(model) {
  return [...new Set([...model.protoPackages.keys()].map(protoModuleOf))].sort();
}

/**
 * Per-channel view model shared by client.js, scaffold.js and tests.js so they stay in sync.
 * `valueRef` is the ts-proto codec object (used at runtime); `typeRef` is the ts-proto message
 * interface of the same name (used in type position). Both are reached through the hand-written
 * `src/messages.ts` barrel that re-exports each generated proto module as a namespace.
 */
function channelViewModels(channels) {
  return channels.map((c) => {
    assertValidTsIdentifier(c.id, `Channel "${c.id}"`);
    const ref = `messages.${protoModuleOf(c.protoPackage)}.${c.protoMessageType}`;
    return { ...c, valueRef: ref, typeRef: ref };
  });
}

/**
 * Emits src/client.ts (MqttTransport, MqttConfig, ProtoCodec, MqttJsTransport, Channel,
 * MessageBus), src/index.ts (public API) and src/messages.ts (proto-module barrel).
 *
 * @param {{ channels: Array<object>, protoPackages: Map<string, Map> }} model
 * @param {{ projectName: string }} ctx
 * @returns {Array<{ path: string, content: string }>}
 */
function buildClientFiles(model, ctx) {
  const { projectName } = ctx;
  const channels = channelViewModels(model.channels);
  const { flat, groups } = groupChannels(channels);

  const fieldDoc = (c, indent) =>
    c.description ? `${indent}/** ${c.description.trim().split('\n')[0]} */\n` : '';

  const fieldDecls = [
    ...flat.map((c) => `${fieldDoc(c, '  ')}  readonly ${c.id}: Channel<${c.typeRef}>;`),
    ...groups.map((g) => {
      const members = g.channels
        .map((c) => `${fieldDoc(c, '    ')}    readonly ${c.id}: Channel<${c.typeRef}>;`)
        .join('\n');
      return `  /** tag: ${g.tags.join(', ')} */\n  readonly ${g.name}: {\n${members}\n  };`;
    }),
  ].join('\n');

  // `new Channel(...)` expression; `indent` is the leading whitespace of the `new Channel(` line.
  // The trailing `retain` arg is only emitted for channels whose MQTT binding sets it, so
  // non-retained output is byte-for-byte unchanged.
  const channelExpr = (c, indent) =>
    `new Channel(\n` +
    `${indent}  "${c.address}",\n` +
    `${indent}  ${c.valueRef} as unknown as ProtoCodec<${c.typeRef}>,\n` +
    `${indent}  this._transport,\n` +
    `${indent}  this._dispatch,\n` +
    (c.retain ? `${indent}  true,\n` : '') +
    `${indent})`;

  const channelAssignments = [
    ...flat.map((c) => `    this.${c.id} = ${channelExpr(c, '    ')};`),
    ...groups.map((g) => {
      const members = g.channels
        .map((c) => `      ${c.id}: ${channelExpr(c, '      ')},`)
        .join('\n');
      return `    this.${g.name} = {\n${members}\n    };`;
    }),
  ].join('\n');

  const exampleId = groups[0]
    ? `${groups[0].name}.${groups[0].channels[0].id}`
    : flat[0]
      ? flat[0].id
      : 'someChannel';

  const clientTs = `/**
 * Generated MQTT message-bus client for ${projectName}. Do not edit by hand.
 *
 * Each spec channel is exposed as a typed \`Channel\` on \`MessageBus\`. A channel that carries
 * AsyncAPI tags is nested under each tag (slugified): \`messageBus.<tag>.<channel>\`; a channel
 * with no tags stays top-level: \`messageBus.<channel>\`.
 *
 *   messageBus.${exampleId}.subscribe((msg) => handle(msg));
 *   messageBus.${exampleId}.publish(msg);
 *   messageBus.${exampleId}.address;
 *
 * publish()/subscribe() always use protobuf binary encoding (Type.encode(...).finish() /
 * Type.decode(...) — the ts-proto codec API, see src/generated/).
 */

import mqtt, { type IClientOptions, type MqttClient } from "mqtt";

import * as messages from "./messages.js";

/** Duck-typed transport interface; MqttJsTransport and the test FakeMqttTransport both implement it. */
export interface MqttTransport {
  connect(): void;
  disconnect(): void;
  publish(topic: string, payload: Uint8Array, retain?: boolean): void;
  subscribe(topic: string): void;
  setMessageHandler(handler: (topic: string, payload: Uint8Array) => void): void;
}

export interface MqttConfig {
  /**
   * Broker URL. Browsers can only speak MQTT over WebSockets, not raw TCP — this must point at a
   * websocket listener (e.g. Mosquitto's \`protocol websockets\`), not the usual TCP 1883 port.
   */
  url?: string;
  clientId?: string;
  /**
   * Optional MQTT Last-Will: the broker publishes \`payload\` to \`topic\` if this client
   * disconnects ungracefully.
   */
  will?: { topic: string; payload: Uint8Array; retain?: boolean };
}

/** The subset of a ts-proto generated message object that Channel needs. */
export interface ProtoCodec<T> {
  encode(message: T): { finish(): Uint8Array };
  decode(input: Uint8Array): T;
  create(base?: unknown): T;
}

/** \`will\` stays optional — a Last-Will is opt-in and has no sensible default. */
type ResolvedMqttConfig = Required<Omit<MqttConfig, "will">> & Pick<MqttConfig, "will">;

const DEFAULT_CONFIG: ResolvedMqttConfig = {
  url: "ws://localhost:9001",
  clientId: "${projectName}",
};

/**
 * MqttTransport implementation backed by MQTT.js. connect() opens the WebSocket connection;
 * incoming messages are dispatched from MQTT.js's own 'message' event.
 */
export class MqttJsTransport implements MqttTransport {
  private readonly config: ResolvedMqttConfig;
  private client: MqttClient | null = null;
  private handler: ((topic: string, payload: Uint8Array) => void) | null = null;
  // MQTT.js queues pre-connect subscriptions and re-subscribes on reconnect
  // itself, but we still track them so subscribe() can be called before
  // connect() without dereferencing a null client, and to be explicit.
  private readonly subscriptions = new Set<string>();

  constructor(config?: MqttConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  connect(): void {
    const options: IClientOptions = { clientId: this.config.clientId };
    if (this.config.will && this.config.will.topic) {
      options.will = {
        topic: this.config.will.topic,
        payload: Buffer.from(this.config.will.payload),
        retain: !!this.config.will.retain,
        qos: 0,
      };
    }
    this.client = mqtt.connect(this.config.url, options);
    this.client.on("connect", () => {
      for (const topic of this.subscriptions) this.client?.subscribe(topic);
    });
    this.client.on("message", (topic, payload) => {
      if (this.handler) this.handler(topic, payload);
    });
  }

  disconnect(): void {
    if (this.client) this.client.end();
  }

  publish(topic: string, payload: Uint8Array, retain = false): void {
    this.client?.publish(topic, Buffer.from(payload), { retain });
  }

  subscribe(topic: string): void {
    this.subscriptions.add(topic);
    this.client?.subscribe(topic);
  }

  setMessageHandler(handler: (topic: string, payload: Uint8Array) => void): void {
    this.handler = handler;
  }
}

/** One MQTT channel, typed to its proto message. See the module docstring for the API. */
export class Channel<T> {
  constructor(
    readonly address: string,
    private readonly codec: ProtoCodec<T>,
    private readonly transport: MqttTransport,
    private readonly dispatch: Map<string, (payload: Uint8Array) => void>,
    private readonly retain: boolean = false,
  ) {}

  publish(message: T): void {
    this.transport.publish(this.address, this.codec.encode(message).finish(), this.retain);
  }

  subscribe(handler: (message: T) => void): void {
    this.transport.subscribe(this.address);
    this.dispatch.set(this.address, (payload) => handler(this.codec.decode(payload)));
  }
}

/**
 * Owns the MQTT connection and exposes one Channel property per spec channel.
 *
 * Pass \`config\` to connect to a real broker via MqttJsTransport, or \`transport\` to inject a
 * caller-provided transport (e.g. an in-memory fake in tests). \`transport\` takes precedence if
 * both are given.
 */
export class MessageBus {
  private readonly _transport: MqttTransport;
  private readonly _dispatch = new Map<string, (payload: Uint8Array) => void>();

${fieldDecls}

  constructor(config?: MqttConfig, transport?: MqttTransport) {
    this._transport = transport ?? new MqttJsTransport(config);
    this._transport.setMessageHandler((topic, payload) => {
      const handler = this._dispatch.get(topic);
      if (handler) handler(payload);
    });

${channelAssignments}
  }

  connect(): void {
    this._transport.connect();
  }

  disconnect(): void {
    this._transport.disconnect();
  }
}
`;

  const barrelExports = protoModules(model)
    .map((mod) => `export * as ${mod} from "./generated/${mod}.js";`)
    .join('\n');

  const messagesTs = `// Barrel over the ts-proto generated modules (one per proto package), so the rest of the
// client can \`import * as messages from "./messages.js"\` and reach every message type as
// \`messages.<protoModule>.<MessageType>\`. src/generated/ is produced by \`npm run proto\`.
${barrelExports}
`;

  const indexTs = `export { MessageBus, Channel, MqttJsTransport } from "./client.js";
export type { MqttTransport, MqttConfig, ProtoCodec } from "./client.js";
export * as messages from "./messages.js";
`;

  return [
    { path: 'src/client.ts', content: clientTs },
    { path: 'src/messages.ts', content: messagesTs },
    { path: 'src/index.ts', content: indexTs },
  ];
}

module.exports = { buildClientFiles, channelViewModels, protoModules };
