import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import type { OfficeManager } from './director/office-manager';
import type { DirectorOffice } from './app-settings';

// Injected by @electron-forge/plugin-webpack for the `director` renderer entry.
declare const DIRECTOR_WINDOW_WEBPACK_ENTRY: string;
declare const DIRECTOR_WINDOW_PRELOAD_WEBPACK_ENTRY: string;

/** Resolve director window entry URL and preload path — loaded directly from
 *  webpack (not over this instance's own HTTP server), same as the settings
 *  window, since Director talks to *remote* offices over HTTP/WS from the
 *  main process rather than to this instance's own Express server. */
function resolveDirectorEntry(): { url: string; preload: string } {
  try {
    return { url: DIRECTOR_WINDOW_WEBPACK_ENTRY, preload: DIRECTOR_WINDOW_PRELOAD_WEBPACK_ENTRY };
  } catch {
    const base = path.join(app.getAppPath(), '.webpack', 'renderer', 'director');
    return {
      url: `file://${path.join(base, 'index.html')}`,
      preload: path.join(base, 'preload.js'),
    };
  }
}

export interface DirectorWindowDeps {
  officeManager: OfficeManager;
  getOffices: () => DirectorOffice[];
}

let directorWindow: BrowserWindow | null = null;

export function registerDirectorIpc(deps: DirectorWindowDeps): void {
  const { officeManager, getOffices } = deps;

  ipcMain.handle('pconair:director:list-offices', () => {
    return getOffices().map((o) => {
      const snapshot = officeManager.getSnapshot(o.id);
      return {
        id: o.id,
        name: o.name,
        baseUrl: o.baseUrl,
        status: snapshot?.status ?? 'offline',
        state: snapshot?.state ?? null,
      };
    });
  });

  ipcMain.handle('pconair:director:fire-action', async (_e, raw: unknown) => {
    const req = raw as { officeId?: unknown; action?: unknown; body?: unknown };
    if (typeof req.officeId !== 'string' || typeof req.action !== 'string') {
      return { ok: false, status: 400, error: { code: 'INVALID_MODE', message: 'officeId and action are required' } };
    }
    const body = req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {};
    return officeManager.fireAction(req.officeId, req.action, body);
  });
}

export function broadcastOfficeStatus(officeId: string, status: string): void {
  if (directorWindow && !directorWindow.isDestroyed()) {
    directorWindow.webContents.send('pconair:director:office-status', { officeId, status });
  }
}

export function broadcastOfficeState(officeId: string, state: unknown): void {
  if (directorWindow && !directorWindow.isDestroyed()) {
    directorWindow.webContents.send('pconair:director:office-state', { officeId, state });
  }
}

export function openDirectorWindow(): BrowserWindow | null {
  if (directorWindow && !directorWindow.isDestroyed()) {
    directorWindow.focus();
    return directorWindow;
  }
  const entry = resolveDirectorEntry();
  directorWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    title: 'PConAir — Director',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: entry.preload,
    },
  });
  void directorWindow.loadURL(entry.url);
  directorWindow.on('closed', () => {
    directorWindow = null;
  });
  return directorWindow;
}
