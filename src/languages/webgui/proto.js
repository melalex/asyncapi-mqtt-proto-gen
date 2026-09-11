'use strict';

const { buildProtoFiles: buildProtoFilesShared } = require('../../proto-emit');

/**
 * Emits one `proto/<lastPackageSegment>.proto` file per distinct proto package, flat under
 * proto/ (same convention as cpp/js/ts). Reused as-is: message encode/decode for this backend
 * happens entirely at runtime via protobufjs reflection compiled from these files (see
 * src/codec/*.ts), not via a per-package codegen step baked into generation-time output.
 *
 * @param {import('../../model').ProtoPackages} protoPackages
 * @returns {Array<{ path: string, content: string }>}
 */
function buildProtoFiles(protoPackages) {
  return buildProtoFilesShared(protoPackages);
}

module.exports = { buildProtoFiles };
