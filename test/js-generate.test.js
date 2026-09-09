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

describe('js buildProject (via src/build.js)', () => {
  let files;
  let byPath;

  beforeAll(async () => {
    const doc = await parseFixture('fleet-sample.yaml');
    files = buildFiles(doc, { lang: 'js', projectName: 'demo_bus' });
    byPath = filesByPath(files);
  });

  it('produces the expected project layout', () => {
    expect(Object.keys(byPath).sort()).toEqual(
      [
        '.gitignore',
        'README.md',
        'package.json',
        'vite.config.js',
        'proto/commands.proto',
        'proto/control.proto',
        'proto/sensors.proto',
        'proto/telemetry.proto',
        'src/client.js',
        'src/index.js',
        'tests/client.test.js',
      ].sort()
    );
  });

  it('keeps proto files flat under proto/, one per package, like the cpp backend', () => {
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

  it('exposes an untagged channel as a top-level Channel property, named exactly after the channel id', () => {
    const clientJs = byPath['src/client.js'];
    expect(clientJs).toContain('this.resetCommand = new Channel(');
    expect(clientJs).toContain('"device/reset", messages.fleet.commands.ResetCommand');
    expect(clientJs).toContain('import messages from "./generated/messages.js"');
  });

  it('nests a tagged channel under a slugified-tag object (messageBus.<tag>.<channel>)', () => {
    const clientJs = byPath['src/client.js'];
    expect(clientJs).toContain('this.motor = {');
    expect(clientJs).toContain('motorCommand: new Channel(');
    expect(clientJs).toContain('"motor/command", messages.fleet.control.MotorCommand');
    expect(clientJs).toContain('motorMode: new Channel(');
    // tag "Device Telemetry" -> slugified property name
    expect(clientJs).toContain('this.device_telemetry = {');
    expect(clientJs).toContain('deviceHeartbeat: new Channel(');
    expect(clientJs).toContain('messages.fleet.telemetry.Heartbeat');
  });

  it('places a channel with several tags under every one of its groups', () => {
    const clientJs = byPath['src/client.js'];
    expect(clientJs).toMatch(/this\.diagnostics = \{[\s\S]*?motorEcho: new Channel\([\s\S]*?"motor\/echo"/);
    expect(clientJs).toMatch(/this\.motor = \{[\s\S]*?motorEcho: new Channel\([\s\S]*?"motor\/echo"/);
  });

  it('threads the MQTT retain binding into the Channel ctor (channel- and operation-level)', () => {
    const clientJs = byPath['src/client.js'];
    // motorMode has a channel-level bindings.mqtt.retain; motorCommand inherits it from its send op.
    expect(clientJs).toMatch(/"motor\/mode", messages\.fleet\.control\.MotorModeCmd, this\._transport, this\._dispatch, true/);
    expect(clientJs).toMatch(/"motor\/command", messages\.fleet\.control\.MotorCommand, this\._transport, this\._dispatch, true/);
    // Untagged, unbound channel: unchanged, no retain arg.
    expect(clientJs).toMatch(/"device\/reset", messages\.fleet\.commands\.ResetCommand, this\._transport, this\._dispatch\n/);
    // motorEcho shares the "motor" group but declares no retain of its own.
    expect(clientJs).not.toMatch(/"motor\/echo"[^\n]*this\._dispatch, true/);
    expect(clientJs).toContain('publish(topic, payload, retain = false)');
    expect(clientJs).toContain('this._client.publish(topic, payload, { retain })');
  });

  it('records and asserts the retain flag in the generated FakeMqttTransport tests', () => {
    const testJs = byPath['tests/client.test.js'];
    expect(testJs).toContain('publish(topic, payload, retain = false)');
    expect(testJs).toContain('this.published.push({ topic, payload, retain })');
    expect(testJs).toMatch(/describe\("motor\.motorMode"[\s\S]*?published\[0\]\.retain\)\.toBe\(true\)/);
    expect(testJs).toMatch(/describe\("resetCommand"[\s\S]*?published\[0\]\.retain\)\.toBe\(false\)/);
  });

  it('index.js re-exports MessageBus and the generated messages namespace', () => {
    const indexJs = byPath['src/index.js'];
    expect(indexJs).toContain('export { MessageBus, Channel, MqttJsTransport } from "./client.js"');
    expect(indexJs).toContain('export { default as messages } from "./generated/messages.js"');
  });

  it('generates a publish/subscribe/address Vitest case per channel, through its accessor path', () => {
    const testJs = byPath['tests/client.test.js'];
    const cases = [
      ['resetCommand', 'bus.resetCommand'],
      ['device_telemetry.deviceHeartbeat', 'bus.device_telemetry.deviceHeartbeat'],
      ['device_telemetry.deviceImu', 'bus.device_telemetry.deviceImu'],
      ['motor.motorCommand', 'bus.motor.motorCommand'],
      ['motor.motorMode', 'bus.motor.motorMode'],
      ['motor.motorEcho', 'bus.motor.motorEcho'],
      ['diagnostics.motorEcho', 'bus.diagnostics.motorEcho'],
    ];
    for (const [label, accessor] of cases) {
      expect(testJs).toContain(`describe("${label}", () => {`);
      expect(testJs).toContain(`${accessor}.address`);
      expect(testJs).toContain(`${accessor}.publish(`);
      expect(testJs).toContain(`${accessor}.subscribe(`);
    }
    expect(testJs).toContain('class FakeMqttTransport');
  });

  it('wires up pbjs, Vite library mode, and the mqtt/protobufjs deps in scaffold files', () => {
    expect(byPath['package.json']).toContain('"name": "demo-bus"');
    expect(byPath['package.json']).toContain('pbjs -t static-module -w es6');
    expect(byPath['package.json']).toContain('"mqtt": ');
    expect(byPath['package.json']).toContain('"protobufjs": ');
    expect(byPath['vite.config.js']).toContain('formats: ["es", "umd"]');
    expect(byPath['vite.config.js']).toContain('name: "DemoBus"');
    expect(byPath['vite.config.js']).toContain('fileName: (format) => `demo-bus.${format}.js`');
    expect(byPath['.gitignore']).toContain('src/generated/');
  });

  it('rejects a channel id that is not a valid JS identifier', async () => {
    const parser = new Parser();
    const { document } = await parser.parse(`
asyncapi: '3.1.0'
info: { title: t, version: '1.0.0' }
channels:
  "bad-name":
    address: a
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
    expect(() => buildFiles(document, { lang: 'js', projectName: 'demo_bus' })).toThrow(
      /not a valid JavaScript identifier/
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
    expect(() => buildFiles(document, { lang: 'js', projectName: 'demo_bus' })).toThrow(
      /Tag group "status" collides with untagged channel "status"/
    );
  });

  it('defaults projectName to a slug of info.title when not provided', async () => {
    const doc = await parseFixture('fleet-sample.yaml');
    const defaulted = filesByPath(buildFiles(doc, { lang: 'js' }));
    expect(defaulted['package.json']).toContain('"name": "sample-fleet-mqtt-api"');
  });
});
