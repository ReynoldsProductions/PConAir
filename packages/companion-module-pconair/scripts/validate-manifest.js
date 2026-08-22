#!/usr/bin/env node
/**
 * Gate packaging on Companion's own manifest validator.
 *
 * Companion runs this exact check when it loads a module — a manifest that
 * fails here produces a module that silently never appears in the connection
 * list, so it is far cheaper to fail the build.
 */
const fs = require('fs')
const path = require('path')
const { validateManifest } = require('@companion-module/base/dist/manifest.js')

const root = path.join(__dirname, '..')
const manifestPath = path.join(root, 'companion', 'manifest.json')
const pkgPath = path.join(root, 'package.json')

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))

try {
  validateManifest(manifest, false)
} catch (err) {
  console.error(`✗ companion/manifest.json is invalid:\n  ${err.message}`)
  process.exit(1)
}

if (manifest.version !== pkg.version) {
  console.error(
    `✗ version mismatch: companion/manifest.json is ${manifest.version}, package.json is ${pkg.version}`
  )
  process.exit(1)
}

const entrypoint = path.resolve(path.join(root, 'companion'), manifest.runtime.entrypoint)
if (!fs.existsSync(entrypoint)) {
  console.error(`✗ runtime.entrypoint does not exist: ${entrypoint} (run "npm run build" first)`)
  process.exit(1)
}

console.log(`✓ companion/manifest.json valid — ${manifest.id} v${manifest.version}`)
