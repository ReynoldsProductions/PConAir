import fs from 'fs';
import path from 'path';
import { scanPackagesDir, defaultStateFromSchema, type LoadedPackage } from './loader';

type NamespaceSubscriber = (state: Record<string, unknown>) => void;

interface PersistFileV1 {
  version: 1;
  states: Record<string, unknown>;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Overlay saved state onto the manifest defaults.
 *
 * Deliberately not a blind `{...base, ...saved}`: keys the manifest no longer
 * declares are dropped (so a renamed field cannot linger in the save file
 * forever) and newly declared keys pick up their default. Nested objects merge
 * recursively; arrays are replaced wholesale, since a ticker item list is a
 * value, not something to merge element-wise.
 */
function mergeSaved(base: Record<string, unknown>, saved: unknown): Record<string, unknown> {
  if (!isPlainObject(saved)) return base;
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(saved)) {
    if (!(key in base)) continue;
    out[key] = isPlainObject(base[key]) && isPlainObject(value)
      ? mergeSaved(base[key] as Record<string, unknown>, value)
      : value;
  }
  return out;
}

/**
 * Reset one dotted path back to its manifest default.
 *
 * Used for `transientFields`: things like a lower third's `visible` flag, which
 * must NOT come back after a restart. Restoring copy is the point of
 * persistence; silently putting a stale name card back on air is not.
 */
function resetPath(target: Record<string, unknown>, base: Record<string, unknown>, dotted: string): void {
  const parts = dotted.split('.');
  let t: Record<string, unknown> = target;
  let b: Record<string, unknown> = base;
  for (let i = 0; i < parts.length - 1; i++) {
    const nt = t[parts[i]];
    const nb = b[parts[i]];
    if (!isPlainObject(nt) || !isPlainObject(nb)) return;
    t = nt;
    b = nb;
  }
  const leaf = parts[parts.length - 1];
  if (leaf in b) t[leaf] = b[leaf];
}

/**
 * Package registry + per-package state with namespace pub/sub.
 * Render/control pages subscribe to `package:<id>` over the main WebSocket;
 * state mutations come from the HTTP API (and later, Companion actions).
 * Pages are stateless: they always hydrate from here on (re)connect.
 *
 * Accepts one or more roots, scanned in order (bundled packages first, then
 * the user packages dir); a later package with an already-seen id is skipped
 * with an error rather than shadowing the earlier one.
 */
export function createPackageHub(
  packagesRoot: string | string[],
  opts: { persistPath?: string } = {}
) {
  const roots = Array.isArray(packagesRoot) ? packagesRoot : [packagesRoot];
  let packages = new Map<string, LoadedPackage>();
  let scanErrors: Array<{ dir: string; error: string }> = [];
  const states = new Map<string, Record<string, unknown>>();
  const subscribers = new Map<string, Set<NamespaceSubscriber>>();
  const persistPath = opts.persistPath;

  /**
   * Package state is otherwise in-memory only, which means a crash mid-show
   * costs the operator every headline and name they typed. Saved state is
   * overlaid on the manifest defaults at scan time.
   */
  function readPersisted(): Record<string, unknown> {
    if (!persistPath) return {};
    try {
      if (!fs.existsSync(persistPath)) return {};
      const raw = JSON.parse(fs.readFileSync(persistPath, 'utf8')) as PersistFileV1;
      return raw && raw.version === 1 && isPlainObject(raw.states) ? raw.states : {};
    } catch {
      return {}; // a corrupt save must never stop the app booting
    }
  }

  let flushTimer: NodeJS.Timeout | null = null;
  function writeNow(): void {
    if (!persistPath) return;
    try {
      const payload: PersistFileV1 = { version: 1, states: Object.fromEntries(states) };
      fs.mkdirSync(path.dirname(persistPath), { recursive: true });
      fs.writeFileSync(persistPath, JSON.stringify(payload, null, 2), 'utf8');
    } catch {
      // a read-only disk should degrade to "no persistence", not crash the show
    }
  }
  function markDirty(): void {
    if (!persistPath) return;
    if (flushTimer) clearTimeout(flushTimer);
    // debounced: a Companion button held down should not hammer the disk
    flushTimer = setTimeout(() => {
      flushTimer = null;
      writeNow();
    }, 400);
  }

  function rescan(): void {
    packages = new Map();
    scanErrors = [];
    for (const root of roots) {
      const result = scanPackagesDir(root);
      scanErrors.push(...result.errors);
      for (const p of result.packages) {
        if (packages.has(p.manifest.id)) {
          scanErrors.push({ dir: p.dir, error: `duplicate package id '${p.manifest.id}' — already loaded from another root` });
          continue;
        }
        packages.set(p.manifest.id, p);
      }
    }
    const saved = readPersisted();
    for (const p of packages.values()) {
      if (!states.has(p.manifest.id)) {
        const base = {
          ...defaultStateFromSchema(p.manifest.stateSchema),
          ...(p.manifest.initialState ?? {}),
        };
        const restored = mergeSaved(base, saved[p.manifest.id]);
        // fields the manifest marks transient always come back at their default
        for (const field of p.manifest.transientFields ?? []) {
          resetPath(restored, base, field);
        }
        states.set(p.manifest.id, restored);
      }
    }
  }

  function list(): LoadedPackage[] {
    return Array.from(packages.values());
  }

  function find(id: string): LoadedPackage | null {
    return packages.get(id) ?? null;
  }

  function errors(): Array<{ dir: string; error: string }> {
    return scanErrors;
  }

  function getState(id: string): Record<string, unknown> | null {
    return states.get(id) ?? null;
  }

  /** Shallow-merge a patch into a package's state and notify subscribers. */
  function patchState(id: string, patch: Record<string, unknown>): Record<string, unknown> | null {
    const current = states.get(id);
    if (!current || !packages.has(id)) return null;
    const next = { ...current, ...patch };
    states.set(id, next);
    markDirty();
    const subs = subscribers.get(`package:${id}`);
    if (subs) {
      for (const fn of subs) fn(structuredClone(next));
    }
    return next;
  }

  /** Replace state entirely (e.g. reset). */
  function setState(id: string, state: Record<string, unknown>): Record<string, unknown> | null {
    if (!packages.has(id)) return null;
    states.set(id, state);
    markDirty();
    const subs = subscribers.get(`package:${id}`);
    if (subs) {
      for (const fn of subs) fn(structuredClone(state));
    }
    return state;
  }

  function subscribe(namespace: string, fn: NamespaceSubscriber): () => void {
    let set = subscribers.get(namespace);
    if (!set) {
      set = new Set();
      subscribers.set(namespace, set);
    }
    set.add(fn);
    return () => {
      set!.delete(fn);
    };
  }

  function subscriberCount(id: string): number {
    return subscribers.get(`package:${id}`)?.size ?? 0;
  }

  rescan();

  return { rescan, list, find, errors, getState, patchState, setState, subscribe, subscriberCount, flushState: writeNow };
}

export type PackageHub = ReturnType<typeof createPackageHub>;
