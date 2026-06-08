import { BrowserWindow, screen } from 'electron';
import { pathToFileURL } from 'url';
import path from 'path';
import type { StateStore } from '../state';
import type { MediaLibraryStore } from './item-store';

export function createMediaLibraryWindowManager(config: { store: StateStore; media: MediaLibraryStore; getDisplayPreference?: () => string | null }) {
  const { store, media, getDisplayPreference } = config;
  let win: BrowserWindow | null = null;
  let unsubscribe: (() => void) | null = null;

  function getTargetDisplay(): Electron.Display {
    const pref = getDisplayPreference?.() ?? null;
    if (pref) {
      const found = screen.getAllDisplays().find((d) => String(d.id) === pref);
      if (found) return found;
    }
    return screen.getPrimaryDisplay();
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
    return win;
  }

  function hideWindow(): void {
    if (win && !win.isDestroyed()) win.hide();
  }

  function initialize(): void {
    unsubscribe = store.subscribe(() => {
      const state = store.getState();
      if (state.currentMode !== 'media-library') {
        hideWindow();
        return;
      }
      const id = state.mediaLibrary?.activeItemId;
      if (!id) {
        hideWindow();
        return;
      }
      const item = media.findById(id);
      if (!item) {
        hideWindow();
        return;
      }
      const abs = path.resolve(media.absolutePath(item));
      const fileUrl = pathToFileURL(abs).href;
      const window = ensureWindow();
      void window.loadURL(fileUrl).then(() => {
        if (!window.isDestroyed()) window.show();
      });
    });
  }

  function destroy(): void {
    unsubscribe?.();
    unsubscribe = null;
    win?.destroy();
    win = null;
  }

  function getWindow(): BrowserWindow | null {
    return win && !win.isDestroyed() ? win : null;
  }

  return { initialize, getWindow, destroy };
}

export type MediaLibraryWindowManager = ReturnType<typeof createMediaLibraryWindowManager>;
