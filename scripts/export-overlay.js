#!/usr/bin/env electron
/**
 * Exports the Faire Wire graphics to ProRes 4444 with a real alpha channel.
 *
 *   npx electron scripts/export-overlay.js --render=ticker --mode=both
 *   npx electron scripts/export-overlay.js --render=ticker --mode=both --speed=140
 *   npx electron scripts/export-overlay.js --render=l3 --side=left \
 *       --name="Rhodes, Punak, Lee vie for Q3 title" --hold=5000
 *
 * Needs ffmpeg on PATH (brew install ffmpeg), `npm ci`, and graphics/_fonts
 * present (`npm run copy-fonts` — that folder is gitignored, and without it the
 * render silently falls back to a system face with different metrics).
 *
 * WHY THIS DOESN'T TOUCH THE LIVE APP
 * It serves the package's own files over a throwaway localhost server and stubs
 * the state client, so nothing is POSTed to a running PC On Air and no graphic
 * can flash onto program output mid-show. The copy still comes from the live
 * state by default (read-only GET), so you export exactly what is loaded.
 *
 * HOW FRAMES STAY EXACT
 * Real time is never used. The page's own CSS transitions/animations are paused
 * and seeked per frame, so output is frame-exact regardless of how slow capture
 * is. Two traps this works around:
 *   - `animation.ready` proves a seek was applied but NOT that the compositor
 *     produced a new frame. Under encode load capturePage() otherwise returns
 *     the previous frame ~1/3 of the time, which looks like judder. Captures of
 *     moving frames are therefore retried until the pixels actually change.
 *   - A finished transition disappears from getAnimations(), so the state flip
 *     and the grab must happen in one evaluation.
 *
 * TICKER LOOP MATH
 * A 180s cycle at 59.94 is 10789.21 frames. Rendering a round 180s would land
 * off a frame boundary and put a visible jump at every loop join, so the cycle
 * is rounded to whole frames and the crawl is mapped to complete exactly one
 * cycle across them: frame 0 and frame N are then byte-identical. Cost is a
 * crawl-speed change of ~0.002%.
 *
 * Write output somewhere that is NOT inside a cloud-synced folder. Multi-GB
 * files written under a Google Drive-mirrored ~/Documents get evicted and
 * silently vanish.
 */
'use strict';
const { app, BrowserWindow } = require('electron');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PKG = path.join(ROOT, 'bundled-packages', 'news');
const W = 1920, H = 1080;
const IN_MS = 550, OUT_MS = 400;      // --in-dur / --out-dur in render-l3.html
const TICKER_IN_MS = 450;             // .ticker slide-up in render-ticker.html

// ── args ────────────────────────────────────────────────────────────────────
const args = {};
for (const a of process.argv.slice(2)) {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  if (m) args[m[1]] = m[2] === undefined ? true : m[2];
}
const RENDER = args.render || 'l3';
const MODE = args.mode || (RENDER === 'ticker' ? 'both' : null);
const FPS_NUM = Number(args.fpsNum || 60000);
const FPS_DEN = Number(args.fpsDen || 1001);
const FRAME_MS = 1000 * FPS_DEN / FPS_NUM;
const HOLD_MS = Number(args.hold || 4000);
const SIDE = args.side === 'right' ? 'right' : 'left';
const STATE_URL = args.state || 'http://127.0.0.1:8080/api/packages/news/state';
const OUTDIR = args.outdir || path.join(os.homedir(), 'Movies', 'faire-wire-exports');
const FFMPEG = args.ffmpeg || 'ffmpeg';
const PORT = Number(args.port || 8899);

function usage(msg) {
  console.error(`${msg}

  --render=ticker|l3         which page to export
  --mode=loop|intro|both     ticker only (default both)
  --side=left|right          l3 only (default left)
  --name= --title= --subtitle=   l3 copy; omit to use whatever is loaded live
  --hold=<ms>                l3 hold, default 4000
  --speed=<px/sec>           ticker: pin crawl speed, derive the cycle length
  --pxPerFrame=<px>          ticker: same, expressed per frame
  --state=<url|file>         live state source, or a JSON file
  --outdir=<dir>             default ~/Movies/faire-wire-exports
  --out=<filename>           override the generated filename
  --fpsNum= --fpsDen=        default 60000/1001 (59.94)
`);
  process.exit(1);
}
if (!['ticker', 'l3'].includes(RENDER)) usage(`unknown --render=${RENDER}`);
if (RENDER === 'ticker' && !['loop', 'intro', 'both'].includes(MODE)) usage(`unknown --mode=${MODE}`);

