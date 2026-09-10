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

  it('exposes an untagged channel as a top-level typed Channel property, named after the channel id', () => {
    const clientTs = byPath['src/client.ts'];
    expect(clientTs).toContain('readonly resetCommand: Channel<messages.commands.ResetCommand>;');
    expect(clientTs).toContain('this.resetCommand = new Channel(');
    expect(clientTs).toContain('"device/reset",');
    expect(clientTs).toContain('implements MqttTransport');
    expect(clientTs).toContain('export class Channel<T>');
    expect(clientTs).toContain('import * as messages from "./messages.js"');
  });

  it('nests a tagged channel under a slugified-tag object field (messageBus.<tag>.<channel>)', () => {
    const clientTs = byPath['src/client.ts'];
    expect(clientTs).toMatch(
      /readonly motor: \{\s*readonly motorCommand: Channel<messages\.control\.MotorCommand>;\s*readonly motorMode: Channel<messages\.control\.MotorModeCmd>;/
    );
    expect(clientTs).toContain('this.motor = {');
    expect(clientTs).toContain('motorCommand: new Channel(');
    // tag "Device Telemetry" -> slugified field name
    expect(clientTs).toContain('readonly device_telemetry: {');
    expect(clientTs).toContain('this.device_telemetry = {');
    expect(clientTs).toContain('readonly deviceHeartbeat: Channel<messages.telemetry.Heartbeat>;');
  });

  it('places a channel with several tags under every one of its groups', () => {
    const clientTs = byPath['src/client.ts'];
    expect(clientTs).toMatch(/this\.diagnostics = \{[\s\S]*?motorEcho: new Channel\([\s\S]*?"motor\/echo"/);
    expect(clientTs).toMatch(/this\.motor = \{[\s\S]*?motorEcho: new Channel\([\s\S]*?"motor\/echo"/);
  });

  it('threads the MQTT retain binding into the Channel ctor (channel- and operation-level)', () => {
    const clientTs = byPath['src/client.ts'];
    // motorMode: channel-level bindings.mqtt.retain. motorCommand: inherited from its send op.
    expect(clientTs).toMatch(/"motor\/mode",[\s\S]*?this\._transport,\s*this\._dispatch,\s*true,\s*\)/);
    expect(clientTs).toMatch(/"motor\/command",[\s\S]*?this\._transport,\s*this\._dispatch,\s*true,\s*\)/);
    // Untagged, unbound channel: no retain arg (constructor stops at this._dispatch,).
    expect(clientTs).toMatch(/"device\/reset",[\s\S]*?this\._transport,\s*this\._dispatch,\s*\);/);
    expect(clientTs).toContain('publish(topic: string, payload: Uint8Array, retain = false): void');
    expect(clientTs).toContain('this.client?.publish(topic, Buffer.from(payload), { retain })');
    expect(clientTs).toContain('private readonly retain: boolean = false,');
  });

  it('records and asserts the retain flag in the generated FakeMqttTransport tests', () => {
    const testTs = byPath['tests/client.test.ts'];
    expect(testTs).toContain('readonly published: Array<{ topic: string; payload: Uint8Array; retain: boolean }>');
    expect(testTs).toContain('publish(topic: string, payload: Uint8Array, retain = false): void');
    expect(testTs).toContain('this.published.push({ topic, payload, retain })');
    expect(testTs).toMatch(/describe\("motor\.motorMode"[\s\S]*?published\[0\]\.retain\)\.toBe\(true\)/);
    expect(testTs).toMatch(/describe\("resetCommand"[\s\S]*?published\[0\]\.retain\)\.toBe\(false\)/);
  });

  it('tracks subscriptions and re-subscribes on connect', () => {
    const clientTs = byPath['src/client.ts'];
    expect(clientTs).toContain('private readonly subscriptions = new Set<string>();');
    expect(clientTs).toMatch(/this\.client\.on\("connect", \(\) => \{[\s\S]*?this\.client\?\.subscribe\(topic\)/);
    expect(clientTs).toMatch(/subscribe\(topic: string\): void \{[\s\S]*?this\.subscriptions\.add\(topic\);[\s\S]*?this\.client\?\.subscribe\(topic\);/);
  });

  it('supports an MQTT Last-Will in MqttConfig and passes it to mqtt.connect()', () => {
    const clientTs = byPath['src/client.ts'];
    expect(clientTs).toContain('will?: { topic: string; payload: Uint8Array; retain?: boolean };');
    expect(clientTs).toContain('Required<Omit<MqttConfig, "will">> & Pick<MqttConfig, "will">');
    expect(clientTs).toMatch(/if \(this\.config\.will && this\.config\.will\.topic\) \{[\s\S]*?options\.will = \{[\s\S]*?topic: this\.config\.will\.topic/);
    expect(clientTs).toContain('this.client = mqtt.connect(this.config.url, options);');
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

  it('generates a publish/subscribe/address Vitest case per channel, through its accessor path', () => {
    const testTs = byPath['tests/client.test.ts'];
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
      expect(testTs).toContain(`describe("${label}", () => {`);
      expect(testTs).toContain(`${accessor}.address`);
      expect(testTs).toContain(`${accessor}.publish(`);
      expect(testTs).toContain(`${accessor}.subscribe(`);
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
    expect(() => buildFiles(document, { lang: 'ts', projectName: 'demo_bus' })).toThrow(
      /Tag group "status" collides with untagged channel "status"/
    );
  });

  it('defaults projectName to a slug of info.title when not provided', async () => {
    const doc = await parseFixture('fleet-sample.yaml');
    const defaulted = filesByPath(buildFiles(doc, { lang: 'ts' }));
    expect(defaulted['package.json']).toContain('"name": "sample-fleet-mqtt-api"');
  });
});
