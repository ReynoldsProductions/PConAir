#!/usr/bin/env electron
/**
 * Smoke-checks the Lower Thirds "Export PNG" render path.
 *
 *   npx electron scripts/check-l3-export.js
 *
 * WHY THIS EXISTS
 * renderLowerThirdCardToPng() drives a real offscreen BrowserWindow, so vitest
 * cannot reach it — tests/l3-themes.test.ts can only cover the pure HTML builder
 * and the route's error branches. That gap let two defects ship unnoticed:
 *
 *   1. The function awaited `did-finish-load` AFTER loadURL() had already
 *      resolved on that same event, so every export hung forever. The operator
 *      saw no download, no error and no status text — the request never got a
 *      response at all.
 *   2. The BrowserWindow lacked `transparent: true`, so the "transparent PNG"
 *      came out fully opaque and would not key over a camera.
 *
 * Both are invisible to a type check and to the existing tests, hence this
 * end-to-end grab. Run it after touching src/main/l3/cue-renderer.ts.
 *
 * Exits 0 when the capture resolves promptly, carries an alpha channel and
 * actually has ink in it; non-zero (with a reason) otherwise.
 */
'use strict';
const { app, nativeImage } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src', 'main', 'l3', 'cue-renderer.ts');
const TIMEOUT_MS = 30000;

/** tsc is a declared devDependency; compile the one file so we exercise real source. */
function compileRenderer() {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'l3-export-check-'));
  const tsc = path.join(ROOT, 'node_modules', '.bin', 'tsc');
  const res = spawnSync(
    tsc,
    [SRC, '--outDir', outDir, '--module', 'commonjs', '--target', 'es2022', '--skipLibCheck', '--esModuleInterop'],
    { encoding: 'utf8' }
  );
  if (!fs.existsSync(path.join(outDir, 'cue-renderer.js'))) {
    throw new Error(`tsc failed to emit cue-renderer.js\n${res.stdout || ''}${res.stderr || ''}`);
  }
  return path.join(outDir, 'cue-renderer.js');
}

function fail(reason) {
  console.error(`FAIL  ${reason}`);
  app.exit(1);
}

app.whenReady().then(async () => {
  let renderLowerThirdCardToPng;
  try {
    ({ renderLowerThirdCardToPng } = require(compileRenderer()));
  } catch (e) {
    return fail(`could not build the renderer: ${e.message}`);
  }

  const started = Date.now();
  const outcome = await Promise.race([
    renderLowerThirdCardToPng({
      name: 'Jane Doe',
      title: 'Chief Executive Officer',
      subtitle: 'Faire',
      theme: 'default',
    }).then(
      (png) => ({ png }),
      (error) => ({ error })
    ),
    new Promise((resolve) => setTimeout(() => resolve({ timedOut: true }), TIMEOUT_MS)),
  ]);
  const elapsed = Date.now() - started;

  if (outcome.timedOut) {
    return fail(
      `render never resolved (${TIMEOUT_MS}ms). The export request would hang with no ` +
        `response — check that nothing awaits an event loadURL() has already consumed.`
    );
  }
  if (outcome.error) return fail(`render threw: ${outcome.error.message}`);

  const png = outcome.png;
  if (!png || png.length === 0) return fail('render produced 0 bytes');

  const image = nativeImage.createFromBuffer(png);
  if (image.isEmpty()) return fail('PNG decoded to an empty image');
  const { width, height } = image.getSize();

  const bitmap = image.getBitmap(); // BGRA
  let transparent = 0;
  let ink = 0;
  for (let i = 0; i < bitmap.length; i += 4) {
    const b = bitmap[i];
    const g = bitmap[i + 1];
    const r = bitmap[i + 2];
    const a = bitmap[i + 3];
    if (a === 0) transparent += 1;
    else if (!(r > 245 && g > 245 && b > 245)) ink += 1;
  }

  if (ink === 0) return fail('capture is blank — no card pixels were painted');
  if (transparent === 0) {
    return fail(
      'capture has no transparent pixels — the window is compositing onto an opaque ' +
        'surface, so the still cannot key over a camera (needs transparent: true)'
    );
  }

  console.log(
    `PASS  ${width}×${height}, ${png.length} bytes in ${elapsed}ms ` +
      `(${ink} ink px, ${transparent} transparent px)`
  );
  app.exit(0);
}).catch((e) => fail(e && e.stack ? e.stack : String(e)));