// ── state ───────────────────────────────────────────────────────────────────
function fetchState() {
  return new Promise((resolve, reject) => {
    if (!/^https?:/.test(STATE_URL)) {
      try { return resolve(JSON.parse(fs.readFileSync(STATE_URL, 'utf8'))); }
      catch (e) { return reject(e); }
    }
    const req = http.get(STATE_URL, (res) => {
      let b = '';
      res.on('data', (c) => { b += c; });
      res.on('end', () => {
        try {
          const j = JSON.parse(b);
          resolve(j.state || j);
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(5000, () => req.destroy(new Error(`no app at ${STATE_URL}`)));
  });
}

// ── tiny static server for the package's own files ──────────────────────────
const STUB = `window.PConAirPackage={connect:function(id,onState){window.__push=onState;
  return {patch:function(){return Promise.resolve()},close:function(){}};}};`;
const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.woff2': 'font/woff2',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg' };
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  if (url === '/packages/news/assets/state.js') {
    res.writeHead(200, { 'Content-Type': 'application/javascript' });
    return res.end(STUB);
  }
  const file = url.startsWith('/graphics/') ? path.join(ROOT, url) : path.join(PKG, url);
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(buf);
  });
});

// ── helpers ─────────────────────────────────────────────────────────────────
/** Backpressure-aware write. Both listeners are removed on settle — leaving the
 *  error listener attached leaks one per frame and trips MaxListenersExceeded. */
const write = (stream, buf) => new Promise((resolve, reject) => {
  if (stream.write(buf)) return resolve();
  const onDrain = () => { stream.off('error', onError); resolve(); };
  const onError = (e) => { stream.off('drain', onDrain); reject(e); };
  stream.once('drain', onDrain);
  stream.once('error', onError);
});

function ffmpegTo(out) {
  return spawn(FFMPEG, ['-y', '-hide_banner', '-loglevel', 'error',
    '-f', 'rawvideo', '-pix_fmt', 'bgra', '-s', `${W}x${H}`,
    '-framerate', `${FPS_NUM}/${FPS_DEN}`, '-i', 'pipe:0',
    '-c:v', 'prores_ks', '-profile:v', '4444', '-pix_fmt', 'yuva444p10le',
    '-alpha_bits', '16', '-vendor', 'apl0', '-r', `${FPS_NUM}/${FPS_DEN}`, out],
    { stdio: ['pipe', 'inherit', 'inherit'] });
}

// One window is created up front and re-navigated between passes: creating a
// SECOND BrowserWindow in the same process reliably fails to load (ERR_FAILED).
// 960x540 at zoom 0.5 lays the 1920px page out into exactly 1920x1080 device
// pixels on a Retina display, so nothing is resampled.
function makeWindow() {
  return new BrowserWindow({ show: false, width: 960, height: 540,
    useContentSize: true, transparent: true, frame: false,
    webPreferences: { offscreen: true } });
}

async function loadPage(win, page) {
  await win.loadURL(`http://127.0.0.1:${PORT}/${page}`);
  win.webContents.setZoomFactor(0.5);
  await win.webContents.executeJavaScript('document.fonts.ready.then(()=>1)').catch(() => {});
  await new Promise((r) => setTimeout(r, 600));
  const size = (await win.webContents.capturePage()).getSize();
  if (size.width !== W || size.height !== H) {
    throw new Error(`expected ${W}x${H} capture, got ${size.width}x${size.height}`);
  }
}

const raf2 = (win) => win.webContents.executeJavaScript(
  `new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(1))))`);

/** Capture one frame; if it must have moved, retry until the pixels change. */
async function grabFrame(win, prev, moving) {
  let buf, tries = 0, retried = 0;
  for (;;) {
    await raf2(win);
    buf = (await win.webContents.capturePage()).getBitmap();
    tries++;
    if (!prev || !moving || !buf.equals(prev) || tries >= 6) break;
    retried++;
  }
  return { buf, retried, stale: Boolean(moving && prev && buf.equals(prev)) };
}

// Whole lines, not \r — a stray warning on the same line makes an overwritten
// progress line look like a hang.
function progress(tag, i, total, t0) {
  if (i === 0 || i % 200 !== 0) return;
  const per = (Date.now() - t0) / i;
  const eta = Math.round(((total - i) * per) / 1000);
  console.error(`${tag} ${i}/${total} (${((i / total) * 100).toFixed(0)}%) `
    + `elapsed ${Math.round((Date.now() - t0) / 1000)}s, eta ${eta}s`);
}

