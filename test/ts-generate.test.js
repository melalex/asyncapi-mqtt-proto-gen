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

describe('ts buildProject (via src/build.js)', () => {
  let files;
  let byPath;

  beforeAll(async () => {
    const doc = await parseFixture('fleet-sample.yaml');
    files = buildFiles(doc, { lang: 'ts', projectName: 'demo_bus' });
    byPath = filesByPath(files);
  });

  it('produces the expected project layout', () => {
    expect(Object.keys(byPath).sort()).toEqual(
      [
        '.gitignore',
        'README.md',
        'buf.gen.yaml',
        'buf.yaml',
        'package.json',
        'tsconfig.json',
        'vite.config.ts',
        'proto/commands.proto',
        'proto/control.proto',
        'proto/sensors.proto',
        'proto/telemetry.proto',
        'src/client.ts',
        'src/index.ts',
        'src/messages.ts',
        'tests/client.test.ts',
      ].sort()
    );
  });

  it('keeps proto files flat under proto/, one per package, like the js backend', () => {
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

  it('declares one typed Channel property per channel, named exactly after the channel id (no case conversion)', () => {
    const clientTs = byPath['src/client.ts'];
    expect(clientTs).toContain('readonly motorCommand: Channel<messages.control.MotorCommand>;');
    expect(clientTs).toContain('this.motorCommand = new Channel(');
    expect(clientTs).toContain('"motor/command",');
    expect(clientTs).toContain('readonly motorEcho: Channel<messages.control.MotorCommand>;');
    expect(clientTs).toContain('readonly motorMode: Channel<messages.control.MotorModeCmd>;');
    expect(clientTs).toContain('readonly deviceHeartbeat: Channel<messages.telemetry.Heartbeat>;');
    expect(clientTs).toContain('implements MqttTransport');
    expect(clientTs).toContain('export class Channel<T>');
    expect(clientTs).toContain('import * as messages from "./messages.js"');
  });

  it('re-exports each generated proto module as a namespace in src/messages.ts', () => {
    const messagesTs = byPath['src/messages.ts'];
    expect(messagesTs).toContain('export * as control from "./generated/control.js";');
    expect(messagesTs).toContain('export * as telemetry from "./generated/telemetry.js";');
    expect(messagesTs).toContain('export * as commands from "./generated/commands.js";');
    expect(messagesTs).toContain('export * as sensors from "./generated/sensors.js";');
  });

  it('index.ts re-exports the public API and the messages namespace', () => {
    const indexTs = byPath['src/index.ts'];
    expect(indexTs).toContain('export { MessageBus, Channel, MqttJsTransport } from "./client.js"');
    expect(indexTs).toContain('export type { MqttTransport, MqttConfig, ProtoCodec } from "./client.js"');
    expect(indexTs).toContain('export * as messages from "./messages.js"');
  });

  it('generates a publish/subscribe/address Vitest case per channel', () => {
    const testTs = byPath['tests/client.test.ts'];
    for (const id of ['deviceHeartbeat', 'motorCommand', 'motorMode', 'motorEcho', 'deviceImu', 'resetCommand']) {
      expect(testTs).toContain(`describe("${id}", () => {`);
      expect(testTs).toContain(`bus.${id}.address`);
      expect(testTs).toContain(`bus.${id}.publish(`);
      expect(testTs).toContain(`bus.${id}.subscribe(`);
    }
    expect(testTs).toContain('class FakeMqttTransport implements MqttTransport');
  });

  it('wires up buf/ts-proto, Vite library mode, tsconfig, and the mqtt dep in scaffold files', () => {
    expect(byPath['package.json']).toContain('"name": "demo-bus"');
    expect(byPath['package.json']).toContain('"proto": "buf generate"');
    expect(byPath['package.json']).toContain('"ts-proto": ');
    expect(byPath['package.json']).toContain('"mqtt": ');
    expect(byPath['buf.gen.yaml']).toContain('protoc-gen-ts_proto');
    expect(byPath['tsconfig.json']).toContain('"strict": true');
    expect(byPath['vite.config.ts']).toContain('formats: ["es", "umd"]');
    expect(byPath['vite.config.ts']).toContain('name: "DemoBus"');
    expect(byPath['vite.config.ts']).toContain('fileName: (format) => `demo-bus.${format}.js`');
    expect(byPath['.gitignore']).toContain('src/generated/');
  });

  it('rejects a channel id that is not a valid TypeScript identifier', async () => {
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
    expect(() => buildFiles(document, { lang: 'ts', projectName: 'demo_bus' })).toThrow(
      /not a valid TypeScript identifier/
    );
  });

  it('defaults projectName to a slug of info.title when not provided', async () => {
    const doc = await parseFixture('fleet-sample.yaml');
    const defaulted = filesByPath(buildFiles(doc, { lang: 'ts' }));
    expect(defaulted['package.json']).toContain('"name": "sample-fleet-mqtt-api"');
  });
});
