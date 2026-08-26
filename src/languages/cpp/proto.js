'use strict';

/**
 * Emits one `proto/<lastPackageSegment>.proto` file per distinct proto package in the model,
 * mirroring the hand-written convention already used in the reference project (one file per
 * domain/package, e.g. `control.proto`, `telemetry.proto`).
 *
 * @param {import('../../model').ProtoPackages} protoPackages
 * @returns {Array<{ path: string, content: string }>}
 */
function buildProtoFiles(protoPackages) {
  const files = [];

  for (const [packageName, declMap] of protoPackages) {
    const fileStem = packageName.split('.').pop();
    const declarationTexts = [...declMap.values()].map((d) => d.text);
    const content = `syntax = "proto3";

package ${packageName};

${declarationTexts.join('\n\n')}
`;
    files.push({ path: `proto/${fileStem}.proto`, content });
  }

  return files;
}

module.exports = { buildProtoFiles };
