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

  it('declares one Channel<T> member per channel, named after the channel id', () => {
    const hpp = byPath['include/demo_bus/message_bus.hpp'];
    expect(hpp).toContain('Channel<fleet::control::MotorCommand> motorCommand{"motor/command"');
    expect(hpp).toContain('Channel<fleet::control::MotorCommand> motorEcho{"motor/echo"');
    expect(hpp).toContain('Channel<fleet::control::MotorModeCmd> motorMode{"motor/mode"');
    expect(hpp).toContain('Channel<fleet::telemetry::Heartbeat> deviceHeartbeat{"device/heartbeat"');
    expect(hpp).toContain('#include "control.pb.h"');
    expect(hpp).toContain('#include "telemetry.pb.h"');
  });

  it('generates a publish/subscribe/address test case per channel', () => {
    const cpp = byPath['tests/test_messages.cpp'];
    for (const channelId of ['deviceHeartbeat', 'motorCommand', 'motorMode', 'motorEcho', 'deviceImu', 'resetCommand']) {
      expect(cpp).toContain(`bus.${channelId}.address`);
      expect(cpp).toContain(`bus.${channelId}.publish(message)`);
      expect(cpp).toContain(`bus.${channelId}.subscribe(`);
    }
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
