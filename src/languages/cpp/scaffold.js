'use strict';

const { groupChannels } = require('../../channel-groups');

/**
 * Emits CMakeLists.txt, .gitignore and README.md for the generated project.
 *
 * @param {{ channels: Array<object>, protoPackages: Map<string, Map> }} model
 * @param {{ projectName: string, specTitle: string }} ctx
 * @returns {Array<{ path: string, content: string }>}
 */
function buildScaffoldFiles(model, ctx) {
  return [
    { path: 'CMakeLists.txt', content: cmakeLists(ctx.projectName) },
    { path: '.gitignore', content: gitignore() },
    { path: 'README.md', content: readme(model, ctx) },
  ];
}

function cmakeLists(projectName) {
  return `cmake_minimum_required(VERSION 3.16)
project(${projectName} CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)

# --- Protobuf -----------------------------------------------------------------
# Prefer protobuf's own CMake CONFIG package: newer protobuf (which depends on Abseil, e.g. the
# Homebrew build on macOS) only records the right transitive link dependencies for generated code
# through its own imported targets, and protobuf_generate()/protobuf::libprotobuf from CONFIG mode
# get that right. Distro packages (e.g. Ubuntu/Debian's libprotobuf-dev) commonly ship only the
# CMake-bundled legacy FindProtobuf module with no CONFIG package at all, so fall back to that.
find_package(Protobuf CONFIG QUIET)
if(NOT Protobuf_FOUND)
  find_package(Protobuf MODULE REQUIRED)
endif()

file(GLOB PROTO_FILES \${CMAKE_CURRENT_SOURCE_DIR}/proto/*.proto)
if(COMMAND protobuf_generate)
  protobuf_generate(
    LANGUAGE cpp
    OUT_VAR PROTO_GENERATED_FILES
    PROTOS \${PROTO_FILES}
    IMPORT_DIRS \${CMAKE_CURRENT_SOURCE_DIR}/proto
    PROTOC_OUT_DIR \${CMAKE_CURRENT_BINARY_DIR})
else()
  protobuf_generate_cpp(PROTO_SRCS PROTO_HDRS \${PROTO_FILES})
  set(PROTO_GENERATED_FILES \${PROTO_SRCS} \${PROTO_HDRS})
endif()

add_library(${projectName}_messages \${PROTO_GENERATED_FILES})
target_link_libraries(${projectName}_messages PUBLIC protobuf::libprotobuf)
# protobuf_generate() (CONFIG mode, PROTOC_OUT_DIR set above) flattens output straight into
# CMAKE_CURRENT_BINARY_DIR; protobuf_generate_cpp() (MODULE mode fallback) instead mirrors the
# proto/ subdirectory into the binary dir. Add both so "#include \\"<name>.pb.h\\"" works either way.
target_include_directories(${projectName}_messages PUBLIC
  \${CMAKE_CURRENT_BINARY_DIR}
  \${CMAKE_CURRENT_BINARY_DIR}/proto)

# --- MQTT (libmosquitto) -------------------------------------------------------
find_path(MOSQUITTO_INCLUDE_DIR mosquitto.h)
find_library(MOSQUITTO_LIBRARY mosquitto)
if(NOT MOSQUITTO_INCLUDE_DIR OR NOT MOSQUITTO_LIBRARY)
  message(FATAL_ERROR
    "libmosquitto not found. Install it first, e.g.:\\n"
    "  apt-get install libmosquitto-dev   (Debian/Ubuntu)\\n"
    "  brew install mosquitto             (macOS)")
endif()

# --- Client library -------------------------------------------------------------
add_library(${projectName}_client
  src/message_bus.cpp
  src/mosquitto_transport.cpp)
target_include_directories(${projectName}_client
  PUBLIC \${CMAKE_CURRENT_SOURCE_DIR}/include \${MOSQUITTO_INCLUDE_DIR})
target_link_libraries(${projectName}_client
  PUBLIC ${projectName}_messages
  PRIVATE \${MOSQUITTO_LIBRARY})

# --- Tests ------------------------------------------------------------------
option(BUILD_TESTS "Build unit tests" ON)
if(BUILD_TESTS)
  include(FetchContent)
  find_package(Catch2 3 QUIET)
  if(NOT Catch2_FOUND)
    FetchContent_Declare(
      Catch2
      GIT_REPOSITORY https://github.com/catchorg/Catch2.git
      GIT_TAG v3.5.4)
    FetchContent_MakeAvailable(Catch2)
    list(APPEND CMAKE_MODULE_PATH \${catch2_SOURCE_DIR}/extras)
  endif()

  add_executable(${projectName}_tests tests/test_messages.cpp)
  target_include_directories(${projectName}_tests PRIVATE tests)
  target_link_libraries(${projectName}_tests PRIVATE ${projectName}_client Catch2::Catch2WithMain)

  include(CTest)
  include(Catch)
  catch_discover_tests(${projectName}_tests)
endif()
`;
}

