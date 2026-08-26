'use strict';

const fs = require('fs');
const path = require('path');

const { buildFiles } = require('../src/build');

module.exports = {
  // Runs before the generator renders template/index.js. The React renderer's saveContentToFile
  // does a plain fs.writeFile with no mkdir -p, so any output path containing a subdirectory
  // (proto/, include/<project>/, src/, tests/) must already exist in targetDir before rendering
  // starts. We compute the exact same file list template/index.js will render (via the shared
  // src/build.js) and pre-create every directory it needs.
  'generate:before': (generator) => {
    const files = buildFiles(generator.asyncapi, generator.templateParams);
    const dirs = new Set(
      files.map((f) => path.dirname(f.path)).filter((dir) => dir && dir !== '.')
    );
    for (const dir of dirs) {
      fs.mkdirSync(path.join(generator.targetDir, dir), { recursive: true });
    }
  },
};
