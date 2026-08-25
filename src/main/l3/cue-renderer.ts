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
  /** Origin the offscreen page can reach the self-hosted webfonts through (e.g. http://127.0.0.1:8080). */
  fontsOrigin?: string;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Pure function — testable without Electron. Builds a standalone page sized
 * to the card's natural content width, transparent background, using the
 * exact geometry/theme tokens graphics/lower-third-live/index.html renders
 * on air — so a screenshot cropped to #card is a faithful still.
 */
export function renderLowerThirdCardHtml(input: LowerThirdCardInput): string {
  const theme = (input.theme && THEME_COLOR_VARS[input.theme]) ? input.theme : 'default';
  const vars = THEME_COLOR_VARS[theme];
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
html,body{width:1920px;height:1080px;overflow:hidden;background:transparent;
  font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;-webkit-font-smoothing:antialiased;}
body{${vars}}
#card{position:absolute;left:24px;top:24px;width:max-content;min-width:400px;max-width:861px;
  min-height:169px;background:var(--panel-fill);border:1px solid var(--panel-border);
  border-radius:4px;display:flex;align-items:center;}
#card .logo{height:96px;max-width:220px;object-fit:contain;margin:0 0 0 24px;flex:none;}
#card .accent{width:5px;height:104px;background:var(--accent);margin:0 16px 0 24px;flex:none;}
#card .text{padding:16px 44px 16px 0;min-width:0;}
#card .name{font-weight:600;font-size:52px;line-height:1;color:var(--name-color);}
#card .title{font-size:32px;color:var(--title-color);margin-top:14px;line-height:1;}
#card .subtitle{font-size:23px;font-weight:400;color:var(--title-color);opacity:.72;margin-top:10px;line-height:1;}
#card .title:empty,#card .subtitle:empty{display:none;margin:0;}
</style>
</head>
<body data-theme="${theme}">
<div id="card">
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
 * Electron-only — not called in tests. Renders the card to a transparent PNG
 * Buffer, cropped tightly to its own bounding box (not the full 1920×1080
 * frame), so the result drops straight into an ATEM/vMix still store.
 */
export async function renderLowerThirdCardToPng(input: LowerThirdCardInput): Promise<Buffer> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { BrowserWindow } = require('electron') as typeof import('electron');

  const html = renderLowerThirdCardHtml(input);
  const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;

  const win = new BrowserWindow({
    show: false,
    width: 1920,
    height: 1080,
    webPreferences: { offscreen: true },
  });

  try {
    await win.loadURL(dataUrl);
    if (win.webContents.isLoadingMainFrame()) {
      await new Promise<void>((resolve) => win.webContents.once('did-finish-load', () => resolve()));
    }
    const rect = (await win.webContents.executeJavaScript(`(function(){
      var e = document.getElementById('card');
      var r = e.getBoundingClientRect();
      return { x: Math.floor(r.x), y: Math.floor(r.y), width: Math.ceil(r.width), height: Math.ceil(r.height) };
    })()`)) as { x: number; y: number; width: number; height: number };
    const image = await win.webContents.capturePage(rect);
    return image.toPNG();
  } finally {
    win.destroy();
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
