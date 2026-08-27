'use strict';

const { buildProtoFiles: buildProtoFilesShared } = require('../../proto-emit');

/**
 * Emits one `proto/<lastPackageSegment>.proto` file per distinct proto package, flat under
 * proto/ (same convention as the cpp backend). Unlike cpp/python, the *codegen* step (pbjs, see
 * scaffold.js's package.json "proto" script) compiles all of these into a single combined
 * src/generated/messages.js, preserving each file's package as a nested namespace — so there's
 * no need for a per-language directory prefix here.
 *
 * @param {import('../../model').ProtoPackages} protoPackages
 * @returns {Array<{ path: string, content: string }>}
 */
function buildProtoFiles(protoPackages) {
  return buildProtoFilesShared(protoPackages);
}

module.exports = { buildProtoFiles };
