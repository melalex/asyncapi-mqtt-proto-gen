'use strict';

const { assertValidCppIdentifier } = require('../../naming');

function protoNamespace(protoPackage) {
  return protoPackage.split('.').join('::');
}

function protoHeaderStem(protoPackage) {
  return protoPackage.split('.').pop();
}

/**
 * Emits the public headers (`mqtt_transport.hpp`, `mosquitto_transport.hpp`, `message_bus.hpp`)
 * and their `src/*.cpp` implementations for the C++ client.
 *
 * @param {{ channels: Array<object> }} model shared IR from src/model.js
 * @param {{ projectName: string }} ctx
 * @returns {Array<{ path: string, content: string }>}
 */
function buildMessageBusFiles(model, ctx) {
  const { projectName } = ctx;
  const channels = model.channels;

  for (const channel of channels) {
    assertValidCppIdentifier(channel.id, `Channel "${channel.id}"`);
  }

  const protoIncludes = [...new Set(channels.map((c) => protoHeaderStem(c.protoPackage)))]
    .sort()
    .map((stem) => `#include "${stem}.pb.h"`)
    .join('\n');

  const channelMembers = channels
    .map((c) => {
      const type = `${protoNamespace(c.protoPackage)}::${c.protoMessageType}`;
      const doc = c.description ? `  // ${c.description.trim().split('\n')[0]}\n` : '';
      return `${doc}  Channel<${type}> ${c.id}{"${c.address}", *transport_, dispatch_};`;
    })
    .join('\n');

  const files = [];

  files.push({ path: `include/${projectName}/mqtt_transport.hpp`, content: mqttTransportHpp(projectName) });
  files.push({
    path: `include/${projectName}/mosquitto_transport.hpp`,
    content: mosquittoTransportHpp(projectName),
  });
  files.push({
    path: `include/${projectName}/message_bus.hpp`,
    content: messageBusHpp(projectName, protoIncludes, channelMembers),
  });
  files.push({ path: 'src/mosquitto_transport.cpp', content: mosquittoTransportCpp(projectName) });
  files.push({ path: 'src/message_bus.cpp', content: messageBusCpp(projectName) });

  return files;
}

function mqttTransportHpp(projectName) {
  return `#pragma once

#include <functional>
#include <string>

namespace ${projectName} {

// Abstraction over the MQTT transport used by MessageBus. Production code gets a
// MosquittoTransport; tests inject an in-memory fake (see tests/fake_mqtt_transport.hpp).
class IMqttTransport {
 public:
  using MessageHandler = std::function<void(const std::string& topic, const std::string& payload)>;

  virtual ~IMqttTransport() = default;

  virtual void connect() = 0;
  virtual void disconnect() = 0;
  virtual void publish(const std::string& topic, const std::string& payload) = 0;
  virtual void subscribe(const std::string& topic) = 0;

  // Installs the single handler invoked for every incoming message, on every subscribed topic.
  // MessageBus uses this to dispatch to the right Channel<T> by topic.
  virtual void setMessageHandler(MessageHandler handler) = 0;
};

}  // namespace ${projectName}
`;
}

function mosquittoTransportHpp(projectName) {
  return `#pragma once

#include <memory>
#include <string>

#include "${projectName}/mqtt_transport.hpp"

struct mosquitto;
struct mosquitto_message;

namespace ${projectName} {

struct MqttConfig {
  std::string host = "localhost";
  int port = 1883;
  std::string clientId = "${projectName}";
  int keepAliveSeconds = 60;
};

// IMqttTransport implementation backed by Eclipse libmosquitto. Connects asynchronously and
// runs mosquitto's own background thread (mosquitto_loop_start); incoming messages are
// dispatched from that thread.
class MosquittoTransport : public IMqttTransport {
 public:
  explicit MosquittoTransport(MqttConfig config);
  ~MosquittoTransport() override;

  MosquittoTransport(const MosquittoTransport&) = delete;
  MosquittoTransport& operator=(const MosquittoTransport&) = delete;

  void connect() override;
  void disconnect() override;
  void publish(const std::string& topic, const std::string& payload) override;
  void subscribe(const std::string& topic) override;
  void setMessageHandler(MessageHandler handler) override;

 private:
  struct MosquittoDeleter {
    void operator()(mosquitto* client) const;
  };

  static void onConnect(mosquitto* client, void* userData, int rc);
  static void onDisconnect(mosquitto* client, void* userData, int rc);
  static void onMessage(mosquitto* client, void* userData, const mosquitto_message* message);

  MqttConfig config_;
  std::unique_ptr<mosquitto, MosquittoDeleter> client_;
  MessageHandler handler_;
};

}  // namespace ${projectName}
`;
}

