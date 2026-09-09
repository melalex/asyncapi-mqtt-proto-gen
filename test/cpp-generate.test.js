'use strict';

const path = require('path');
const fs = require('fs');
const { Parser } = require('@asyncapi/parser');
const { buildFiles } = require('../src/build');

async function parseFixture(name) {
  const parser = new Parser();
  const text = fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');
  const { document, diagnostics } = await parser.parse(text);
  if (!document) {
    throw new Error(diagnostics.map((d) => d.message).join('\n'));
  }
  return document;
}

function filesByPath(files) {
  return Object.fromEntries(files.map((f) => [f.path, f.content]));
}

describe('cpp buildProject (via src/build.js)', () => {
  let files;
  let byPath;

  beforeAll(async () => {
    const doc = await parseFixture('fleet-sample.yaml');
    files = buildFiles(doc, { lang: 'cpp', projectName: 'demo_bus' });
    byPath = filesByPath(files);
  });

  it('rejects an unsupported lang before doing any work', async () => {
    const doc = await parseFixture('minimal.yaml');
    expect(() => buildFiles(doc, { lang: 'rust' })).toThrow(/Unsupported lang "rust"/);
  });

  it('produces the expected project layout', () => {
    expect(Object.keys(byPath).sort()).toEqual(
      [
        '.gitignore',
        'CMakeLists.txt',
        'README.md',
        'include/demo_bus/message_bus.hpp',
        'include/demo_bus/mosquitto_transport.hpp',
        'include/demo_bus/mqtt_transport.hpp',
        'proto/commands.proto',
        'proto/control.proto',
        'proto/sensors.proto',
        'proto/telemetry.proto',
        'src/message_bus.cpp',
        'src/mosquitto_transport.cpp',
        'tests/fake_mqtt_transport.hpp',
        'tests/test_messages.cpp',
      ].sort()
    );
  });

  it('emits one proto file per package with deduplicated declarations', () => {
    const controlProto = byPath['proto/control.proto'];
    expect(controlProto).toContain('package fleet.control;');
    // MotorCommand is referenced by two channels; it must appear exactly once in the file.
    expect(controlProto.match(/message MotorCommand/g)).toHaveLength(1);
    expect(controlProto).toContain('enum MotorMode');
    expect(controlProto).toContain('message MotorModeCmd');
  });

  it('emits an empty-bodied message declaration unchanged', () => {
    expect(byPath['proto/commands.proto']).toContain('message ResetCommand {}');
  });

  it('exposes an untagged channel as a direct Channel<T> member, named after the channel id', () => {
    const hpp = byPath['include/demo_bus/message_bus.hpp'];
    expect(hpp).toContain('Channel<fleet::commands::ResetCommand> resetCommand{"device/reset"');
    expect(hpp).toContain('#include "control.pb.h"');
    expect(hpp).toContain('#include "telemetry.pb.h"');
  });

  it('nests a tagged channel under one struct per slugified tag (messageBus.<tag>.<channel>)', () => {
    const hpp = byPath['include/demo_bus/message_bus.hpp'];
    // tag "motor"
    expect(hpp).toContain('struct MotorGroup {');
    expect(hpp).toContain('Channel<fleet::control::MotorCommand> motorCommand;');
    expect(hpp).toContain('Channel<fleet::control::MotorModeCmd> motorMode;');
    expect(hpp).toContain('} motor{*transport_, dispatch_};');
    expect(hpp).toContain('motorCommand("motor/command", transport, dispatch, true)');
    // tag "Device Telemetry" -> slugified
    expect(hpp).toContain('struct DeviceTelemetryGroup {');
    expect(hpp).toContain('} device_telemetry{*transport_, dispatch_};');
  });

  it('places a channel with several tags under every one of its groups', () => {
    const hpp = byPath['include/demo_bus/message_bus.hpp'];
    // motorEcho is tagged both "motor" and "diagnostics"
    expect(hpp).toContain('struct DiagnosticsGroup {');
    expect(hpp).toMatch(/struct DiagnosticsGroup \{[\s\S]*?Channel<fleet::control::MotorCommand> motorEcho;[\s\S]*?\} diagnostics\{/);
    expect(hpp).toMatch(/struct MotorGroup \{[\s\S]*?Channel<fleet::control::MotorCommand> motorEcho;[\s\S]*?\} motor\{/);
  });

  it('generates a publish/subscribe/address test case per channel, through its accessor path', () => {
    const cpp = byPath['tests/test_messages.cpp'];
    const accessors = [
      'bus.resetCommand',
      'bus.device_telemetry.deviceHeartbeat',
      'bus.device_telemetry.deviceImu',
      'bus.motor.motorCommand',
      'bus.motor.motorMode',
      'bus.motor.motorEcho',
      'bus.diagnostics.motorEcho',
    ];
    for (const accessor of accessors) {
      expect(cpp).toContain(`${accessor}.address`);
      expect(cpp).toContain(`${accessor}.publish(message)`);
      expect(cpp).toContain(`${accessor}.subscribe(`);
    }
  });

  it('threads the MQTT retain binding into the Channel<T> ctor (channel- and operation-level)', () => {
    const hpp = byPath['include/demo_bus/message_bus.hpp'];
    // motorMode carries a channel-level bindings.mqtt.retain; motorCommand inherits it from its
    // send operation. Both are grouped under "motor".
    expect(hpp).toContain('motorMode("motor/mode", transport, dispatch, true)');
    expect(hpp).toContain('motorCommand("motor/command", transport, dispatch, true)');
    // An untagged, unbound channel is unchanged: no retain arg.
    expect(hpp).toContain('Channel<fleet::commands::ResetCommand> resetCommand{"device/reset", *transport_, dispatch_};');
    // motorEcho has no retain of its own even though it shares the "motor" group.
    expect(hpp).toContain('motorEcho("motor/echo", transport, dispatch)');
    expect(hpp).not.toContain('motorEcho("motor/echo", transport, dispatch, true)');
  });

  it('records and asserts the retain flag in the generated FakeMqttTransport tests', () => {
    const hpp = byPath['tests/fake_mqtt_transport.hpp'];
    expect(hpp).toContain('bool retain;');
    expect(hpp).toContain('void publish(const std::string& topic, const std::string& payload, bool retain) override');
    expect(hpp).toContain('published.push_back({topic, payload, retain});');

    const cpp = byPath['tests/test_messages.cpp'];
    expect(cpp).toMatch(/bus\.motor\.motorMode\.publish[\s\S]*?published\[0\]\.retain == true/);
    expect(cpp).toMatch(/bus\.resetCommand\.publish[\s\S]*?published\[0\]\.retain == false/);
  });

  it('rejects a tag whose slug collides with an untagged channel accessor', async () => {
    const parser = new Parser();
    const { document } = await parser.parse(`
asyncapi: '3.1.0'
info: { title: t, version: '1.0.0' }
channels:
  status:
    address: status
    messages:
      A: { $ref: '#/components/messages/A' }
  ping:
    address: ping
    tags:
      - name: Status
    messages:
      B: { $ref: '#/components/messages/B' }
components:
  messages:
    A:
      name: A
      payload:
        schemaFormat: 'application/vnd.google.protobuf;version=3'
        schema: |
          syntax = "proto3";
          package p;
          message A { int32 x = 1; }
    B:
      name: B
      payload:
        schemaFormat: 'application/vnd.google.protobuf;version=3'
        schema: |
          syntax = "proto3";
          package p;
          message B { int32 y = 1; }
`);
    expect(() => buildFiles(document, { lang: 'cpp', projectName: 'demo_bus' })).toThrow(
      /Tag group "status" collides with untagged channel "status"/
    );
  });

  it('names the CMake project after projectName and wires up protobuf + mosquitto', () => {
    const cmake = byPath['CMakeLists.txt'];
    expect(cmake).toContain('project(demo_bus CXX)');
    expect(cmake).toContain('find_package(Protobuf CONFIG QUIET)');
    expect(cmake).toContain('find_package(Protobuf MODULE REQUIRED)');
    expect(cmake).toContain('find_library(MOSQUITTO_LIBRARY mosquitto)');
    expect(cmake).toContain('FetchContent_Declare(\n      Catch2');
  });

  it('defaults projectName to a slug of info.title when not provided', async () => {
    const doc = await parseFixture('fleet-sample.yaml');
    const defaulted = filesByPath(buildFiles(doc, { lang: 'cpp' }));
    expect(Object.keys(defaulted)).toContain('include/sample_fleet_mqtt_api/message_bus.hpp');
  });
});
