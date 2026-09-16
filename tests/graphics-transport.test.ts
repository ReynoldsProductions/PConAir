import { describe, it, expect } from 'vitest';
import { validateManifest } from '../src/main/packages/loader';

function baseManifest(overrides: Record<string, unknown> = {}) {
  return {
    id: 'txp',
    name: 'Transport Test',
    version: '1.0.0',
    renders: [{ id: 'r', label: 'R', file: 'r.html', ...overrides }],
  };
}

describe('T1 — transport manifest schema', () => {
  it('validates a render declaring transport: {stops: 3}', () => {
    const res = validateManifest(baseManifest({ transport: { stops: 3 } }));
    expect(res.ok).toBe(true);
  });

  it('rejects stops: 0', () => {
    const res = validateManifest(baseManifest({ transport: { stops: 0 } }));
    expect(res.ok).toBe(false);
  });

  it('rejects stops: 17 (over the 16 cap)', () => {
    const res = validateManifest(baseManifest({ transport: { stops: 17 } }));
    expect(res.ok).toBe(false);
  });

  it('rejects stops: 1.5 (not an integer)', () => {
    const res = validateManifest(baseManifest({ transport: { stops: 1.5 } }));
    expect(res.ok).toBe(false);
  });

  it('rejects inMs: [-1] (negative)', () => {
    const res = validateManifest(baseManifest({ transport: { stops: 2, inMs: [-1] } }));
    expect(res.ok).toBe(false);
  });

  it('produces distinct error messages for each failure', () => {
    const stopsZero = validateManifest(baseManifest({ transport: { stops: 0 } }));
    const stopsTooMany = validateManifest(baseManifest({ transport: { stops: 17 } }));
    const stopsFraction = validateManifest(baseManifest({ transport: { stops: 1.5 } }));
    const badInMs = validateManifest(baseManifest({ transport: { stops: 2, inMs: [-1] } }));
    const messages = [stopsZero, stopsTooMany, stopsFraction, badInMs].map((r) =>
      r.ok ? '' : r.error
    );
    // every message is non-empty and the inMs failure reads differently from the stops failures
    expect(messages.every((m) => m.length > 0)).toBe(true);
    expect(messages[3]).not.toBe(messages[0]);
  });

  it('a render with no transport key still validates (untouched behaviour)', () => {
    const res = validateManifest(baseManifest());
    expect(res.ok).toBe(true);
  });

  it('rejects inMs longer than stops', () => {
    const res = validateManifest(baseManifest({ transport: { stops: 1, inMs: [100, 200] } }));
    expect(res.ok).toBe(false);
  });

  it('rejects outMs that is negative or non-integer', () => {
    expect(validateManifest(baseManifest({ transport: { stops: 1, outMs: -5 } })).ok).toBe(false);
    expect(validateManifest(baseManifest({ transport: { stops: 1, outMs: 3.2 } })).ok).toBe(false);
    expect(validateManifest(baseManifest({ transport: { stops: 1, outMs: 400 } })).ok).toBe(true);
  });

  it('rejects autoAdvanceMs longer than stops or with negative entries', () => {
    expect(validateManifest(baseManifest({ transport: { stops: 1, autoAdvanceMs: [100, 200] } })).ok).toBe(false);
    expect(validateManifest(baseManifest({ transport: { stops: 2, autoAdvanceMs: [-1, 0] } })).ok).toBe(false);
    expect(validateManifest(baseManifest({ transport: { stops: 2, autoAdvanceMs: [1500, 0] } })).ok).toBe(true);
  });
});
