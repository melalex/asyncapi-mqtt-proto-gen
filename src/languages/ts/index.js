'use strict';

const { buildProtoFiles } = require('./proto');
const { buildClientFiles } = require('./client');
const { buildTestFiles } = require('./tests');
const { buildScaffoldFiles } = require('./scaffold');

/**
 * TypeScript language backend — a typed sibling of the js backend. Same seam as the other
 * backends: buildProject(model, params, extra). Emits an idiomatic TypeScript project (real
 * MqttTransport interface, generic Channel<T>, tsconfig, .d.ts output) whose proto types come
 * from ts-proto driven by `buf` (no system protoc, like the python backend's grpcio-tools).
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
