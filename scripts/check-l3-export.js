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
   3. The capture was cropped to the card's own bounding box, so the still
 *      lost its on-air position and could not be taken as a full-frame layer.
 *
 * All three are invisible to a type check and to the existing tests, hence this
 * end-to-end grab. Run it after touching src/main/l3/cue-renderer.ts.
 *
 * Exits 0 when, for both sides, the capture resolves promptly, is a full
 * 1920x1080 keyable frame, and the card lands where
 * graphics/lower-third-live/index.html puts it; non-zero (with a reason) otherwise.
 */
'use strict';
const { app, nativeImage } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

// Own profile per run: Chromium persists things like per-host zoom, and a value
// left by the app (or a previous run) would otherwise silently rescale the
// capture and make this check lie.
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'l3-export-profile-')));

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src', 'main', 'l3', 'cue-renderer.ts');
const TIMEOUT_MS = 30000;
const FRAME_W = 1920;
const FRAME_H = 1080;

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

/**
 * Bounds of the panel itself plus a count of anything non-transparent.
 *
 * Two thresholds on purpose: `opaque` counts every pixel carrying any alpha (so
 * keyability can be judged), while the bounds only admit near-solid pixels. The
 * panel's own drop shadow (0 4px 24px rgba(0,0,0,.4)) bleeds ~28px past the box
 * at low alpha, and measuring that instead of the panel makes placement read
 * ~21px off. The lightest panel fill is alpha ~235, the shadow peaks at ~102.
 */
function inkBounds(image) {
  const { width, height } = image.getSize();
  const bitmap = image.getBitmap(); // BGRA
  const SOLID = 200;
  let minX = Infinity, maxX = -1, minY = Infinity, maxY = -1, opaque = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const a = bitmap[(y * width + x) * 4 + 3];
      if (a === 0) continue;
      opaque += 1;
      if (a < SOLID) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return { width, height, opaque, minX, maxX, minY, maxY };
}

async function checkSide(render, side) {
  const started = Date.now();
  const outcome = await Promise.race([
    render({
      name: 'Jane Doe',
      title: 'Chief Executive Officer',
      subtitle: 'Faire',
      theme: 'default',
      side,
    }).then((png) => ({ png }), (error) => ({ error })),
    new Promise((resolve) => setTimeout(() => resolve({ timedOut: true }), TIMEOUT_MS)),
  ]);
  const elapsed = Date.now() - started;

  if (outcome.timedOut) {
    return `[${side}] render never resolved (${TIMEOUT_MS}ms). The export request would hang ` +
      `with no response — check that nothing awaits an event loadURL() has already consumed.`;
  }
  if (outcome.error) return `[${side}] render threw: ${outcome.error.message}`;

  const png = outcome.png;
  if (!png || png.length === 0) return `[${side}] render produced 0 bytes`;

  const image = nativeImage.createFromBuffer(png);
  if (image.isEmpty()) return `[${side}] PNG decoded to an empty image`;

  const b = inkBounds(image);
  if (b.width !== FRAME_W || b.height !== FRAME_H) {
    return `[${side}] expected a full ${FRAME_W}x${FRAME_H} frame, got ${b.width}x${b.height} ` +
      `(a still cropped to the card loses its on-air position)`;
  }
  if (b.opaque === 0) return `[${side}] frame is blank — no card pixels were painted`;
  if (b.opaque === b.width * b.height) {
    return `[${side}] every pixel is opaque — the frame is not keyable (needs transparent: true)`;
  }

  // Placement, against graphics/lower-third-live/index.html: bottom:96px, 96px side margin.
  const expectedBottomGap = 96;
  const bottomGap = b.height - 1 - b.maxY;
  const where =
    `frame ${b.width}x${b.height}, ink x:${b.minX}-${b.maxX} y:${b.minY}-${b.maxY}, ${png.length} bytes`;
  if (Math.abs(bottomGap - expectedBottomGap) > 8) {
    return `[${side}] card sits ${bottomGap}px from the bottom, expected ~${expectedBottomGap}px (${where})`;
  }
  if (side === 'left') {
    if (Math.abs(b.minX - 96) > 8) return `[${side}] card starts at x=${b.minX}, expected ~96 (${where})`;
    if (b.maxX > b.width / 2) return `[${side}] card crosses the centre line (maxX=${b.maxX})`;
  } else {
    const rightGap = b.width - 1 - b.maxX;
    if (Math.abs(rightGap - 96) > 8) return `[${side}] card ends ${rightGap}px from the right, expected ~96`;
    if (b.minX < b.width / 2) return `[${side}] card crosses the centre line (minX=${b.minX})`;
  }

  console.log(
    `PASS  [${side}] ${b.width}x${b.height}, ${png.length} bytes in ${elapsed}ms ` +
      `(ink x:${b.minX}-${b.maxX} y:${b.minY}-${b.maxY}, ${b.opaque} opaque px)`
  );
  return null;
}

app.whenReady().then(async () => {
  let renderLowerThirdCardToPng;
  try {
    ({ renderLowerThirdCardToPng } = require(compileRenderer()));
  } catch (e) {
    return fail(`could not build the renderer: ${e.message}`);
  }

  // Each side twice, alternating: a second export used to fail outright, so
  // repetition is the point of this loop, not thoroughness for its own sake.
  for (const side of ['left', 'right', 'left', 'right']) {
    const reason = await checkSide(renderLowerThirdCardToPng, side);
    if (reason) return fail(reason);
  }
  app.exit(0);
}).catch((e) => fail(e && e.stack ? e.stack : String(e)));
