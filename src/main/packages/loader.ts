import fs from 'fs';
import path from 'path';

/**
 * A URL preset a render asks the app to keep. Use it for renders that are a
 * whole scene someone would launch by name; layers meant only to be stacked as
 * browser sources should leave it off. See packages/render-presets.ts.
 */
export interface PackageRenderPreset {
  /** Defaults to "<package name> — <render label>". */
  name?: string;
  description?: string;
}

/**
 * Declares a render as transport-managed: it has a playback state machine
 * (idle -> playing-in -> holding[n] -> playing-out -> finished) driven by the
 * server, rather than a single `visible` boolean. See
 * specs/15-graphics-transport.md.
 */
export interface PackageRenderTransport {
  /** Number of hold points. 1 = classic in/hold/out. Max 16. */
  stops: number;
  /** Milliseconds of intro per segment. Segment i is durations[i], last repeats. */
  inMs?: number[];
  /** Milliseconds of outro. Default 400. */
  outMs?: number;
  /** Auto-advance a hold after N ms. 0 or absent = hold until told. */
  autoAdvanceMs?: number[];
}

/** One render page declared by a package. */
export interface PackageRenderDecl {
  id: string;
  label: string;
  file: string;
  preset?: PackageRenderPreset;
  transport?: PackageRenderTransport;
}

/** Leaf types allowed in a package stateSchema. */
export type PackageSchemaLeaf = 'number' | 'string' | 'boolean';
export type PackageSchema = { [key: string]: PackageSchemaLeaf | PackageSchema | unknown[] };

// ── Declarative Companion interface (consumed by companion-module-pconair) ──
//
// Packages declare their Companion actions/feedbacks/variables in package.json.
// The Companion module loads these via GET /api/packages and registers them
// dynamically. Field paths are dot-separated ("playerCard.visible", "scores.0")
// and may contain "{optionId}" placeholders substituted from action options.
// Values are literals, { "option": id } (with optional "orState" fallback path
// and "split" delimiter), or { "state": path }.

export type PkgValueRef =
  | string
  | number
  | boolean
  | null
  | PkgValueRef[]
  | { option: string; orState?: string; split?: string }
  | { state: string }
  | { [key: string]: unknown };

export interface PkgCompanionOption {
  id: string;
  label: string;
  type: 'number' | 'textinput' | 'dropdown' | 'checkbox';
  default?: string | number | boolean;
  min?: number;
  max?: number;
  choices?: Array<{ id: string | number; label: string }>;
}

export type PkgCompanionOp =
  | { op: 'set'; field: string; value: PkgValueRef }
  | { op: 'add'; field: string; value: PkgValueRef; min?: number; max?: number }
  | { op: 'toggle'; field: string }
  // Countdown helpers (deadline epoch-ms pattern used by hoops/ffg):
  // start: deadlineField = now + remaining(valueField); stop: valueField =
  // remaining, deadlineField = 0; reset: valueField = value (+ restart if running).
  | {
      op: 'countdown_start' | 'countdown_stop' | 'countdown_reset';
      deadlineField: string;
      valueField: string;
      format: 'mm:ss' | 'seconds';
      runningField?: string;
      value?: PkgValueRef;
      defaultValue?: number;
    };

export interface PkgCompanionAction {
  id: string;
  label: string;
  description?: string;
  options?: PkgCompanionOption[];
  ops: PkgCompanionOp[];
}

export interface PkgCompanionFeedback {
  id: string;
  label: string;
  field: string;
  /** Active when value === equals; { option } adds a comparison option input. */
  equals?: PkgValueRef;
  /** Active when value !== notEquals (e.g. winner set: notEquals null). */
  notEquals?: PkgValueRef;
  options?: PkgCompanionOption[];
  defaultStyle?: { bgcolor?: [number, number, number]; color?: [number, number, number] };
}

export interface PkgCompanionVariable {
  id: string;
  label: string;
  field?: string;
  /** Live countdown display computed from deadline/value fields. */
  countdown?: { deadlineField: string; valueField: string; runningField?: string; format: 'mm:ss' | 'seconds' };
}

/** Derived fields computed by the Companion module before variables/feedbacks. */
export type PkgCompanionDerived =
  | { field: string; fn: 'argmax'; source: string }
  | { field: string; fn: 'lookup'; source: string; index: string; path: string };

export interface PackageManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  renders: PackageRenderDecl[];
  stateSchema?: PackageSchema;
  /** Optional initial state — wins over schema-derived defaults. */
  initialState?: Record<string, unknown>;
  /**
   * Dotted state paths that must NOT be restored from persisted state — they
   * always come back at their manifest default. Use for on-air flags: restoring
   * a lower third's `visible` after a crash would silently put a stale name
   * card back on screen.
   */
  transientFields?: string[];
  companionActions?: PkgCompanionAction[];
  companionFeedbacks?: PkgCompanionFeedback[];
  companionVariables?: PkgCompanionVariable[];
  companionDerived?: PkgCompanionDerived[];
}

export interface LoadedPackage {
  manifest: PackageManifest;
  /** Absolute directory the package was loaded from. */
  dir: string;
  controlFile: string | null;
}

const ID_PATTERN = /^[a-z0-9][a-z0-9-_]*$/;

