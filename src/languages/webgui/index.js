'use strict';

const { buildProtoFiles } = require('./proto');
const { buildChannelsFile } = require('./channels');
const { buildTopicsFile } = require('./topics');
const { buildCodecFiles } = require('./codec');
const { buildMqttFiles } = require('./mqtt');
const { buildStorageFiles } = require('./storage');
const { buildDiffFiles } = require('./diff');
const { buildI18nFiles } = require('./i18n');
const { buildThemeFiles } = require('./theme');
const { buildStateFiles } = require('./state');
const { buildAppShellFiles } = require('./app-shell');
const { buildLayoutComponentFiles } = require('./components-layout');
const { buildTreeComponentFiles } = require('./components-tree');
const { buildSettingsComponentFiles } = require('./components-settings');
const { buildTopicComponentFiles } = require('./components-topic');
const { buildPublishComponentFiles } = require('./components-publish');
const { buildConnectionsComponentFiles } = require('./components-connections');
const { buildHookFiles } = require('./hooks');
const { buildUtilFiles } = require('./utils');
const { buildScaffoldFiles } = require('./scaffold');
const { buildTestFiles } = require('./tests');

/**
 * React + TypeScript + Vite + MUI web GUI backend — a generic MQTT/protobuf "explorer" modeled on
 * MQTT Explorer (topic tree, JSON/raw/field->value message inspector with change highlighting and
 * history, JSON/HTML-form/raw-bytes publish panel, saved connections). Same seam as every backend:
 * buildProject(model, params, extra).
 *
 * Unlike cpp/python/js/ts, message encode/decode is NOT generated per channel — it happens
 * entirely at runtime via protobufjs reflection (see src/codec/*.ts), so most of this backend's
 * output is static TS/TSX text independent of the spec. Only proto.js/channels.js/storage.js/
 * scaffold.js/app-shell.js vary with the model.
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
    ...buildChannelsFile(model, ctx),
    ...buildTopicsFile(),
    ...buildCodecFiles(),
    ...buildMqttFiles(),
    ...buildStorageFiles(ctx),
    ...buildDiffFiles(),
    ...buildI18nFiles(),
    ...buildThemeFiles(),
    ...buildStateFiles(),
    ...buildAppShellFiles(ctx),
    ...buildLayoutComponentFiles(),
    ...buildTreeComponentFiles(),
    ...buildSettingsComponentFiles(),
    ...buildTopicComponentFiles(),
    ...buildPublishComponentFiles(),
    ...buildConnectionsComponentFiles(),
    ...buildHookFiles(),
    ...buildUtilFiles(),
    ...buildScaffoldFiles(model, ctx),
    ...buildTestFiles(),
  ];
}

module.exports = { buildProject };
