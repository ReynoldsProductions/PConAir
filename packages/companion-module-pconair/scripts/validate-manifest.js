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

// `runtime.apiVersion` is the module API we were built against, and Companion checks it against
// its own supported range (`isModuleApiVersionCompatible`) before offering the module in the
// connection list. The schema validator above does not police the value, so a wrong one — the
// `0.0.0` placeholder in particular — installs and loads without complaint and then silently
// never shows up. Pin it to the base library we actually bundle.
const baseVersion = require('@companion-module/base/package.json').version
if (manifest.runtime.apiVersion !== baseVersion) {
  console.error(
    `✗ runtime.apiVersion is ${manifest.runtime.apiVersion}, but @companion-module/base is ${baseVersion}.\n` +
      `  Companion filters out modules whose apiVersion it does not support — the module would install\n` +
      `  successfully and then never appear in "Add Connection". Set apiVersion to ${baseVersion}.`
  )
  process.exit(1)
}

console.log(`✓ companion/manifest.json valid — ${manifest.id} v${manifest.version}`)