function gitignore() {
  return `# Out-of-source build directory (generated .pb.h/.pb.cc, object files, binaries)
build/
build-*/

# Editor/IDE
.vscode/
.idea/
*.swp

# OS cruft
.DS_Store
`;
}

function readme(model, ctx) {
  const { projectName, specTitle } = ctx;
  const { flat, groups } = groupChannels(model.channels);
  const exampleChannel = groups[0] ? groups[0].channels[0] : flat[0];
  const protoFiles = [...model.protoPackages.keys()].map((pkg) => `proto/${pkg.split('.').pop()}.proto`).sort();
  const exampleType = exampleChannel
    ? `${exampleChannel.protoPackage.split('.').join('::')}::${exampleChannel.protoMessageType}`
    : 'YourMessageType';
  const exampleChannelId = groups[0]
    ? `${groups[0].name}.${groups[0].channels[0].id}`
    : exampleChannel
      ? exampleChannel.id
      : 'yourChannel';
  const exampleAddress = exampleChannel ? exampleChannel.address : 'your/topic';

  return `# ${projectName}

C++ MQTT client generated from **${specTitle}** by [asyncapi-mqtt-proto-gen](https://github.com/) \\
(\`asyncapi generate fromTemplate <spec>.yaml <this-generator> -p lang=cpp -p projectName=${projectName}\`).

Every channel in the spec becomes a typed \`Channel\` on \`${projectName}::MessageBus\`. A channel that
carries AsyncAPI tags is nested under each tag (slugified) — \`messageBus.<tag>.<channel>\`; a channel
with no tags stays top-level — \`messageBus.<channel>\`. Multi-tag channels appear under each.

\`\`\`cpp
#include "${projectName}/message_bus.hpp"

int main() {
  ${projectName}::MqttConfig config;
  config.host = "localhost";
  ${projectName}::MessageBus messageBus(config);
  messageBus.connect();

  messageBus.${exampleChannelId}.subscribe([](const ${exampleType}& msg) {
    // handle(msg);
  });

  ${exampleType} msg;
  messageBus.${exampleChannelId}.publish(msg);

  messageBus.${exampleChannelId}.address;  // "${exampleAddress}"
}
\`\`\`

publish()/subscribe() always use protobuf binary encoding (\`SerializeToString\`/\`ParseFromString\`).
Channels whose AsyncAPI MQTT binding (or their \`send\` operation's binding) sets \`retain: true\`
publish with the MQTT retain flag set; all others publish normally.

## Project layout

\`\`\`
proto/                        Generated .proto files (one per proto package), canonical source of truth
include/${projectName}/       Public headers: message_bus.hpp, mqtt_transport.hpp, mosquitto_transport.hpp
src/                           message_bus.cpp, mosquitto_transport.cpp
tests/                         Catch2 tests using an in-memory MQTT transport (no broker required)
build/                         Out-of-source build directory (untracked) — .pb.h/.pb.cc land here too
\`\`\`

Generated proto files: ${protoFiles.map((f) => `\`${f}\``).join(', ')}.

## Building

Prerequisites:

\`\`\`sh
# Debian/Ubuntu
sudo apt-get install build-essential cmake protobuf-compiler libprotobuf-dev libmosquitto-dev

# macOS
brew install cmake protobuf mosquitto
\`\`\`

On macOS, \`mosquitto\` is keg-only (not linked onto the default include/library search path), so
point CMake at it explicitly:

\`\`\`sh
cmake -S . -B build -DCMAKE_PREFIX_PATH="$(brew --prefix mosquitto)"
cmake --build build
ctest --test-dir build
\`\`\`

On Linux, \`libmosquitto-dev\` installs onto the default search path, so plain \`cmake -S . -B
build\` is enough.

Catch2 (test-only) is fetched automatically via CMake \`FetchContent\` if it isn't already
available via \`find_package\`. Pass \`-DBUILD_TESTS=OFF\` to skip building tests.
`;
}

module.exports = { buildScaffoldFiles };
