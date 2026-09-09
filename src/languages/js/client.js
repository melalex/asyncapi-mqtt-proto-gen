'use strict';

const { groupChannels } = require('../../channel-groups');

// A conservative, ASCII-only check (same rules as the python backend's identifier validation).
// JS identifiers technically also allow `$`/unicode, but every real AsyncAPI channel id in
// practice is already camelCase ASCII, and this keeps generated code as plain `this.foo = ...`
// property assignments instead of always falling back to bracket notation.
function assertValidJsIdentifier(name, context) {
  if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)) {
    throw new Error(`${context}: "${name}" is not a valid JavaScript identifier`);
  }
  return name;
}

/** Per-channel view model shared by client.js and tests.js so the two stay in sync. */
function channelViewModels(channels) {
  return channels.map((c) => {
    assertValidJsIdentifier(c.id, `Channel "${c.id}"`);
    return { ...c, typeRef: `messages.${c.protoPackage}.${c.protoMessageType}` };
  });
}

/**
 * Emits src/client.js (MqttJsTransport, Channel, MessageBus) and src/index.js.
 *
 * @param {{ channels: Array<object> }} model
 * @param {{ projectName: string }} ctx
 * @returns {Array<{ path: string, content: string }>}
 */
function buildClientFiles(model, ctx) {
  const { projectName } = ctx;
  const channels = channelViewModels(model.channels);
  const { flat, groups } = groupChannels(channels);

  // `messageBus.<channel>` for a Channel with no tags; `new Channel(...)` expression for a member
  // of a tag group. `indent` is the leading whitespace for the `new Channel(` line. The trailing
  // `retain` arg is only emitted for channels whose MQTT binding sets it, so non-retained output
  // is byte-for-byte unchanged.
  const channelExpr = (c, indent) => {
    const retainArg = c.retain ? ", true" : "";
    return `new Channel(\n${indent}  "${c.address}", ${c.typeRef}, this._transport, this._dispatch${retainArg}\n${indent})`;
  };

  const flatProps = flat
    .map((c) => {
      const doc = c.description ? `    // ${c.description.trim().split('\n')[0]}\n` : '';
      return `${doc}    this.${c.id} = ${channelExpr(c, '    ')};`;
    })
    .join('\n');

  const groupProps = groups
    .map((g) => {
      const members = g.channels
        .map((c) => {
          const doc = c.description ? `      // ${c.description.trim().split('\n')[0]}\n` : '';
          return `${doc}      ${c.id}: ${channelExpr(c, '      ')},`;
        })
        .join('\n');
      return `    // tag: ${g.tags.join(', ')}\n    this.${g.name} = {\n${members}\n    };`;
    })
    .join('\n');

  const channelProps = [flatProps, groupProps].filter(Boolean).join('\n');

  // Example accessor path for the docstring: a tagged channel becomes messageBus.<tag>.<channel>,
  // an untagged one stays messageBus.<channel>.
  const examplePath = groups[0]
    ? `${groups[0].name}.${groups[0].channels[0].id}`
    : flat[0]
      ? flat[0].id
      : 'someChannel';

  const clientJs = `/**
 * Generated MQTT message-bus client for ${projectName}. Do not edit by hand.
 *
 * Each spec channel is exposed as a typed \`Channel\` on \`MessageBus\`. A channel that carries
 * AsyncAPI tags is nested under each tag (slugified): \`messageBus.<tag>.<channel>\`; a channel
 * with no tags stays top-level: \`messageBus.<channel>\`.
 *
 *   messageBus.${examplePath}.subscribe((msg) => handle(msg));
 *   messageBus.${examplePath}.publish(msg);
 *   messageBus.${examplePath}.address;
 *
 * publish()/subscribe() always use protobuf binary encoding (Type.encode(...).finish() /
 * Type.decode(...) — protobufjs's static API, see src/generated/messages.js).
 */

import mqtt from "mqtt";

import messages from "./generated/messages.js";

/**
 * @typedef {Object} MqttTransport Duck-typed transport interface (no TS compiler here to check
 *   it, but every implementation — MqttJsTransport below, and FakeMqttTransport in tests — has
 *   the same five methods).
 * @property {() => void} connect
 * @property {() => void} disconnect
 * @property {(topic: string, payload: Uint8Array, retain?: boolean) => void} publish
 * @property {(topic: string) => void} subscribe
 * @property {(handler: (topic: string, payload: Uint8Array) => void) => void} setMessageHandler
 */

/**
 * @typedef {Object} MqttConfig
 * @property {string} [url] Broker URL. Browsers can only speak MQTT over WebSockets, not raw TCP
 *   — this must point at a websocket listener (e.g. Mosquitto's \`protocol websockets\`), not the
 *   usual TCP 1883 port.
 * @property {string} [clientId]
 */

/** @type {MqttConfig} */
const DEFAULT_CONFIG = {
  url: "ws://localhost:9001",
  clientId: "${projectName}",
};

/**
 * MqttTransport implementation backed by MQTT.js. connect() opens the WebSocket connection;
 * incoming messages are dispatched from MQTT.js's own 'message' event.
 * @implements {MqttTransport}
 */
export class MqttJsTransport {
  /** @param {MqttConfig} [config] */
  constructor(config) {
    this._config = { ...DEFAULT_CONFIG, ...config };
    this._client = null;
    this._handler = null;
  }

  connect() {
    this._client = mqtt.connect(this._config.url, { clientId: this._config.clientId });
    this._client.on("message", (topic, payload) => {
      if (this._handler) this._handler(topic, payload);
    });
  }

  disconnect() {
    if (this._client) this._client.end();
  }

  /**
   * @param {string} topic
   * @param {Uint8Array} payload
   * @param {boolean} [retain] set the MQTT retain flag on this publish
   */
  publish(topic, payload, retain = false) {
    this._client.publish(topic, payload, { retain });
  }

  /** @param {string} topic */
  subscribe(topic) {
    this._client.subscribe(topic);
  }

  /** @param {(topic: string, payload: Uint8Array) => void} handler */
  setMessageHandler(handler) {
    this._handler = handler;
  }
}

/**
 * One MQTT channel, typed to its proto message. See the module docstring for the API.
 */
export class Channel {
  /**
   * @param {string} address
   * @param {{ encode: Function, decode: Function }} messageType a generated protobufjs static
   *   message class (e.g. messages.fleet.control.MotorCommand)
   * @param {MqttTransport} transport
   * @param {Map<string, (payload: Uint8Array) => void>} dispatch
   * @param {boolean} [retain] publish with the MQTT retain flag set (from the channel's binding)
   */
  constructor(address, messageType, transport, dispatch, retain = false) {
    this.address = address;
    this._messageType = messageType;
    this._transport = transport;
    this._dispatch = dispatch;
    this._retain = retain;
  }

  /** @param {object} message a plain object matching the proto shape, or a message instance */
  publish(message) {
    this._transport.publish(this.address, this._messageType.encode(message).finish(), this._retain);
  }

  /** @param {(message: object) => void} handler */
  subscribe(handler) {
    this._transport.subscribe(this.address);
    this._dispatch.set(this.address, (payload) => handler(this._messageType.decode(payload)));
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
  /**
   * @param {MqttConfig} [config]
   * @param {MqttTransport} [transport]
   */
  constructor(config, transport) {
    this._transport = transport || new MqttJsTransport(config);
    /** @type {Map<string, (payload: Uint8Array) => void>} */
    this._dispatch = new Map();
    this._transport.setMessageHandler((topic, payload) => {
      const handler = this._dispatch.get(topic);
      if (handler) handler(payload);
    });

${channelProps}
  }

  connect() {
    this._transport.connect();
  }

  disconnect() {
    this._transport.disconnect();
  }
}
`;

  const indexJs = `export { MessageBus, Channel, MqttJsTransport } from "./client.js";
export { default as messages } from "./generated/messages.js";
`;

  return [
    { path: 'src/client.js', content: clientJs },
    { path: 'src/index.js', content: indexJs },
  ];
}

module.exports = { buildClientFiles, channelViewModels };
