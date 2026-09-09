'use strict';

const path = require('path');
const fs = require('fs');
const { Parser } = require('@asyncapi/parser');
const { parseAsyncApiDocument } = require('../src/model');
const { extractProtoDeclarations } = require('../src/proto-extract');
const { groupChannels } = require('../src/channel-groups');

async function parseFixture(name) {
  const parser = new Parser();
  const text = fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');
  const { document, diagnostics } = await parser.parse(text);
  if (!document) {
    throw new Error(diagnostics.map((d) => d.message).join('\n'));
  }
  return document;
}

describe('extractProtoDeclarations', () => {
  it('extracts the package and every top-level message/enum', () => {
    const { package: pkg, declarations } = extractProtoDeclarations(`
syntax = "proto3";
package example.control;

enum ExampleMode {
  EXAMPLE_MODE_MANUAL = 0;
}

message ExampleModeCmd {
  ExampleMode mode = 1;
}
`);
    expect(pkg).toBe('example.control');
    expect(declarations.map((d) => [d.kind, d.name])).toEqual([
      ['enum', 'ExampleMode'],
      ['message', 'ExampleModeCmd'],
    ]);
  });

  it('handles an empty message body on one line', () => {
    const { declarations } = extractProtoDeclarations(`
syntax = "proto3";
package example.commands;
message ExampleReset {}
`);
    expect(declarations).toEqual([{ kind: 'message', name: 'ExampleReset', text: 'message ExampleReset {}' }]);
  });

  it('throws when there is no package declaration', () => {
    expect(() => extractProtoDeclarations('syntax = "proto3";\nmessage Foo {}\n')).toThrow(/package/);
  });
});

describe('parseAsyncApiDocument', () => {
  it('builds one channel entry per channel and groups declarations by proto package', async () => {
    const doc = await parseFixture('fleet-sample.yaml');
    const model = parseAsyncApiDocument(doc);

    expect(model.channels).toHaveLength(6);
    const byId = Object.fromEntries(model.channels.map((c) => [c.id, c]));
    expect(byId.motorCommand).toMatchObject({
      address: 'motor/command',
      protoPackage: 'fleet.control',
      protoMessageType: 'MotorCommand',
    });
    expect(byId.motorEcho).toMatchObject({
      address: 'motor/echo',
      protoPackage: 'fleet.control',
      protoMessageType: 'MotorCommand',
    });

    // fleet.control is shared by MotorCommand (used twice) and MotorModeCmd/its enum: dedup by
    // declaration name means the package has exactly 3 declarations, not 4.
    expect([...model.protoPackages.get('fleet.control').keys()].sort()).toEqual([
      'MotorCommand',
      'MotorMode',
      'MotorModeCmd',
    ]);
    expect(model.protoPackages.size).toBe(4); // fleet.control, fleet.telemetry, fleet.sensors, fleet.commands
  });

  it('carries each channel\'s AsyncAPI tag names on the IR (empty array when none)', async () => {
    const doc = await parseFixture('fleet-sample.yaml');
    const byId = Object.fromEntries(parseAsyncApiDocument(doc).channels.map((c) => [c.id, c]));

    expect(byId.deviceHeartbeat.tags).toEqual(['Device Telemetry']);
    expect(byId.motorEcho.tags).toEqual(['motor', 'diagnostics']);
    expect(byId.resetCommand.tags).toEqual([]);
  });

  it('resolves the MQTT retain flag: channel binding first, then a send operation binding', async () => {
    const doc = await parseFixture('fleet-sample.yaml');
    const byId = Object.fromEntries(parseAsyncApiDocument(doc).channels.map((c) => [c.id, c]));

    // motorMode declares bindings.mqtt.retain on the channel itself.
    expect(byId.motorMode.retain).toBe(true);
    // motorCommand has no channel binding; it inherits retain from its `send` operation
    // (sendMotorCommand) and NOT from the sibling `receive` operation.
    expect(byId.motorCommand.retain).toBe(true);
    // Channels with neither a channel nor an operation binding default to false.
    expect(byId.motorEcho.retain).toBe(false);
    expect(byId.resetCommand.retain).toBe(false);
    expect(byId.deviceHeartbeat.retain).toBe(false);
  });

  it('rejects channels with more than one message', async () => {
    const parser = new Parser();
    const { document } = await parser.parse(`
asyncapi: '3.1.0'
info: { title: t, version: '1.0.0' }
channels:
  multi:
    address: multi
    messages:
      A: { $ref: '#/components/messages/A' }
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
          message B { int32 x = 1; }
`);
    expect(() => parseAsyncApiDocument(document)).toThrow(/exactly one message/);
  });

  it('rejects a message payload with a non-protobuf schemaFormat', async () => {
    const parser = new Parser();
    const { document } = await parser.parse(`
asyncapi: '3.1.0'
info: { title: t, version: '1.0.0' }
channels:
  avroOnly:
    address: avro_only
    messages:
      A: { $ref: '#/components/messages/A' }
components:
  messages:
    A:
      name: A
      payload:
        schemaFormat: 'application/x-my-custom-format'
        schema: 'not protobuf'
`);
    expect(() => parseAsyncApiDocument(document)).toThrow(/protobuf/);
  });

  it('rejects a message payload with no inline schema text at all', async () => {
    const parser = new Parser();
    const { document } = await parser.parse(`
asyncapi: '3.1.0'
info: { title: t, version: '1.0.0' }
channels:
  jsonOnly:
    address: json_only
    messages:
      A: { $ref: '#/components/messages/A' }
components:
  messages:
    A:
      name: A
      payload:
        type: object
        properties:
          x: { type: string }
`);
    expect(() => parseAsyncApiDocument(document)).toThrow(/no inline proto payload/);
  });
});

