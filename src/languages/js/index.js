'use strict';

const { buildProtoFiles } = require('./proto');
const { buildClientFiles } = require('./client');
const { buildTestFiles } = require('./tests');
const { buildScaffoldFiles } = require('./scaffold');

/**
 * JavaScript (plain JS, no TypeScript) language backend. Same seam as the other backends:
 * buildProject(model, params, extra).
 *
 * @param {import('../../model').Model} model shared IR from src/model.js
 * @param {{ lang: string, projectName?: string }} params raw AsyncAPI Generator templateParams
 * @param {{ specTitle: string, defaultProjectName: string }} extra
 * @returns {Array<{ path: string, content: string }>}
 */
function buildProject(model, params, extra) {
  const projectName = params.projectName || extra.defaultProjectName;
  const ctx = { projectName, specTitle: extra.specTitle };

  return [
    ...buildProtoFiles(model.protoPackages),
    ...buildClientFiles(model, ctx),
    ...buildTestFiles(model),
    ...buildScaffoldFiles(model, ctx),
  ];
}

module.exports = { buildProject };
