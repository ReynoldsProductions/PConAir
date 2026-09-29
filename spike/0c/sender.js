// Spike 0C sender harness (throwaway, never merges to main).
// Sends a synthetic 1920x1080 BGRA test pattern over NDI via `grandi` for
// SPIKE_SECONDS, measuring emit-interval jitter and process CPU, and
// dumping raw frames + a JSON result, mirroring 0A/0B's main.js style.
'use strict';
const fs = require('fs');
const path = require('path');
const { makeFrameBuilder } = require('./pattern.js');

const SECONDS = +(process.env.SPIKE_SECONDS || 20);
const FPS = 30;
const PERIOD = 1000 / FPS;
const W = 1920, H = 1080;
const NAME = process.env.SPIKE_NDI_NAME || 'PConAir-Spike-0C';
const OUT = process.env.SPIKE_OUT || __dirname; // result-*.json land directly in spike/0c/, per the task
const DUMP_DIR = path.join(__dirname, 'frame-dumps'); // gitignored, not committed (24MB+ of raw BGRA)
const DUMP_N = +(process.env.SPIKE_DUMP || 3);
fs.mkdirSync(OUT, { recursive: true });

const stats = (a) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const m = a.reduce((x, y) => x + y, 0) / a.length;
  return {
    n: a.length,
    mean: +m.toFixed(3),
    p50: +s[s.length >> 1].toFixed(3),
    p99: +s[Math.floor(s.length * 0.99)].toFixed(3),
    max: +s[s.length - 1].toFixed(3),
    sd: +Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / a.length).toFixed(3),
  };
};
const deltas = (a) => a.slice(1).map((v, i) => v - a[i]);

(async () => {
  let grandi;
  try {
    grandi = require('grandi');
  } catch (e) {
    console.error(JSON.stringify({ error: 'require(grandi) failed', message: e.message }));
    process.exit(1);
  }

  const initOk = grandi.initialize();
  const build = makeFrameBuilder(W, H);

  const t0 = performance.now();
  let sender;
  try {
    sender = await grandi.send({ name: NAME });
  } catch (e) {
    console.error(JSON.stringify({ error: 'send() create failed', message: e.message }));
    process.exit(1);
  }
  const createMs = performance.now() - t0;
  const sourceName = sender.sourceName();

  // Preallocated buffer pool (per spec: 1080p BGRA is 8.3MB/frame, no
  // per-frame allocation in the real implementation). makeFrameBuilder
  // reuses one internal buffer; we copy into a small ring here only for
  // the frames we dump to disk, not for every send.
  fs.mkdirSync(DUMP_DIR, { recursive: true });

  const issueTimes = [];
  const resolveTimes = [];
  const blocked = []; // await took > 2x period
  const cpuSamples = [];
  let sent = 0, errors = 0, connectionsLast = 0;

  const cpuStart = process.cpuUsage();
  let lastCpu = cpuStart;
  let lastCpuWallMs = performance.now();
  const cpuTimer = setInterval(() => {
    const now = process.cpuUsage();
    const wallNow = performance.now();
    const userDeltaMs = (now.user - lastCpu.user) / 1000;
    const sysDeltaMs = (now.system - lastCpu.system) / 1000;
    const wallDeltaMs = wallNow - lastCpuWallMs;
    cpuSamples.push(+(((userDeltaMs + sysDeltaMs) / wallDeltaMs) * 100).toFixed(2));
    lastCpu = now;
    lastCpuWallMs = wallNow;
  }, 1000);

  const start = performance.now();
  let next = start + PERIOD;
  let frameIndex = 0;
  let running = true;

  async function tick() {
    if (!running) return;
    const now = performance.now();
    if (now - start > SECONDS * 1000) return finish();

    const frame = build(frameIndex);
    const issueAt = performance.now();
    issueTimes.push(issueAt);
    try {
      await sender.video({
        xres: W, yres: H, frameRateN: FPS, frameRateD: 1,
        pictureAspectRatio: W / H,
        fourCC: grandi.FourCC.BGRA,
        frameFormatType: grandi.FrameType.Progressive,
        lineStrideBytes: W * 4,
        data: frame,
      });
      const resolvedAt = performance.now();
      resolveTimes.push(resolvedAt);
      if (resolvedAt - issueAt > PERIOD * 2) blocked.push({ frameIndex, waitMs: +(resolvedAt - issueAt).toFixed(2) });
      sent++;
      if (frameIndex < DUMP_N) {
        fs.writeFileSync(path.join(DUMP_DIR, `frame${frameIndex}.bgra`), frame);
      }
    } catch (e) {
      errors++;
    }
    connectionsLast = sender.connections();
    frameIndex++;
    next += PERIOD;
    setTimeout(tick, Math.max(0, next - performance.now()));
  }

  setTimeout(tick, PERIOD);

  async function finish() {
    running = false;
    clearInterval(cpuTimer);
    const expected = Math.round((SECONDS * 1000) / PERIOD);
    const result = {
      library: 'grandi',
      libraryVersion: require('grandi/package.json').version,
      ndiSdkVersion: grandi.version(),
      initializeOk: initOk,
      name: NAME,
      sourceName,
      createMs: +createMs.toFixed(2),
      seconds: SECONDS,
      width: W, height: H, fps: FPS,
      expectedFrames: expected,
      sent,
      errors,
      dropsVsExpected: expected - sent,
      connectionsAtEnd: connectionsLast,
      blockedSends: blocked.length,
      blockedDetail: blocked.slice(0, 10),
      issueIntervalMs: stats(deltas(issueTimes)),
      resolveIntervalMs: stats(deltas(resolveTimes)),
      cpuPercentSingleProcess: stats(cpuSamples),
      cpuCoresAvailable: require('os').cpus().length,
      node: process.version,
      platform: process.platform,
    };
    fs.writeFileSync(path.join(OUT, 'result-send.json'), JSON.stringify(result, null, 2));
    console.log('SENDER_RESULT ' + JSON.stringify(result));
    try { sender.destroy(); } catch (e) { /* best-effort */ }
    process.exit(0);
  }
})();
