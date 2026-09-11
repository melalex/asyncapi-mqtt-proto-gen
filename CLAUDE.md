# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

An [AsyncAPI Generator](https://www.asyncapi.com/docs/tools/generator) template. Given an MQTT
AsyncAPI v3 spec whose message payloads are **inline proto3 schemas**
(`schemaFormat: application/vnd.google.protobuf;version=3`), it emits a ready-to-build client
project — one `.proto` file per proto package plus a typed client where every channel exposes the
same tiny API — in C++, Python, JavaScript, or TypeScript; or (`lang=webgui`) a runnable
React/TypeScript/Vite/MUI **web GUI**, an MQTT Explorer-style browser app for the same channels
(topic tree, message inspector, publish panel, saved connections) with message encode/decode done
via runtime protobufjs reflection instead of per-channel generated code. A channel with no AsyncAPI tags is
reached as `messageBus.<channel>.publish/subscribe/address`; a channel that carries `tags` is
nested under each tag (slugified): `messageBus.<tag>.<channel>.publish/subscribe/address`, and a
multi-tag channel appears under every one of its groups. A channel whose MQTT binding — or the
binding on its `send` operation — sets `retain: true` publishes MQTT retained messages.

Invoked as:
```sh
asyncapi generate fromTemplate <spec>.yaml <this-repo> -p lang=<cpp|python|js|ts> -p projectName=<name>
```

## Commands

```sh
npm install                      # or: npm ci
npm test                         # jest: src/ unit tests + real `asyncapi generate` e2e for all 4 langs
npm run test:e2e                 # just test/e2e-cli.test.js
npx jest test/model.test.js      # a single test file
npx jest -t "some test name"     # tests matching a name

npm run generate:example         # render the fixture spec to /tmp as a full cpp project (also :python, :js, :ts, :webgui)
```

There is no lint step. Node >= 18.

### Verifying a change end to end

Generator unit tests are **not** sufficient — always run the generated project's real toolchain,
because that is what has historically caught bugs (AsyncAPI parser payload restructuring, CMake
Module-vs-Config output paths, abseil link errors, pbjs needing its output dir pre-created):

```sh
npm run generate:example         && cmake -S /tmp/asyncapi-mqtt-proto-gen-example -B .../build && cmake --build ... && ctest --test-dir .../build
npm run generate:example:python  && (cd /tmp/asyncapi-mqtt-proto-gen-example-py && make test)
npm run generate:example:js      && (cd /tmp/asyncapi-mqtt-proto-gen-example-js && npm install && npm run build && npm test)
npm run generate:example:ts      && (cd /tmp/asyncapi-mqtt-proto-gen-example-ts && npm install && npm run build && npm run typecheck && npm test)
npm run generate:example:webgui  && (cd /tmp/asyncapi-mqtt-proto-gen-example-webgui && npm install && npm run build && npm run typecheck && npm test)
```

`.github/workflows/ci.yml` does exactly this: one job runs `npm test`, then one job per language
builds and tests the generated project on `ubuntu-latest`.

## Architecture

Almost all logic is plain, unit-testable CommonJS in `src/` — not AsyncAPI templating.

```
hooks/index.js  ──┐  generate:before hook, pre-creates every output dir
                  ├──> src/build.js ──> src/model.js + src/proto-extract.js  (build shared IR)
template/index.js ┘   (LANGUAGES map)   src/languages/<lang>/index.js        (render file tree)
```

- **`template/index.js`** — the single React component AsyncAPI Generator renders. Looks up
  `params.lang`, calls `buildFiles`, maps the resulting `{path, content}[]` to `<File>` elements.
- **`hooks/index.js`** — `generate:before` hook. The React renderer writes files with a bare
  `fs.writeFile` and no `mkdir -p`, so this computes the *same* file list and pre-creates every
  directory it needs. Language-agnostic; never needs to change when adding a language.
- **`src/build.js`** — the extension seam. `LANGUAGES` maps `lang` → `src/languages/<lang>/index.js`,
  each exporting `buildProject(model, params, { specTitle, defaultProjectName }) -> {path, content}[]`.
- **`src/model.js` + `src/proto-extract.js`** — parse every channel's embedded proto3 text into the
  shared IR: `{ channels: [{id, address, tags, protoPackage, protoMessageType, ...}],
  protoPackages: Map<pkg, Map<declName, decl>> }`. `tags` is the channel's AsyncAPI tag names (a
  possibly-empty array). Declarations referenced by multiple channels are deduplicated; conflicting
  bodies for the same name throw.
- **`src/proto-emit.js`** — shared "one `.proto` file per package" text renderer, used by all four
  backends. Only the output-path prefix differs (see Python note below).
- **`src/channel-groups.js`** — shared `groupChannels(channels, keyOf)` → `{ flat, groups }`,
  used by every backend to render the tag-grouped client API (see the tag-grouping convention
  below). Slugifies tag names, merges same-slug tags, throws on a group/flat-channel name clash.
