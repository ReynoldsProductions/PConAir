import http from 'http';
import type { L3Cue } from './cue-store';

/**
 * Per-theme CSS custom properties, transcribed verbatim from FaireL3s
 * style*.json color values — kept in lockstep with
 * graphics/lower-third-live/_theme-colors.css.snippet (the source of truth)
 * and graphics/lower-third-live/index.html's embedded copy, so an exported
 * still matches what's actually on air.
 */
const THEME_COLOR_VARS: Record<string, string> = {
  default: '--panel-fill: rgba(251,248,246,0.92); --panel-border: rgb(223,224,225); --accent: rgb(181,169,152); --name-color: rgb(51,51,51); --title-color: rgb(117,117,117);',
  dark: '--panel-fill: rgba(51,51,51,1.0); --panel-border: rgb(88,85,80); --accent: rgb(181,169,152); --name-color: rgb(255,255,255); --title-color: rgb(224,224,224);',
  dark_alt: '--panel-fill: rgba(0,0,0,1.0); --panel-border: rgb(51,51,51); --accent: rgb(181,169,152); --name-color: rgb(255,255,255); --title-color: rgb(200,200,200);',
  bright: '--panel-fill: rgba(221,227,208,1.0); --panel-border: rgb(145,167,147); --accent: rgb(73,105,76); --name-color: rgb(62,64,35); --title-color: rgb(62,64,35);',
  bright_info: '--panel-fill: rgba(226,231,240,1.0); --panel-border: rgb(122,120,133); --accent: rgb(27,40,52); --name-color: rgb(27,40,52); --title-color: rgb(122,120,133);',
  bright_insider: '--panel-fill: rgba(242,245,245,1.0); --panel-border: rgb(54,103,106); --accent: rgb(21,69,72); --name-color: rgb(21,69,72); --title-color: rgb(54,103,106);',
  bright_warm: '--panel-fill: rgba(246,239,219,1.0); --panel-border: rgb(209,185,133); --accent: rgb(144,124,58); --name-color: rgb(144,124,58); --title-color: rgb(144,124,58);',
  palette_copper: '--panel-fill: rgba(250,242,232,1.0); --panel-border: rgb(200,170,145); --accent: rgb(175,105,65); --name-color: rgb(75,50,38); --title-color: rgb(140,95,65);',
  palette_olive: '--panel-fill: rgba(235,225,195,1.0); --panel-border: rgb(160,155,125); --accent: rgb(118,115,70); --name-color: rgb(62,60,40); --title-color: rgb(118,115,70);',
  palette_plum: '--panel-fill: rgba(242,238,248,1.0); --panel-border: rgb(175,165,195); --accent: rgb(95,80,130); --name-color: rgb(55,48,72); --title-color: rgb(115,100,140);',
  palette_sage: '--panel-fill: rgba(232,238,232,1.0); --panel-border: rgb(140,165,150); --accent: rgb(75,100,88); --name-color: rgb(45,58,50); --title-color: rgb(85,110,95);',
  palette_teal: '--panel-fill: rgba(228,238,238,1.0); --panel-border: rgb(100,155,160); --accent: rgb(35,95,105); --name-color: rgb(25,70,75); --title-color: rgb(55,115,120);',
  palette_terracotta: '--panel-fill: rgba(248,238,232,1.0); --panel-border: rgb(195,165,155); --accent: rgb(165,95,85); --name-color: rgb(85,55,52); --title-color: rgb(130,85,80);',
};

export interface LowerThirdCardInput {
  name: string;
  title?: string | null;
  subtitle?: string | null;
  theme?: string | null;
  /** data: URL for the optional logo chip, when logoEnabled. */
  logoDataUrl?: string | null;
  /** Which side of frame the card sits on, mirroring the live graphic. Defaults to left. */
  side?: 'left' | 'right' | null;
  /** Origin the offscreen page can reach the self-hosted webfonts through (e.g. http://127.0.0.1:8080). */
  fontsOrigin?: string;
}

/** The still is a full frame, so a switcher can take it without repositioning. */
export const EXPORT_WIDTH = 1920;
export const EXPORT_HEIGHT = 1080;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Pure function — testable without Electron. Builds a full 1920x1080 page on a
 * transparent background with the card placed exactly where it sits on air:
 * geometry, side placement and theme tokens all come from
 * graphics/lower-third-live/index.html (the source of truth), so the still
 * drops onto a switcher layer without being nudged back into position.
 */
