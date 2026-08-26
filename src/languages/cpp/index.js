'use strict';

const { buildProtoFiles } = require('./proto');
const { buildMessageBusFiles } = require('./message-bus');
const { buildTestFiles } = require('./tests');
const { buildScaffoldFiles } = require('./scaffold');

/**
 * C++ language backend: the seam a future language implements (src/languages/<lang>/index.js
 * exporting the same buildProject(model, params) signature, then registering itself in
 * hooks/index.js and template/index.js's LANGUAGES map).
 *
 * @param {import('../../model').Model} model shared IR from src/model.js
 * @param {{ lang: string, projectName?: string }} params raw AsyncAPI Generator templateParams
 * @param {{ specTitle: string }} extra spec-derived defaults not carried by params
 * @returns {Array<{ path: string, content: string }>}
 */
function buildProject(model, params, extra) {
  const projectName = params.projectName || extra.defaultProjectName;
  const ctx = { projectName, specTitle: extra.specTitle };

  return [
    ...buildProtoFiles(model.protoPackages),
    ...buildMessageBusFiles(model, ctx),
    ...buildTestFiles(model, ctx),
    ...buildScaffoldFiles(model, ctx),
  ];
}

module.exports = { buildProject };
