'use strict';

const { extractProtoDeclarations } = require('./proto-extract');

/**
 * Builds the shared, language-agnostic intermediate representation every language backend
 * consumes: one entry per channel (name/address/proto type), plus the full set of proto
 * declarations grouped by proto `package` (deduplicated by declaration name, since the same
 * message is commonly referenced by more than one channel).
 *
 * @param {import('@asyncapi/parser').AsyncAPIDocument} asyncapiDoc parsed AsyncAPI document
 * @returns {{
 *   channels: Array<{ id: string, address: string, description: string|undefined,
 *                      tags: string[], retain: boolean, protoPackage: string,
 *                      protoMessageType: string }>,
 *   protoPackages: Map<string, Map<string, { kind: string, name: string, text: string }>>
 * }}
 */
function parseAsyncApiDocument(asyncapiDoc) {
  const channels = asyncapiDoc.channels().all();
  const channelModels = [];
  const protoPackages = new Map();

  // MQTT `retain` is declared per channel via `channels.<id>.bindings.mqtt.retain`. The AsyncAPI
  // MQTT binding spec actually defines `retain` on the *operation* binding, so fall back to that:
  // an explicit channel-level value (true or false) always wins; only a channel with no `retain`
  // key inherits it from a `send` operation that targets it. Bindings are untouched by any schema
  // parser, so `.bindings().get('mqtt')` reads the same under the CLI and a bare `new Parser()`.
  const operationRetainChannelIds = new Set();
  for (const operation of asyncapiDoc.operations ? asyncapiDoc.operations().all() : []) {
    if (operation.action && operation.action() !== 'send') continue;
    const opMqtt = operation.bindings ? operation.bindings().get('mqtt') : undefined;
    if (opMqtt && opMqtt.json('retain') === true) {
      for (const ch of operation.channels().all()) {
        operationRetainChannelIds.add(ch.id());
      }
    }
  }

  for (const channel of channels) {
    const channelId = channel.id();
    const messages = channel.messages().all();
    if (messages.length !== 1) {
      throw new Error(
        `Channel "${channelId}" declares ${messages.length} messages; this generator only supports ` +
          'exactly one message per channel.'
      );
    }
    const message = messages[0];
    const messageId = message.id();

    const payload = message.payload();
    const rawPayload = payload && typeof payload.json === 'function' ? payload.json() : undefined;
    // When a protobuf schema-parser plugin is registered (as the real `asyncapi` CLI does),
    // payload.json().schema is replaced by a structurally-parsed JSON Schema, and the original
    // proto3 source text is preserved separately under 'x-parser-original-payload'. Without such
    // a plugin (e.g. a bare `new Parser()` with no extra schema parsers registered), .schema
    // stays the raw proto3 string as authored. Support both so this works identically whether
    // it's driven by the CLI or invoked programmatically.
    const schemaText =
      rawPayload &&
      (typeof rawPayload['x-parser-original-payload'] === 'string'
        ? rawPayload['x-parser-original-payload']
        : typeof rawPayload.schema === 'string'
          ? rawPayload.schema
          : undefined);
    if (!schemaText) {
      throw new Error(
        `Channel "${channelId}": message "${messageId}" has no inline proto payload.schema string.`
      );
    }
    if (!/protobuf/i.test(rawPayload.schemaFormat || '')) {
      throw new Error(
        `Channel "${channelId}": message "${messageId}" has schemaFormat ` +
          `"${rawPayload.schemaFormat}", but only inline proto3 payloads ` +
          '("application/vnd.google.protobuf;version=3") are supported.'
      );
    }

    const { package: protoPackage, declarations } = extractProtoDeclarations(schemaText);
    if (declarations.length === 0) {
      throw new Error(`Channel "${channelId}": message "${messageId}" has no message/enum declarations.`);
    }

    let pkgMap = protoPackages.get(protoPackage);
    if (!pkgMap) {
      pkgMap = new Map();
      protoPackages.set(protoPackage, pkgMap);
    }
    for (const decl of declarations) {
      const existing = pkgMap.get(decl.name);
      if (existing && existing.text !== decl.text) {
        throw new Error(
          `Proto declaration "${decl.name}" in package "${protoPackage}" has conflicting bodies across ` +
            'messages that are supposed to share it. Fix the AsyncAPI spec so every occurrence is identical.'
        );
      }
      if (!existing) {
        pkgMap.set(decl.name, decl);
      }
    }

    // The declaration that represents this message's own wire type: prefer a top-level `message`
    // declaration whose name matches the AsyncAPI message name (the spec's own convention);
    // fall back to the last `message` declaration in the schema block otherwise.
    const messageDecls = declarations.filter((d) => d.kind === 'message');
    if (messageDecls.length === 0) {
      throw new Error(
        `Channel "${channelId}": message "${messageId}" schema only declares enum(s), no top-level "message".`
      );
    }
    const matching = messageDecls.find((d) => d.name === messageId);
    const protoMessageType = (matching || messageDecls[messageDecls.length - 1]).name;

    const channelMqtt = channel.bindings ? channel.bindings().get('mqtt') : undefined;
    const channelRetain = channelMqtt ? channelMqtt.json('retain') : undefined;
    const retain =
      channelRetain === true ||
      (channelRetain === undefined && operationRetainChannelIds.has(channelId));

    channelModels.push({
      id: channelId,
      address: channel.address(),
      description: channel.description ? channel.description() : undefined,
      // AsyncAPI v3 tags on the channel; drive the grouped client API (messageBus.<tag>.<channel>).
      // Always a (possibly empty) array — channel.tags() returns an empty collection when absent.
      tags: channel.tags ? channel.tags().all().map((t) => t.name()) : [],
      // MQTT retain flag for publishes on this channel (see the operation fallback above).
      retain,
      protoPackage,
      protoMessageType,
    });
  }

  return { channels: channelModels, protoPackages };
}

module.exports = { parseAsyncApiDocument };
