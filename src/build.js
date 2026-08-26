'use strict';

const { parseAsyncApiDocument } = require('./model');
const { slugify } = require('./naming');

// Registered language backends. Adding a language: implement src/languages/<lang>/index.js
// exporting buildProject(model, params, extra), then add it here. No other file needs to change.
const LANGUAGES = {
  cpp: require('./languages/cpp'),
};

/**
 * Single source of truth for "what files does this generation run produce", shared by both
 * hooks/index.js (which only needs the file *paths*, to pre-create their directories) and
 * template/index.js (which needs the full file contents).
 *
 * @param {import('@asyncapi/parser').AsyncAPIDocument} asyncapiDoc
 * @param {{ lang: string, projectName?: string }} params raw AsyncAPI Generator templateParams
 * @returns {Array<{ path: string, content: string }>}
 */
function buildFiles(asyncapiDoc, params) {
  const lang = params && params.lang;
  const languageModule = LANGUAGES[lang];
  if (!languageModule) {
    throw new Error(
      `Unsupported lang "${lang}". Supported languages: ${Object.keys(LANGUAGES).join(', ')}.`
    );
  }

  const model = parseAsyncApiDocument(asyncapiDoc);
  const specTitle = asyncapiDoc.info().title();
  const defaultProjectName = slugify(specTitle);

  return languageModule.buildProject(model, params, { specTitle, defaultProjectName });
}

module.exports = { buildFiles, LANGUAGES };