export function renderLowerThirdCardHtml(input: LowerThirdCardInput): string {
  const theme = (input.theme && THEME_COLOR_VARS[input.theme]) ? input.theme : 'default';
  const vars = THEME_COLOR_VARS[theme];
  const side = input.side === 'right' ? 'right' : 'left';
  const fontFaces = input.fontsOrigin
    ? `
@font-face{font-family:'Inter';font-style:normal;font-weight:400;src:url('${input.fontsOrigin}/graphics/_fonts/inter-latin-400.woff2') format('woff2');}
@font-face{font-family:'Inter';font-style:normal;font-weight:600;src:url('${input.fontsOrigin}/graphics/_fonts/inter-latin-600.woff2') format('woff2');}`
    : '';
  const logoHtml = input.logoDataUrl
    ? `<img class="logo" src="${escapeHtml(input.logoDataUrl)}" alt="" />`
    : '';

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
${fontFaces}
*{box-sizing:border-box;margin:0;padding:0;}
html,body{width:${EXPORT_WIDTH}px;height:${EXPORT_HEIGHT}px;overflow:hidden;background:transparent;
  font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;-webkit-font-smoothing:antialiased;}
body{${vars}}
/* Placement copied from graphics/lower-third-live/index.html .l3 — bottom:96px
   with a 96px side margin — so the exported frame lines up with what goes to air. */
#card{position:absolute;bottom:96px;width:max-content;min-width:400px;max-width:861px;
  min-height:169px;background:var(--panel-fill);border:1px solid var(--panel-border);
  border-radius:4px;display:flex;align-items:center;box-shadow:0 4px 24px rgba(0,0,0,.4);}
#card[data-side="left"]{left:96px;}
#card[data-side="right"]{right:96px;flex-direction:row-reverse;}
#card[data-side="right"] .text{text-align:right;}
#card .logo{height:96px;max-width:220px;object-fit:contain;margin:0 0 0 24px;flex:none;}
#card[data-side="right"] .logo{margin:0 24px 0 0;}
#card .accent{width:5px;height:104px;background:var(--accent);margin:0 16px 0 24px;flex:none;}
#card .text{padding:16px 44px 16px 0;min-width:0;}
#card[data-side="right"] .text{padding:16px 0 16px 44px;}
#card .name{font-weight:600;font-size:52px;line-height:1;color:var(--name-color);}
#card .title{font-size:32px;color:var(--title-color);margin-top:14px;line-height:1;}
#card .subtitle{font-size:23px;font-weight:400;color:var(--title-color);opacity:.72;margin-top:10px;line-height:1;}
#card .title:empty,#card .subtitle:empty{display:none;margin:0;}
</style>
</head>
<body data-theme="${theme}">
<div id="card" data-side="${side}">
${logoHtml}
<div class="accent"></div>
<div class="text">
  <div class="name">${escapeHtml(input.name)}</div>
  <div class="title">${escapeHtml(input.title ?? '')}</div>
  <div class="subtitle">${escapeHtml(input.subtitle ?? '')}</div>
