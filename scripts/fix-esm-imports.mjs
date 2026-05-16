// Adds .js extensions to relative imports in the ESM build output.
// Node's native ESM requires explicit file extensions; tsc with moduleResolution:bundler
// doesn't emit them, so we patch the compiled output as a post-build step.
// Handles both flat files (./encrypt → ./encrypt.js) and directory indexes
// (./constants → ./constants/index.js).
import { readdirSync, readFileSync, writeFileSync, statSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'

const dir = 'dist/esm'

function resolveRelativeImport(specifier, fromFile) {
  const fromDir = dirname(fromFile)
  const resolved = join(fromDir, specifier)
  if (existsSync(resolved) && statSync(resolved).isDirectory()) {
    return specifier + '/index.js'
  }
  return specifier + '.js'
}

for (const file of readdirSync(dir, { recursive: true }).filter(f => f.endsWith('.js'))) {
  const p = join(dir, file)
  const src = readFileSync(p, 'utf8')
  const fixed = src.replace(/from '(\.\.?\/[^'.]+)'/g, (_, spec) => {
    return `from '${resolveRelativeImport(spec, p)}'`
  })
  if (fixed !== src) writeFileSync(p, fixed)
}
