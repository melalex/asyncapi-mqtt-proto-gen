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

describe('python buildProject (via src/build.js)', () => {
  let files;
  let byPath;

  beforeAll(async () => {
    const doc = await parseFixture('fleet-sample.yaml');
    files = buildFiles(doc, { lang: 'python', projectName: 'demo_bus' });
    byPath = filesByPath(files);
  });

  it('produces the expected project layout', () => {
    expect(Object.keys(byPath).sort()).toEqual(
      [
        '.gitignore',
        'Makefile',
        'README.md',
        'pyproject.toml',
        'proto/demo_bus/commands.proto',
        'proto/demo_bus/control.proto',
        'proto/demo_bus/sensors.proto',
        'proto/demo_bus/telemetry.proto',
        'src/demo_bus/__init__.py',
        'src/demo_bus/client.py',
        'tests/test_client.py',
      ].sort()
    );
  });

  it('nests proto files under proto/<projectName>/ so generated _pb2 modules land in the right package', () => {
    const controlProto = byPath['proto/demo_bus/control.proto'];
    expect(controlProto).toContain('package fleet.control;');
    // MotorCommand is referenced by two channels; it must appear exactly once in the file.
    expect(controlProto.match(/message MotorCommand/g)).toHaveLength(1);
    expect(controlProto).toContain('enum MotorMode');
    expect(controlProto).toContain('message MotorModeCmd');
  });

  it('emits an empty-bodied message declaration unchanged', () => {
    expect(byPath['proto/demo_bus/commands.proto']).toContain('message ResetCommand {}');
  });

  it('snake_cases channel ids into Channel attribute names, keeping the original address', () => {
    const clientPy = byPath['src/demo_bus/client.py'];
    expect(clientPy).toContain('self.motor_command: Channel[control_pb2.MotorCommand] = Channel(');
    expect(clientPy).toContain('"motor/command", control_pb2.MotorCommand');
    expect(clientPy).toContain('self.motor_echo: Channel[control_pb2.MotorCommand] = Channel(');
    expect(clientPy).toContain('"motor/echo", control_pb2.MotorCommand');
    expect(clientPy).toContain('self.motor_mode: Channel[control_pb2.MotorModeCmd] = Channel(');
    expect(clientPy).toContain('self.device_heartbeat: Channel[telemetry_pb2.Heartbeat] = Channel(');
    expect(clientPy).toContain('from demo_bus import control_pb2');
    expect(clientPy).toContain('from demo_bus import telemetry_pb2');
  });

  it('__init__.py re-exports MessageBus and MqttConfig', () => {
    expect(byPath['src/demo_bus/__init__.py']).toContain('from demo_bus.client import MessageBus, MqttConfig');
  });

  it('generates a publish/subscribe/address pytest function per channel', () => {
    const testPy = byPath['tests/test_client.py'];
    for (const attr of ['device_heartbeat', 'motor_command', 'motor_mode', 'motor_echo', 'device_imu', 'reset_command']) {
      expect(testPy).toContain(`def test_${attr}_address`);
      expect(testPy).toContain(`def test_${attr}_publish_sends_a_protobuf_encoded_message`);
      expect(testPy).toContain(`def test_${attr}_subscribe_dispatches_incoming_messages`);
      expect(testPy).toContain(`bus.${attr}.address`);
    }
    expect(testPy).toContain('class FakeMqttTransport:');
  });

  it('wires up Hatch, the src layout, and grpc_tools protoc generation in scaffold files', () => {
    expect(byPath['pyproject.toml']).toContain('build-backend = "hatchling.build"');
    expect(byPath['pyproject.toml']).toContain('packages = ["src/demo_bus"]');
    expect(byPath['pyproject.toml']).toContain('name = "demo-bus"');
    expect(byPath['Makefile']).toContain('-m grpc_tools.protoc');
    expect(byPath['Makefile']).toContain('proto/demo_bus/*.proto');
    expect(byPath['.gitignore']).toContain('*_pb2.py');
  });

  it('rejects channels whose snake_case attribute names collide', async () => {
    const parser = new Parser();
    const { document } = await parser.parse(`
asyncapi: '3.1.0'
info: { title: t, version: '1.0.0' }
channels:
  motorCommand:
    address: a
    messages:
      A: { $ref: '#/components/messages/A' }
  motor_command:
    address: b
    messages:
      A: { $ref: '#/components/messages/A' }
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
`);
    expect(() => buildFiles(document, { lang: 'python', projectName: 'demo_bus' })).toThrow(
      /both map to the Python attribute name/
    );
  });

  it('defaults projectName to a slug of info.title when not provided', async () => {
    const doc = await parseFixture('fleet-sample.yaml');
    const defaulted = filesByPath(buildFiles(doc, { lang: 'python' }));
    expect(Object.keys(defaulted)).toContain('src/sample_fleet_mqtt_api/client.py');
  });
});
