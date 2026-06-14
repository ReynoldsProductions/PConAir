import fs from 'fs';
import path from 'path';

/** One PerfectCue TCP listener configuration. */
export interface PerfectCuePortConfig {
  /** Stable id used by toggle-port (independent of the port number). */
  id: string;
  /** Human label shown in the admin UI. */
  name: string;
  /** TCP port the extender connects to. */
  port: number;
  /** Hardware family — selects the keep-alive/idle timing preset. */
  adapterType: 'dsan' | 'waveshare';
  /** Per-port dispatch gate; false = connection stays open but commands ignored. */
  enabled: boolean;
}

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
  /** Cloudflare tunnel: start cloudflared on boot. */
  tunnelEnabled: boolean;
  /** Custom domain shown as the public URL when a token-based tunnel is used. */
  tunnelDomain: string | null;
  /** Cloudflare tunnel token (`cloudflared tunnel run --token …`); null = quick tunnel. */
  tunnelToken: string | null;
  /** bcrypt hash of the 4-digit tunnel PIN; null = tunnel access not PIN-gated. */
  tunnelPinHash: string | null;
  /** Stagetimer.io room id for the notes-display overlay; null = not configured. */
  stagetimerRoomId: string | null;
  /** Stagetimer.io API key (paired with the room id); null = not configured. */
  stagetimerApiKey: string | null;
  /** Overlay corner on the notes display. */
  stageTimerOverlayPosition: 'bottom-left' | 'bottom-right' | 'top-left' | 'top-right';
  /** Overlay size as percent of the notes display (1–100). */
  stageTimerOverlaySize: number;
  /** Overlay was showing when the app last ran — restore it at boot. */
  stageTimerOverlayEnabled: boolean;
  /** Absolute path to a custom brand logo (PNG/JPG/SVG); null = no logo. */
  customLogoPath: string | null;
  /** Absolute path to a custom CSS file for white-labeling the web remote; null = no override. */
  customCssPath: string | null;
  /** Master enable for the PerfectCue TCP listeners. */
  perfectcueEnabled: boolean;
  /** Per-port PerfectCue listener configs. */
  perfectcuePorts: PerfectCuePortConfig[];
}

export const DEFAULT_APP_SETTINGS: AppSettings = Object.freeze({
  schemaVersion: 1,
  port: 8080,
  tunnelEnabled: false,
  tunnelDomain: null,
  tunnelToken: null,
  tunnelPinHash: null,
  stagetimerRoomId: null,
  stagetimerApiKey: null,
  stageTimerOverlayPosition: 'bottom-left',
  stageTimerOverlaySize: 10,
  stageTimerOverlayEnabled: false,
  customLogoPath: null,
  customCssPath: null,
  perfectcueEnabled: false,
  perfectcuePorts: [],
});

export function appSettingsPath(userDataDir: string): string {
  return path.join(userDataDir, 'app-settings.json');
}

function isValidPort(p: unknown): p is number {
  return typeof p === 'number' && Number.isInteger(p) && p >= 1 && p <= 65535;
}

function strOrNull(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

const OVERLAY_POSITIONS = new Set(['bottom-left', 'bottom-right', 'top-left', 'top-right']);

export function isValidOverlayPosition(v: unknown): v is AppSettings['stageTimerOverlayPosition'] {
  return typeof v === 'string' && OVERLAY_POSITIONS.has(v);
}

export function isValidOverlaySize(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 100;
}

let perfectcueIdSeq = 0;
function nextPerfectcueId(): string {
  perfectcueIdSeq += 1;
  return `pc-${Date.now().toString(36)}-${perfectcueIdSeq}`;
}

/**
 * Coerce an unknown value into a clean PerfectCuePortConfig[]. Drops entries
 * without a valid port, fills missing names, defaults the adapter to 'dsan',
 * and synthesises an id when one is missing (legacy/imported configs).
 */
export function normalizePerfectCuePorts(value: unknown): PerfectCuePortConfig[] {
  if (!Array.isArray(value)) return [];
  const out: PerfectCuePortConfig[] = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) continue;
    const e = entry as Record<string, unknown>;
    if (!isValidPort(e.port)) continue;
    out.push({
      id: typeof e.id === 'string' && e.id.length > 0 ? e.id : nextPerfectcueId(),
      name: typeof e.name === 'string' ? e.name : '',
      port: e.port,
      adapterType: e.adapterType === 'waveshare' ? 'waveshare' : 'dsan',
      enabled: e.enabled !== false,
    });
  }
  return out;
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
    tunnelEnabled: obj.tunnelEnabled === true,
    tunnelDomain: strOrNull(obj.tunnelDomain),
    tunnelToken: strOrNull(obj.tunnelToken),
    tunnelPinHash: strOrNull(obj.tunnelPinHash),
    stagetimerRoomId: strOrNull(obj.stagetimerRoomId),
    stagetimerApiKey: strOrNull(obj.stagetimerApiKey),
    stageTimerOverlayPosition: isValidOverlayPosition(obj.stageTimerOverlayPosition)
      ? obj.stageTimerOverlayPosition
      : DEFAULT_APP_SETTINGS.stageTimerOverlayPosition,
    stageTimerOverlaySize: isValidOverlaySize(obj.stageTimerOverlaySize)
      ? obj.stageTimerOverlaySize
      : DEFAULT_APP_SETTINGS.stageTimerOverlaySize,
    stageTimerOverlayEnabled: obj.stageTimerOverlayEnabled === true,
    customLogoPath: strOrNull(obj.customLogoPath),
    customCssPath: strOrNull(obj.customCssPath),
    perfectcueEnabled: obj.perfectcueEnabled === true,
    perfectcuePorts: normalizePerfectCuePorts(obj.perfectcuePorts),
  };
}

export type AppSettingsPatch = Partial<Omit<AppSettings, 'schemaVersion'>>;

/** Merge a patch into the stored settings and persist. Returns the merged result. */
export function saveAppSettings(filePath: string, patch: AppSettingsPatch): AppSettings {
  const current = loadAppSettings(filePath);
  const next: AppSettings = {
    ...current,
    ...patch,
    schemaVersion: 1,
    port: patch.port !== undefined && isValidPort(patch.port) ? patch.port : current.port,
    stageTimerOverlayPosition: isValidOverlayPosition(patch.stageTimerOverlayPosition)
      ? patch.stageTimerOverlayPosition
      : current.stageTimerOverlayPosition,
    stageTimerOverlaySize: isValidOverlaySize(patch.stageTimerOverlaySize)
      ? patch.stageTimerOverlaySize
      : current.stageTimerOverlaySize,
    perfectcuePorts:
      patch.perfectcuePorts !== undefined
        ? normalizePerfectCuePorts(patch.perfectcuePorts)
        : current.perfectcuePorts,
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
