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
const zlib = require('zlib')
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

  // Strip build noise that only bloats the bundle. `Icon\r` is the macOS custom-folder-icon
  // file that Google Drive leaves in a mirrored ~/Documents; `._*` are AppleDouble sidecars.
  for (const junk of ['.DS_Store', 'Icon\r', '._*']) {
    execFileSync('find', [pkgDir, '-name', junk, '-delete'])
  }

  // macOS bsdtar archives extended attributes as AppleDouble `._name` members. The first such
  // member is `._package`, a *file* sitting beside the `package/` root — and Companion extracts
  // with `tar-fs`'s `strip: 1`, which reduces a name with no slash in it to the empty string.
  // tar-fs then tries to create a file at the extraction root itself and dies with EISDIR,
  // aborting the import. Clearing the xattrs and telling tar to skip mac metadata keeps those
  // members out of the archive entirely. `tar -tzf` will not show them if they do get in.
  if (process.platform === 'darwin') {
    execFileSync('xattr', ['-cr', pkgDir])
  }
  const macFlags = process.platform === 'darwin' ? ['--no-mac-metadata', '--no-xattrs'] : []

  fs.rmSync(outPath, { force: true })
  execFileSync('tar', [...macFlags, '-czf', outPath, '-C', staging, 'package'], {
    env: { ...process.env, COPYFILE_DISABLE: '1' },
  })
  fs.rmSync(staging, { recursive: true, force: true })

  assertExtractsUnderStrip1(outPath)

  const sizeMb = (fs.statSync(outPath).size / (1024 * 1024)).toFixed(2)
  console.log(`✓ ${outName} (${sizeMb} MB, ${deps.length} production dependencies)`)
}

/**
 * Walk the finished archive's raw 512-byte headers the way Companion's extractor sees them,
 * and refuse to ship one that cannot be unpacked.
 *
 * Companion calls `tarfs.extract(moduleDir, { strip: 1 })`, so every member name loses its
 * first path segment. A member that strips to nothing is only legal if it is the root
 * directory; anything else makes tar-fs operate on the extraction root as though it were a
 * file. We also confirm the manifest still lands where Companion looks for it.
 */
function assertExtractsUnderStrip1(tarballPath) {
  const data = zlib.gunzipSync(fs.readFileSync(tarballPath))
  const problems = []
  let manifestFound = false
  let members = 0

  for (let off = 0; off + 512 <= data.length; ) {
    const header = data.subarray(off, off + 512)
    if (header.every((b) => b === 0)) {
      off += 512
      continue
    }

    const readStr = (start, len) => header.subarray(start, start + len).toString('utf8').replace(/\0.*$/, '')
    const name = readStr(0, 100)
    const prefix = readStr(345, 155)
    const full = prefix ? `${prefix}/${name}` : name
    const size = parseInt(readStr(124, 12).trim(), 8) || 0
    const typeflag = header.subarray(156, 157).toString('binary')

    const stripped = full.split('/').slice(1).join('/')
    if (stripped === '' && typeflag !== '5') {
      problems.push(`${JSON.stringify(full)} (type ${JSON.stringify(typeflag)}) strips to an empty name`)
    }
    if (stripped === 'companion/manifest.json') manifestFound = true

    members++
    off += 512 + Math.ceil(size / 512) * 512
  }

  if (!manifestFound) problems.push('companion/manifest.json is not present after strip: 1')

  if (problems.length > 0) {
    console.error(`✗ ${path.basename(tarballPath)} would fail Companion's import:`)
    for (const problem of problems.slice(0, 10)) console.error(`  - ${problem}`)
    fs.rmSync(tarballPath, { force: true })
    process.exit(1)
  }

  console.log(`✓ verified ${members} members extract cleanly under strip: 1`)
}

main()
