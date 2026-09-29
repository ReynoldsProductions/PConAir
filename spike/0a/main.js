const { app, BrowserWindow } = require('electron');
const fs = require('fs'); const path = require('path');
const MODE = process.env.SPIKE_MODE || 'fake-camera';
const DURATION_MS = +(process.env.SPIKE_SECONDS || 30) * 1000;
const DUMP_N = +(process.env.SPIKE_DUMP || 5);
const OUT = process.env.SPIKE_OUT || path.join(__dirname, 'out'); fs.mkdirSync(OUT, { recursive: true });
app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
app.commandLine.appendSwitch('use-fake-device-for-media-stream');
app.commandLine.appendSwitch('no-sandbox');
const W = 1920, H = 1080, FPS = 30, PERIOD = 1000 / FPS;
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: W, height: H, webPreferences: { offscreen: true, backgroundThrottling: false } });
  win.webContents.setFrameRate(FPS);
  win.webContents.on('console-message', (e) => console.log('[page]', e.message ?? e));
  let last = null, paints = 0, fullPaints = 0, firstPaint = null;
  const t0 = performance.now(); const paintTimes = [], emitTimes = [], cpu = [];
  win.webContents.on('paint', (e, dirty, image) => {
    paints++; const now = performance.now(); paintTimes.push(now);
    const s = image.getSize(); if (dirty.width === s.width && dirty.height === s.height) fullPaints++;
    last = image; if (firstPaint === null) firstPaint = now - t0;
  });
  await win.loadFile(path.join(__dirname, 'page.html'), { query: { animate: MODE === 'animated' ? '1' : '0' } });
  let dumped = 0, emitted = 0, held = 0, lastSeen = null; const start = performance.now(); let next = start + PERIOD;
  const tick = () => {
    const now = performance.now();
    if (now - start > DURATION_MS) return finish();
    if (last) {
      emitTimes.push(now); emitted++; if (last === lastSeen) held++; lastSeen = last;
      if (dumped < DUMP_N) { fs.writeFileSync(path.join(OUT, `frame${dumped++}.bgra`), last.toBitmap()); }
    }
    next += PERIOD; setTimeout(tick, Math.max(0, next - performance.now()));
  };
  setTimeout(tick, PERIOD);
  const cpuIv = setInterval(() => { cpu.push(app.getAppMetrics().reduce((a, m) => a + m.cpu.percentCPUUsage, 0)); }, 1000);
  const stats = a => { if (!a.length) return null; const s=[...a].sort((x,y)=>x-y); const m=a.reduce((x,y)=>x+y,0)/a.length; return { n:a.length, mean:+m.toFixed(3), p50:+s[s.length>>1].toFixed(3), p99:+s[Math.floor(s.length*.99)].toFixed(3), max:+s[s.length-1].toFixed(3), sd:+Math.sqrt(a.reduce((x,y)=>x+(y-m)**2,0)/a.length).toFixed(3) }; };
  const deltas = a => a.slice(1).map((v, i) => v - a[i]);
  async function finish() {
    clearInterval(cpuIv);
    const gum = await win.webContents.executeJavaScript('window.__gum');
    const size = last ? last.getSize() : null;
    const res = { mode: MODE, seconds: DURATION_MS / 1000, gum, frameSize: size, paints, fullPaints, firstPaintMs: firstPaint,
      paintIntervalMs: stats(deltas(paintTimes)), emitIntervalMs: stats(deltas(emitTimes)), emitted, heldDuplicates: held,
      expectedEmits: Math.round(DURATION_MS / PERIOD), dropsVsExpected: Math.round(DURATION_MS / PERIOD) - emitted,
      cpuPercentSumAllProcs: stats(cpu), electron: process.versions.electron, chrome: process.versions.chrome, platform: process.platform };
    fs.writeFileSync(path.join(OUT, `result-${MODE}.json`), JSON.stringify(res, null, 2)); console.log(JSON.stringify(res, null, 2)); app.quit();
  }
});
