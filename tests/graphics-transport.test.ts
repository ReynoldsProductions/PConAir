import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { validateManifest } from '../src/main/packages/loader';
import { createPackageHub } from '../src/main/packages/state-hub';
import { createTransportEngine } from '../src/main/packages/transport';

function baseManifest(overrides: Record<string, unknown> = {}) {
  return {
    id: 'txp',
    name: 'Transport Test',
    version: '1.0.0',
    renders: [{ id: 'r', label: 'R', file: 'r.html', ...overrides }],
  };
}

describe('T2 — underscore-prefixed stateSchema keys are reserved', () => {
  it('rejects a stateSchema with a leading-underscore top-level key', () => {
    const res = validateManifest({
      id: 'txp',
      name: 'Transport Test',
      version: '1.0.0',
      renders: [{ id: 'r', label: 'R', file: 'r.html' }],
      stateSchema: { _transport: 'string' },
    });
    expect(res.ok).toBe(false);
  });

  it('rejects a stateSchema colliding with _data too', () => {
    const res = validateManifest({
      id: 'txp',
      name: 'Transport Test',
      version: '1.0.0',
      renders: [{ id: 'r', label: 'R', file: 'r.html' }],
      stateSchema: { _data: {} },
    });
    expect(res.ok).toBe(false);
  });

  it('still passes for an ordinary top-level key', () => {
    const res = validateManifest({
      id: 'txp',
      name: 'Transport Test',
      version: '1.0.0',
      renders: [{ id: 'r', label: 'R', file: 'r.html' }],
      stateSchema: { scoreA: 'number' },
    });
    expect(res.ok).toBe(true);
  });
});


function writeTransportFixture(root: string, opts: { id?: string; stops?: number; inMs?: number[]; outMs?: number; autoAdvanceMs?: number[] } = {}): string {
  const id = opts.id ?? 'txp';
  const dir = path.join(root, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({
      id,
      name: 'Transport Fixture',
      version: '1.0.0',
      renders: [
        {
          id: 'card',
          label: 'Card',
          file: 'render.html',
          transport: {
            stops: opts.stops ?? 2,
            ...(opts.inMs ? { inMs: opts.inMs } : {}),
            ...(opts.outMs !== undefined ? { outMs: opts.outMs } : {}),
            ...(opts.autoAdvanceMs ? { autoAdvanceMs: opts.autoAdvanceMs } : {}),
          },
        },
        { id: 'plain', label: 'Plain', file: 'render.html' },
      ],
      stateSchema: { title: 'string' },
    })
  );
  fs.writeFileSync(path.join(dir, 'render.html'), '<html></html>');
  return dir;
}

