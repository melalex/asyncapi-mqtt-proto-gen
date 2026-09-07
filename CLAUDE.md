# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

An [AsyncAPI Generator](https://www.asyncapi.com/docs/tools/generator) template. Given an MQTT
AsyncAPI v3 spec whose message payloads are **inline proto3 schemas**
(`schemaFormat: application/vnd.google.protobuf;version=3`), it emits a ready-to-build client
project — one `.proto` file per proto package plus a typed client where every channel exposes the
same tiny API (`messageBus.<channel>.publish/subscribe/address`) — in C++, Python, JavaScript, or
TypeScript.

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

npm run generate:example         # render the fixture spec to /tmp as a full cpp project (also :python, :js, :ts)
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
  shared IR: `{ channels: [{id, address, protoPackage, protoMessageType, ...}],
  protoPackages: Map<pkg, Map<declName, decl>> }`. Declarations referenced by multiple channels are
  deduplicated; conflicting bodies for the same name throw.
- **`src/proto-emit.js`** — shared "one `.proto` file per package" text renderer, used by all four
  backends. Only the output-path prefix differs (see Python note below).
- **`src/naming.js`** — string-case helpers (`slugify`, `toSnakeCase`, `toPascalCase`,
  `toUpperSnake`, identifier validators).

Each `src/languages/<lang>/` follows the same layout: `index.js` (composes the others) + `proto.js`
+ `scaffold.js` (build files, README, .gitignore) + `tests.js` + a client module
(`message-bus.js` for cpp, `client.js` for python/js/ts). The backend files are plain CommonJS
even in the `ts` backend — they *generate* TypeScript, they are not TypeScript.

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
- **Each backend ships a transport abstraction + an in-memory `FakeMqttTransport`** so generated
  tests need no broker. Real transports: libmosquitto (cpp), paho-mqtt (python), MQTT.js over
  WebSocket (js/ts — browsers can't do raw TCP MQTT).
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

## Fixture

`test/fixtures/fleet-sample.yaml` — the generic spec used by every test and `generate:example`
script. Deliberately scrubbed of any tie to the private project this generator was modeled on;
keep new test naming in the same generic style.
