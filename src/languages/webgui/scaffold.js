'use strict';

/**
 * Emits package.json, tsconfig.json, tsconfig.node.json, vite.config.ts, .gitignore and
 * README.md for the generated project. Same conservative-majors posture as js/ts (protobufjs
 * ^7.2.6, mqtt ^5.5.0, vite ^5.2.0, vitest ^1.5.0, typescript ^5.4.0), not today's npm `latest`.
 *
 * @param {{ channels: Array<object> }} model
 * @param {{ projectName: string, specTitle: string }} ctx
 * @returns {Array<{ path: string, content: string }>}
 */
function buildScaffoldFiles(model, ctx) {
  const distName = ctx.projectName.replace(/_/g, '-');

  return [
    { path: 'package.json', content: packageJson(distName, ctx.specTitle) },
    { path: 'tsconfig.json', content: tsconfigJson() },
    { path: 'tsconfig.node.json', content: tsconfigNodeJson() },
    { path: 'vite.config.ts', content: viteConfig() },
    { path: '.gitignore', content: gitignore() },
    { path: 'Dockerfile', content: dockerfile() },
    { path: '.dockerignore', content: dockerignore() },
    { path: 'nginx.conf', content: nginxConf() },
    { path: 'README.md', content: readme(ctx, distName) },
  ];
}

function packageJson(distName, specTitle) {
  return `{
  "name": "${distName}",
  "version": "0.1.0",
  "description": "Generated MQTT Explorer-style web GUI for ${specTitle}",
  "private": true,
  "type": "module",
  "scripts": {
    "proto": "node -e \\"require('fs').mkdirSync('src/generated',{recursive:true})\\" && pbjs -t json-module -w es6 -o src/generated/messages.js proto/*.proto",
    "dev": "npm run proto && vite",
    "build": "npm run proto && tsc -b && vite build",
    "typecheck": "npm run proto && tsc --noEmit",
    "test": "npm run proto && vitest run"
  },
  "dependencies": {
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "@mui/material": "^5.15.0",
    "@mui/icons-material": "^5.15.0",
    "@emotion/react": "^11.11.0",
    "@emotion/styled": "^11.11.0",
    "react-i18next": "^14.1.0",
    "i18next": "^23.11.0",
    "mqtt": "^5.5.0",
    "protobufjs": "^7.2.6",
    "diff": "^5.2.0",
    "idb": "^8.0.0",
    "buffer": "^6.0.3"
  },
  "devDependencies": {
    "protobufjs-cli": "^1.1.2",
    "typescript": "^5.4.0",
    "vite": "^5.2.0",
    "@vitejs/plugin-react": "^4.2.0",
    "vitest": "^1.5.0",
    "@testing-library/react": "^14.2.0",
    "@testing-library/jest-dom": "^6.4.0",
    "@testing-library/user-event": "^14.5.0",
    "jsdom": "^24.0.0",
    "fake-indexeddb": "^5.0.2",
    "@types/diff": "^5.2.0",
    "@types/react": "^18.2.0",
    "@types/react-dom": "^18.2.0",
    "@types/node": "^20.12.0"
  }
}
`;
}

function tsconfigJson() {
  return `{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["src", "tests"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
`;
}

function tsconfigNodeJson() {
  return `{
  "compilerOptions": {
    "composite": true,
    "skipLibCheck": true,
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowSyntheticDefaultImports": true
  },
  "include": ["vite.config.ts"]
}
`;
}

