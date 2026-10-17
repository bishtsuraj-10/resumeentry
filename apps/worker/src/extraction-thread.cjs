/* eslint-disable @typescript-eslint/no-require-imports -- Thread-local CommonJS TypeScript loader. */
// No esbuild subprocess. The worker command already requires dev dependencies;
// transpile only this thread's TS imports, never mutate the parent loader.
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(
  fs.readFileSync(file, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
  } }).outputText, file);
require('./extraction-thread.ts');
