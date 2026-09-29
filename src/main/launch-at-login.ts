import { app } from 'electron';

/**
 * No-op in dev (electron-forge start runs an unpacked binary that isn't a
 * stable path to register as a login item) — only meaningful in a packaged build.
 */
export function applyLaunchAtLogin(enabled: boolean): void {
  if (!app.isPackaged) return;
  app.setLoginItemSettings({ openAtLogin: enabled });
}
