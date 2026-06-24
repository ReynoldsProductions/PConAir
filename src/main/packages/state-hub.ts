import { scanPackagesDir, defaultStateFromSchema, type LoadedPackage } from './loader';

type NamespaceSubscriber = (state: Record<string, unknown>) => void;

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
export function createPackageHub(packagesRoot: string | string[]) {
  const roots = Array.isArray(packagesRoot) ? packagesRoot : [packagesRoot];
  let packages = new Map<string, LoadedPackage>();
  let scanErrors: Array<{ dir: string; error: string }> = [];
  const states = new Map<string, Record<string, unknown>>();
  const subscribers = new Map<string, Set<NamespaceSubscriber>>();

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
    for (const p of packages.values()) {
      if (!states.has(p.manifest.id)) {
        states.set(p.manifest.id, {
          ...defaultStateFromSchema(p.manifest.stateSchema),
          ...(p.manifest.initialState ?? {}),
        });
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

  return { rescan, list, find, errors, getState, patchState, setState, subscribe, subscriberCount };
}

export type PackageHub = ReturnType<typeof createPackageHub>;
