'use strict';

/**
 * Emits one `<dirPrefix><lastPackageSegment>.proto` file per distinct proto package in the
 * model, deduplicated declarations already grouped by src/model.js. Shared by every language
 * backend that wants "one file per proto package" — only the directory prefix differs (e.g. the
 * cpp backend uses '', flat under proto/; the python backend nests under proto/<project>/ so
 * generated _pb2.py modules land inside the right Python package — see src/languages/python).
 *
 * @param {import('./model').ProtoPackages} protoPackages
 * @param {{ dirPrefix?: string }} [options] dirPrefix is prepended to each file's path under proto/
 * @returns {Array<{ path: string, content: string }>}
 */
function buildProtoFiles(protoPackages, { dirPrefix = '' } = {}) {
  const files = [];

  for (const [packageName, declMap] of protoPackages) {
    const fileStem = packageName.split('.').pop();
    const declarationTexts = [...declMap.values()].map((d) => d.text);
    const content = `syntax = "proto3";

package ${packageName};

${declarationTexts.join('\n\n')}
`;
    files.push({ path: `proto/${dirPrefix}${fileStem}.proto`, content });
  }

  return files;
}

module.exports = { buildProtoFiles };