// ── ticker ──────────────────────────────────────────────────────────────────
/**
 * `tickerSeconds` is a duration for one full pass, not a speed: the crawl covers
 * half the track (one run of the list) in that time, and the track is as wide as
 * the copy makes it. So px/sec = (trackWidth / 2) / tickerSeconds, and changing
 * the number of headlines changes the speed even when the seconds are untouched.
 *
 * --speed=<px/sec> (or --pxPerFrame) inverts that: measure the track, then derive
 * the duration. Pinning the speed necessarily un-pins the cycle length.
 */
async function resolveCycle(win, state) {
  await loadPage(win, 'render-ticker.html');
  await win.webContents.executeJavaScript(`window.__push(${JSON.stringify({
    theme: state.theme, logo: state.logo, logoScale: state.logoScale,
    tickerItems: state.tickerItems, tickerVisible: true,
    tickerSeconds: state.tickerSeconds })});1`);
  await new Promise((r) => setTimeout(r, 800));
  const trackW = await win.webContents.executeJavaScript(
    `+document.getElementById('track').getBoundingClientRect().width.toFixed(3)`);
  if (!trackW) throw new Error('ticker track has no width — are there any items?');

  const travel = trackW / 2;                 // the keyframe runs 0 -> -50%
  let pxPerSec = args.speed !== undefined ? Number(args.speed) : null;
  if (args.pxPerFrame !== undefined) pxPerSec = Number(args.pxPerFrame) * (FPS_NUM / FPS_DEN);
  if (pxPerSec !== null && !(pxPerSec > 0)) throw new Error('--speed must be > 0');

  const tickerSeconds = pxPerSec ? travel / pxPerSec : Number(state.tickerSeconds);
  if (!(tickerSeconds > 0)) throw new Error(`bad tickerSeconds: ${tickerSeconds}`);
  const cycleMs = tickerSeconds * 1000;
  const cycleFrames = Math.round(cycleMs / FRAME_MS);
  return { trackW, travelPx: +travel.toFixed(1), tickerSeconds: +tickerSeconds.toFixed(4),
    cycleMs, cycleFrames,
    crawlStep: cycleMs / cycleFrames,        // exact one-cycle-per-N-frames
    pxPerSec: +(travel / tickerSeconds).toFixed(2),
    pxPerFrame: +(travel / tickerSeconds / (FPS_NUM / FPS_DEN)).toFixed(4),
    speedPinned: Boolean(pxPerSec) };
}

async function renderTicker(win, state, cycle, frames, withIntro, out) {
  const crawlStep = cycle.crawlStep;
  await loadPage(win, 'render-ticker.html');
  // push the resolved duration, so the animation's own length matches the
  // per-frame seek mapping (this is what --speed actually changes)
  const base = { theme: state.theme, logo: state.logo, logoScale: state.logoScale,
    tickerItems: state.tickerItems, tickerSeconds: cycle.tickerSeconds };

  if (!withIntro) {
    await win.webContents.executeJavaScript(`(() => {
      const s = document.createElement('style');
      s.textContent = '.ticker{transition:none !important}';
      document.head.appendChild(s);
      window.__push(${JSON.stringify({ ...base, tickerVisible: true })});
      return 1; })()`);
  } else {
    await win.webContents.executeJavaScript(
      `window.__push(${JSON.stringify({ ...base, tickerVisible: false })});1`);
  }
  await new Promise((r) => setTimeout(r, 900));

  // flip + grab in ONE evaluation, or a finished transition is already gone
  const reg = await win.webContents.executeJavaScript(`(() => {
    ${withIntro ? `window.__push(${JSON.stringify({ ...base, tickerVisible: true })});` : ''}
    const track = document.getElementById('track'), bar = document.getElementById('ticker');
    const all = document.getAnimations();
    window.__crawl = all.filter(a => a.effect && track.contains(a.effect.target));
    window.__intro = all.filter(a => a.effect && a.effect.target === bar);
    [...window.__crawl, ...window.__intro].forEach(a => a.pause());
    return { crawl: window.__crawl.length, intro: window.__intro.length }; })()`);
  if (!reg.crawl) throw new Error('crawl animation not found — are there ticker items?');
  if (withIntro && !reg.intro) throw new Error('intro transition not captured');

  const seek = (crawlMs, introMs) => win.webContents.executeJavaScript(`(async () => {
    window.__crawl.forEach(a => { try { a.currentTime = ${crawlMs}; } catch (e) {} });
    ${withIntro ? `window.__intro.forEach(a => { try { a.currentTime = ${introMs}; } catch (e) {} });` : ''}
    const all = [...window.__crawl, ...window.__intro];
    await Promise.all(all.map(a => a.ready.catch(() => {})));
    return 1; })()`);

  const ff = ffmpegTo(out);
  const t0 = Date.now();
  let prev = null, stale = 0, retries = 0;
  for (let i = 0; i < frames; i++) {
    await seek(i * crawlStep, i * FRAME_MS);
    const g = await grabFrame(win, prev, true);
    retries += g.retried; if (g.stale) stale++;
    await write(ff.stdin, g.buf);
    prev = Buffer.from(g.buf);
    progress(withIntro ? 'intro' : 'loop', i, frames, t0);
  }
  ff.stdin.end();
  await new Promise((r) => ff.on('close', r));
  return { frames, stale, retries, seconds: +(frames * FPS_DEN / FPS_NUM).toFixed(4) };
}