- **`src/naming.js`** — string-case helpers (`slugify`, `toSnakeCase`, `toPascalCase`,
  `toUpperSnake`, identifier validators including the language-agnostic `assertValidIdentifier`).

Each `src/languages/<lang>/` follows the same layout: `index.js` (composes the others) + `proto.js`
+ `scaffold.js` (build files, README, .gitignore) + `tests.js` + a client module
(`message-bus.js` for cpp, `client.js` for python/js/ts). The backend files are plain CommonJS
even in the `ts` backend — they *generate* TypeScript, they are not TypeScript. `webgui` follows
the same "plain CommonJS emitting target-language text" posture but has no single client module:
it's an app, not an SDK, so its ~20 generator files split along the app's own module boundaries
(`codec.js`, `mqtt.js`, `storage.js`, `state.js`, one per `components/*` group, etc.) — see the
`webgui:` bullet below.

### Adding a language

Implement `src/languages/<lang>/index.js` with the `buildProject` signature above, then add it to
`LANGUAGES` in `src/build.js`. Nothing else changes.

## Conventions and constraints (already settled — don't re-litigate)

- **CommonJS everywhere in `src/`.** `template/index.js` uses a literal `require('../src/build')`
  on purpose: the react-sdk's rollup/babel bundler has no CJS-interop plugin, so it leaves a bare
  `require()` untouched for Node to resolve at render time. Keep `src/**` as plain CJS so both the
  bundled template and the plain-Node `hooks/index.js` can load it.
- **`__transpiled/` is a generated bundler cache** (gitignored). Don't edit or commit it.
- **Scope limits for every backend:** exactly one message per channel; `publish`/`subscribe` always
  use protobuf **binary** encoding — any legacy per-message wire-format in a spec is ignored, proto
  is canonical.
- **MQTT `retain` (all four backends):** `src/model.js` resolves a per-channel `retain` boolean
  onto the IR — `channels.<id>.bindings.mqtt.retain` if the channel declares it, otherwise the
  `mqtt.retain` binding on a `send` operation targeting that channel (an explicit channel-level
  value always wins; default `false`). Each backend's `Channel` gets a defaulted `retain` ctor arg
  (emitted only when `true`, so non-retained output is byte-identical) and forwards it to a new
  trailing `retain` param on `transport.publish` (mosquitto `retain` flag / paho `retain=` /
  MQTT.js `{ retain }`). Publish-only — subscribers receive retained messages automatically.
