# asyncapi-mqtt-proto-gen

An [AsyncAPI Generator](https://www.asyncapi.com/docs/tools/generator) template for MQTT specs
that define their message payloads as **inline proto3 schemas** (`payload.schemaFormat:
application/vnd.google.protobuf;version=3`). It turns such a spec into a ready-to-build client
project with one `.proto` file per proto package and a typed client where every channel exposes
the same small API, in whichever supported language you pick:

```cpp
messageBus.controlRouterInput.subscribe([](const some::protocol::Message& msg) { handle(msg); });
messageBus.controlRouterInput.publish(msg);
messageBus.controlRouterInput.address;   // "some/topic"
```

```python
message_bus.control_router_input.subscribe(lambda msg: handle(msg))
message_bus.control_router_input.publish(msg)
message_bus.control_router_input.address  # "some/topic"
```

`publish`/`subscribe` always use protobuf binary encoding (`SerializeToString`/`ParseFromString`).

## Usage

```sh
asyncapi generate fromTemplate <spec>.yaml https://github.com/melalex/asyncapi-mqtt-proto-gen -p lang=cpp -p projectName=my_project
```

| Parameter     | Required | Default                  | Description                                                                          |
|---------------|----------|---------------------------|----------------------------------------------------------------------------------------|
| `lang`        | yes      | —                          | Target language: `cpp` or `python`.                                                    |
| `projectName` | no       | slug of `info.title`      | CMake project name / Python package name (include directory, namespace) for the client. |

### Supported languages

#### `cpp`

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

#### `python`

```
<project>/
├── pyproject.toml          # Hatch/hatchling, PEP 621 metadata, src/ layout
├── .gitignore
├── Makefile                # proto / install / dev / test / clean targets
├── README.md
├── proto/<project>/        # One .proto file per proto package, nested to match the Python package
├── src/<project>/          # __init__.py, client.py — *_pb2.py/*_pb2.pyi land here via `make proto`
└── tests/                  # pytest tests using an in-memory MQTT transport (no broker needed)
```

MQTT transport is [paho-mqtt](https://pypi.org/project/paho-mqtt/); `.proto` files are compiled
with `grpcio-tools` (`make proto`), not a system `protoc` install. Proto files are nested under
`proto/<project>/` — unlike the flat `proto/` the cpp backend uses — because protoc's Python
codegen derives the generated module's *path* from the `.proto` file's own path relative to the
`-I` include root (not from the proto `package` statement), so this is what makes
`from <project> import <name>_pb2` land in the right place. Channel ids from the spec are
snake_cased into Python attribute names (`controlRouterInput` → `control_router_input`); the
MQTT `address` itself is untouched.

Both backends share the same scope limits: exactly one message per channel, and publish/subscribe
always use protobuf binary — any legacy per-message wire-format notes in a spec are ignored (proto
is treated as the canonical, target encoding).

See [Adding a language](#adding-a-language) below for how a third language would slot in.

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
- `src/proto-emit.js` is the shared "one `.proto` file per package" renderer both `languages/cpp`
  and `languages/python` call (with a different output-path prefix — see the `python` section
  above for why the prefix differs).
- `src/languages/<lang>/*.js` renders the IR into the full project as a `Map<relativePath,
  content>`.
- `hooks/index.js`'s `generate:before` hook pre-creates every output directory the render will
  need: the Generator's React renderer writes files with a plain `fs.writeFile` and no
  `mkdir -p`, so any nested output path needs its directory to exist first.
- `template/index.js` is the one React component AsyncAPI Generator actually renders: it looks up
  `params.lang`, calls the same `src/build.js`, and turns the resulting file list into `<File>`
  components.

### Adding a language

1. Implement `src/languages/<lang>/index.js` exporting `buildProject(model, params, extra) ->
   Array<{ path, content }>` (see `src/languages/cpp/index.js` or `src/languages/python/index.js`).
2. Register it in the `LANGUAGES` map in `src/build.js`.

Nothing else changes — `hooks/index.js` and `template/index.js` are language-agnostic.

## Development

```sh
npm install
npm test          # unit tests (src/model.js, src/languages/*) + real end-to-end runs through the
                   # actual `asyncapi generate fromTemplate` CLI, for every supported language
```

`npm run generate:example` (cpp) / `npm run generate:example:python` runs the template against the
bundled fixture spec (`test/fixtures/fleet-sample.yaml`) and writes a full sample project to
`/tmp`, useful for poking at real generated output by hand:

```sh
npm run generate:example
cmake -S /tmp/asyncapi-mqtt-proto-gen-example -B /tmp/asyncapi-mqtt-proto-gen-example/build
cmake --build /tmp/asyncapi-mqtt-proto-gen-example/build
ctest --test-dir /tmp/asyncapi-mqtt-proto-gen-example/build
```

```sh
npm run generate:example:python
cd /tmp/asyncapi-mqtt-proto-gen-example-py
make test   # make dev && make proto && pytest
```

CI (`.github/workflows/ci.yml`) runs `npm test` and then does exactly those build+test cycles, one
job per language, on `ubuntu-latest` — so a generator bug and a generated-project build break both
fail the same way.
