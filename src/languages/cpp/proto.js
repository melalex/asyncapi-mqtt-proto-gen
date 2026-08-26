'use strict';

const { buildProtoFiles: buildProtoFilesShared } = require('../../proto-emit');

/**
 * Emits one `proto/<lastPackageSegment>.proto` file per distinct proto package in the model,
 * mirroring the hand-written convention already used in the reference project (one file per
 * domain/package, e.g. `control.proto`, `telemetry.proto`).
 *
 * @param {import('../../model').ProtoPackages} protoPackages
 * @returns {Array<{ path: string, content: string }>}
 */
function buildProtoFiles(protoPackages) {
  return buildProtoFilesShared(protoPackages);
}

module.exports = { buildProtoFiles };