- **Each backend ships a transport abstraction + an in-memory `FakeMqttTransport`** so generated
  tests need no broker. Real transports: libmosquitto (cpp), paho-mqtt (python), MQTT.js over
  WebSocket (js/ts — browsers can't do raw TCP MQTT).
- **Tag grouping (all four backends, via `src/channel-groups.js`):** an untagged channel stays a
  top-level accessor (`messageBus.<channel>`); a tagged channel is nested under one group per tag,
  named `slugify(tag)` — the **same** lower_snake_case name in every language — reached as
  `messageBus.<tag>.<channel>`. A multi-tag channel is a member of each of its groups; two tags
  that slugify to the same name merge; a group name that collides with an untagged channel's
  accessor throws. Group container: nested struct-with-ctor (cpp, named `<Pascal>Group`), inline
  object literal + inline object type (js/ts), `types.SimpleNamespace` (python). The topic→handler
  dispatch table is unaffected — grouping is only an accessor path.
- **`src/model.js` payload parsing handles both drivers:** the real `asyncapi` CLI registers a
  protobuf schema-parser plugin (original proto text lands in `x-parser-original-payload`); a bare
  `new Parser()` leaves it as `payload.schema`. Support both.
- **cpp:** flat `proto/`. CMake does `find_package(Protobuf CONFIG QUIET)` then `MODULE REQUIRED`
  fallback (Homebrew needs CONFIG/Abseil; Debian `libprotobuf-dev` only ships Module). Catch2.
- **python:** proto files nested under `proto/<projectName>/`, **not** flat — protoc's Python
  codegen derives the module path from the `.proto` file's path relative to `-I`, not the `package`
  statement. Hatch/hatchling, `src/` layout, `grpcio-tools` (not system protoc), pytest. Channel
  ids are snake_cased for attribute names; the MQTT address is untouched.
- **js:** **plain JavaScript, not TypeScript** — no `tsconfig.json`, no `pbts`/`.d.ts`, no
  `typescript` dep (JSDoc `@typedef` instead). Confirm before adding any TS tooling *to the `js`
  backend* — the separate `ts` backend is where typed output lives. Flat `proto/`. Vite library
  mode (es+umd), `pbjs -t static-module -w es6` compiling all `proto/*.proto` into one
  `src/generated/messages.js` (nested namespace per package). Vitest. Channel ids used as-is.
- **ts:** the typed sibling of `js` — real `.ts` sources, `interface MqttTransport`, generic
  `Channel<T>`, strict `tsconfig.json`, `.d.ts` in the Vite build (es+umd + declarations via
  `vite-plugin-dts`). Proto codegen is **ts-proto driven by the `buf` CLI** (`buf generate`, config
  in `buf.yaml` + `buf.gen.yaml`) — both come from `npm install`, no system `protoc` (like
  python's `grpcio-tools`). ts-proto 1.x → generated code imports `protobufjs/minimal`, so
  `protobufjs` stays a runtime dep. Flat `proto/` → `src/generated/<pkg>.ts`, re-exported as
  namespaces by a hand-written `src/messages.ts` barrel (`messages.<pkg>.<Type>`). Vitest. Channel
  ids used as-is.
- **webgui:** React + TypeScript + Vite + MUI — a runnable MQTT Explorer-style browser app, *not*
  an importable SDK like the other four backends: a persistent left panel (topic tree switching
  to settings, toggled by the top bar), a topic detail pane (JSON/raw/field-to-value views with
  old-vs-new diff highlighting and a persisted history list), and a publish panel (JSON /
  auto-generated HTML form / raw protobuf bytes). Message encode/decode happens entirely **at
  runtime** via protobufjs reflection, not per-channel generated code: flat `proto/` (shared
  `proto-emit.js`, same as cpp/js) is compiled by **pbjs**, not buf/ts-proto — `pbjs -t json-module
  -w es6` (the `-w es6` is required; without it pbjs emits a UMD wrapper with no `export`
  statement, unimportable by Vite) — into `src/generated/messages.js`, whose default export is
  already a resolved `protobufjs/light` `Root`. `src/codec/root.ts` imports it directly (with
  `@ts-expect-error`, since pbjs emits no `.d.ts` for it) and calls `root.resolveAll()` once;
  `src/codec/fieldSchema.ts` walks `Type.fieldsArray` into a generic field schema (guarding
  cyclic/self-referential message types against infinite recursion) that drives both the
  field-to-value view and the auto-generated publish form, for any message shape, with no
  per-message code. `src/channels.ts` is plain IR data
  (id/address/tags/retain/protoPackage/protoMessageType) grouped via the shared
  `channel-groups.js` — unlike every other backend, channel ids are never turned into a JS/TS
  property, so there's no per-channel identifier-validity check here (only the shared tag/flat
  collision check still applies). MQTT connectivity reuses the browser-WebSocket-only constraint
  from js/ts (`src/mqtt/MqttJsTransport.ts`, its own independently-authored copy) — mqtt.js's
  `publish()` types require a `Buffer`, so payloads are wrapped via the standalone `buffer` npm
  package (not a Node global). Saved connections and per-topic message history persist in
  IndexedDB via `idb`: connections in **plaintext**, local-only, never transmitted; history drives
  the red/green diff view (`diff`/jsdiff) and the History list. EN/UK localization
  (`react-i18next`) is generated from one shared key list in `i18n.js` so the two locale files
  can't structurally drift apart. The retain checkbox is always shown in the Publish panel
  (matches MQTT Explorer's UI) but default-checked/unchecked from the channel's IR `retain` flag.
  On connect, subscribes only to the spec's known channel addresses — spec-driven, not a `#`
  wildcard. The top bar shows the spec's `info.title` (`src/channels.ts`'s `specTitle`), not a
  hardcoded app name. The Connections dialog is prepopulated, on first-ever open only (a one-time
  flag in IndexedDB's `meta` store — never re-applied, even if the user deletes every seeded
  connection), from the spec's `servers` section (`model.servers` in `src/model.js`, resolved
  `{var}` templates and all — raw extraction, no protocol interpretation, since only webgui
  consumes it): a `servers.<key>` entry with protocol `ws`/`wss`/`mqtts`/`secure-mqtt` maps
  cleanly, but plain `mqtt`/`mqtts`-as-raw-TCP entries (the common case — servers blocks rarely
  declare a browser-usable WS listener) still seed a best-effort connection carrying the spec's
  host/port through unchanged, tagged with a `description` caveat surfaced in the UI (an info icon
  in the list, an inline `Alert` in the form) explaining the port likely needs to point at the
  broker's WS bridge instead. No buf/ts-proto, no bonus typed SDK: GUI-only output, one build pipeline. Vitest +
  Testing Library + jsdom + `fake-indexeddb` (wired only into `tests/setup.ts`, never real app
  code). `vite.config.ts` imports `defineConfig` from `"vitest/config"`, not `"vite"` — plain
  `vite`'s `UserConfigExport` type doesn't know about the `test` key.

## Fixture

`test/fixtures/fleet-sample.yaml` — the generic spec used by every test and `generate:example`
script. Deliberately scrubbed of any tie to the private project this generator was modeled on;
keep new test naming in the same generic style. It tags several channels to exercise grouping end
to end: `motorCommand`/`motorMode` → `motor`, `motorEcho` → `motor` **and** `diagnostics`
(multi-tag), `deviceHeartbeat`/`deviceImu` → `Device Telemetry` (slugifies to `device_telemetry`),
and `resetCommand` stays untagged/flat. It also exercises `retain` both ways: `motorMode` carries
a channel-level `bindings.mqtt.retain: true`, and the `sendMotorCommand` operation carries an
operation-level one that `motorCommand` (no channel binding) inherits.