// ── lower third ─────────────────────────────────────────────────────────────
async function renderL3(win, state, out) {
  const cardMs = IN_MS + HOLD_MS + OUT_MS;
  const frames = Math.ceil(cardMs / FRAME_MS) + 1;      // +1 fully clear tail
  await loadPage(win, 'render-l3.html');

  const live = SIDE === 'left' ? (state.l3Left || {}) : (state.l3Right || {});
  const card = { name: args.name !== undefined ? args.name : (live.name || ''),
    title: args.title !== undefined ? args.title : (live.title || ''),
    subtitle: args.subtitle !== undefined ? args.subtitle : (live.subtitle || '') };
  const mine = SIDE === 'left' ? 'l3Left' : 'l3Right';
  const other = SIDE === 'left' ? 'l3Right' : 'l3Left';
  const cardId = SIDE === 'left' ? 'cardLeft' : 'cardRight';
  const stateFor = (vis) => ({ theme: state.theme || 'default',
    autoClear: false, autoClearSeconds: 0,
    [mine]: { ...card, visible: vis },
    [other]: { name: '', title: '', subtitle: '', visible: false } });

  const flipAndGrab = (vis) => `(() => {
    window.__push(${JSON.stringify(stateFor(vis))});
    const root = document.getElementById('${cardId}');
    const anims = document.getAnimations().filter(a => a.effect && root.contains(a.effect.target));
    anims.forEach(a => a.pause());
    window.__reg = anims;
    return anims.length; })()`;
  const seek = (ms) => win.webContents.executeJavaScript(`(async () => {
    const anims = window.__reg || [];
    anims.forEach(a => { try { a.currentTime = ${ms}; } catch (e) {} });
    await Promise.all(anims.map(a => a.ready.catch(() => {})));
    return 1; })()`);

  const phaseOf = (t) => {
    if (t < IN_MS) return { phase: 'in', local: t };
    if (t < IN_MS + HOLD_MS) return { phase: 'hold', local: IN_MS };
    if (t < cardMs) return { phase: 'out', local: t - (IN_MS + HOLD_MS) };
    return { phase: 'done', local: OUT_MS };
  };

  const ff = ffmpegTo(out);
  const t0 = Date.now();
  let ph = null, prev = null, reused = 0, retries = 0, stale = 0, fit = null;

  for (let i = 0; i < frames; i++) {
    const P = phaseOf(i * FRAME_MS);
    const changed = P.phase !== ph;
    if (changed) {
      if (P.phase === 'in' || P.phase === 'out') {
        const n = await win.webContents.executeJavaScript(flipAndGrab(P.phase === 'in'));
        if (!n) throw new Error(`no ${P.phase} transition captured`);
        if (P.phase === 'in') {
          fit = await win.webContents.executeJavaScript(`(() => {
            const n = document.querySelector('#${cardId} .name');
            return { renderedFontPx: parseFloat(getComputedStyle(n).fontSize),
                     ellipsised: n.scrollWidth > n.clientWidth + 1 }; })()`);
        }
      } else {
        await win.webContents.executeJavaScript(
          `window.__push(${JSON.stringify(stateFor(P.phase === 'hold'))});1`);
        await seek(P.phase === 'hold' ? IN_MS : OUT_MS);
      }
      ph = P.phase;
    }
    const moving = P.phase === 'in' || P.phase === 'out';
    if (!moving && !changed && prev) { await write(ff.stdin, prev); reused++; continue; }
    if (moving) await seek(P.local);
    const g = await grabFrame(win, prev, moving);
    retries += g.retried; if (g.stale) stale++;
    await write(ff.stdin, g.buf);
    prev = Buffer.from(g.buf);
    progress('l3', i, frames, t0);
  }
  ff.stdin.end();
  await new Promise((r) => ff.on('close', r));
  process.stderr.write('\n');
  return { frames, seconds: +(frames * FPS_DEN / FPS_NUM).toFixed(4),
    copy: card, fit, reused, retries, stale };
}

