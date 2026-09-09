'use strict';

const { channelViewModels } = require('./client');
const { groupChannels } = require('../../channel-groups');

/**
 * Emits tests/test_client.py: an in-memory FakeMqttTransport plus a publish/subscribe/address
 * pytest function per channel, mirroring the cpp backend's generated Catch2 cases.
 *
 * @param {{ channels: Array<object> }} model
 * @param {{ projectName: string }} ctx
 * @returns {Array<{ path: string, content: string }>}
 */
function buildTestFiles(model, ctx) {
  const { projectName } = ctx;
  const channels = channelViewModels(model.channels);
  const { flat, groups } = groupChannels(channels, (c) => c.attrName);

  const imports = [...new Set(channels.map((c) => c.moduleAlias))]
    .sort()
    .map((alias) => `from ${projectName} import ${alias}`)
    .join('\n');

  const testFunctions = [
    ...flat.map((c) => testFunctionsFor(c)),
    ...groups.flatMap((g) => g.channels.map((c) => testFunctionsFor(c, g.name))),
  ].join('\n');

  const content = `"""Generated tests: one publish/subscribe/address check per channel, using the in-memory
FakeMqttTransport so no real MQTT broker is needed."""

from __future__ import annotations

from typing import Callable, Optional

from ${projectName}.client import MessageBus
${imports}


class FakeMqttTransport:
    """In-memory MqttTransport used by tests: publish() records into an inspectable list, and
    deliver() simulates an incoming broker message by invoking the handler MessageBus installed
    via set_message_handler()."""

    def __init__(self) -> None:
        self.published: list[tuple[str, bytes, bool]] = []
        self.subscribed_topics: list[str] = []
        self.connected = False
        self._handler: Optional[Callable[[str, bytes], None]] = None

    def connect(self) -> None:
        self.connected = True

    def disconnect(self) -> None:
        self.connected = False

    def publish(self, topic: str, payload: bytes, retain: bool = False) -> None:
        self.published.append((topic, payload, retain))

    def subscribe(self, topic: str) -> None:
        self.subscribed_topics.append(topic)

    def set_message_handler(self, handler: Callable[[str, bytes], None]) -> None:
        self._handler = handler

    def deliver(self, topic: str, payload: bytes) -> None:
        """Test helper: simulate the broker delivering \`payload\` on \`topic\`."""
        if self._handler is not None:
            self._handler(topic, payload)


${testFunctions}`;

  return [{ path: 'tests/test_client.py', content }];
}

function testFunctionsFor(channel, groupName) {
  const { attrName, typeRef, address, retain } = channel;
  const accessor = groupName ? `bus.${groupName}.${attrName}` : `bus.${attrName}`;
  const fn = groupName ? `${groupName}__${attrName}` : attrName;

  return `def test_${fn}_address() -> None:
    transport = FakeMqttTransport()
    bus = MessageBus(transport=transport)

    assert ${accessor}.address == "${address}"


def test_${fn}_publish_sends_a_protobuf_encoded_message() -> None:
    transport = FakeMqttTransport()
    bus = MessageBus(transport=transport)

    message = ${typeRef}()
    ${accessor}.publish(message)

    assert len(transport.published) == 1
    topic, payload, retain = transport.published[0]
    assert topic == "${address}"
    assert retain is ${retain ? 'True' : 'False'}

    round_tripped = ${typeRef}()
    round_tripped.ParseFromString(payload)  # doesn't raise


def test_${fn}_subscribe_dispatches_incoming_messages() -> None:
    transport = FakeMqttTransport()
    bus = MessageBus(transport=transport)

    received: list[${typeRef}] = []
    ${accessor}.subscribe(lambda msg: received.append(msg))

    assert transport.subscribed_topics == ["${address}"]

    message = ${typeRef}()
    transport.deliver("${address}", message.SerializeToString())

    assert len(received) == 1
`;
}

module.exports = { buildTestFiles };
