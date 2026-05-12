/**
 * Watchdog — pure, testable logic for spec 09 §6.2, §6.3, §6.5.
 *
 * Electron wiring (IPC, BrowserWindow events, setInterval) lives in
 * watchdog-electron.ts and is NOT unit-tested here.
 */

export interface WatchdogState {
  /** Monotonic timestamp (ms, from Date.now()) of last pong received. */
  lastPongAt: number | null;
  /** Monotonic timestamp of last memory-pressure warning emitted. */
  lastMemWarnAt: number | null;
}

export function createWatchdogState(): WatchdogState {
  return { lastPongAt: null, lastMemWarnAt: null };
}

// ---------------------------------------------------------------------------
// §6.2  Unresponsive-page helpers
// ---------------------------------------------------------------------------

export interface UnresponsivenessResult {
  unresponsive: boolean;
  secondsUnresponsive: number;
}

/**
 * Given the last pong timestamp (or null if never received) and the current
 * time, return whether the renderer is considered unresponsive and for how long.
 *
 * @param lastPongAt  ms timestamp of most recent pong (null = never received)
 * @param nowMs       current time in ms (Date.now())
 * @param timeoutMs   ms of silence before "unresponsive" (default 5000)
 */
export function checkUnresponsiveness(
  lastPongAt: number | null,
  nowMs: number,
  timeoutMs = 5_000
): UnresponsivenessResult {
  if (lastPongAt === null) {
    // No pong ever received — only mark unresponsive after one timeout period
    // has elapsed since "the watchdog started". Callers should set lastPongAt
    // to the startup time or first-ping time; if they pass null we treat it as
    // "never" and flag immediately.
    return { unresponsive: true, secondsUnresponsive: -1 };
  }
  const elapsed = nowMs - lastPongAt;
  if (elapsed >= timeoutMs) {
    return { unresponsive: true, secondsUnresponsive: Math.floor(elapsed / 1000) };
  }
  return { unresponsive: false, secondsUnresponsive: 0 };
}

// ---------------------------------------------------------------------------
// §6.3  Memory-pressure helpers
// ---------------------------------------------------------------------------

export interface MemoryPressureResult {
  pressure: boolean;
  pct: number;       // 0–100, integer
  usedGb: number;    // rounded to 2 dp
  totalGb: number;
}

/**
 * Compute memory-pressure status from a Node.js MemoryUsage snapshot.
 */
export function computeMemoryPressure(
  mem: NodeJS.MemoryUsage,
  threshold = 0.80
): MemoryPressureResult {
  const pct = mem.heapTotal > 0 ? mem.heapUsed / mem.heapTotal : 0;
  const GB = 1024 ** 3;
  return {
    pressure: pct > threshold,
    pct: Math.round(pct * 100),
    usedGb: Math.round((mem.heapUsed / GB) * 100) / 100,
    totalGb: Math.round((mem.heapTotal / GB) * 100) / 100,
  };
}

/**
 * Returns true if a memory-pressure warning should be emitted now.
 * Enforces a 60-second throttle between successive warnings.
 *
 * @param lastWarnedAt  ms timestamp of the last warning (null = never)
 * @param nowMs         current time in ms
 * @param throttleMs    minimum gap between warnings (default 60 000)
 */
export function shouldWarnAboutMemory(
  lastWarnedAt: number | null,
  nowMs: number,
  throttleMs = 60_000
): boolean {
  if (lastWarnedAt === null) return true;
  return nowMs - lastWarnedAt >= throttleMs;
}

// ---------------------------------------------------------------------------
// §6.5  Crash-recovery helpers
// ---------------------------------------------------------------------------

/**
 * Build the AppState `watchdog` patch to signal a renderer restart.
 */
export function buildRendererRestartPatch(crashedAt: Date = new Date()) {
  return {
    lastRendererCrashAt: crashedAt.toISOString(),
  };
}
