'use strict';

const { buildProtoFiles: buildProtoFilesShared } = require('../../proto-emit');

/**
 * Emits one `proto/<lastPackageSegment>.proto` file per distinct proto package, flat under
 * proto/ (same convention as the cpp and js backends). The codegen step (`buf generate`, see
 * scaffold.js's package.json "proto" script + buf.gen.yaml) runs `protoc-gen-ts_proto` over all
 * of these into src/generated/, one `.ts` module per `.proto` file plus an index barrel — so
 * there's no need for a per-language directory prefix here.
 *
 * @param {import('../../model').ProtoPackages} protoPackages
 * @returns {Array<{ path: string, content: string }>}
 */
function buildProtoFiles(protoPackages) {
  return buildProtoFilesShared(protoPackages);
}

module.exports = { buildProtoFiles };
