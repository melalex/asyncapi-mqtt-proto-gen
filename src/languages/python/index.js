'use strict';

const { buildProtoFiles } = require('./proto');
const { buildClientFiles } = require('./client');
const { buildTestFiles } = require('./tests');
const { buildScaffoldFiles } = require('./scaffold');

/**
 * Python language backend. Same seam as src/languages/cpp: buildProject(model, params, extra).
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
    ...buildProtoFiles(model.protoPackages, projectName),
    ...buildClientFiles(model, ctx),
    ...buildTestFiles(model, ctx),
    ...buildScaffoldFiles(model, ctx),
  ];
}

module.exports = { buildProject };
