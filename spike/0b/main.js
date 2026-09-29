const { app, BrowserWindow, session, desktopCapturer } = require('electron');
const fs = require('fs'); const path = require('path');
const MODE = process.env.SPIKE_MODE || 'fake-camera';
const DURATION_MS = +(process.env.SPIKE_SECONDS || 30) * 1000;
const OUT = process.env.SPIKE_OUT || path.join(__dirname, 'out'); fs.mkdirSync(OUT, { recursive: true });
app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
app.commandLine.appendSwitch('use-fake-device-for-media-stream');
const stats = a => { if (!a.length) return null; const s=[...a].sort((x,y)=>x-y); const m=a.reduce((x,y)=>x+y,0)/a.length; return { n:a.length, mean:+m.toFixed(3), p50:+s[s.length>>1].toFixed(3), p99:+s[Math.floor(s.length*.99)].toFixed(3), max:+s[s.length-1].toFixed(3), sd:+Math.sqrt(a.reduce((x,y)=>x+(y-m)**2,0)/a.length).toFixed(3) }; };
app.whenReady().then(async () => {
  session.defaultSession.setDisplayMediaRequestHandler(async (req, cb) => {
    const sources = await desktopCapturer.getSources({ types: ['window', 'screen'] });
    console.log('[sources]', sources.map(s => s.name + ':' + s.id).join(', '));
    const win = sources.find(s => s.id.startsWith('window:')) || sources[0];
    cb(win ? { video: win } : {});
  });
  const win = new BrowserWindow({ show: true, x: 0, y: 0, width: 1920, height: 1080, webPreferences: { backgroundThrottling: false } });
  win.webContents.on('console-message', (e) => console.log('[page]', e.message ?? e));
  const cpu = []; const iv = setInterval(() => cpu.push(app.getAppMetrics().reduce((a, m) => a + m.cpu.percentCPUUsage, 0)), 1000);
  await win.loadFile(path.join(__dirname, 'page.html'), { query: { animate: MODE === 'animated' ? '1' : '0' } });
  setTimeout(async () => {
    clearInterval(iv);
    const dm = await win.webContents.executeJavaScript('window.__dm');
    const fr = await win.webContents.executeJavaScript('window.__frames');
    const d = fr.t.slice(1).map((v, i) => v - fr.t[i]);
    const capSecs = DURATION_MS / 1000 - 1.5;
    const res = { mode: MODE, seconds: DURATION_MS / 1000, displayMedia: dm, frames: fr.t.length, presentedFrames: fr.n,
      expectedFrames: Math.round(capSecs * 30), dropsVsExpected: Math.round(capSecs * 30) - fr.t.length,
      frameIntervalMs: stats(d), cpuPercentSumAllProcs: stats(cpu), electron: process.versions.electron, chrome: process.versions.chrome, platform: process.platform };
    fs.writeFileSync(path.join(OUT, `result-${MODE}.json`), JSON.stringify(res, null, 2)); console.log(JSON.stringify(res, null, 2)); app.quit();
  }, DURATION_MS);
});
