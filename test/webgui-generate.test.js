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

describe('webgui buildProject (via src/build.js)', () => {
  let files;
  let byPath;

  beforeAll(async () => {
    const doc = await parseFixture('fleet-sample.yaml');
    files = buildFiles(doc, { lang: 'webgui', projectName: 'demo_bus' });
    byPath = filesByPath(files);
  });

  it('produces the expected project layout', () => {
    expect(Object.keys(byPath).sort()).toEqual(
      [
        '.gitignore',
        '.dockerignore',
        'Dockerfile',
        'nginx.conf',
        'README.md',
        'index.html',
        'package.json',
        'tsconfig.json',
        'tsconfig.node.json',
        'vite.config.ts',
        'proto/commands.proto',
        'proto/control.proto',
        'proto/sensors.proto',
        'proto/telemetry.proto',
        'src/App.tsx',
        'src/main.tsx',
        'src/theme.ts',
        'src/vite-env.d.ts',
        'src/channels.ts',
        'src/topics.ts',
        'src/codec/root.ts',
        'src/codec/messageTypes.ts',
        'src/codec/fieldSchema.ts',
        'src/codec/codec.ts',
        'src/mqtt/MqttTransport.ts',
        'src/mqtt/MqttJsTransport.ts',
        'src/mqtt/FakeMqttTransport.ts',
        'src/storage/db.ts',
        'src/storage/connections.ts',
        'src/storage/history.ts',
        'src/diff/textDiff.ts',
        'src/i18n/index.ts',
        'src/i18n/en.ts',
        'src/i18n/uk.ts',
        'src/state/ConnectionContext.tsx',
        'src/state/TopicStore.tsx',
        'src/state/SettingsContext.tsx',
        'src/hooks/useTopicData.ts',
        'src/hooks/useFieldSchema.ts',
        'src/hooks/useSearch.ts',
        'src/utils/bytes.ts',
        'src/utils/format.ts',
        'src/components/layout/AppShell.tsx',
        'src/components/layout/TopAppBar.tsx',
        'src/components/layout/LeftPanel.tsx',
        'src/components/tree/TopicTree.tsx',
        'src/components/tree/TopicTreeNode.tsx',
        'src/components/settings/SettingsPanel.tsx',
        'src/components/topic/TopicDetailView.tsx',
        'src/components/topic/TopicBreadcrumb.tsx',
        'src/components/topic/ValueSection.tsx',
        'src/components/topic/ValueJsonView.tsx',
        'src/components/topic/ValueRawView.tsx',
        'src/components/topic/ValueFieldsView.tsx',
        'src/components/topic/ValueDiff.tsx',
        'src/components/topic/HistoryList.tsx',
        'src/components/publish/PublishPanel.tsx',
        'src/components/publish/PublishJsonEditor.tsx',
        'src/components/publish/PublishFormField.tsx',
        'src/components/publish/PublishFormEditor.tsx',
        'src/components/publish/PublishRawEditor.tsx',
        'src/components/connections/ConnectionsDialog.tsx',
        'src/components/connections/ConnectionsList.tsx',
        'src/components/connections/ConnectionForm.tsx',
        'tests/setup.ts',
        'tests/codec.test.ts',
        'tests/fieldSchema.test.ts',
        'tests/storage.test.ts',
        'tests/mqttTransport.test.ts',
        'tests/topics.test.ts',
        'tests/TopicTree.test.tsx',
        'tests/HistoryList.test.tsx',
        'tests/PublishPanel.test.tsx',
        'tests/ConnectionForm.test.tsx',
      ].sort()
    );
  });

  it("shows the History count as a plain inline Chip, not MUI's Badge (which needs children to anchor its overlay against — used bare, it can visually cover its own row and swallow clicks in a real browser, even though jsdom's synthetic click() doesn't reproduce that)", () => {
    const historyListTsx = byPath['src/components/topic/HistoryList.tsx'];
    expect(historyListTsx).not.toContain('@mui/material/Badge');
    expect(historyListTsx).not.toMatch(/<Badge\b/);
    expect(historyListTsx).toContain('import Chip from "@mui/material/Chip"');
    expect(historyListTsx).toContain('<Chip label={count > 99 ? "99+" : count}');
  });

  it('emits a multi-stage Dockerfile (Node build -> nginx serve) wired to nginx.conf', () => {
    const dockerfile = byPath['Dockerfile'];
    expect(dockerfile).toContain('FROM node:20-alpine AS build');
    expect(dockerfile).toContain('RUN npm run build');
    expect(dockerfile).toContain('FROM nginx:1.27-alpine AS serve');
    expect(dockerfile).toContain('COPY --from=build /app/dist /usr/share/nginx/html');
    expect(dockerfile).toContain('COPY nginx.conf /etc/nginx/conf.d/default.conf');
    expect(byPath['nginx.conf']).toContain('try_files $uri $uri/ /index.html;');
    expect(byPath['.dockerignore']).toContain('node_modules');
  });

  it('sets a favicon via an inline SVG data URI (no binary asset pipeline)', () => {
    const indexHtml = byPath['index.html'];
    expect(indexHtml).toContain('<link rel="icon" href="data:image/svg+xml,');
  });

  it("displays the spec's info.title in the top bar instead of a hardcoded app name", () => {
    expect(byPath['src/channels.ts']).toContain('export const specTitle: string = "Sample Fleet MQTT API";');
    const topAppBarTsx = byPath['src/components/layout/TopAppBar.tsx'];
    expect(topAppBarTsx).toContain('import { specTitle } from "../../channels"');
    expect(topAppBarTsx).toContain('{specTitle}');
  });

  it("derives a connection seed per spec server, resolving {var} templates and flagging non-ws/wss protocols", () => {
    const channelsTs = byPath['src/channels.ts'];
    const seed = channelsTs.match(/export const serverSeeds: ServerConnectionSeed\[\] = (\[[\s\S]*?\n\]);/)[1];
    const parsed = JSON.parse(seed);
    expect(parsed).toEqual([
      {
        id: 'production',
        host: 'localhost',
        port: 1883,
        protocol: 'ws',
        tls: false,
        description:
          'Spec declares protocol "mqtt" — browsers need a WebSocket listener, so the port may ' +
          "need to point at your broker's WS bridge rather than its raw MQTT port.",
      },
    ]);
  });

  it('seeds the connections store from serverSeeds exactly once, gated behind a one-time flag', () => {
    const connectionsTs = byPath['src/storage/connections.ts'];
    expect(connectionsTs).toContain('import { serverSeeds } from "../channels";');
    expect(connectionsTs).toContain('export async function ensureSeedConnections');
    expect(connectionsTs).toContain('SEED_FLAG_KEY');

    const dialogTsx = byPath['src/components/connections/ConnectionsDialog.tsx'];
    expect(dialogTsx).toContain('ensureSeedConnections');
  });

  it('subscribes with an MQTT + wildcard for parameterized channel addresses, and resolves received topics back to a channel by pattern, not just exact match', () => {
    const connectionContextTsx = byPath['src/state/ConnectionContext.tsx'];
    expect(connectionContextTsx).toContain('import { subscribeFilterFor } from "../topics";');
    expect(connectionContextTsx).toContain('next.subscribe(subscribeFilterFor(channel))');

    const topicStoreTsx = byPath['src/state/TopicStore.tsx'];
    expect(topicStoreTsx).toContain('import { hasParameters, matchesAddress } from "../topics";');
    expect(topicStoreTsx).toContain('resolveChannelForTopic(topic)');

    const topicsTs = byPath['src/topics.ts'];
    expect(topicsTs).toContain('export function subscribeFilterFor');
    expect(topicsTs).toContain('export function matchesAddress');
    expect(topicsTs).toContain('export function findChannelForTopic');
  });

  it('keeps proto files flat under proto/, one per package, like the js/ts backends', () => {
    const controlProto = byPath['proto/control.proto'];
    expect(controlProto).toContain('package fleet.control;');
    expect(controlProto.match(/message MotorCommand/g)).toHaveLength(1);
    expect(controlProto).toContain('enum MotorMode');
    expect(controlProto).toContain('message MotorModeCmd');
  });

  it('emits channel metadata as plain data, grouped by tag, with no per-channel JS symbol', () => {
    const channelsTs = byPath['src/channels.ts'];
    expect(channelsTs).toContain('export interface ChannelMeta');
    expect(channelsTs).toMatch(/"id": "resetCommand"/);
    // flat channel present, no tag groups
    expect(channelsTs).toMatch(/export const flatChannels: ChannelMeta\[\] = \[\s*\{\s*"id": "resetCommand"/);
    // motor group contains motorCommand, motorMode, motorEcho
    expect(channelsTs).toMatch(/"name": "motor"[\s\S]*"id": "motorCommand"[\s\S]*"id": "motorMode"[\s\S]*"id": "motorEcho"/);
    // multi-tag: motorEcho also appears under diagnostics
    expect(channelsTs).toMatch(/"name": "diagnostics"[\s\S]*"id": "motorEcho"/);
    // tag with space/capitals slugifies
    expect(channelsTs).toContain('"name": "device_telemetry"');
  });

  it('threads the MQTT retain binding onto the channel metadata (channel- and operation-level)', () => {
    const channelsTs = byPath['src/channels.ts'];
    const motorCommand = channelsTs.match(/\{\s*"id": "motorCommand",[\s\S]*?\}/)[0];
    const motorMode = channelsTs.match(/\{\s*"id": "motorMode",[\s\S]*?\}/)[0];
    const resetCommand = channelsTs.match(/\{\s*"id": "resetCommand",[\s\S]*?\}/)[0];
    expect(motorCommand).toContain('"retain": true');
    expect(motorMode).toContain('"retain": true');
    expect(resetCommand).toContain('"retain": false');
  });

  it('loads the pbjs-compiled reflection root and resolves it once', () => {
    const rootTs = byPath['src/codec/root.ts'];
    expect(rootTs).toContain('import generatedRoot from "../generated/messages.js"');
    expect(rootTs).toContain('root.resolveAll();');
    expect(rootTs).toContain('export default root;');
  });

  it('looks up message types at runtime by protoPackage + protoMessageType, not a generated symbol', () => {
    const messageTypesTs = byPath['src/codec/messageTypes.ts'];
    expect(messageTypesTs).toContain('root.lookupType(key)');
    expect(messageTypesTs).toContain('protoPackage + "." + protoMessageType');
  });

  it('implements the MqttTransport contract in MqttJsTransport and threads a retain/qos publish', () => {
    const transportTs = byPath['src/mqtt/MqttJsTransport.ts'];
    expect(transportTs).toContain('implements MqttTransport');
    expect(transportTs).toContain('publish(topic: string, payload: Uint8Array, retain = false, qos: 0 | 1 | 2 = 0)');
    expect(transportTs).toContain('Buffer.from(payload)');
  });

  it('declares both IndexedDB object stores plus the seeding meta store, with their keys and indexes', () => {
    const dbTs = byPath['src/storage/db.ts'];
    expect(dbTs).toContain('createObjectStore("connections", { keyPath: "id" })');
    expect(dbTs).toContain('autoIncrement: true');
    expect(dbTs).toContain('createIndex("byTopic", "topic")');
    expect(dbTs).toContain('createIndex("byTopicAndTime", ["topic", "timestampMs"])');
    expect(dbTs).toContain('createObjectStore("meta")');
    expect(dbTs).toContain('DB_NAME = "demo_bus-webgui"');
  });

  it('guards store creation with objectStoreNames.contains(...) so upgrading an older-schema database only adds what it is missing', () => {
    const dbTs = byPath['src/storage/db.ts'];
    expect(dbTs).toMatch(/if \(!db\.objectStoreNames\.contains\("connections"\)\)/);
    expect(dbTs).toMatch(/if \(!db\.objectStoreNames\.contains\("messageHistory"\)\)/);
    expect(dbTs).toMatch(/if \(!db\.objectStoreNames\.contains\("meta"\)\)/);
  });

  it('surfaces (rather than silently swallows) a failed history write or connection-seed attempt', () => {
    const topicStoreTsx = byPath['src/state/TopicStore.tsx'];
    expect(topicStoreTsx).toMatch(/appendHistoryEntry\(\{[\s\S]*?\}\)\s*\.catch\(/);

    const dialogTsx = byPath['src/components/connections/ConnectionsDialog.tsx'];
    expect(dialogTsx).toContain('.catch(');
  });

  it('keeps the English and Ukrainian locale files structurally in sync (identical key sets)', () => {
    const en = byPath['src/i18n/en.ts'];
    const uk = byPath['src/i18n/uk.ts'];
    const keysOf = (content) => [...content.matchAll(/^\s{2}(\w+):/gm)].map((m) => m[1]).sort();
    const enKeys = keysOf(en);
    const ukKeys = keysOf(uk);
    expect(enKeys.length).toBeGreaterThan(10);
    expect(ukKeys).toEqual(enKeys);
  });

  it('wires the app-mode Vite config, strict TS project config, and the app dependency set', () => {
    expect(byPath['vite.config.ts']).toContain('import { defineConfig } from "vitest/config";');
    expect(byPath['vite.config.ts']).toContain('@vitejs/plugin-react');
    expect(byPath['vite.config.ts']).toContain('environment: "jsdom"');
    expect(byPath['tsconfig.json']).toContain('"strict": true');
    expect(byPath['tsconfig.json']).toContain('"jsx": "react-jsx"');

    const packageJson = byPath['package.json'];
    expect(packageJson).toContain('"name": "demo-bus"');
    expect(packageJson).toContain('pbjs -t json-module -w es6');
    for (const dep of ['react', 'react-dom', '@mui/material', 'react-i18next', 'mqtt', 'protobufjs', 'diff', 'idb', 'buffer']) {
      expect(packageJson).toContain(`"${dep}":`);
    }
    for (const devDep of ['protobufjs-cli', 'vite', 'vitest', 'typescript', 'fake-indexeddb', '@testing-library/react']) {
      expect(packageJson).toContain(`"${devDep}":`);
    }
  });

  // Unlike every other backend, channels.ts stores channel ids as plain string data rather than
  // turning them into a `this.<id>` JS/TS property (message lookup happens at runtime via
  // protobufjs reflection — see src/codec/messageTypes.ts), so there is no per-channel
  // identifier-validity check to run here, unlike ts-generate.test.js's analogous test. The
  // tag/flat-channel collision check below still applies: it's enforced unconditionally by the
  // shared channel-groups.js, independent of backend.
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
    expect(() => buildFiles(document, { lang: 'webgui', projectName: 'demo_bus' })).toThrow(
      /Tag group "status" collides with untagged channel "status"/
    );
  });

  it('defaults projectName to a slug of info.title when not provided', async () => {
    const doc = await parseFixture('fleet-sample.yaml');
    const defaulted = filesByPath(buildFiles(doc, { lang: 'webgui' }));
    expect(defaulted['package.json']).toContain('"name": "sample-fleet-mqtt-api"');
  });
});
