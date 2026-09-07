'use strict';

const { toPascalCase } = require('../../naming');
const { channelViewModels, protoModules } = require('./client');
const { groupChannels } = require('../../channel-groups');

/**
 * Emits package.json, tsconfig.json, buf.yaml, buf.gen.yaml, vite.config.ts, .gitignore and
 * README.md for the generated TypeScript project.
 *
 * @param {{ channels: Array<object>, protoPackages: Map<string, Map> }} model
 * @param {{ projectName: string, specTitle: string }} ctx
 * @returns {Array<{ path: string, content: string }>}
 */
function buildScaffoldFiles(model, ctx) {
  const distName = ctx.projectName.replace(/_/g, '-');
  return [
    { path: 'package.json', content: packageJson(distName, ctx.specTitle) },
    { path: 'tsconfig.json', content: tsconfig() },
    { path: 'buf.yaml', content: bufYaml() },
    { path: 'buf.gen.yaml', content: bufGenYaml() },
    { path: 'vite.config.ts', content: viteConfig(distName) },
    { path: '.gitignore', content: gitignore() },
    { path: 'README.md', content: readme(model, ctx, distName) },
  ];
}

function packageJson(distName, specTitle) {
  return `{
  "name": "${distName}",
  "version": "0.1.0",
  "description": "Generated MQTT message-bus client for ${specTitle}",
  "type": "module",
  "main": "./dist/${distName}.umd.js",
  "module": "./dist/${distName}.es.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/${distName}.es.js",
      "require": "./dist/${distName}.umd.js"
    }
  },
  "files": ["dist"],
  "scripts": {
    "proto": "buf generate",
    "build": "npm run proto && vite build",
    "test": "npm run proto && vitest run",
    "typecheck": "npm run proto && tsc --noEmit",
    "dev": "vite build --watch"
  },
  "dependencies": {
    "mqtt": "^5.5.0",
    "protobufjs": "^7.2.6"
  },
  "devDependencies": {
    "@bufbuild/buf": "^1.32.0",
    "@types/node": "^20.12.0",
    "ts-proto": "^1.181.2",
    "typescript": "^5.4.0",
    "vite": "^5.2.0",
    "vite-plugin-dts": "^3.9.0",
    "vitest": "^1.5.0"
  }
}
`;
}

function tsconfig() {
  return `{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2020", "DOM"],
    "types": ["node"],
    "strict": true,
    "declaration": true,
    "outDir": "dist",
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src", "tests", "vite.config.ts"]
}
`;
}

function bufYaml() {
  return `version: v2
modules:
  - path: proto
`;
}

function bufGenYaml() {
  return `version: v2
plugins:
  - local: protoc-gen-ts_proto
    out: src/generated
    opt:
      - esModuleInterop=true
      - forceLong=number
      - useOptionals=messages
`;
}

function viteConfig(distName) {
  const globalName = toPascalCase(distName);
  return `import { defineConfig } from "vite";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import dts from "vite-plugin-dts";

const rootDir = fileURLToPath(new URL(".", import.meta.url));

// Bundler configuration (Library Mode): emits both an ES module build (for
// <script type="module">) and a UMD build (for a plain <script> tag, exposed as
// window.${globalName}), plus .d.ts files under dist/.
export default defineConfig({
  plugins: [dts({ include: ["src"] })],
  build: {
    lib: {
      entry: resolve(rootDir, "src/index.ts"),
      name: "${globalName}",
      fileName: (format) => \`${distName}.\${format}.js\`,
      formats: ["es", "umd"],
    },
  },
});
`;
}

function gitignore() {
  return `node_modules/
dist/
src/generated/
`;
}

function readme(model, ctx, distName) {
  const { specTitle } = ctx;
  const channels = channelViewModels(model.channels);
  const { flat, groups } = groupChannels(channels);
  const example = groups[0] ? groups[0].channels[0] : flat[0];
  const protoFiles = [...model.protoPackages.keys()].map((pkg) => `proto/${pkg.split('.').pop()}.proto`).sort();
  const globalName = toPascalCase(distName);

  const exampleId = groups[0]
    ? `${groups[0].name}.${groups[0].channels[0].id}`
    : example
      ? example.id
      : 'someChannel';
  const exampleType = example ? example.valueRef : 'messages.somePkg.YourMessageType';
  const exampleAddress = example ? example.address : 'your/topic';
  const exampleModules = protoModules(model).join(', ') || 'somePkg';

  return `# ${distName}

TypeScript MQTT client generated from **${specTitle}** by [asyncapi-mqtt-proto-gen](https://github.com/melalex/asyncapi-mqtt-proto-gen) \\
(\`asyncapi generate fromTemplate <spec>.yaml <this-generator> -p lang=ts -p projectName=${ctx.projectName}\`).

Every channel in the spec becomes a typed \`Channel\` on \`MessageBus\`. A channel that carries
AsyncAPI tags is nested under each tag (slugified) — \`messageBus.<tag>.<channel>\`; a channel with
no tags stays top-level — \`messageBus.<channel>\`. A channel with several tags appears under each.

\`\`\`ts
import { MessageBus, messages } from "${distName}";

const messageBus = new MessageBus({ url: "ws://localhost:9001" });
messageBus.connect();

messageBus.${exampleId}.subscribe((msg) => {
  // handle(msg);
});

messageBus.${exampleId}.publish(${exampleType}.create({}));

messageBus.${exampleId}.address; // "${exampleAddress}"
\`\`\`

\`publish\`/\`subscribe\` always use protobuf binary encoding (\`Type.encode(...).finish()\` /
\`Type.decode(...)\`, the [ts-proto](https://github.com/stephenh/ts-proto) codec API).

**Browsers cannot open raw TCP MQTT sockets** — only MQTT-over-WebSocket. The broker this client
connects to needs a websocket listener (e.g. Mosquitto's \`protocol websockets\`, commonly on port
9001), not just the usual TCP 1883.

## Project layout

\`\`\`
proto/                Generated .proto files (one per proto package) — canonical source of truth
src/index.ts           Public API exported to consumers (Vite library-mode entry point)
src/client.ts          MessageBus / Channel / MqttJsTransport
src/messages.ts        Barrel re-exporting each generated proto module as a namespace
src/generated/         *.ts compiled from proto/*.proto by \`npm run proto\` (buf + ts-proto, untracked)
tests/                 Vitest tests using an in-memory MQTT transport (no broker required)
dist/                  ${distName}.es.js + ${distName}.umd.js + *.d.ts, built by \`npm run build\` (untracked)
\`\`\`

Proto codegen is [ts-proto](https://github.com/stephenh/ts-proto) driven by the
[\`buf\`](https://buf.build) CLI (both pulled in by \`npm install\` — no system \`protoc\` needed).
Generated proto files: ${protoFiles.map((f) => `\`${f}\``).join(', ')}, each compiled to a matching
\`src/generated/<name>.ts\` and re-exported through \`src/messages.ts\` as
\`messages.<protoModule>.<MessageType>\` (proto modules: ${exampleModules}).

## Building

\`\`\`sh
npm install
npm run build      # buf generate (ts-proto) -> src/generated/, then \`vite build\` (es + umd + .d.ts)
npm run typecheck  # tsc --noEmit
npm test           # compiles protos, then runs the Vitest suite
\`\`\`

\`dist/${distName}.umd.js\` exposes the library as \`window.${globalName}\` when loaded via a plain
\`<script>\` tag; \`dist/${distName}.es.js\` is for \`<script type="module">\` / bundler consumers.
`;
}

module.exports = { buildScaffoldFiles };
