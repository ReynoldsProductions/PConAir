import fs from 'fs';
import path from 'path';

/**
 * Operator/admin overrides for one data source: the manifest supplies
 * defaults, the operator owns the live value (spec 20 §3.5). Persisted
 * per-package under `userData`, mirroring state-hub.ts's persist file.
 */
export interface DataSourceOverride {
  url?: string;
  pollSeconds?: number;
  enabled?: boolean;
}

/** packageId -> sourceId -> override */
export type DataOverrides = Record<string, Record<string, DataSourceOverride>>;

interface PersistFileV1 {
  version: 1;
  overrides: DataOverrides;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function sanitizeOverride(raw: unknown): DataSourceOverride {
  if (!isPlainObject(raw)) return {};
  const out: DataSourceOverride = {};
  if (typeof raw.url === 'string') out.url = raw.url;
  if (typeof raw.pollSeconds === 'number' && Number.isInteger(raw.pollSeconds) && raw.pollSeconds > 0) {
    out.pollSeconds = raw.pollSeconds;
  }
  if (typeof raw.enabled === 'boolean') out.enabled = raw.enabled;
  return out;
}

function sanitizeOverrides(raw: unknown): DataOverrides {
  if (!isPlainObject(raw)) return {};
  const out: DataOverrides = {};
  for (const [pkgId, bySource] of Object.entries(raw)) {
    if (!isPlainObject(bySource)) continue;
    const sources: Record<string, DataSourceOverride> = {};
    for (const [sourceId, ov] of Object.entries(bySource)) {
      sources[sourceId] = sanitizeOverride(ov);
    }
    out[pkgId] = sources;
  }
  return out;
}

export interface DataOverridesStore {
  get(): DataOverrides;
  getFor(packageId: string, sourceId: string): DataSourceOverride;
  /** Merge a patch into one source's override and persist. Returns the merged override. */
  set(packageId: string, sourceId: string, patch: DataSourceOverride): DataSourceOverride;
}

/** `filePath` omitted keeps overrides purely in-memory (as tests without a userData dir do). */
export function createDataOverridesStore(filePath?: string): DataOverridesStore {
  function readPersisted(): DataOverrides {
    if (!filePath) return {};
    try {
      if (!fs.existsSync(filePath)) return {};
      const raw = JSON.parse(fs.readFileSync(filePath, 'utf8')) as PersistFileV1;
      return raw && raw.version === 1 ? sanitizeOverrides(raw.overrides) : {};
    } catch {
      return {}; // a corrupt save must never stop the app booting
    }
  }

  let overrides: DataOverrides = readPersisted();

  function writeNow(): void {
    if (!filePath) return;
    try {
      const payload: PersistFileV1 = { version: 1, overrides };
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
    } catch {
      // a read-only disk should degrade to "in-memory only", not crash the show
    }
  }

  function get(): DataOverrides {
    return overrides;
  }

  function getFor(packageId: string, sourceId: string): DataSourceOverride {
    return overrides[packageId]?.[sourceId] ?? {};
  }

  function set(packageId: string, sourceId: string, patch: DataSourceOverride): DataSourceOverride {
    const clean = sanitizeOverride(patch);
    const existing = overrides[packageId]?.[sourceId] ?? {};
    const merged = { ...existing, ...clean };
    overrides = { ...overrides, [packageId]: { ...(overrides[packageId] ?? {}), [sourceId]: merged } };
    writeNow();
    return merged;
  }

  return { get, getFor, set };
}
