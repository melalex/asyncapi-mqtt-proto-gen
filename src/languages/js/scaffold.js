'use strict';

const { toPascalCase } = require('../../naming');
const { channelViewModels } = require('./client');
const { groupChannels } = require('../../channel-groups');

/**
 * Emits package.json, vite.config.js, .gitignore and README.md for the generated project.
 *
 * @param {{ channels: Array<object>, protoPackages: Map<string, Map> }} model
 * @param {{ projectName: string, specTitle: string }} ctx
 * @returns {Array<{ path: string, content: string }>}
 */
function buildScaffoldFiles(model, ctx) {
  const distName = ctx.projectName.replace(/_/g, '-');
  return [
    { path: 'package.json', content: packageJson(distName, ctx.specTitle) },
    { path: 'vite.config.js', content: viteConfig(distName) },
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
  "exports": {
    ".": {
      "import": "./dist/${distName}.es.js",
      "require": "./dist/${distName}.umd.js"
    }
  },
  "files": ["dist"],
  "scripts": {
    "proto": "node -e \\"require('fs').mkdirSync('src/generated',{recursive:true})\\" && pbjs -t static-module -w es6 -o src/generated/messages.js proto/*.proto",
    "build": "npm run proto && vite build",
    "test": "npm run proto && vitest run",
    "dev": "vite build --watch"
  },
  "dependencies": {
    "mqtt": "^5.5.0",
    "protobufjs": "^7.2.6"
  },
  "devDependencies": {
    "protobufjs-cli": "^1.1.2",
    "vite": "^5.2.0",
    "vitest": "^1.5.0"
  }
}
`;
}

function viteConfig(distName) {
  const globalName = toPascalCase(distName);
  return `import { defineConfig } from "vite";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

// Bundler configuration (Library Mode): emits both an ES module build (for
// <script type="module">) and a UMD build (for a plain <script> tag, exposed as
// window.${globalName}).
export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, "src/index.js"),
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

  const examplePath = groups[0]
    ? `${groups[0].name}.${groups[0].channels[0].id}`
    : example
      ? example.id
      : 'someChannel';
  const exampleType = example ? example.typeRef : 'messages.some.pkg.YourMessageType';
  const exampleAddress = example ? example.address : 'your/topic';

  return `# ${distName}

JavaScript MQTT client generated from **${specTitle}** by [asyncapi-mqtt-proto-gen](https://github.com/melalex/asyncapi-mqtt-proto-gen) \\
(\`asyncapi generate fromTemplate <spec>.yaml <this-generator> -p lang=js -p projectName=${ctx.projectName}\`).

Every channel in the spec becomes a typed \`Channel\` on \`MessageBus\`. A channel that carries
AsyncAPI tags is nested under each tag (slugified) — \`messageBus.<tag>.<channel>\`; a channel with
no tags stays top-level — \`messageBus.<channel>\`. A channel with several tags appears under each.

\`\`\`js
import { MessageBus, messages } from "${distName}";

const messageBus = new MessageBus({ url: "ws://localhost:9001" });
messageBus.connect();

messageBus.${examplePath}.subscribe((msg) => {
  // handle(msg);
});

messageBus.${examplePath}.publish(${exampleType}.create({}));

messageBus.${examplePath}.address; // "${exampleAddress}"
\`\`\`

\`publish\`/\`subscribe\` always use protobuf binary encoding (\`Type.encode(...).finish()\` /
\`Type.decode(...)\`, protobufjs's static API). Channels whose AsyncAPI MQTT binding (or their
\`send\` operation's binding) sets \`retain: true\` publish with the MQTT retain flag set; all
others publish normally.

**Browsers cannot open raw TCP MQTT sockets** — only MQTT-over-WebSocket. The broker this client
connects to needs a websocket listener (e.g. Mosquitto's \`protocol websockets\`, commonly on port
9001), not just the usual TCP 1883.

## Project layout

\`\`\`
proto/                Generated .proto files (one per proto package) — canonical source of truth
src/index.js           Public API exported to consumers (Vite library-mode entry point)
src/client.js          MessageBus / Channel / MqttJsTransport
src/generated/         messages.js, compiled from proto/*.proto by \`npm run proto\` (untracked)
tests/                 Vitest tests using an in-memory MQTT transport (no broker required)
dist/                  ${distName}.es.js + ${distName}.umd.js, built by \`npm run build\` (untracked)
\`\`\`

Generated proto files: ${protoFiles.map((f) => `\`${f}\``).join(', ')}, compiled together into a
single \`src/generated/messages.js\` (nested namespaces per proto package, e.g.
\`messages.${example ? example.protoPackage : 'some.pkg'}.${example ? example.protoMessageType : 'YourMessageType'}\`).

## Building

\`\`\`sh
npm install
npm run build   # compiles proto/*.proto -> src/generated/messages.js, then runs \`vite build\`
npm test        # compiles protos, then runs the Vitest suite
\`\`\`

\`dist/${distName}.umd.js\` exposes the library as \`window.${globalName}\` when loaded via a plain
\`<script>\` tag; \`dist/${distName}.es.js\` is for \`<script type="module">\` / bundler consumers.
`;
}

module.exports = { buildScaffoldFiles };
