# asyncapi-mqtt-proto-gen

An [AsyncAPI Generator](https://www.asyncapi.com/docs/tools/generator) template for MQTT specs
that define their message payloads as **inline proto3 schemas** (`payload.schemaFormat:
application/vnd.google.protobuf;version=3`). It turns such a spec into a ready-to-build client
project with one `.proto` file per proto package and a typed client where every channel exposes
the same small API:

```cpp
messageBus.controlRouterInput.subscribe([](const some::protocol::Message& msg) { handle(msg); });
messageBus.controlRouterInput.publish(msg);
messageBus.controlRouterInput.address;   // "some/topic"
```

`publish`/`subscribe` always use protobuf binary encoding (`SerializeToString`/`ParseFromString`).

## Usage

```sh
asyncapi generate fromTemplate <spec>.yaml <this-repo> -p lang=cpp -p projectName=my_project
```

| Parameter     | Required | Default                  | Description                                                              |
|---------------|----------|---------------------------|----------------------------------------------------------------------------|
| `lang`        | yes      | —                          | Target language. Currently only `cpp`.                                    |
| `projectName` | no       | slug of `info.title`      | CMake project name / include directory / C++ namespace for the client.   |

### Supported languages

Only `cpp` today. See [Adding a language](#adding-a-language) below — the repo is structured so
this is the one entry point that's meant to grow.

### C++ output

```
<project>/
├── CMakeLists.txt          # C++17, find_package(Protobuf)+find_package(mosquitto), Catch2 tests
├── .gitignore
├── README.md
├── proto/                  # One .proto file per proto package (deduplicated across channels)
├── include/<project>/      # message_bus.hpp, mqtt_transport.hpp, mosquitto_transport.hpp
├── src/                    # message_bus.cpp, mosquitto_transport.cpp
├── tests/                  # Catch2 tests using an in-memory MQTT transport (no broker needed)
└── build/                  # Out-of-source build dir (untracked) — .pb.h/.pb.cc land here
```

MQTT transport is [libmosquitto](https://mosquitto.org/); tests substitute an in-memory
`FakeMqttTransport` (see `tests/fake_mqtt_transport.hpp` in the generated project) so no broker is
needed to run them.

**Scope limits (v1):** exactly one message per channel (matches every channel in the reference
spec); publish/subscribe always use protobuf binary, ignoring any legacy per-message wire-format
notes in the spec (proto is treated as the canonical, target encoding).

## How it works

```
hooks/index.js  ──┐
                   ├──> src/build.js ──> src/model.js (parses embedded proto, groups by package)
template/index.js ─┘                └──> src/languages/<lang>/index.js (renders the file tree)
```

Almost all of the interesting logic is plain, unit-testable Node in `src/`, not AsyncAPI Generator
templating:

- `src/model.js` + `src/proto-extract.js` build a shared, language-agnostic IR from the AsyncAPI
  document: one entry per channel, plus every proto `message`/`enum` declaration grouped by
  package and deduplicated by name (the same message is commonly referenced by multiple channels).
- `src/languages/cpp/*.js` renders that IR into the full C++ project as a
  `Map<relativePath, content>`.
- `hooks/index.js`'s `generate:before` hook pre-creates every output directory the render will
  need (`proto/`, `include/<project>/`, `src/`, `tests/`): the Generator's React renderer writes
  files with a plain `fs.writeFile` and no `mkdir -p`, so any nested output path needs its
  directory to exist first.
- `template/index.js` is the one React component AsyncAPI Generator actually renders: it looks up
  `params.lang`, calls the same `src/build.js`, and turns the resulting file list into `<File>`
  components.

### Adding a language

1. Implement `src/languages/<lang>/index.js` exporting `buildProject(model, params, extra) ->
   Array<{ path, content }>` (see `src/languages/cpp/index.js`).
2. Register it in the `LANGUAGES` map in `src/build.js`.

Nothing else changes — `hooks/index.js` and `template/index.js` are language-agnostic.

## Development

```sh
npm install
npm test          # unit tests (src/model.js, src/languages/cpp) + a real end-to-end run through
                   # the actual `asyncapi generate fromTemplate` CLI
```

`npm run generate:example` runs the template against the bundled fixture spec
(`test/fixtures/fleet-sample.yaml`) and writes a full sample project to `/tmp`, useful for poking
at real generated output by hand:

```sh
npm run generate:example
cmake -S /tmp/asyncapi-mqtt-proto-gen-example -B /tmp/asyncapi-mqtt-proto-gen-example/build
cmake --build /tmp/asyncapi-mqtt-proto-gen-example/build
ctest --test-dir /tmp/asyncapi-mqtt-proto-gen-example/build
```

CI (`.github/workflows/ci.yml`) runs `npm test` and then does exactly that build+test cycle on
`ubuntu-latest`, so a generator bug and a generated-project build break both fail the same way.
