'use strict';

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

  const fieldDecls = channels
    .map((c) => {
      const doc = c.description ? `  /** ${c.description.trim().split('\n')[0]} */\n` : '';
      return `${doc}  readonly ${c.id}: Channel<${c.typeRef}>;`;
    })
    .join('\n');

  const channelAssignments = channels
    .map(
      (c) =>
        `    this.${c.id} = new Channel(\n` +
        `      "${c.address}",\n` +
        `      ${c.valueRef} as unknown as ProtoCodec<${c.typeRef}>,\n` +
        `      this._transport,\n` +
        `      this._dispatch,\n` +
        `    );`
    )
    .join('\n');

  const exampleId = channels[0] ? channels[0].id : 'someChannel';

  const clientTs = `/**
 * Generated MQTT message-bus client for ${projectName}. Do not edit by hand.
 *
 * Every channel from the spec is exposed as a typed \`Channel\` property on \`MessageBus\`:
 *
 *   messageBus.${exampleId}.subscribe((msg) => handle(msg));
 *   messageBus.${exampleId}.publish(msg);
 *   messageBus.${exampleId}.address;
 *
 * publish()/subscribe() always use protobuf binary encoding (Type.encode(...).finish() /
 * Type.decode(...) — the ts-proto codec API, see src/generated/).
 */

import mqtt, { type MqttClient } from "mqtt";

import * as messages from "./messages.js";

/** Duck-typed transport interface; MqttJsTransport and the test FakeMqttTransport both implement it. */
export interface MqttTransport {
  connect(): void;
  disconnect(): void;
  publish(topic: string, payload: Uint8Array): void;
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
}

/** The subset of a ts-proto generated message object that Channel needs. */
export interface ProtoCodec<T> {
  encode(message: T): { finish(): Uint8Array };
  decode(input: Uint8Array): T;
  create(base?: unknown): T;
}

const DEFAULT_CONFIG: Required<MqttConfig> = {
  url: "ws://localhost:9001",
  clientId: "${projectName}",
};

/**
 * MqttTransport implementation backed by MQTT.js. connect() opens the WebSocket connection;
 * incoming messages are dispatched from MQTT.js's own 'message' event.
 */
export class MqttJsTransport implements MqttTransport {
  private readonly config: Required<MqttConfig>;
  private client: MqttClient | null = null;
  private handler: ((topic: string, payload: Uint8Array) => void) | null = null;

  constructor(config?: MqttConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  connect(): void {
    this.client = mqtt.connect(this.config.url, { clientId: this.config.clientId });
    this.client.on("message", (topic, payload) => {
      if (this.handler) this.handler(topic, payload);
    });
  }

  disconnect(): void {
    if (this.client) this.client.end();
  }

  publish(topic: string, payload: Uint8Array): void {
    this.client?.publish(topic, Buffer.from(payload));
  }

  subscribe(topic: string): void {
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
  ) {}

  publish(message: T): void {
    this.transport.publish(this.address, this.codec.encode(message).finish());
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
