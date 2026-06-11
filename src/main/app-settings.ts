import fs from 'fs';
import path from 'path';

/**
 * App-level settings that must be known before the Express server starts
 * (the port cannot come from a profile — profiles load after boot, and the
 * settings window must be able to fix a bad port even when the server fails).
 * Stored as JSON in the Electron userData directory, separate from profiles.
 */
export interface AppSettings {
  schemaVersion: 1;
  /** HTTP/WS port. Default 8080. Never default to 9595 — that's GSC's port. */
  port: number;
}

export const DEFAULT_APP_SETTINGS: AppSettings = Object.freeze({
  schemaVersion: 1,
  port: 8080,
});

export function appSettingsPath(userDataDir: string): string {
  return path.join(userDataDir, 'app-settings.json');
}

function isValidPort(p: unknown): p is number {
  return typeof p === 'number' && Number.isInteger(p) && p >= 1 && p <= 65535;
}

/** Tolerant load: missing file, unreadable JSON, or bad fields fall back to defaults. */
export function loadAppSettings(filePath: string): AppSettings {
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return { ...DEFAULT_APP_SETTINGS };
  }
  if (typeof raw !== 'object' || raw === null) {
    return { ...DEFAULT_APP_SETTINGS };
  }
  const obj = raw as Record<string, unknown>;
  return {
    schemaVersion: 1,
    port: isValidPort(obj.port) ? obj.port : DEFAULT_APP_SETTINGS.port,
  };
}

/** Merge a patch into the stored settings and persist. Returns the merged result. */
export function saveAppSettings(filePath: string, patch: Partial<Pick<AppSettings, 'port'>>): AppSettings {
  const current = loadAppSettings(filePath);
  const next: AppSettings = {
    ...current,
    port: patch.port !== undefined && isValidPort(patch.port) ? patch.port : current.port,
  };
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2));
  fs.renameSync(tmp, filePath);
  return next;
}

/**
 * Port resolution order: PCONAIR_PORT env (dev/test override) > settings file > 8080.
 */
export function resolvePort(envValue: string | undefined, settings: AppSettings): number {
  if (envValue !== undefined) {
    const parsed = parseInt(envValue, 10);
    if (isValidPort(parsed)) return parsed;
  }
  return settings.port;
}
