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

  it('declares one Channel property per channel, named exactly after the channel id (no case conversion)', () => {
    const clientJs = byPath['src/client.js'];
    expect(clientJs).toContain('this.motorCommand = new Channel(');
    expect(clientJs).toContain('"motor/command", messages.fleet.control.MotorCommand');
    expect(clientJs).toContain('this.motorEcho = new Channel(');
    expect(clientJs).toContain('"motor/echo", messages.fleet.control.MotorCommand');
    expect(clientJs).toContain('this.motorMode = new Channel(');
    expect(clientJs).toContain('this.deviceHeartbeat = new Channel(');
    expect(clientJs).toContain('messages.fleet.telemetry.Heartbeat');
    expect(clientJs).toContain('import messages from "./generated/messages.js"');
  });

  it('index.js re-exports MessageBus and the generated messages namespace', () => {
    const indexJs = byPath['src/index.js'];
    expect(indexJs).toContain('export { MessageBus, Channel, MqttJsTransport } from "./client.js"');
    expect(indexJs).toContain('export { default as messages } from "./generated/messages.js"');
  });

  it('generates a publish/subscribe/address Vitest case per channel', () => {
    const testJs = byPath['tests/client.test.js'];
    for (const id of ['deviceHeartbeat', 'motorCommand', 'motorMode', 'motorEcho', 'deviceImu', 'resetCommand']) {
      expect(testJs).toContain(`describe("${id}", () => {`);
      expect(testJs).toContain(`bus.${id}.address`);
      expect(testJs).toContain(`bus.${id}.publish(`);
      expect(testJs).toContain(`bus.${id}.subscribe(`);
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

  it('defaults projectName to a slug of info.title when not provided', async () => {
    const doc = await parseFixture('fleet-sample.yaml');
    const defaulted = filesByPath(buildFiles(doc, { lang: 'js' }));
    expect(defaulted['package.json']).toContain('"name": "sample-fleet-mqtt-api"');
  });
});