function messageBusHpp(projectName, protoIncludes, channelMembers) {
  return `#pragma once

#include <functional>
#include <memory>
#include <string>
#include <unordered_map>
#include <utility>

#include "${projectName}/mosquitto_transport.hpp"
#include "${projectName}/mqtt_transport.hpp"

${protoIncludes}

namespace ${projectName} {

// One MQTT channel, typed to its proto message. Every channel generated from the AsyncAPI spec
// gets exactly this shape:
//
//   messageBus.someChannel.publish(msg);
//   messageBus.someChannel.subscribe([](const SomeMessage& msg) { ... });
//   messageBus.someChannel.address;  // e.g. "some/topic"
//
// Publish/subscribe always use protobuf binary encoding (SerializeToString/ParseFromString).
template <typename TMessage>
class Channel {
 public:
  Channel(std::string channelAddress, IMqttTransport& transport,
          std::unordered_map<std::string, std::function<void(const std::string&)>>& dispatch)
      : address(std::move(channelAddress)), transport_(transport), dispatch_(dispatch) {}

  void publish(const TMessage& message) const {
    std::string payload;
    if (!message.SerializeToString(&payload)) {
      return;
    }
    transport_.publish(address, payload);
  }

  void subscribe(std::function<void(const TMessage&)> handler) {
    transport_.subscribe(address);
    dispatch_[address] = [handler = std::move(handler)](const std::string& payload) {
      TMessage message;
      if (message.ParseFromString(payload)) {
        handler(message);
      }
    };
  }

  const std::string address;

 private:
  IMqttTransport& transport_;
  std::unordered_map<std::string, std::function<void(const std::string&)>>& dispatch_;
};

// Owns the MQTT connection and exposes one Channel<T> member per spec channel.
//
// MessageBus is neither copyable nor movable: each Channel<T> member holds a reference back into
// this object's own transport/dispatch table, so a MessageBus must be constructed in place (a
// local variable, or heap-allocated via std::make_unique<MessageBus>(...)) and used for its
// whole lifetime from that one location.
class MessageBus {
 public:
  // Connects to a real broker via MosquittoTransport.
  explicit MessageBus(MqttConfig config);
  // Test/advanced constructor: takes ownership of a caller-provided transport (e.g. an in-memory
  // fake in tests).
  explicit MessageBus(std::unique_ptr<IMqttTransport> transport);
  ~MessageBus();

  MessageBus(const MessageBus&) = delete;
  MessageBus& operator=(const MessageBus&) = delete;
  MessageBus(MessageBus&&) = delete;
  MessageBus& operator=(MessageBus&&) = delete;

  void connect();
  void disconnect();

 private:
  std::unique_ptr<IMqttTransport> transport_;
  std::unordered_map<std::string, std::function<void(const std::string&)>> dispatch_;

 public:
${channelMembers}
};

}  // namespace ${projectName}
`;
}

