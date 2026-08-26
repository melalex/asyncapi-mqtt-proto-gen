'use strict';

const { toSnakeCase, assertValidPythonIdentifier } = require('../../naming');

function protoModuleStem(protoPackage) {
  return protoPackage.split('.').pop();
}

/** Per-channel view model shared by client.js and tests.js so the two stay in sync. */
function channelViewModels(channels) {
  const seen = new Map(); // attrName -> channel.id, to catch snake_case collisions
  return channels.map((c) => {
    const attrName = assertValidPythonIdentifier(toSnakeCase(c.id), `Channel "${c.id}"`);
    const collidesWith = seen.get(attrName);
    if (collidesWith && collidesWith !== c.id) {
      throw new Error(
        `Channels "${collidesWith}" and "${c.id}" both map to the Python attribute name ` +
          `"${attrName}"; rename one of them in the spec.`
      );
    }
    seen.set(attrName, c.id);

    const moduleStem = protoModuleStem(c.protoPackage);
    return {
      ...c,
      attrName,
      moduleStem,
      moduleAlias: `${moduleStem}_pb2`,
      typeRef: `${moduleStem}_pb2.${c.protoMessageType}`,
    };
  });
}

/**
 * Emits src/<projectName>/client.py (MqttTransport protocol, MqttConfig, PahoMqttTransport,
 * Channel[T], MessageBus) and src/<projectName>/__init__.py.
 *
 * @param {{ channels: Array<object> }} model
 * @param {{ projectName: string }} ctx
 * @returns {Array<{ path: string, content: string }>}
 */
function buildClientFiles(model, ctx) {
  const { projectName } = ctx;
  const channels = channelViewModels(model.channels);

  const imports = [...new Set(channels.map((c) => c.moduleAlias))]
    .sort()
    .map((alias) => `from ${projectName} import ${alias}`)
    .join('\n');

  const channelAttrs = channels
    .map((c) => {
      const doc = c.description ? `        # ${c.description.trim().split('\n')[0]}\n` : '';
      return (
        `${doc}        self.${c.attrName}: Channel[${c.typeRef}] = Channel(\n` +
        `            "${c.address}", ${c.typeRef}, self._transport, self._dispatch\n` +
        `        )`
      );
    })
    .join('\n');

  const clientPy = `"""Generated MQTT message-bus client for ${projectName}. Do not edit by hand.

Every channel from the spec is exposed as a typed \`Channel\` attribute on \`MessageBus\`:

    message_bus.${channels[0] ? channels[0].attrName : 'some_channel'}.subscribe(lambda msg: handle(msg))
    message_bus.${channels[0] ? channels[0].attrName : 'some_channel'}.publish(msg)
    message_bus.${channels[0] ? channels[0].attrName : 'some_channel'}.address

publish()/subscribe() always use protobuf binary encoding (SerializeToString/ParseFromString).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Generic, Optional, Protocol, TypeVar

import paho.mqtt.client as mqtt

${imports}

TMessage = TypeVar("TMessage")


class MqttTransport(Protocol):
    """Abstraction over the MQTT transport used by MessageBus. Production code gets a
    PahoMqttTransport; tests inject an in-memory fake (see tests/test_client.py)."""

    def connect(self) -> None: ...

    def disconnect(self) -> None: ...

    def publish(self, topic: str, payload: bytes) -> None: ...

    def subscribe(self, topic: str) -> None: ...

    # Installs the single handler invoked for every incoming message, on every subscribed topic.
    # MessageBus uses this to dispatch to the right Channel by topic.
    def set_message_handler(self, handler: Callable[[str, bytes], None]) -> None: ...


@dataclass
class MqttConfig:
    host: str = "localhost"
    port: int = 1883
    client_id: str = "${projectName}"
    keepalive_seconds: int = 60


class PahoMqttTransport:
    """MqttTransport implementation backed by paho-mqtt. Connects asynchronously and runs
    paho's own background network thread (loop_start()); incoming messages are dispatched
    from that thread."""

    def __init__(self, config: MqttConfig) -> None:
        self._config = config
        self._client = mqtt.Client(client_id=config.client_id)
        self._handler: Optional[Callable[[str, bytes], None]] = None
        self._client.on_message = self._on_message

    def connect(self) -> None:
        self._client.connect_async(self._config.host, self._config.port, self._config.keepalive_seconds)
        self._client.loop_start()

    def disconnect(self) -> None:
        self._client.disconnect()
        self._client.loop_stop()

    def publish(self, topic: str, payload: bytes) -> None:
        self._client.publish(topic, payload)

    def subscribe(self, topic: str) -> None:
        self._client.subscribe(topic)

    def set_message_handler(self, handler: Callable[[str, bytes], None]) -> None:
        self._handler = handler

    def _on_message(self, _client: mqtt.Client, _userdata: object, message: mqtt.MQTTMessage) -> None:
        if self._handler is not None:
            self._handler(message.topic, message.payload)


class Channel(Generic[TMessage]):
    """One MQTT channel, typed to its proto message. See the module docstring for the API."""

    def __init__(
        self,
        address: str,
        message_cls: type[TMessage],
        transport: MqttTransport,
        dispatch: dict[str, Callable[[bytes], None]],
    ) -> None:
        self.address = address
        self._message_cls = message_cls
        self._transport = transport
        self._dispatch = dispatch

    def publish(self, message: TMessage) -> None:
        self._transport.publish(self.address, message.SerializeToString())

    def subscribe(self, handler: Callable[[TMessage], None]) -> None:
        self._transport.subscribe(self.address)

        def _decode(payload: bytes) -> None:
            message = self._message_cls()
            message.ParseFromString(payload)
            handler(message)

        self._dispatch[self.address] = _decode


class MessageBus:
    """Owns the MQTT connection and exposes one Channel attribute per spec channel.

    Pass \`config\` to connect to a real broker via PahoMqttTransport, or \`transport\` to inject a
    caller-provided transport (e.g. an in-memory fake in tests). Exactly one of the two should be
    given; \`transport\` takes precedence if both are.
    """

    def __init__(
        self,
        config: Optional[MqttConfig] = None,
        transport: Optional[MqttTransport] = None,
    ) -> None:
        self._transport: MqttTransport = transport if transport is not None else PahoMqttTransport(
            config if config is not None else MqttConfig()
        )
        self._dispatch: dict[str, Callable[[bytes], None]] = {}
        self._transport.set_message_handler(self._on_message)

${channelAttrs}

    def connect(self) -> None:
        self._transport.connect()

    def disconnect(self) -> None:
        self._transport.disconnect()

    def _on_message(self, topic: str, payload: bytes) -> None:
        handler = self._dispatch.get(topic)
        if handler is not None:
            handler(payload)
`;

  const initPy = `"""${projectName}: generated MQTT message-bus client."""

from ${projectName}.client import MessageBus, MqttConfig

__all__ = ["MessageBus", "MqttConfig"]
`;

  return [
    { path: `src/${projectName}/client.py`, content: clientPy },
    { path: `src/${projectName}/__init__.py`, content: initPy },
  ];
}

module.exports = { buildClientFiles, channelViewModels };
