// Bundle src/client into dist/client.js in the DSH client module format:
// a classic script calling window.__ModuleLoader__.load({ id, factory(require) }).
// React (and react/jsx-runtime) come from DSH's shared module table, never bundled.
import { build } from 'esbuild'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { PACKAGE_ROOT } from './lib.mjs'

const result = await build({
  entryPoints: [path.join(PACKAGE_ROOT, 'src/client/index.tsx')],
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: ['es2020'],
  jsx: 'automatic',
  minify: true,
  write: false,
  external: ['react', 'react/*', 'react-dom', 'react-dom/*'],
  logLevel: 'warning',
})

const code = result.outputFiles[0].text
const wrapped = `window.__ModuleLoader__.load({
  id: "dsh-docshield",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
${code}
    return module.exports;
  }
});
`
mkdirSync(path.join(PACKAGE_ROOT, 'dist'), { recursive: true })
writeFileSync(path.join(PACKAGE_ROOT, 'dist', 'client.js'), wrapped)
console.log(`dist/client.js (${(wrapped.length / 1024).toFixed(1)} KB)`)
