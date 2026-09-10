'use strict';

const { toSnakeCase, assertValidPythonIdentifier } = require('../../naming');
const { groupChannels } = require('../../channel-groups');

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
  const { flat, groups } = groupChannels(channels, (c) => c.attrName);

  const imports = [...new Set(channels.map((c) => c.moduleAlias))]
    .sort()
    .map((alias) => `from ${projectName} import ${alias}`)
    .join('\n');

  // A tagged channel is reached as message_bus.<tag>.<channel>; the group is a SimpleNamespace
  // holding one Channel per member. `indent` is the leading whitespace of the `Channel(` line.
  // The trailing `retain` arg is only emitted for channels whose MQTT binding sets it, so
  // non-retained output is byte-for-byte unchanged.
  const channelExpr = (c, indent) => {
    const retainArg = c.retain ? ', True' : '';
    return `Channel(\n${indent}    "${c.address}", ${c.typeRef}, self._transport, self._dispatch${retainArg}\n${indent})`;
  };

  const flatAttrs = flat
    .map((c) => {
      const doc = c.description ? `        # ${c.description.trim().split('\n')[0]}\n` : '';
      return `${doc}        self.${c.attrName}: Channel[${c.typeRef}] = ${channelExpr(c, '        ')}`;
    })
    .join('\n');

  const groupAttrs = groups
    .map((g) => {
      const members = g.channels
        .map((c) => {
          const doc = c.description ? `            # ${c.description.trim().split('\n')[0]}\n` : '';
          return `${doc}            ${c.attrName}=${channelExpr(c, '            ')},`;
        })
        .join('\n');
      return `        # tag: ${g.tags.join(', ')}\n        self.${g.name} = SimpleNamespace(\n${members}\n        )`;
    })
    .join('\n');

  const channelAttrs = [flatAttrs, groupAttrs].filter(Boolean).join('\n');
  const simpleNamespaceImport = groups.length ? '\nfrom types import SimpleNamespace' : '';
  const examplePath = groups[0]
    ? `${groups[0].name}.${groups[0].channels[0].attrName}`
    : flat[0]
      ? flat[0].attrName
      : 'some_channel';

  const clientPy = `"""Generated MQTT message-bus client for ${projectName}. Do not edit by hand.

Each spec channel is exposed as a typed \`Channel\` on \`MessageBus\`. A channel that carries
AsyncAPI tags is nested under each tag (slugified): \`message_bus.<tag>.<channel>\`; a channel
with no tags stays top-level: \`message_bus.<channel>\`.

    message_bus.${examplePath}.subscribe(lambda msg: handle(msg))
    message_bus.${examplePath}.publish(msg)
    message_bus.${examplePath}.address

publish()/subscribe() always use protobuf binary encoding (SerializeToString/ParseFromString).
"""

from __future__ import annotations

import threading
from dataclasses import dataclass
from typing import Callable, Generic, Optional, Protocol, TypeVar${simpleNamespaceImport}

import paho.mqtt.client as mqtt

${imports}

TMessage = TypeVar("TMessage")


class MqttTransport(Protocol):
    """Abstraction over the MQTT transport used by MessageBus. Production code gets a
    PahoMqttTransport; tests inject an in-memory fake (see tests/test_client.py)."""

    def connect(self) -> None: ...

    def disconnect(self) -> None: ...

    def publish(self, topic: str, payload: bytes, retain: bool = False) -> None: ...

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

    # Optional MQTT Last-Will. When will_topic is set the broker publishes
    # will_payload to it if this client disconnects ungracefully.
    will_topic: str = ""
    will_payload: bytes = b""
    will_retain: bool = False


class PahoMqttTransport:
    """MqttTransport implementation backed by paho-mqtt. Connects asynchronously and runs
    paho's own background network thread (loop_start()); incoming messages are dispatched
    from that thread."""

    def __init__(self, config: MqttConfig) -> None:
        self._config = config
        self._client = mqtt.Client(client_id=config.client_id)
        self._handler: Optional[Callable[[str, bytes], None]] = None
        # paho-mqtt silently drops a subscribe() issued before CONNACK and never
        # replays subscriptions after a reconnect. Record every topic and
        # (re)issue them from on_connect.
        self._subscriptions: set[str] = set()
        self._sub_lock = threading.Lock()
        self._client.on_message = self._on_message
        self._client.on_connect = self._on_connect
        if config.will_topic:
            self._client.will_set(
                config.will_topic, config.will_payload, qos=0, retain=config.will_retain
            )

    def connect(self) -> None:
        self._client.connect_async(self._config.host, self._config.port, self._config.keepalive_seconds)
        self._client.loop_start()

    def disconnect(self) -> None:
        self._client.disconnect()
        self._client.loop_stop()

    def publish(self, topic: str, payload: bytes, retain: bool = False) -> None:
        self._client.publish(topic, payload, retain=retain)

    def subscribe(self, topic: str) -> None:
        with self._sub_lock:
            self._subscriptions.add(topic)
        # Harmless (MQTT_ERR_NO_CONN) if the socket isn't up yet; _on_connect
        # replays it (and every reconnect).
        self._client.subscribe(topic)

    def set_message_handler(self, handler: Callable[[str, bytes], None]) -> None:
        self._handler = handler

    def _on_connect(self, *_args: object) -> None:
        # Signature covers paho CallbackAPIVersion v1 (client, userdata, flags, rc)
        # and v2. A failed connect just makes the re-subscribes harmless no-ops.
        with self._sub_lock:
            topics = list(self._subscriptions)
        for topic in topics:
            self._client.subscribe(topic)

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
        retain: bool = False,
    ) -> None:
        self.address = address
        self._message_cls = message_cls
        self._transport = transport
        self._dispatch = dispatch
        self._retain = retain

    def publish(self, message: TMessage) -> None:
        self._transport.publish(self.address, message.SerializeToString(), self._retain)

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
