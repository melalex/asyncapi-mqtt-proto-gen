'use strict';

const { channelViewModels } = require('./client');
const { groupChannels } = require('../../channel-groups');

/**
 * Emits tests/client.test.ts: an in-memory FakeMqttTransport plus a publish/subscribe/address
 * Vitest case per channel, mirroring the cpp/python/js backends' generated test cases.
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

import { MessageBus, type MqttTransport } from "../src/client.js";
import * as messages from "../src/messages.js";

/** In-memory MqttTransport used by tests. */
class FakeMqttTransport implements MqttTransport {
  readonly published: Array<{ topic: string; payload: Uint8Array }> = [];
  readonly subscribedTopics: string[] = [];
  connected = false;
  private handler: ((topic: string, payload: Uint8Array) => void) | null = null;

  connect(): void {
    this.connected = true;
  }

  disconnect(): void {
    this.connected = false;
  }

  publish(topic: string, payload: Uint8Array): void {
    this.published.push({ topic, payload });
  }

  subscribe(topic: string): void {
    this.subscribedTopics.push(topic);
  }

  setMessageHandler(handler: (topic: string, payload: Uint8Array) => void): void {
    this.handler = handler;
  }

  /** Test helper: simulate the broker delivering \`payload\` on \`topic\`. */
  deliver(topic: string, payload: Uint8Array): void {
    if (this.handler) this.handler(topic, payload);
  }
}

${testCases}`;

  return [{ path: 'tests/client.test.ts', content }];
}

function testCasesFor(channel, groupName) {
  const { id, valueRef, address } = channel;
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

    ${accessor}.publish(${valueRef}.create({}));

    expect(transport.published).toHaveLength(1);
    expect(transport.published[0].topic).toBe("${address}");
    expect(() => ${valueRef}.decode(transport.published[0].payload)).not.toThrow();
  });

  it("subscribe dispatches incoming messages on its topic", () => {
    const transport = new FakeMqttTransport();
    const bus = new MessageBus(undefined, transport);

    let received: unknown = null;
    ${accessor}.subscribe((msg) => {
      received = msg;
    });

    expect(transport.subscribedTopics).toEqual(["${address}"]);

    const payload = ${valueRef}.encode(${valueRef}.create({})).finish();
    transport.deliver("${address}", payload);

    expect(received).not.toBeNull();
  });
});
`;
}

module.exports = { buildTestFiles };
