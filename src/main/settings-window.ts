import { app, BrowserWindow, ipcMain } from 'electron';
import { appSettingsPath, loadAppSettings, saveAppSettings } from './app-settings';
import { snapshotDisplays } from './displays';
import { loadProfile, writeProfile, getActiveMarker } from './profiles/bootstrap';
import type { ProfilePaths } from './profiles/paths';

// Injected by @electron-forge/plugin-webpack for the `settings` renderer entry.
declare const SETTINGS_WINDOW_WEBPACK_ENTRY: string;
declare const SETTINGS_WINDOW_PRELOAD_WEBPACK_ENTRY: string;

export interface SettingsWindowDeps {
  /** Port the server is actually running on (or tried to). */
  runningPort: number;
  serverError: () => string | null;
  profilePaths: ProfilePaths;
  getActiveProfileId: () => string;
}

let settingsWindow: BrowserWindow | null = null;

export function registerSettingsIpc(deps: SettingsWindowDeps): void {
  const settingsFile = appSettingsPath(app.getPath('userData'));

  ipcMain.handle('pconair:settings:get', () => {
    const stored = loadAppSettings(settingsFile);
    const id = getActiveMarker(deps.profilePaths)?.id ?? deps.getActiveProfileId();
    const profile = loadProfile(deps.profilePaths, id);
    return {
      port: deps.runningPort,
      pendingPort: stored.port,
      settingsPath: settingsFile,
      displays: snapshotDisplays(),
      security: {
        ipAllowlistEnabled: profile?.appPreferences.ipAllowlistEnabled === true,
        ipAllowlist: profile?.appPreferences.ipAllowlist ?? [],
      },
      serverError: deps.serverError(),
      version: app.getVersion(),
    };
  });

  ipcMain.handle('pconair:settings:save-port', (_e, port: unknown) => {
    if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) {
      return { ok: false, error: 'Port must be an integer between 1 and 65535.' };
    }
    if (port === 9595) {
      return { ok: false, error: "9595 is Google Slides Controller's port — pick another." };
    }
    saveAppSettings(settingsFile, { port });
    return { ok: true, restartRequired: port !== deps.runningPort };
  });

  ipcMain.handle('pconair:settings:save-security', (_e, raw: unknown) => {
    const sec = raw as { ipAllowlistEnabled?: unknown; ipAllowlist?: unknown };
    const enabled = sec?.ipAllowlistEnabled === true;
    const entries = Array.isArray(sec?.ipAllowlist)
      ? sec.ipAllowlist.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
      : [];
    if (enabled && entries.length === 0) {
      return { ok: false, error: 'Add at least one IP/CIDR before enabling the allowlist.' };
    }
    const id = getActiveMarker(deps.profilePaths)?.id ?? deps.getActiveProfileId();
    const profile = loadProfile(deps.profilePaths, id);
    if (!profile) {
      return { ok: false, error: 'Active profile not found.' };
    }
    writeProfile(deps.profilePaths, {
      ...profile,
      appPreferences: {
        ...profile.appPreferences,
        ipAllowlistEnabled: enabled,
        ipAllowlist: entries,
      },
    });
    return { ok: true };
  });

  ipcMain.handle('pconair:settings:restart', () => {
    app.relaunch();
    app.exit(0);
  });
}

export function openSettingsWindow(): BrowserWindow {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus();
    return settingsWindow;
  }
  settingsWindow = new BrowserWindow({
    width: 520,
    height: 720,
    title: 'PConAir Settings',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: SETTINGS_WINDOW_PRELOAD_WEBPACK_ENTRY,
    },
  });
  // Loaded from the webpack entry (file/dev-server), not over HTTP, so the
  // settings window still opens when the server failed to start.
  void settingsWindow.loadURL(SETTINGS_WINDOW_WEBPACK_ENTRY);
  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });
  return settingsWindow;
}