function mosquittoTransportCpp(projectName) {
  return `#include "${projectName}/mosquitto_transport.hpp"

#include <mosquitto.h>

#include <stdexcept>
#include <utility>

namespace ${projectName} {

namespace {

// mosquitto_lib_init/_cleanup must be called exactly once per process. A function-local static
// guarantees that regardless of how many MosquittoTransport instances are created.
struct MosquittoLibraryGuard {
  MosquittoLibraryGuard() { mosquitto_lib_init(); }
  ~MosquittoLibraryGuard() { mosquitto_lib_cleanup(); }
};

void ensureMosquittoLibraryInitialized() {
  static MosquittoLibraryGuard guard;
  (void)guard;
}

}  // namespace

void MosquittoTransport::MosquittoDeleter::operator()(mosquitto* client) const {
  if (client != nullptr) {
    mosquitto_destroy(client);
  }
}

MosquittoTransport::MosquittoTransport(MqttConfig config) : config_(std::move(config)) {
  ensureMosquittoLibraryInitialized();
  client_.reset(mosquitto_new(config_.clientId.c_str(), /*clean_session=*/true, this));
  if (!client_) {
    throw std::runtime_error("MosquittoTransport: mosquitto_new failed");
  }
  mosquitto_connect_callback_set(client_.get(), &MosquittoTransport::onConnect);
  mosquitto_disconnect_callback_set(client_.get(), &MosquittoTransport::onDisconnect);
  mosquitto_message_callback_set(client_.get(), &MosquittoTransport::onMessage);
}

MosquittoTransport::~MosquittoTransport() { disconnect(); }

void MosquittoTransport::connect() {
  mosquitto_connect_async(client_.get(), config_.host.c_str(), config_.port, config_.keepAliveSeconds);
  mosquitto_loop_start(client_.get());
}

void MosquittoTransport::disconnect() {
  if (client_) {
    mosquitto_disconnect(client_.get());
    mosquitto_loop_stop(client_.get(), /*force=*/true);
  }
}

void MosquittoTransport::publish(const std::string& topic, const std::string& payload) {
  mosquitto_publish(client_.get(), /*mid=*/nullptr, topic.c_str(), static_cast<int>(payload.size()),
                     payload.data(), /*qos=*/0, /*retain=*/false);
}

void MosquittoTransport::subscribe(const std::string& topic) {
  mosquitto_subscribe(client_.get(), /*mid=*/nullptr, topic.c_str(), /*qos=*/0);
}

void MosquittoTransport::setMessageHandler(MessageHandler handler) { handler_ = std::move(handler); }

void MosquittoTransport::onConnect(mosquitto* /*client*/, void* /*userData*/, int /*rc*/) {}

void MosquittoTransport::onDisconnect(mosquitto* /*client*/, void* /*userData*/, int /*rc*/) {}

void MosquittoTransport::onMessage(mosquitto* /*client*/, void* userData, const mosquitto_message* message) {
  auto* self = static_cast<MosquittoTransport*>(userData);
  if (self == nullptr || !self->handler_ || message == nullptr || message->topic == nullptr) {
    return;
  }
  const char* data = static_cast<const char*>(message->payload);
  std::string payload = (data != nullptr && message->payloadlen > 0)
                             ? std::string(data, static_cast<size_t>(message->payloadlen))
                             : std::string();
  self->handler_(message->topic, payload);
}

}  // namespace ${projectName}
`;
}

function messageBusCpp(projectName) {
  return `#include "${projectName}/message_bus.hpp"

#include <stdexcept>
#include <utility>

namespace ${projectName} {

namespace {

std::unique_ptr<IMqttTransport> requireNonNull(std::unique_ptr<IMqttTransport> transport) {
  if (!transport) {
    throw std::invalid_argument("MessageBus requires a non-null IMqttTransport");
  }
  return transport;
}

}  // namespace

MessageBus::MessageBus(MqttConfig config)
    : transport_(requireNonNull(std::make_unique<MosquittoTransport>(std::move(config)))) {
  transport_->setMessageHandler([this](const std::string& topic, const std::string& payload) {
    const auto it = dispatch_.find(topic);
    if (it != dispatch_.end()) {
      it->second(payload);
    }
  });
}

MessageBus::MessageBus(std::unique_ptr<IMqttTransport> transport)
    : transport_(requireNonNull(std::move(transport))) {
  transport_->setMessageHandler([this](const std::string& topic, const std::string& payload) {
    const auto it = dispatch_.find(topic);
    if (it != dispatch_.end()) {
      it->second(payload);
    }
  });
}

MessageBus::~MessageBus() = default;

void MessageBus::connect() { transport_->connect(); }

void MessageBus::disconnect() { transport_->disconnect(); }

}  // namespace ${projectName}
`;
}

module.exports = { buildMessageBusFiles };