function makeEngine(opts: Parameters<typeof writeTransportFixture>[1] = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pconair-transport-'));
  writeTransportFixture(root, opts);
  const hub = createPackageHub(root);
  const engine = createTransportEngine(hub);
  return { root, hub, engine };
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

describe('T3 — engine: play from idle', () => {
  it('play on a stops:2 render moves to playing-in step 0 with phaseMs = inMs[0], then to holding after the timer fires', () => {
    vi.useFakeTimers();
    try {
      const { engine, root } = makeEngine({ stops: 2, inMs: [500, 350] });
      const first = engine.dispatch('txp', 'card', 'play');
      expect(first).toMatchObject({ phase: 'playing-in', step: 0, stops: 2, phaseMs: 500 });

      vi.advanceTimersByTime(500);
      const after = engine.get('txp', 'card');
      expect(after?.phase).toBe('holding');
      expect(after?.step).toBe(0);
      fs.rmSync(root, { recursive: true, force: true });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('T4 — engine: advance and wrap', () => {
  it('next from holding step 0 advances to playing-in step 1 then holding step 1', () => {
    vi.useFakeTimers();
    try {
      const { engine, root } = makeEngine({ stops: 2, inMs: [500, 350] });
      engine.dispatch('txp', 'card', 'play');
      vi.advanceTimersByTime(500); // now holding[0]

      const advancing = engine.dispatch('txp', 'card', 'next');
      expect(advancing).toMatchObject({ phase: 'playing-in', step: 1, phaseMs: 350 });

      vi.advanceTimersByTime(350);
      const held = engine.get('txp', 'card');
      expect(held).toMatchObject({ phase: 'holding', step: 1 });
      fs.rmSync(root, { recursive: true, force: true });
    } finally {
      vi.useRealTimers();
    }
  });

  it('play from the last hold behaves as stop', () => {
    vi.useFakeTimers();
    try {
      const { engine, root } = makeEngine({ stops: 2, inMs: [500, 350], outMs: 400 });
      engine.dispatch('txp', 'card', 'play');
      vi.advanceTimersByTime(500); // holding[0]
      engine.dispatch('txp', 'card', 'next');
      vi.advanceTimersByTime(350); // holding[1] — the last hold

      const stopped = engine.dispatch('txp', 'card', 'play');
      expect(stopped).toMatchObject({ phase: 'playing-out', phaseMs: 400 });

      vi.advanceTimersByTime(400);
      expect(engine.get('txp', 'card')).toMatchObject({ phase: 'finished' });
      fs.rmSync(root, { recursive: true, force: true });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('T5 — engine: stop and clear', () => {
  it('stop moves to playing-out then finished after outMs', () => {
    vi.useFakeTimers();
    try {
      const { engine, root } = makeEngine({ stops: 2, inMs: [500, 350], outMs: 250 });
      engine.dispatch('txp', 'card', 'play');
      vi.advanceTimersByTime(500); // holding[0]

      const stopped = engine.dispatch('txp', 'card', 'stop');
      expect(stopped).toMatchObject({ phase: 'playing-out', phaseMs: 250 });

      vi.advanceTimersByTime(250);
      expect(engine.get('txp', 'card')).toMatchObject({ phase: 'finished' });
      fs.rmSync(root, { recursive: true, force: true });
    } finally {
      vi.useRealTimers();
    }
  });

  it('clear from playing-in returns idle synchronously and cancels the pending timer', () => {
    vi.useFakeTimers();
    try {
      const { engine, root } = makeEngine({ stops: 2, inMs: [500, 350] });
      engine.dispatch('txp', 'card', 'play'); // playing-in[0]

      const cleared = engine.dispatch('txp', 'card', 'clear');
      expect(cleared).toMatchObject({ phase: 'idle' });

      // advancing the clock must NOT resurrect the cancelled playing-in -> holding timer
      vi.advanceTimersByTime(10_000);
      expect(engine.get('txp', 'card')).toMatchObject({ phase: 'idle' });
      fs.rmSync(root, { recursive: true, force: true });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('T6 — auto-advance', () => {
  it('holding step 0 advances itself after autoAdvanceMs[0]; holding step 1 does not advance', () => {
    vi.useFakeTimers();
    try {
      const { engine, root } = makeEngine({ stops: 2, inMs: [100, 100], autoAdvanceMs: [1500, 0] });
      engine.dispatch('txp', 'card', 'play');
      vi.advanceTimersByTime(100); // holding[0]
      expect(engine.get('txp', 'card')).toMatchObject({ phase: 'holding', step: 0 });

      vi.advanceTimersByTime(1500); // auto-advance fires
      expect(engine.get('txp', 'card')).toMatchObject({ phase: 'playing-in', step: 1 });

      vi.advanceTimersByTime(100); // in-transition completes
      expect(engine.get('txp', 'card')).toMatchObject({ phase: 'holding', step: 1 });

      // step 1's autoAdvanceMs is 0 — it must sit there, not auto-advance further
      vi.advanceTimersByTime(10_000);
      expect(engine.get('txp', 'card')).toMatchObject({ phase: 'holding', step: 1 });
      fs.rmSync(root, { recursive: true, force: true });
    } finally {
      vi.useRealTimers();
    }
  });
});
