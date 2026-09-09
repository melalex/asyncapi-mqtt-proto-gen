'use strict';

const { channelViewModels } = require('./client');
const { groupChannels } = require('../../channel-groups');

/**
 * Emits tests/client.test.js: an in-memory FakeMqttTransport plus a publish/subscribe/address
 * Vitest case per channel, mirroring the cpp/python backends' generated test cases.
 *
 * @param {{ channels: Array<object> }} model
 * @returns {Array<{ path: string, content: string }>}
 */
function buildTestFiles(model) {
  const { flat, groups } = groupChannels(channelViewModels(model.channels));
  const testCases = [
    ...flat.map((c) => testCasesFor(c)),
    ...groups.flatMap((g) => g.channels.map((c) => testCasesFor(c, g.name))),
  ].join('\n');

  const content = `// Generated tests: one publish/subscribe/address check per channel, using the in-memory
// FakeMqttTransport so no real MQTT broker is needed.
import { describe, it, expect } from "vitest";

import { MessageBus } from "../src/client.js";
import messages from "../src/generated/messages.js";

/** In-memory MqttTransport used by tests. */
class FakeMqttTransport {
  constructor() {
    /** @type {Array<{ topic: string, payload: Uint8Array, retain: boolean }>} */
    this.published = [];
    /** @type {string[]} */
    this.subscribedTopics = [];
    this.connected = false;
    this._handler = null;
  }

  connect() {
    this.connected = true;
  }

  disconnect() {
    this.connected = false;
  }

  publish(topic, payload, retain = false) {
    this.published.push({ topic, payload, retain });
  }

  subscribe(topic) {
    this.subscribedTopics.push(topic);
  }

  setMessageHandler(handler) {
    this._handler = handler;
  }

  /** Test helper: simulate the broker delivering \`payload\` on \`topic\`. */
  deliver(topic, payload) {
    if (this._handler) this._handler(topic, payload);
  }
}

${testCases}`;

  return [{ path: 'tests/client.test.js', content }];
}

function testCasesFor(channel, groupName) {
  const { id, typeRef, address, retain } = channel;
  const accessor = groupName ? `bus.${groupName}.${id}` : `bus.${id}`;
  const label = groupName ? `${groupName}.${id}` : id;

  return `describe("${label}", () => {
  it("address matches the spec", () => {
    const transport = new FakeMqttTransport();
    const bus = new MessageBus(undefined, transport);

    expect(${accessor}.address).toBe("${address}");
  });

  it("publish sends a protobuf-encoded message to its topic", () => {
    const transport = new FakeMqttTransport();
    const bus = new MessageBus(undefined, transport);

    ${accessor}.publish(${typeRef}.create({}));

    expect(transport.published).toHaveLength(1);
    expect(transport.published[0].topic).toBe("${address}");
    expect(transport.published[0].retain).toBe(${retain ? 'true' : 'false'});
    expect(() => ${typeRef}.decode(transport.published[0].payload)).not.toThrow();
  });

  it("subscribe dispatches incoming messages on its topic", () => {
    const transport = new FakeMqttTransport();
    const bus = new MessageBus(undefined, transport);

    let received = null;
    ${accessor}.subscribe((msg) => {
      received = msg;
    });

    expect(transport.subscribedTopics).toEqual(["${address}"]);

    const payload = ${typeRef}.encode(${typeRef}.create({})).finish();
    transport.deliver("${address}", payload);

    expect(received).not.toBeNull();
  });
});
`;
}

module.exports = { buildTestFiles };
