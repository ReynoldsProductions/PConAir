import { BrowserWindow, screen } from 'electron';
import type { StateStore } from '../state';

interface L3StackEntry {
  name: string;
  title: string;
}

interface L3WindowConfig {
  store: StateStore;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildDataUrl(stack: L3StackEntry[]): string {
  const blocks = stack
    .map(
      (e) => `
    <div class="cue">
      <div class="name">${escapeHtml(e.name)}</div>
      <div class="title">${escapeHtml(e.title)}</div>
    </div>`
    )
    .join('');
  const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"/>
<style>
html,body{margin:0;background:transparent;overflow:hidden;}
#wrap{position:fixed;left:0;right:0;bottom:0;padding:32px 48px;display:flex;flex-direction:column;align-items:flex-start;justify-content:flex-end;gap:16px;pointer-events:none;}
.cue{color:#fff;text-shadow:0 2px 8px #000;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;}
.name{font-size:40px;font-weight:700;line-height:1.1;}
.title{font-size:26px;font-weight:500;opacity:0.92;margin-top:4px;}
</style></head><body><div id="wrap">${blocks}</div></body></html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

export function createL3WindowManager(config: L3WindowConfig) {
  const { store } = config;
  let win: BrowserWindow | null = null;
  let stack: L3StackEntry[] = [];
  let unsubscribe: (() => void) | null = null;
  let lastTakenCueId: string | null = null;

  function ensureWindow(): BrowserWindow {
    if (win && !win.isDestroyed()) return win;
    const display = screen.getPrimaryDisplay();
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
    const url = buildDataUrl(entries);
    const window = ensureWindow();
    void window.loadURL(url).then(() => {
      if (!window.isDestroyed()) window.show();
    });
  }

  function initialize(): void {
    unsubscribe = store.subscribe((patch) => {
      const state = store.getState();

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
        name: l3.activeCueName ?? '',
        title: l3.activeTitle ?? '',
      };

      if (l3.activeCueId !== lastTakenCueId) {
        if (l3.isStacking) stack = [...stack, entry];
        else stack = [entry];
        lastTakenCueId = l3.activeCueId;
      }

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

  return { initialize, destroy };
}

export type L3WindowManager = ReturnType<typeof createL3WindowManager>;
