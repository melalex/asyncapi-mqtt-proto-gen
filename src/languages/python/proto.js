'use strict';

const { buildProtoFiles: buildProtoFilesShared } = require('../../proto-emit');

/**
 * Emits one `proto/<projectName>/<lastPackageSegment>.proto` file per distinct proto package.
 *
 * Nested under proto/<projectName>/ (unlike the cpp backend's flat proto/) because protoc's
 * Python codegen derives the generated module's *path* purely from the .proto file's own path
 * relative to the -I include root (the dotted `package` statement does NOT drive Python package
 * nesting, unlike C++/Java). Compiling with `-I proto --python_out=src` therefore lands
 * `<lastPackageSegment>_pb2.py` directly inside `src/<projectName>/`, alongside the hand-written
 * client.py — see src/languages/python/client.js for how those modules get imported.
 *
 * @param {import('../../model').ProtoPackages} protoPackages
 * @param {string} projectName
 * @returns {Array<{ path: string, content: string }>}
 */
function buildProtoFiles(protoPackages, projectName) {
  return buildProtoFilesShared(protoPackages, { dirPrefix: `${projectName}/` });
}

module.exports = { buildProtoFiles };
