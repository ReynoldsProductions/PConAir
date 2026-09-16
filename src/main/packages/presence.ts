import type { PresenceEntry, PackagePresence } from '../../shared/types';

export type { PresenceEntry, PackagePresence };

/**
 * Tracks which render/control pages are actually connected to a package's
 * WebSocket namespace — "is anything actually listening" as a first-class,
 * per-render fact (spec 16 §1). Keyed by `symbol` rather than by socket so
 * this module never imports `ws` and is trivially unit-testable.
 *
 * A control page (`?control=1`) never counts as an output: it always
 * increments `controls`, never `renders`/`byRender`. Only a render page
 * (`?render=1`) counts as delivery.
 */
export interface PresenceRegistry {
  add(id: symbol, entry: PresenceEntry): void;
  remove(id: symbol): void;
  /** Presence for one package. Always returns a value, zeroed if unknown. */
  forPackage(packageId: string): PackagePresence;
  /** Every entry, sorted by connectedAt ascending, for the diagnostics endpoint. */
  all(): PresenceEntry[];
  /** Fires whenever any count changes. Returns an unsubscribe. */
  onChange(fn: () => void): () => void;
}

export function createPresenceRegistry(): PresenceRegistry {
  const entries = new Map<symbol, PresenceEntry>();
  const listeners = new Set<() => void>();

  function notify(): void {
    for (const fn of listeners) {
      try {
        fn();
      } catch {
        /* a bad listener must not stop the rest, or corrupt future notifications */
      }
    }
  }

  function add(id: symbol, entry: PresenceEntry): void {
    entries.set(id, entry);
    notify();
  }

  function remove(id: symbol): void {
    if (!entries.delete(id)) return;
    notify();
  }

  function forPackage(packageId: string): PackagePresence {
    let renders = 0;
    let controls = 0;
    const byRender: Record<string, number> = {};
    for (const entry of entries.values()) {
      if (entry.packageId !== packageId) continue;
      if (entry.role === 'control') {
        controls += 1;
        continue;
      }
      renders += 1;
      if (entry.renderId) {
        byRender[entry.renderId] = (byRender[entry.renderId] ?? 0) + 1;
      }
    }
    return { renders, byRender, controls };
  }

  function all(): PresenceEntry[] {
    return Array.from(entries.values()).sort((a, b) => a.connectedAt - b.connectedAt);
  }

  function onChange(fn: () => void): () => void {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }

  return { add, remove, forPackage, all, onChange };
}
