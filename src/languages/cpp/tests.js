'use strict';

const { groupChannels } = require('../../channel-groups');

function protoNamespace(protoPackage) {
  return protoPackage.split('.').join('::');
}

/**
 * Emits tests/fake_mqtt_transport.hpp (the in-memory IMqttTransport used by tests) and
 * tests/test_messages.cpp (a Catch2 publish/subscribe/address test per channel).
 *
 * @param {{ channels: Array<object> }} model
 * @param {{ projectName: string }} ctx
 * @returns {Array<{ path: string, content: string }>}
 */
function buildTestFiles(model, ctx) {
  const { projectName } = ctx;
  const { flat, groups } = groupChannels(model.channels);

  const testCases = [
    ...flat.map((c) => testCasesFor(projectName, c)),
    ...groups.flatMap((g) => g.channels.map((c) => testCasesFor(projectName, c, g.name))),
  ].join('\n');

  const content = `// Generated tests: one publish/subscribe/address check per channel, using the in-memory
// FakeMqttTransport so no real MQTT broker is needed.
#include <catch2/catch_test_macros.hpp>

#include <memory>
#include <string>

#include "${projectName}/message_bus.hpp"
#include "fake_mqtt_transport.hpp"

${testCases}`;

  return [
    { path: 'tests/fake_mqtt_transport.hpp', content: fakeMqttTransportHpp(projectName) },
    { path: 'tests/test_messages.cpp', content },
  ];
}

function testCasesFor(projectName, channel, groupName) {
  const type = `${protoNamespace(channel.protoPackage)}::${channel.protoMessageType}`;
  const accessor = groupName ? `bus.${groupName}.${channel.id}` : `bus.${channel.id}`;
  const label = groupName ? `${groupName}.${channel.id}` : channel.id;
  const tag = groupName ? `[${groupName}][${channel.id}]` : `[${channel.id}]`;
  const address = channel.address;
  const retain = channel.retain ? 'true' : 'false';

  return `TEST_CASE("${label}.address matches the spec", "${tag}") {
  auto transport = std::make_unique<${projectName}::testing::FakeMqttTransport>();
  ${projectName}::MessageBus bus(std::move(transport));

  CHECK(${accessor}.address == "${address}");
}

TEST_CASE("${label}.publish sends a protobuf-encoded message to its topic", "${tag}") {
  auto transport = std::make_unique<${projectName}::testing::FakeMqttTransport>();
  auto* rawTransport = transport.get();
  ${projectName}::MessageBus bus(std::move(transport));

  ${type} message;
  ${accessor}.publish(message);

  REQUIRE(rawTransport->published.size() == 1);
  CHECK(rawTransport->published[0].topic == "${address}");
  CHECK(rawTransport->published[0].retain == ${retain});

  ${type} roundTripped;
  CHECK(roundTripped.ParseFromString(rawTransport->published[0].payload));
}

TEST_CASE("${label}.subscribe dispatches incoming messages on its topic", "${tag}") {
  auto transport = std::make_unique<${projectName}::testing::FakeMqttTransport>();
  auto* rawTransport = transport.get();
  ${projectName}::MessageBus bus(std::move(transport));

  bool received = false;
  ${accessor}.subscribe([&received](const ${type}&) { received = true; });

  REQUIRE(rawTransport->subscribedTopics.size() == 1);
  CHECK(rawTransport->subscribedTopics[0] == "${address}");

  ${type} message;
  std::string payload;
  REQUIRE(message.SerializeToString(&payload));
  rawTransport->deliver("${address}", payload);

  CHECK(received);
}
`;
}

function fakeMqttTransportHpp(projectName) {
  return `#pragma once

// In-memory IMqttTransport used by tests, so they never need a real MQTT broker: publish()
// records into an inspectable list, and deliver() simulates an incoming broker message by
// invoking the handler MessageBus installed via setMessageHandler().
#include <string>
#include <utility>
#include <vector>

#include "${projectName}/mqtt_transport.hpp"

namespace ${projectName}::testing {

class FakeMqttTransport : public ${projectName}::IMqttTransport {
 public:
  struct PublishedMessage {
    std::string topic;
    std::string payload;
    bool retain;
  };

  void connect() override { connected_ = true; }
  void disconnect() override { connected_ = false; }

  void publish(const std::string& topic, const std::string& payload, bool retain) override {
    published.push_back({topic, payload, retain});
  }

  void subscribe(const std::string& topic) override { subscribedTopics.push_back(topic); }

  void setMessageHandler(MessageHandler handler) override { handler_ = std::move(handler); }

  // Test helper: simulate the broker delivering \`payload\` on \`topic\`.
  void deliver(const std::string& topic, const std::string& payload) const {
    if (handler_) {
      handler_(topic, payload);
    }
  }

  bool connected() const { return connected_; }

  std::vector<PublishedMessage> published;
  std::vector<std::string> subscribedTopics;

 private:
  bool connected_ = false;
  MessageHandler handler_;
};

}  // namespace ${projectName}::testing
`;
}

module.exports = { buildTestFiles };
