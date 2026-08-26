'use strict';

const { channelViewModels } = require('./client');

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

  const imports = [...new Set(channels.map((c) => c.moduleAlias))]
    .sort()
    .map((alias) => `from ${projectName} import ${alias}`)
    .join('\n');

  const testFunctions = channels.map((c) => testFunctionsFor(projectName, c)).join('\n');

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
        self.published: list[tuple[str, bytes]] = []
        self.subscribed_topics: list[str] = []
        self.connected = False
        self._handler: Optional[Callable[[str, bytes], None]] = None

    def connect(self) -> None:
        self.connected = True

    def disconnect(self) -> None:
        self.connected = False

    def publish(self, topic: str, payload: bytes) -> None:
        self.published.append((topic, payload))

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

function testFunctionsFor(projectName, channel) {
  const { attrName, typeRef, address } = channel;

  return `def test_${attrName}_address() -> None:
    transport = FakeMqttTransport()
    bus = MessageBus(transport=transport)

    assert bus.${attrName}.address == "${address}"


def test_${attrName}_publish_sends_a_protobuf_encoded_message() -> None:
    transport = FakeMqttTransport()
    bus = MessageBus(transport=transport)

    message = ${typeRef}()
    bus.${attrName}.publish(message)

    assert len(transport.published) == 1
    topic, payload = transport.published[0]
    assert topic == "${address}"

    round_tripped = ${typeRef}()
    round_tripped.ParseFromString(payload)  # doesn't raise


def test_${attrName}_subscribe_dispatches_incoming_messages() -> None:
    transport = FakeMqttTransport()
    bus = MessageBus(transport=transport)

    received: list[${typeRef}] = []
    bus.${attrName}.subscribe(lambda msg: received.append(msg))

    assert transport.subscribed_topics == ["${address}"]

    message = ${typeRef}()
    transport.deliver("${address}", message.SerializeToString())

    assert len(received) == 1
`;
}

module.exports = { buildTestFiles };