export function validateManifest(raw: unknown): { ok: true; manifest: PackageManifest } | { ok: false; error: string } {
  if (typeof raw !== 'object' || raw === null) return { ok: false, error: 'manifest is not an object' };
  const m = raw as Record<string, unknown>;
  if (typeof m.id !== 'string' || !ID_PATTERN.test(m.id)) {
    return { ok: false, error: 'id must be lowercase alphanumeric (with - or _)' };
  }
  if (typeof m.name !== 'string' || m.name.length === 0) return { ok: false, error: 'name is required' };
  if (typeof m.version !== 'string') return { ok: false, error: 'version is required' };
  if (!Array.isArray(m.renders) || m.renders.length === 0) {
    return { ok: false, error: 'renders must be a non-empty array' };
  }
  for (const r of m.renders) {
    const rr = r as Record<string, unknown>;
    if (typeof rr.id !== 'string' || !ID_PATTERN.test(rr.id) || typeof rr.file !== 'string') {
      return { ok: false, error: 'each render needs an id (lowercase) and a file' };
    }
    if (rr.file.includes('..') || path.isAbsolute(String(rr.file))) {
      return { ok: false, error: `render file path '${rr.file}' must be relative to the package` };
    }
    if (rr.preset !== undefined) {
      const preset = rr.preset as Record<string, unknown>;
      if (typeof preset !== 'object' || preset === null || Array.isArray(preset)) {
        return { ok: false, error: `render '${rr.id}' preset must be an object` };
      }
      for (const key of ['name', 'description'] as const) {
        if (preset[key] !== undefined && typeof preset[key] !== 'string') {
          return { ok: false, error: `render '${rr.id}' preset ${key} must be a string` };
        }
      }
    }
    if (rr.transport !== undefined) {
      const t = rr.transport as Record<string, unknown>;
      if (typeof t !== 'object' || t === null || Array.isArray(t)) {
        return { ok: false, error: `render '${rr.id}' transport must be an object` };
      }
      if (typeof t.stops !== 'number' || !Number.isInteger(t.stops) || t.stops < 1 || t.stops > 16) {
        return { ok: false, error: `render '${rr.id}' transport.stops must be an integer between 1 and 16` };
      }
      const stops = t.stops;
      const isNonNegIntArray = (v: unknown): v is number[] =>
        Array.isArray(v) && v.every((n) => typeof n === 'number' && Number.isInteger(n) && n >= 0);
      if (t.inMs !== undefined) {
        if (!isNonNegIntArray(t.inMs) || t.inMs.length > stops) {
          return {
            ok: false,
            error: `render '${rr.id}' transport.inMs must be an array of up to ${stops} non-negative integers`,
          };
        }
      }
      if (t.outMs !== undefined) {
        if (typeof t.outMs !== 'number' || !Number.isInteger(t.outMs) || t.outMs < 0) {
          return { ok: false, error: `render '${rr.id}' transport.outMs must be a non-negative integer` };
        }
      }
      if (t.autoAdvanceMs !== undefined) {
        if (!isNonNegIntArray(t.autoAdvanceMs) || t.autoAdvanceMs.length > stops) {
          return {
            ok: false,
            error: `render '${rr.id}' transport.autoAdvanceMs must be an array of up to ${stops} non-negative integers`,
          };
        }
      }
    }
  }
  if (m.stateSchema !== undefined) {
    if (typeof m.stateSchema !== 'object' || m.stateSchema === null || Array.isArray(m.stateSchema)) {
      return { ok: false, error: 'stateSchema must be an object' };
    }
    for (const key of Object.keys(m.stateSchema as Record<string, unknown>)) {
      if (key.startsWith('_')) {
        return {
          ok: false,
          error: `stateSchema key '${key}' is reserved — leading-underscore keys belong to the engine (_transport, _data, _meta)`,
        };
      }
    }
  }
  if (m.transientFields !== undefined) {
    if (!Array.isArray(m.transientFields) || m.transientFields.some((f) => typeof f !== 'string' || f.length === 0)) {
      return { ok: false, error: 'transientFields must be an array of non-empty dotted state paths' };
    }
  }
  return { ok: true, manifest: raw as PackageManifest };
}

/** Derive an initial state object from a stateSchema (number→0, string→'', boolean→false). */
export function defaultStateFromSchema(schema: PackageSchema | undefined): Record<string, unknown> {
  if (!schema) return {};
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(schema)) {
    if (val === 'number') out[key] = 0;
    else if (val === 'string') out[key] = '';
    else if (val === 'boolean') out[key] = false;
    else if (Array.isArray(val)) out[key] = val;
    else if (typeof val === 'object' && val !== null) out[key] = defaultStateFromSchema(val as PackageSchema);
    else out[key] = null;
  }
  return out;
}

/** Scan a packages directory. Invalid packages are skipped with a reason. */
export function scanPackagesDir(packagesRoot: string): { packages: LoadedPackage[]; errors: Array<{ dir: string; error: string }> } {
  const packages: LoadedPackage[] = [];
  const errors: Array<{ dir: string; error: string }> = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(packagesRoot, { withFileTypes: true });
  } catch {
    return { packages, errors }; // missing dir = no packages
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(packagesRoot, entry.name);
    const manifestPath = path.join(dir, 'package.json');
    let raw: unknown;
    try {
      raw = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    } catch (err) {
      errors.push({ dir: entry.name, error: `package.json unreadable: ${(err as Error).message}` });
      continue;
    }
    const v = validateManifest(raw);
    if (!v.ok) {
      errors.push({ dir: entry.name, error: v.error });
      continue;
    }
    for (const r of v.manifest.renders) {
      if (!fs.existsSync(path.join(dir, r.file))) {
        errors.push({ dir: entry.name, error: `render file missing: ${r.file}` });
      }
    }
    const controlFile = fs.existsSync(path.join(dir, 'control.html')) ? 'control.html' : null;
    packages.push({ manifest: v.manifest, dir, controlFile });
  }
  return { packages, errors };
}
