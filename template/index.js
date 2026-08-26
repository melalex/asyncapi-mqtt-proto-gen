import { File } from '@asyncapi/generator-react-sdk';

// Plain require(), not `import`, on purpose: the react-sdk's rollup+babel transpiler only
// understands genuine ES module `import`/`export` syntax for files it bundles (it has no
// CommonJS-interop plugin), while hooks/index.js loads this same src/ tree via plain Node
// require(). A literal require() call here is left untouched by rollup and resolved normally by
// Node at render time, so src/**/*.js can stay ordinary CommonJS and work in both places.
const { buildFiles } = require('../src/build');

// Single entry point for every supported language. Dispatch on params.lang and the whole output
// tree happens inside src/build.js -> src/languages/<lang>; this component just turns the
// resulting { path, content } list into <File> components. See hooks/index.js for why the
// matching directories must be (and are) pre-created before this renders.
export default function ({ asyncapi, params }) {
  const files = buildFiles(asyncapi, params);
  return files.map((file) => <File name={file.path}>{file.content}</File>);
}
