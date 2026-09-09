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

  it('exposes an untagged channel as a top-level snake_cased Channel attribute, keeping the original address', () => {
    const clientPy = byPath['src/demo_bus/client.py'];
    expect(clientPy).toContain('self.reset_command: Channel[commands_pb2.ResetCommand] = Channel(');
    expect(clientPy).toContain('"device/reset", commands_pb2.ResetCommand');
    expect(clientPy).toContain('from demo_bus import control_pb2');
    expect(clientPy).toContain('from demo_bus import telemetry_pb2');
  });

  it('nests a tagged channel under a slugified-tag SimpleNamespace (message_bus.<tag>.<channel>)', () => {
    const clientPy = byPath['src/demo_bus/client.py'];
    expect(clientPy).toContain('from types import SimpleNamespace');
    expect(clientPy).toContain('self.motor = SimpleNamespace(');
    expect(clientPy).toContain('motor_command=Channel(');
    expect(clientPy).toContain('"motor/command", control_pb2.MotorCommand');
    expect(clientPy).toContain('motor_mode=Channel(');
    // tag "Device Telemetry" -> slugified attribute name
    expect(clientPy).toContain('self.device_telemetry = SimpleNamespace(');
    expect(clientPy).toContain('device_heartbeat=Channel(');
  });

  it('places a channel with several tags under every one of its groups', () => {
    const clientPy = byPath['src/demo_bus/client.py'];
    expect(clientPy).toMatch(/self\.diagnostics = SimpleNamespace\([\s\S]*?motor_echo=Channel\([\s\S]*?"motor\/echo"/);
    expect(clientPy).toMatch(/self\.motor = SimpleNamespace\([\s\S]*?motor_echo=Channel\([\s\S]*?"motor\/echo"/);
  });

  it('threads the MQTT retain binding into the Channel ctor (channel- and operation-level)', () => {
    const clientPy = byPath['src/demo_bus/client.py'];
    // motor_mode: channel-level bindings.mqtt.retain. motor_command: inherited from its send op.
    expect(clientPy).toContain('"motor/mode", control_pb2.MotorModeCmd, self._transport, self._dispatch, True');
    expect(clientPy).toContain('"motor/command", control_pb2.MotorCommand, self._transport, self._dispatch, True');
    // Untagged, unbound channel: unchanged, no retain arg.
    expect(clientPy).toContain('"device/reset", commands_pb2.ResetCommand, self._transport, self._dispatch\n');
    // motor_echo shares the "motor" group but declares no retain of its own.
    expect(clientPy).not.toMatch(/"motor\/echo"[^\n]*self\._dispatch, True/);
    expect(clientPy).toContain('def publish(self, topic: str, payload: bytes, retain: bool = False) -> None:');
    expect(clientPy).toContain('self._client.publish(topic, payload, retain=retain)');
  });

  it('records and asserts the retain flag in the generated FakeMqttTransport tests', () => {
    const testPy = byPath['tests/test_client.py'];
    expect(testPy).toContain('self.published: list[tuple[str, bytes, bool]] = []');
    expect(testPy).toContain('def publish(self, topic: str, payload: bytes, retain: bool = False) -> None:');
    expect(testPy).toContain('self.published.append((topic, payload, retain))');
    expect(testPy).toMatch(/def test_motor__motor_mode_publish[\s\S]*?assert retain is True/);
    expect(testPy).toMatch(/def test_reset_command_publish[\s\S]*?assert retain is False/);
  });

  it('__init__.py re-exports MessageBus and MqttConfig', () => {
    expect(byPath['src/demo_bus/__init__.py']).toContain('from demo_bus.client import MessageBus, MqttConfig');
  });

  it('generates a publish/subscribe/address pytest function per channel, through its accessor path', () => {
    const testPy = byPath['tests/test_client.py'];
    const cases = [
      ['reset_command', 'bus.reset_command'],
      ['device_telemetry__device_heartbeat', 'bus.device_telemetry.device_heartbeat'],
      ['device_telemetry__device_imu', 'bus.device_telemetry.device_imu'],
      ['motor__motor_command', 'bus.motor.motor_command'],
      ['motor__motor_mode', 'bus.motor.motor_mode'],
      ['motor__motor_echo', 'bus.motor.motor_echo'],
      ['diagnostics__motor_echo', 'bus.diagnostics.motor_echo'],
    ];
    for (const [fn, accessor] of cases) {
      expect(testPy).toContain(`def test_${fn}_address`);
      expect(testPy).toContain(`def test_${fn}_publish_sends_a_protobuf_encoded_message`);
      expect(testPy).toContain(`def test_${fn}_subscribe_dispatches_incoming_messages`);
      expect(testPy).toContain(`${accessor}.address`);
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
    expect(() => buildFiles(document, { lang: 'python', projectName: 'demo_bus' })).toThrow(
      /Tag group "status" collides with untagged channel "status"/
    );
  });

  it('defaults projectName to a slug of info.title when not provided', async () => {
    const doc = await parseFixture('fleet-sample.yaml');
    const defaulted = filesByPath(buildFiles(doc, { lang: 'python' }));
    expect(Object.keys(defaulted)).toContain('src/sample_fleet_mqtt_api/client.py');
  });
});
