export interface FitWarning {
  field: string;
  text: string;
  naturalWidth: number;
  maxWidth: number;
}

/** Keyed by renderId. */
export type PackageWarningsState = Record<string, FitWarning[]>;

/**
 * Holds the latest text-fit overflow warnings per (packageId, renderId),
 * in memory only — never persisted, and cleared as soon as the reporting
 * render's last output disconnects (spec 22 §3.2). A warning from a browser
 * source that has gone away is noise, not a fact worth remembering across
 * a restart.
 */
export interface WarningsStore {
  /** Replaces the warning list for one render. An empty array clears it. */
  set(packageId: string, renderId: string, warnings: FitWarning[]): void;
  /** Every render's current warnings for one package. Never undefined. */
  get(packageId: string): PackageWarningsState;
  /** Removes one render's entry entirely (e.g. its last output disconnected). */
  clear(packageId: string, renderId: string): void;
}

export function createWarningsStore(): WarningsStore {
  const byPackage = new Map<string, Map<string, FitWarning[]>>();

  function set(packageId: string, renderId: string, warnings: FitWarning[]): void {
    if (warnings.length === 0) {
      clear(packageId, renderId);
      return;
    }
    let pkg = byPackage.get(packageId);
    if (!pkg) {
      pkg = new Map();
      byPackage.set(packageId, pkg);
    }
    pkg.set(renderId, warnings);
  }

  function get(packageId: string): PackageWarningsState {
    const pkg = byPackage.get(packageId);
    if (!pkg) return {};
    const out: PackageWarningsState = {};
    for (const [renderId, warnings] of pkg) {
      out[renderId] = warnings;
    }
    return out;
  }

  function clear(packageId: string, renderId: string): void {
    const pkg = byPackage.get(packageId);
    if (!pkg) return;
    pkg.delete(renderId);
    if (pkg.size === 0) byPackage.delete(packageId);
  }

  return { set, get, clear };
}
