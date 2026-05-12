import { describe, it, expect } from 'vitest';
import {
  createWatchdogState,
  checkUnresponsiveness,
  computeMemoryPressure,
  shouldWarnAboutMemory,
  buildRendererRestartPatch,
} from '../src/main/watchdog';

// ---------------------------------------------------------------------------
// createWatchdogState
// ---------------------------------------------------------------------------

describe('createWatchdogState', () => {
  it('returns null for both timestamps by default', () => {
    const s = createWatchdogState();
    expect(s.lastPongAt).toBeNull();
    expect(s.lastMemWarnAt).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// checkUnresponsiveness  (spec 09 §6.2)
// ---------------------------------------------------------------------------

describe('checkUnresponsiveness', () => {
  const now = 1_000_000;
  const TIMEOUT = 5_000;

  it('is unresponsive when lastPongAt is null (never received)', () => {
    const r = checkUnresponsiveness(null, now, TIMEOUT);
    expect(r.unresponsive).toBe(true);
    expect(r.secondsUnresponsive).toBe(-1);
  });

  it('is NOT unresponsive when last pong was recent', () => {
    const lastPong = now - 2_000; // 2 s ago — inside 5 s window
    const r = checkUnresponsiveness(lastPong, now, TIMEOUT);
    expect(r.unresponsive).toBe(false);
    expect(r.secondsUnresponsive).toBe(0);
  });

  it('is NOT unresponsive at exactly the boundary (elapsed < timeout)', () => {
    const lastPong = now - (TIMEOUT - 1); // 4999 ms ago
    const r = checkUnresponsiveness(lastPong, now, TIMEOUT);
    expect(r.unresponsive).toBe(false);
  });

  it('is unresponsive when elapsed == timeout', () => {
    const lastPong = now - TIMEOUT; // exactly 5 000 ms ago
    const r = checkUnresponsiveness(lastPong, now, TIMEOUT);
    expect(r.unresponsive).toBe(true);
    expect(r.secondsUnresponsive).toBe(5);
  });

  it('is unresponsive after 15 s with correct secondsUnresponsive', () => {
    const lastPong = now - 15_000;
    const r = checkUnresponsiveness(lastPong, now, TIMEOUT);
    expect(r.unresponsive).toBe(true);
    expect(r.secondsUnresponsive).toBe(15);
  });

  it('uses custom timeoutMs', () => {
    const lastPong = now - 3_000;
    const r2 = checkUnresponsiveness(lastPong, now, 2_000);
    expect(r2.unresponsive).toBe(true);
    const r3 = checkUnresponsiveness(lastPong, now, 4_000);
    expect(r3.unresponsive).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// computeMemoryPressure  (spec 09 §6.3)
// ---------------------------------------------------------------------------

function mem(heapUsed: number, heapTotal: number): NodeJS.MemoryUsage {
  return { heapUsed, heapTotal, rss: 0, external: 0, arrayBuffers: 0 };
}

describe('computeMemoryPressure', () => {
  it('reports no pressure at 50% heap usage', () => {
    const r = computeMemoryPressure(mem(512, 1024));
    expect(r.pressure).toBe(false);
    expect(r.pct).toBe(50);
  });

  it('reports no pressure just below 80%', () => {
    const r = computeMemoryPressure(mem(799, 1000));
    expect(r.pressure).toBe(false);
    expect(r.pct).toBe(80); // rounds to 80, but just below threshold
    // 799/1000 = 0.799, not > 0.80
    expect(r.pressure).toBe(false);
  });

  it('reports pressure at exactly 80% (not strictly above)', () => {
    // threshold is > 0.80, so 0.80 itself is NOT pressure
    const r = computeMemoryPressure(mem(800, 1000));
    expect(r.pressure).toBe(false);
  });

  it('reports pressure above 80%', () => {
    const r = computeMemoryPressure(mem(801, 1000));
    expect(r.pressure).toBe(true);
    expect(r.pct).toBe(80); // rounds to 80
  });

  it('reports pressure at 85%', () => {
    const r = computeMemoryPressure(mem(850, 1000));
    expect(r.pressure).toBe(true);
    expect(r.pct).toBe(85);
  });

  it('handles zero heapTotal gracefully', () => {
    const r = computeMemoryPressure(mem(0, 0));
    expect(r.pressure).toBe(false);
    expect(r.pct).toBe(0);
  });

  it('converts bytes to GB correctly', () => {
    const GB = 1024 ** 3;
    const r = computeMemoryPressure(mem(2 * GB, 4 * GB));
    expect(r.usedGb).toBeCloseTo(2, 1);
    expect(r.totalGb).toBeCloseTo(4, 1);
  });

  it('uses a custom threshold', () => {
    // 70% with threshold of 0.65 → pressure
    const r = computeMemoryPressure(mem(700, 1000), 0.65);
    expect(r.pressure).toBe(true);
    // 70% with threshold of 0.80 → no pressure
    const r2 = computeMemoryPressure(mem(700, 1000), 0.80);
    expect(r2.pressure).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// shouldWarnAboutMemory  (spec 09 §6.3 — 60 s throttle)
// ---------------------------------------------------------------------------

describe('shouldWarnAboutMemory', () => {
  const now = 1_000_000;
  const THROTTLE = 60_000;

  it('returns true when lastWarnedAt is null (never warned)', () => {
    expect(shouldWarnAboutMemory(null, now, THROTTLE)).toBe(true);
  });

  it('returns false when last warning was less than 60 s ago', () => {
    expect(shouldWarnAboutMemory(now - 59_999, now, THROTTLE)).toBe(false);
  });

  it('returns true when last warning was exactly 60 s ago', () => {
    expect(shouldWarnAboutMemory(now - THROTTLE, now, THROTTLE)).toBe(true);
  });

  it('returns true when last warning was more than 60 s ago', () => {
    expect(shouldWarnAboutMemory(now - 61_000, now, THROTTLE)).toBe(true);
  });

  it('respects a custom throttle', () => {
    expect(shouldWarnAboutMemory(now - 30_000, now, 30_000)).toBe(true);
    expect(shouldWarnAboutMemory(now - 29_000, now, 30_000)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// buildRendererRestartPatch  (spec 09 §6.5)
// ---------------------------------------------------------------------------

describe('buildRendererRestartPatch', () => {
  it('returns a valid ISO timestamp string', () => {
    const patch = buildRendererRestartPatch(new Date('2026-05-12T10:00:00.000Z'));
    expect(patch.lastRendererCrashAt).toBe('2026-05-12T10:00:00.000Z');
  });

  it('defaults to current time when no date argument given', () => {
    const before = Date.now();
    const patch = buildRendererRestartPatch();
    const after = Date.now();
    const ts = new Date(patch.lastRendererCrashAt!).getTime();
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });
});
