#!/usr/bin/env node
/**
 * Build a self-contained .tgz for Companion.
 *
 * Companion loads a module by running `runtime.entrypoint` with the module's
 * own `node_modules` on disk — there is no install step on the Companion side.
 * So the tarball carries the production dependency closure alongside `dist/`
 * and `companion/`. The closure is read from the already-installed tree via
 * `npm ls --omit=dev`, which keeps packaging offline and deterministic.
 *
 * Layout matches npm's own convention (everything under `package/`), which is
 * what Companion's "import module bundle" expects.
 */
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')

const root = path.join(__dirname, '..')
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const outName = `pconair-companion-${pkg.version}.tgz`
const outPath = path.join(root, outName)

const TOP_LEVEL = ['package.json', 'companion', 'dist', 'LICENSE', 'README.md']

/** Production dependency directories, relative to the module root. */
function productionDeps() {
  const raw = execFileSync('npm', ['ls', '--omit=dev', '--all', '--parseable'], {
    cwd: root,
    encoding: 'utf8',
  })
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith(root + path.sep))
    .map((line) => path.relative(root, line))
    .filter((rel) => rel.startsWith('node_modules' + path.sep))
    // Nested copies come along with their parent's directory copy.
    .filter((rel) => rel.split(path.sep).filter((s) => s === 'node_modules').length === 1)
    .sort()
}

function main() {
  for (const entry of TOP_LEVEL) {
    if (!fs.existsSync(path.join(root, entry))) {
      console.error(`✗ missing ${entry} — run "npm run build" first`)
      process.exit(1)
    }
  }

  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'pconair-companion-pack-'))
  const pkgDir = path.join(staging, 'package')
  fs.mkdirSync(pkgDir, { recursive: true })

  for (const entry of TOP_LEVEL) {
    fs.cpSync(path.join(root, entry), path.join(pkgDir, entry), { recursive: true })
  }

  const deps = productionDeps()
  if (deps.length === 0) {
    console.error('✗ no production dependencies resolved — is node_modules installed?')
    process.exit(1)
  }
  for (const rel of deps) {
    fs.cpSync(path.join(root, rel), path.join(pkgDir, rel), { recursive: true })
  }

  // Strip build noise that only bloats the bundle.
  for (const junk of ['.DS_Store']) {
    execFileSync('find', [pkgDir, '-name', junk, '-delete'])
  }

  fs.rmSync(outPath, { force: true })
  execFileSync('tar', ['-czf', outPath, '-C', staging, 'package'])
  fs.rmSync(staging, { recursive: true, force: true })

  const sizeMb = (fs.statSync(outPath).size / (1024 * 1024)).toFixed(2)
  console.log(`✓ ${outName} (${sizeMb} MB, ${deps.length} production dependencies)`)
}

main()
