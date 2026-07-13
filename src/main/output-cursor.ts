import type { BrowserWindow } from 'electron';

/**
 * Hides the OS cursor over an output window — these are live-playout surfaces
 * (Slides, media library, URL, L3) and a visible pointer reads as on-air.
 * Re-injected on every navigation since `dom-ready` fires per top-level load.
 */
export function hideCursorOnLoad(win: BrowserWindow | null): void {
  if (!win || win.isDestroyed()) return;
  win.webContents.on('dom-ready', () => {
    if (win.isDestroyed()) return;
    void win.webContents.insertCSS('*, *::before, *::after { cursor: none !important; }').catch(() => {});
  });
}
