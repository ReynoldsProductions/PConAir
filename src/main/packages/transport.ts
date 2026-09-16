import type { PackageHub } from './state-hub';
import type { PackageRenderTransport } from './loader';

/**
 * One playback state machine, shared by every transport-managed render. See
 * specs/15-graphics-transport.md §3.1-3.4.
 *
 *                  play          play/next        stop
 *   idle --> playing-in --> holding[n] --> playing-out --> finished
 *     ^          |              |  ^            |              |
 *     +----------+--------------+--+------------+--------------+
 *                           clear (from any state)
 */
export type TransportPhase = 'idle' | 'playing-in' | 'holding' | 'playing-out' | 'finished';

export interface RenderTransportState {
  phase: TransportPhase;
  /** Which hold we are at or heading toward. 0-based. */
  step: number;
  /** Total holds, mirrored from the manifest so render pages need not fetch it. */
  stops: number;
  /** epoch ms the current phase began. */
  phaseStartedAt: number;
  /** ms the current phase is expected to last; 0 for holding without auto-advance. */
  phaseMs: number;
}

/** Keyed by render id. */
export type PackageTransportState = Record<string, RenderTransportState>;

export type TransportVerb = 'play' | 'next' | 'stop' | 'clear';

export interface TransportEngine {
  /** Apply a verb. Returns the resulting state, or null if the render is
      unknown or not transport-managed. */
  dispatch(packageId: string, renderId: string, verb: TransportVerb): RenderTransportState | null;
  /** Current state for one render, or null. Lazily seeds an idle entry the
      first time a transport-managed render is read. */
  get(packageId: string, renderId: string): RenderTransportState | null;
  /** Clear every transport-managed render in a package. Used by clear-all and by panic. */
  clearAll(packageId: string): void;
  /** Clear every transport-managed render in every loaded package — panic's job. */
  clearAllPackages(): void;
  /** Re-seed idle defaults for any transport-managed render that lacks an
      entry yet (e.g. after hub.rescan() picks up a new package/render). */
  reseed(): void;
  /** Stop timers. Called on server close. */
  dispose(): void;
}

const DEFAULT_IN_MS = 400;
const DEFAULT_OUT_MS = 400;

function inMsFor(cfg: PackageRenderTransport, step: number): number {
  const arr = cfg.inMs;
  if (!arr || arr.length === 0) return DEFAULT_IN_MS;
  return step < arr.length ? arr[step] : arr[arr.length - 1];
}

function outMsFor(cfg: PackageRenderTransport): number {
  return cfg.outMs ?? DEFAULT_OUT_MS;
}

function autoAdvanceFor(cfg: PackageRenderTransport, step: number): number {
  const arr = cfg.autoAdvanceMs;
  if (!arr) return 0;
  return step < arr.length ? arr[step] ?? 0 : 0;
}

function idleState(cfg: PackageRenderTransport, now: number): RenderTransportState {
  return { phase: 'idle', step: 0, stops: cfg.stops, phaseStartedAt: now, phaseMs: 0 };
}

