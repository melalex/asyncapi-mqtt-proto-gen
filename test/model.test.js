'use strict';

const path = require('path');
const fs = require('fs');
const { Parser } = require('@asyncapi/parser');
const { parseAsyncApiDocument } = require('../src/model');
const { extractProtoDeclarations } = require('../src/proto-extract');

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
        schema: 'syntax = "proto3";\\npackage p;\\nmessage A { int32 x = 1; }\\n'
    B:
      name: B
      payload:
        schemaFormat: 'application/vnd.google.protobuf;version=3'
        schema: 'syntax = "proto3";\\npackage p;\\nmessage B { int32 x = 1; }\\n'
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
