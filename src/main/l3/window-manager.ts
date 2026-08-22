import { BrowserWindow, screen } from 'electron';
import type { BackgroundState } from '../../shared/types';
import type { StateStore } from '../state';
import type { L3CueStore } from './cue-store';
import type { L3ThemeStore } from './theme-store';
import { scheduleFullscreenChrome } from '../fullscreen-chrome';
import { hideCursorOnLoad } from '../output-cursor';

interface L3StackEntry {
  cueId: string;
  name: string;
  title: string;
}

export type L3ProgramStackEntry = Pick<L3StackEntry, 'name' | 'title'>;

interface L3WindowConfig {
  store: StateStore;
  /** When set with cues, program L3 loads installed theme CSS for the on-air cue (last in stack when stacking). */
  themes?: L3ThemeStore;
  cues?: L3CueStore;
  getDisplayPreference?: () => string | null;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Resolve the CSS backdrop for the program window from Admin → Background.
 * `transparent` (and no configured background at all) keys straight through.
 */
function resolveBackdrop(background: BackgroundState | null): string {
  if (!background || background.type === 'transparent') return 'transparent';
  return background.value;
}

/** Build program overlay HTML; exported for unit tests (theme link + fallback layout). */
export function buildL3ProgramMarkup(
  stack: L3ProgramStackEntry[],
  themeCss: string | null,
  background: BackgroundState | null = null
): string {
  const blocks = stack
    .map(
      (e) => `
    <div class="cue">
      <div class="name">${escapeHtml(e.name)}</div>
      <div class="title">${escapeHtml(e.title)}</div>
    </div>`
    )
    .join('');

  const themeLink =
    themeCss && themeCss.length > 0
      ? `<link rel="stylesheet" href="data:text/css;charset=utf-8;base64,${Buffer.from(themeCss, 'utf8').toString('base64')}" />`
      : '';

  // One backdrop for the whole window, behind every card in the stack. That is
  // what makes stacked layers see-through: the cards themselves never carry a
  // fill, so the card below and this backdrop both remain visible.
  const backdrop = resolveBackdrop(background);

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"/>
<style>
html,body{margin:0;background:${backdrop};overflow:hidden;}
#wrap{position:fixed;left:0;right:0;bottom:0;padding:32px 48px;display:flex;flex-direction:column;align-items:flex-start;justify-content:flex-end;gap:16px;pointer-events:none;}
.cue{color:#fff;text-shadow:0 2px 8px #000;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;}
.name{font-size:40px;font-weight:700;line-height:1.1;}
.title{font-size:26px;font-weight:500;opacity:0.92;margin-top:4px;}
</style>
${themeLink}
</head><body><div id="wrap">${blocks}</div></body></html>`;
}

function buildDataUrl(
  stack: L3StackEntry[],
  themeCss: string | null,
  background: BackgroundState | null
): string {
  const markup = buildL3ProgramMarkup(stack, themeCss, background);
  return `data:text/html;charset=utf-8,${encodeURIComponent(markup)}`;
}

function resolveThemeCss(
  stack: L3StackEntry[],
  themes: L3ThemeStore | undefined,
  cues: L3CueStore | undefined
): string | null {
  if (!themes || !cues || stack.length === 0) return null;
  const last = stack[stack.length - 1];
  const cue = cues.findById(last.cueId);
  const themeName = cue?.theme ?? 'default';
  const theme = themes.findByName(themeName);
  return theme?.cssContent ?? null;
}

export function createL3WindowManager(config: L3WindowConfig) {
  const { store, themes, cues, getDisplayPreference } = config;
  let win: BrowserWindow | null = null;
  let stack: L3StackEntry[] = [];
  let unsubscribe: (() => void) | null = null;
  let lastTakenCueId: string | null = null;

  function getTargetDisplay(): Electron.Display {
    // Operator's per-session choice on the Cue Library page wins; the profile
    // preference from Admin → Monitors is the fallback.
    const pref = store.getState().l3?.outputDisplayId ?? getDisplayPreference?.() ?? null;
    if (pref) {
      const found = screen.getAllDisplays().find((d) => String(d.id) === pref);
      if (found) return found;
    }
    return screen.getPrimaryDisplay();
  }

  /** Move an already-open window when the operator retargets it mid-show. */
  function applyTargetDisplay(): void {
    if (!win || win.isDestroyed()) return;
    const b = getTargetDisplay().bounds;
    const cur = win.getBounds();
    if (cur.x === b.x && cur.y === b.y && cur.width === b.width && cur.height === b.height) return;
    win.setBounds({ x: b.x, y: b.y, width: b.width, height: b.height });
    scheduleFullscreenChrome(win);
  }

  function ensureWindow(): BrowserWindow {
    if (win && !win.isDestroyed()) return win;
    const display = getTargetDisplay();
    win = new BrowserWindow({
      x: display.bounds.x,
      y: display.bounds.y,
      width: display.bounds.width,
      height: display.bounds.height,
      transparent: true,
      frame: false,
      fullscreen: false,
      show: false,
      hasShadow: false,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    hideCursorOnLoad(win);
    return win;
  }

  function hideWindow(): void {
    if (win && !win.isDestroyed()) win.hide();
  }

  function paint(entries: L3StackEntry[]): void {
    if (entries.length === 0) {
      hideWindow();
      return;
    }
    const themeCss = resolveThemeCss(entries, themes, cues);
    const url = buildDataUrl(entries, themeCss, store.getState().background ?? null);
    const window = ensureWindow();
    applyTargetDisplay();
    void window.loadURL(url).then(() => {
      if (!window.isDestroyed()) {
        window.show();
        scheduleFullscreenChrome(window);
      }
    });
  }

  function initialize(): void {
    unsubscribe = store.subscribe((patch) => {
      // Only react when this manager's own slice of state actually changed —
      // otherwise every unrelated state tick elsewhere in the app (WS client
      // count, watchdog pings, other modes' actions) re-runs paint()'s
      // loadURL() on the live-preview window, aborting the previous in-flight
      // load each time (ERR_ABORTED) and hammering the renderer.
      if (patch.currentMode === undefined && patch.l3 === undefined && patch.background === undefined) return;

      const state = store.getState();

      // Retarget an open window even when nothing else about the take changed.
      if (patch.l3?.outputDisplayId !== undefined) applyTargetDisplay();

      if (state.currentMode !== 'l3') {
        stack = [];
        lastTakenCueId = null;
        hideWindow();
        return;
      }

      if (patch.l3 && patch.l3.activeCueId === null) {
        stack = [];
        lastTakenCueId = null;
        hideWindow();
        return;
      }

      const l3 = state.l3;
      if (!l3?.activeCueId) {
        hideWindow();
        return;
      }

      const entry: L3StackEntry = {
        cueId: l3.activeCueId,
        name: l3.activeCueName ?? '',
        title: l3.activeTitle ?? '',
      };

      if (l3.activeCueId !== lastTakenCueId) {
        if (l3.isStacking) stack = [...stack, entry];
        else stack = [entry];
        lastTakenCueId = l3.activeCueId;
      }

      // A background-only change falls through to here with an unchanged stack,
      // repainting the live card over the new backdrop.
      paint(stack);
    });
  }

  function destroy(): void {
    unsubscribe?.();
    unsubscribe = null;
    stack = [];
    lastTakenCueId = null;
    win?.destroy();
    win = null;
  }

  function getWindow(): BrowserWindow | null {
    return win && !win.isDestroyed() ? win : null;
  }

  return { initialize, getWindow, destroy };
}

export type L3WindowManager = ReturnType<typeof createL3WindowManager>;
