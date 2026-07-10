import { BrowserWindow } from 'electron';

/** macOS-only: take a borderless output window fully OS-level fullscreen (hides menu bar), not just bounds-matched. */
export function applyFullscreenChrome(win: BrowserWindow | null): void {
  if (process.platform !== 'darwin' || !win || win.isDestroyed()) return;
  // Some window-managers repaint/re-show their window on every unrelated state
  // change (not just ones relevant to them), which calls this far more often
  // than the window's fullscreen state actually changes. Skip the OS call
  // entirely when already fullscreen so those redundant repaints stay cheap.
  if (win.isSimpleFullScreen()) return;
  try {
    win.setSimpleFullScreen(true);
  } catch (e) {
    console.warn('[fullscreen-chrome] setSimpleFullScreen failed:', e);
  }
}

/** True if the window fell out of simple-fullscreen and needs re-applying (race after load/resize). */
export function fullscreenChromeNeedsReapply(win: BrowserWindow | null): boolean {
  if (process.platform !== 'darwin' || !win || win.isDestroyed()) return false;
  return !win.isSimpleFullScreen();
}

/** Apply fullscreen chrome now, then re-check once ~200ms later in case the first application didn't stick. */
export function scheduleFullscreenChrome(win: BrowserWindow | null): void {
  applyFullscreenChrome(win);
  setTimeout(() => {
    if (fullscreenChromeNeedsReapply(win)) {
      applyFullscreenChrome(win);
    }
  }, 200);
}