function viteConfig() {
  return `import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Bundler configuration (app mode, not library mode — unlike the js/ts backends, this project is
// a runnable application, not an importable SDK): builds an index.html-rooted single-page app.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    globals: true,
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

function dockerfile() {
  return `# Multi-stage build: this is a static SPA (protobuf decode/encode happens entirely in the
# browser via runtime reflection — see src/codec/), so the runtime image only ever needs to serve
# the built dist/ output. No Node, no server-side app process.

FROM node:20-alpine AS build
WORKDIR /app

# Installed separately from the rest of the source so \`docker build\` can cache this layer across
# rebuilds that only touch app code, not dependencies.
COPY package.json package-lock.json* ./
RUN npm install

COPY . .
# Runs the proto codegen step (pbjs) + tsc project build + vite build in one go — see package.json.
RUN npm run build

FROM nginx:1.27-alpine AS serve
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
`;
}

function dockerignore() {
  return `node_modules
dist
src/generated
.git
*.log
`;
}

function nginxConf() {
  return `server {
  listen 80;
  server_name _;
  root /usr/share/nginx/html;
  index index.html;

  # Single-page app: any path that doesn't match a real file falls back to index.html. The app
  # itself has no client-side router today (everything is in-page state), but this keeps a hard
  # refresh/deep link working the same way if that ever changes.
  location / {
    try_files $uri $uri/ /index.html;
  }
}
`;
}

function readme(ctx, distName) {
  return `# ${distName}

Web GUI (React + TypeScript + Vite + MUI) generated from **${ctx.specTitle}** by
[asyncapi-mqtt-proto-gen](https://github.com/melalex/asyncapi-mqtt-proto-gen) \\
(\`asyncapi generate fromTemplate <spec>.yaml <this-generator> -p lang=webgui -p projectName=${ctx.projectName}\`).

An MQTT Explorer-style browser app for every channel in the spec: a topic tree (grouped by
AsyncAPI tags, same convention as every other backend), a JSON/raw/field→value message inspector
with change highlighting and history, and a publish panel supporting JSON, an auto-generated HTML
form, or raw protobuf bytes.

Message encode/decode happens entirely at runtime via protobufjs reflection compiled from
\`proto/*.proto\` — there is no per-channel generated client code to keep in sync with the spec.

## Getting started

\`\`\`sh
npm install
npm run dev     # compiles proto/*.proto -> src/generated/messages.js, then starts Vite
\`\`\`

Connect to a broker with an MQTT-over-WebSocket listener (browsers cannot open raw TCP MQTT
sockets — e.g. Mosquitto's \`protocol websockets\`, commonly on port 9001) via the connections icon
in the top bar. Saved connections and per-topic message history are kept in the browser's
IndexedDB (plaintext, local-only, never transmitted).

## Project layout

\`\`\`
proto/                 Generated .proto files (one per proto package) — canonical source of truth
src/channels.ts         Plain channel/group metadata (id, address, tags, retain, proto type)
src/codec/              protobufjs reflection: message lookup, field schema, encode/decode
src/mqtt/                MqttTransport (MQTT.js over WebSocket) + an in-memory fake for tests
src/storage/             IndexedDB: saved connections, per-topic message history
src/state/                React contexts: live connection, per-topic store, UI settings
src/components/           The GUI itself (topic tree, message inspector, publish panel, connections)
src/generated/            messages.js, compiled from proto/*.proto by \`npm run proto\` (untracked)
tests/                    Vitest + Testing Library, jsdom + fake-indexeddb (no broker required)
dist/                     Built by \`npm run build\` (untracked)
\`\`\`

## Building

\`\`\`sh
npm run build       # proto codegen, tsc project build, then vite build
npm run typecheck   # proto codegen, then tsc --noEmit
npm test            # proto codegen, then vitest run
\`\`\`

## Docker

A multi-stage \`Dockerfile\` is included: it builds the app with Node, then serves the static
\`dist/\` output with nginx (the app is a static SPA — protobuf encode/decode happens entirely in
the browser, so there's no Node process to run at runtime).

\`\`\`sh
docker build -t ${distName} .
docker run --rm -p 8080:80 ${distName}
\`\`\`

Then open http://localhost:8080 and connect to your broker's WebSocket listener via the
Connections dialog — the broker itself isn't part of this image. If your broker also runs in
Docker (e.g. Mosquitto with \`protocol websockets\` configured), just make sure its websocket port
is published on the host so the browser can reach it directly; the two containers don't need to
share a network unless you're also proxying through nginx.
`;
}

module.exports = { buildScaffoldFiles };