/** stream-copy concat; ProRes is all-intra so the trim is frame-exact */
function concat(parts, out) {
  const list = path.join(OUTDIR, '_concat.txt');
  fs.writeFileSync(list, parts.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n'));
  const r = spawnSync(FFMPEG, ['-y', '-hide_banner', '-loglevel', 'error',
    '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', out], { stdio: 'inherit' });
  fs.unlinkSync(list);
  if (r.status !== 0) throw new Error('concat failed');
}

// ── main ────────────────────────────────────────────────────────────────────
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  try {
    if (spawnSync(FFMPEG, ['-version'], { stdio: 'ignore' }).status !== 0) {
      throw new Error(`${FFMPEG} not runnable — brew install ffmpeg`);
    }
    if (!fs.existsSync(path.join(ROOT, 'graphics', '_fonts', 'inter-latin-600.woff2'))) {
      throw new Error('graphics/_fonts is empty — run: npm run copy-fonts');
    }
    fs.mkdirSync(OUTDIR, { recursive: true });
    await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
    const state = await fetchState();
    const win = makeWindow();
    const tag = `1920x1080_${String(FPS_NUM / FPS_DEN === 60000 / 1001 ? '5994' : Math.round(FPS_NUM / FPS_DEN))}_prores4444`;
    const report = { render: RENDER, outdir: OUTDIR };

    if (RENDER === 'ticker') {
      const cycle = await resolveCycle(win, state);
      report.cycle = cycle;
      const cycleFrames = cycle.cycleFrames;
      const introFrames = Math.ceil(TICKER_IN_MS / FRAME_MS);
      const label = Number(cycle.tickerSeconds.toFixed(2));
      console.error(`cycle: ${cycleFrames} frames = ${(cycleFrames * FPS_DEN / FPS_NUM).toFixed(3)}s`
        + ` | crawl ${cycle.pxPerSec} px/s (${cycle.pxPerFrame} px/frame)`
        + ` | track ${cycle.trackW}px`
        + (cycle.speedPinned ? ' | speed pinned, duration derived' : ' | duration from state'));
      const loopOut = path.join(OUTDIR, args.out || `ticker_loop${label}_${tag}.mov`);
      const introOut = path.join(OUTDIR, `ticker_intro+loop${label}_${tag}.mov`);

      if (MODE === 'intro') {
        report.intro = await renderTicker(win, state, cycle, cycleFrames, true, introOut);
        report.files = [introOut];
      } else {
        report.loop = await renderTicker(win, state, cycle, cycleFrames, false, loopOut);
        report.files = [loopOut];
        if (MODE === 'both') {
          // only the first 450ms differ, so render just those and splice the
          // loop's remainder in behind them — saves a second full pass
          const head = path.join(OUTDIR, '_intro-head.mov');
          const rest = path.join(OUTDIR, '_loop-rest.mov');
          report.introHead = await renderTicker(win, state, cycle, introFrames, true, head);
          const ss = (introFrames * FPS_DEN / FPS_NUM).toFixed(6);
          if (spawnSync(FFMPEG, ['-y', '-hide_banner', '-loglevel', 'error',
            '-ss', ss, '-i', loopOut, '-c', 'copy', rest], { stdio: 'inherit' }).status !== 0) {
            throw new Error('trim failed');
          }
          concat([head, rest], introOut);
          fs.unlinkSync(head); fs.unlinkSync(rest);
          report.files.push(introOut);
        }
      }
    } else {
      const out = path.join(OUTDIR, args.out
        || `l3-${SIDE}_hold${HOLD_MS}_${tag}.mov`);
      report.l3 = await renderL3(win, state, out);
      report.files = [out];
    }

    console.log(JSON.stringify(report, null, 2));
    app.exit(0);
  } catch (err) {
    console.error(`\nexport failed: ${err.message}`);
    app.exit(1);
  }
});