</div>
</div>
</body>
</html>`;
}

/**
 * Electron-only — not called in tests. Renders a full 1920x1080 transparent PNG
 * with the card in its on-air position, so the result drops straight into an
 * ATEM/vMix still store as a frame-sized layer.
 */
/**
 * One reused capture window, created on first export and kept for the process
 * lifetime.
 *
 * Creating a second BrowserWindow for a second export fails the navigation with
 * ERR_FAILED and then takes the process down — regardless of whether the page is
 * served from a data: URL or over http, so it is the window churn rather than the
 * scheme. Only the first export of a session ever worked. scripts/export-overlay.js
 * likewise drives thousands of frames through a single window.
 */
let captureWindow: import('electron').BrowserWindow | null = null;

/** Renders are serialised: they share one window, so they cannot interleave. */
let renderQueue: Promise<unknown> = Promise.resolve();

function acquireCaptureWindow(): import('electron').BrowserWindow {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { BrowserWindow } = require('electron') as typeof import('electron');
  if (captureWindow && !captureWindow.isDestroyed()) return captureWindow;
  // transparent/frame/useContentSize mirror scripts/export-overlay.js, the proven
  // capture path. Without `transparent` the window's backing surface is opaque and
  // the card's alpha composites onto white, so the PNG this promises to key over a
  // camera arrives fully opaque.
  captureWindow = new BrowserWindow({
    show: false,
    width: EXPORT_WIDTH,
    height: EXPORT_HEIGHT,
    useContentSize: true,
    transparent: true,
    frame: false,
    webPreferences: { offscreen: true },
  });
  return captureWindow;
}

export function renderLowerThirdCardToPng(input: LowerThirdCardInput): Promise<Buffer> {
  const run = renderQueue.then(
    () => renderCardOnce(input),
    () => renderCardOnce(input)
  );
  // Keep the chain alive regardless of this render's outcome.
  renderQueue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

async function renderCardOnce(input: LowerThirdCardInput): Promise<Buffer> {

  const html = renderLowerThirdCardHtml(input);

  // Served over an ephemeral localhost origin rather than a data: URL. A second
  // top-level navigation to data: in the same process fails with ERR_FAILED and
  // then takes the process down, so only the first export of a session worked.
  // scripts/export-overlay.js loads over http for the same reason and renders
  // thousands of frames without trouble.
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const closeServer = () =>
    new Promise<void>((resolve) => {
      server.close(() => resolve());
    });

  const win = acquireCaptureWindow();

  try {
    // loadURL() already resolves on did-finish-load. Do NOT then wait for that
    // event again — it is in the past and never fires twice, which hung every
    // export forever (isLoadingMainFrame() stays true here even though
    // document.readyState is already 'complete'). See scripts/check-l3-export.js.
    await win.loadURL(`http://127.0.0.1:${port}/`);

    // Chromium persists zoom per HOST (the port is ignored), and this renders from
    // 127.0.0.1 — the same host the app's own server uses. A zoom level stored for
    // it by anything else would silently rescale the still, so pin it to 1.
    win.webContents.setZoomFactor(1);

    // A finished load does not mean webfonts are applied or that the compositor
    // has produced a frame, and capturePage() on a window that has never painted
    // comes back empty. Wait for both, the way the ProRes exporter does.
    await win.webContents
      .executeJavaScript('document.fonts.ready.then(() => 1)')
      .catch(() => undefined);
    await win.webContents
      .executeJavaScript('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(1))))')
      .catch(() => undefined);

    // Sanity-check the card actually laid out; a 0x0 panel would capture an
    // empty frame that still encodes to a valid, useless PNG.
    const rect = (await win.webContents.executeJavaScript(`(function(){
      var e = document.getElementById('card');
      var r = e.getBoundingClientRect();
      return { width: Math.ceil(r.width), height: Math.ceil(r.height) };
    })()`)) as { width: number; height: number };
    if (!rect || rect.width < 1 || rect.height < 1) {
      throw new Error('Lower third measured 0×0 — nothing to capture');
    }

    // Grab the whole frame, not the card's own box: the still has to carry the
    // card's position so a switcher can take it as a full-frame layer.
    // Retry a blank grab rather than shipping it — the first frame after a load
    // can still be empty under load, and an empty capture used to reach the
    // operator as a 0-byte "successful" download.
    let image = await win.webContents.capturePage();
    for (let tries = 0; image.isEmpty() && tries < 10; tries += 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
      image = await win.webContents.capturePage();
    }
    if (image.isEmpty()) {
      throw new Error('Offscreen capture came back empty after 10 attempts');
    }

    // capturePage() returns physical pixels, so a 2x display yields 3840x2160.
    // Normalise rather than trusting the host's scale factor — callers are
    // promised exactly EXPORT_WIDTH x EXPORT_HEIGHT.
    const size = image.getSize();
    if (size.width !== EXPORT_WIDTH || size.height !== EXPORT_HEIGHT) {
      image = image.resize({ width: EXPORT_WIDTH, height: EXPORT_HEIGHT, quality: 'best' });
    }

    const png = image.toPNG();
    if (png.length === 0) {
      throw new Error('PNG encode produced 0 bytes');
    }
    return png;
  } finally {
    // The window is deliberately kept — see acquireCaptureWindow.
    await closeServer();
  }
}

/** Back-compat entry point for the per-cue export route — a cue has no logo/animation of its own. */
export async function renderCueToPng(cue: L3Cue, fontsOrigin?: string): Promise<Buffer> {
  return renderLowerThirdCardToPng({
    name: cue.name,
    title: cue.title,
    subtitle: cue.subtitle,
    theme: cue.theme,
    fontsOrigin,
  });
}
