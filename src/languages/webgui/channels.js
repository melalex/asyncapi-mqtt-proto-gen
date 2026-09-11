'use strict';

const { groupChannels } = require('../../channel-groups');

/**
 * Per-channel view model. Unlike every other backend, channel ids here are NEVER turned into a
 * JS/TS property/identifier (message lookup happens at runtime via protobufjs reflection, keyed
 * by protoPackage + protoMessageType — see src/codec/messageTypes.ts), so there is no
 * assertValidIdentifier-style check to run per channel id.
 */
function channelViewModels(channels) {
  return channels.map((c) => ({ ...c }));
}

// AsyncAPI server protocols that imply a TLS-secured connection. Anything else (plain "mqtt",
// "ws", or unrecognized) is treated as non-TLS — matching this generator's own scope: MQTT only.
const SECURE_PROTOCOLS = /^(mqtts|secure-mqtt|wss)$/i;

/**
 * Best-effort mapping from a spec-declared server to a seed connection for the GUI's Connections
 * dialog. Faithful to the spec but NOT guaranteed to work as-is: a server declaring the raw
 * "mqtt" protocol (as opposed to "ws"/"wss") gives no information about a browser-usable
 * WebSocket listener — the seed still carries whatever port the spec's host string declares (raw
 * MQTT's, typically 1883/8883), which the user will commonly need to correct to their broker's
 * actual WebSocket bridge port. The seed's `description` carries that caveat through into the UI.
 */
function buildServerSeeds(servers) {
  return servers.map((server) => {
    const secure = SECURE_PROTOCOLS.test(server.protocol || '');
    const match = /^(.*):(\d+)$/.exec(server.host || '');
    const host = (match ? match[1] : server.host) || 'localhost';
    const port = match ? Number(match[2]) : undefined;
    const caveat = secure || /^wss?$/i.test(server.protocol || '')
      ? undefined
      : `Spec declares protocol "${server.protocol}" — browsers need a WebSocket listener, so the port may need to point at your broker's WS bridge rather than its raw MQTT port.`;
    const description = [server.description, caveat].filter(Boolean).join(' ') || undefined;

    return { id: server.id, host, port, protocol: secure ? 'wss' : 'ws', tls: secure, description };
  });
}

/**
 * Emits src/channels.ts: plain, JSON-serializable channel/group metadata (id, address,
 * description, tags, retain, protoPackage, protoMessageType) — no generated per-message code.
 *
 * @param {{ channels: Array<object>, servers: Array<object> }} model
 * @param {{ specTitle: string }} ctx
 * @returns {Array<{ path: string, content: string }>}
 */
function buildChannelsFile(model, ctx) {
  const channels = channelViewModels(model.channels);
  const { flat, groups } = groupChannels(channels);
  const serverSeeds = buildServerSeeds(model.servers || []);

  const content = `/**
 * Generated channel metadata. Do not edit by hand.
 *
 * Plain data describing every MQTT channel in the spec grouped the same way as every other
 * backend (an untagged channel is flat; a tagged channel is nested under one entry per tag,
 * slugified; a multi-tag channel appears in every one of its groups). No per-channel JS symbols:
 * message lookup happens at runtime via protobufjs reflection keyed on protoPackage +
 * protoMessageType (see src/codec/messageTypes.ts).
 */

/** The AsyncAPI spec's info.title, used as the app's displayed name (e.g. the top bar). */
export const specTitle: string = ${JSON.stringify(ctx.specTitle)};

export interface ChannelMeta {
  id: string;
  address: string;
  description?: string;
  tags: string[];
  retain: boolean;
  protoPackage: string;
  protoMessageType: string;
}

export interface ChannelGroup {
  name: string;
  tags: string[];
  channels: ChannelMeta[];
}

export const flatChannels: ChannelMeta[] = ${JSON.stringify(flat, null, 2)};

export const channelGroups: ChannelGroup[] = ${JSON.stringify(groups, null, 2)};

/** Every channel exactly once, regardless of how many tag groups it belongs to. */
export const allChannels: ChannelMeta[] = (() => {
  const seen = new Set<string>();
  const result: ChannelMeta[] = [];
  for (const channel of [...flatChannels, ...channelGroups.flatMap((g) => g.channels)]) {
    if (seen.has(channel.id)) continue;
    seen.add(channel.id);
    result.push(channel);
  }
  return result;
})();

/** Best-effort connection seeds derived from the spec's \`servers\` section — see storage/connections.ts's ensureSeedConnections(). */
export interface ServerConnectionSeed {
  id: string;
  host: string;
  port?: number;
  protocol: "ws" | "wss";
  tls: boolean;
  description?: string;
}

export const serverSeeds: ServerConnectionSeed[] = ${JSON.stringify(serverSeeds, null, 2)};
`;

  return [{ path: 'src/channels.ts', content }];
}

module.exports = { buildChannelsFile, channelViewModels };
