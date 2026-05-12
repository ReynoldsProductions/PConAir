import type { L3Cue } from './cue-store';

/**
 * Pure function — testable without Electron.
 * Returns a full 1920×1080 HTML document string that renders the cue
 * as a lower-third graphic, with the provided theme CSS injected.
 */
export function renderCueHtml(cue: L3Cue, themeCss: string): string {
  const escapedName = escapeHtml(cue.name);
  const escapedTitle = escapeHtml(cue.title ?? '');
  const subtitleHtml = cue.subtitle
    ? `\n  <div class="subtitle">${escapeHtml(cue.subtitle)}</div>`
    : '';

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body {
  width: 1920px;
  height: 1080px;
  overflow: hidden;
  background: #000000;
  font-family: Arial, sans-serif;
  color: #ffffff;
}
.lower-third {
  position: fixed;
  bottom: 0;
  left: 0;
  width: 100%;
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 24px 40px;
}
.name {
  font-size: 48px;
  font-weight: bold;
  line-height: 1.2;
}
.title {
  font-size: 32px;
  line-height: 1.2;
  margin-top: 8px;
}
.subtitle {
  font-size: 24px;
  line-height: 1.2;
  margin-top: 4px;
}
${themeCss}
</style>
</head>
<body>
<div class="lower-third">
  <div class="name">${escapedName}</div>
  <div class="title">${escapedTitle}</div>${subtitleHtml}
</div>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Electron-only — not called in tests.
 * Renders the cue to a PNG Buffer using an offscreen BrowserWindow.
 */
export async function renderCueToPng(cue: L3Cue, themeCss: string): Promise<Buffer> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { BrowserWindow } = require('electron') as typeof import('electron');

  const html = renderCueHtml(cue, themeCss);
  const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;

  const win = new BrowserWindow({
    show: false,
    width: 1920,
    height: 1080,
    webPreferences: {
      offscreen: true,
    },
  });

  try {
    await win.loadURL(dataUrl);
    const image = await win.webContents.capturePage();
    return image.toPNG();
  } finally {
    win.destroy();
  }
}