export function createTransportEngine(hub: PackageHub): TransportEngine {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  function timerKey(packageId: string, renderId: string): string {
    return `${packageId}:${renderId}`;
  }

  function clearTimer(packageId: string, renderId: string): void {
    const k = timerKey(packageId, renderId);
    const t = timers.get(k);
    if (t) {
      clearTimeout(t);
      timers.delete(k);
    }
  }

  function scheduleTimer(packageId: string, renderId: string, ms: number, fn: () => void): void {
    clearTimer(packageId, renderId);
    const k = timerKey(packageId, renderId);
    const handle = setTimeout(() => {
      timers.delete(k);
      fn();
    }, ms);
    timers.set(k, handle);
  }

  function renderConfig(packageId: string, renderId: string): PackageRenderTransport | null {
    const pkg = hub.find(packageId);
    if (!pkg) return null;
    const render = pkg.manifest.renders.find((r) => r.id === renderId);
    return render?.transport ?? null;
  }

  function readMap(packageId: string): PackageTransportState {
    const state = hub.getState(packageId);
    const map = state?._transport;
    return map && typeof map === 'object' ? (map as PackageTransportState) : {};
  }

  /** Write one render's entry back into the package's namespace state. */
  function writeEntry(packageId: string, renderId: string, entry: RenderTransportState): void {
    const map = { ...readMap(packageId), [renderId]: entry };
    hub.patchState(packageId, { _transport: map });
  }

  function beginPlayingIn(packageId: string, renderId: string, cfg: PackageRenderTransport, step: number): RenderTransportState {
    const ms = inMsFor(cfg, step);
    const next: RenderTransportState = { phase: 'playing-in', step, stops: cfg.stops, phaseStartedAt: Date.now(), phaseMs: ms };
    writeEntry(packageId, renderId, next);
    scheduleTimer(packageId, renderId, ms, () => enterHolding(packageId, renderId, cfg, step));
    return next;
  }

  function enterHolding(packageId: string, renderId: string, cfg: PackageRenderTransport, step: number): void {
    const auto = autoAdvanceFor(cfg, step);
    const next: RenderTransportState = { phase: 'holding', step, stops: cfg.stops, phaseStartedAt: Date.now(), phaseMs: auto };
    writeEntry(packageId, renderId, next);
    if (auto > 0) {
      scheduleTimer(packageId, renderId, auto, () => advanceFromHolding(packageId, renderId, cfg, step));
    }
  }

  function advanceFromHolding(packageId: string, renderId: string, cfg: PackageRenderTransport, step: number): void {
    if (step >= cfg.stops - 1) {
      beginPlayingOut(packageId, renderId, cfg, step);
    } else {
      beginPlayingIn(packageId, renderId, cfg, step + 1);
    }
  }

  function beginPlayingOut(packageId: string, renderId: string, cfg: PackageRenderTransport, step: number): RenderTransportState {
    const ms = outMsFor(cfg);
    const next: RenderTransportState = { phase: 'playing-out', step, stops: cfg.stops, phaseStartedAt: Date.now(), phaseMs: ms };
    writeEntry(packageId, renderId, next);
    scheduleTimer(packageId, renderId, ms, () => enterFinished(packageId, renderId, cfg, step));
    return next;
  }

  function enterFinished(packageId: string, renderId: string, cfg: PackageRenderTransport, step: number): void {
    const next: RenderTransportState = { phase: 'finished', step, stops: cfg.stops, phaseStartedAt: Date.now(), phaseMs: 0 };
    writeEntry(packageId, renderId, next);
  }

  function get(packageId: string, renderId: string): RenderTransportState | null {
    const cfg = renderConfig(packageId, renderId);
    if (!cfg) return null;
    const existing = readMap(packageId)[renderId];
    if (existing) return existing;
    const seeded = idleState(cfg, Date.now());
    writeEntry(packageId, renderId, seeded);
    return seeded;
  }

  function dispatch(packageId: string, renderId: string, verb: TransportVerb): RenderTransportState | null {
    const cfg = renderConfig(packageId, renderId);
    if (!cfg) return null;
    const current = readMap(packageId)[renderId] ?? idleState(cfg, Date.now());

    if (verb === 'clear') {
      clearTimer(packageId, renderId);
      const next = idleState(cfg, Date.now());
      writeEntry(packageId, renderId, next);
      return next;
    }

    if (verb === 'stop') {
      if (current.phase === 'idle' || current.phase === 'finished') return current;
      clearTimer(packageId, renderId);
      return beginPlayingOut(packageId, renderId, cfg, current.step);
    }

    // play / next
    if (current.phase === 'idle' || current.phase === 'finished') {
      clearTimer(packageId, renderId);
      return beginPlayingIn(packageId, renderId, cfg, 0);
    }
    if (current.phase === 'holding') {
      const isLast = current.step >= cfg.stops - 1;
      clearTimer(packageId, renderId);
      if (isLast) {
        // From the last hold, play/next both behave as stop — there is
        // nowhere further to advance to.
        return beginPlayingOut(packageId, renderId, cfg, current.step);
      }
      return beginPlayingIn(packageId, renderId, cfg, current.step + 1);
    }
    // playing-in / playing-out: a transition is already in flight. play/next
    // have no defined effect here — leave the pending timer alone and report
    // the current state unchanged.
    return current;
  }

  function clearAll(packageId: string): void {
    const pkg = hub.find(packageId);
    if (!pkg) return;
    const map = { ...readMap(packageId) };
    let changed = false;
    for (const r of pkg.manifest.renders) {
      if (!r.transport) continue;
      clearTimer(packageId, r.id);
      map[r.id] = idleState(r.transport, Date.now());
      changed = true;
    }
    if (changed) hub.patchState(packageId, { _transport: map });
  }

  function clearAllPackages(): void {
    for (const pkg of hub.list()) clearAll(pkg.manifest.id);
  }

  function reseed(): void {
    for (const pkg of hub.list()) {
      for (const r of pkg.manifest.renders) {
        if (r.transport) get(pkg.manifest.id, r.id);
      }
    }
  }

  function dispose(): void {
    for (const t of timers.values()) clearTimeout(t);
    timers.clear();
  }

  // Seed idle defaults for every transport-managed render up front, so a
  // render page's very first namespace snapshot already carries `_transport`
  // rather than waiting for the first dispatched verb.
  reseed();

  return { dispatch, get, clearAll, clearAllPackages, reseed, dispose };
}