describe('groupChannels', () => {
  const ch = (id, tags) => ({ id, tags });

  it('keeps untagged channels flat, in spec order, with no groups', () => {
    const { flat, groups } = groupChannels([ch('a', []), ch('b', [])]);
    expect(flat.map((c) => c.id)).toEqual(['a', 'b']);
    expect(groups).toEqual([]);
  });

  it('slugifies tag names and sorts groups by the slugified name', () => {
    const { flat, groups } = groupChannels([ch('heartbeat', ['Device Telemetry']), ch('cmd', ['motor'])]);
    expect(flat).toEqual([]);
    expect(groups.map((g) => g.name)).toEqual(['device_telemetry', 'motor']);
    expect(groups[0].channels.map((c) => c.id)).toEqual(['heartbeat']);
  });

  it('puts a channel with several tags under every one of its groups', () => {
    const { groups } = groupChannels([ch('echo', ['motor', 'diagnostics'])]);
    expect(groups.map((g) => g.name)).toEqual(['diagnostics', 'motor']);
    expect(groups.every((g) => g.channels[0].id === 'echo')).toBe(true);
  });

  it('merges tag strings that slugify to the same name into one group', () => {
    const { groups } = groupChannels([ch('a', ['Motor Control']), ch('b', ['motor-control'])]);
    expect(groups).toHaveLength(1);
    expect(groups[0].name).toBe('motor_control');
    expect(groups[0].channels.map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('honours a custom keyOf when deduplicating group members', () => {
    const { groups } = groupChannels(
      [{ id: 'x', attr: 'shared', tags: ['g'] }, { id: 'y', attr: 'shared', tags: ['g'] }],
      (c) => c.attr
    );
    expect(groups[0].channels.map((c) => c.id)).toEqual(['x']);
  });

  it('throws when a slugified tag collides with an untagged channel accessor', () => {
    expect(() => groupChannels([ch('status', []), ch('ping', ['Status'])])).toThrow(
      /Tag group "status" collides with untagged channel "status"/
    );
  });

  it('throws when a tag cannot be slugified into a valid identifier', () => {
    expect(() => groupChannels([ch('a', ['123'])])).toThrow(/not a valid identifier/);
  });
});
