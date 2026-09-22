import { describe, it, expect, beforeEach } from 'vitest';
import { createStateStore } from '../src/main/state';
import type { StateStore } from '../src/main/state';
import { createDocWatcher } from '../src/main/prompter/doc-watcher';
import type { DocFetcher } from '../src/main/prompter/doc-watcher';
import type { DocFetchResult } from '../src/main/prompter/doc-source';

/** Fully injected fake clock — no real wall time, no vi.useFakeTimers(). */
function makeFakeClock(start = 0) {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

/**
 * Fake for `setIntervalFn`/`clearIntervalFn`. Captures the handler the
 * watcher installs and lets the test fire it deterministically, awaiting
 * whatever promise the (possibly async) handler returns.
 */
function makeFakeTimer() {
  let handler: (() => void | Promise<void>) | null = null;
  let handle: symbol | null = null;
  let clearCount = 0;

  const setIntervalFn = (fn: () => void | Promise<void>, _ms: number): unknown => {
    handler = fn;
    handle = Symbol('interval');
    return handle;
  };

  const clearIntervalFn = (h: unknown): void => {
    clearCount += 1;
    if (h === handle) {
      handler = null;
      handle = null;
    }
  };

  return {
    setIntervalFn,
    clearIntervalFn,
    /** Fire the installed tick handler once and wait for it to settle. */
    fire: async (): Promise<void> => {
      if (handler) await handler();
    },
    get isCleared(): boolean {
      return handle === null;
    },
    get clearCount(): number {
      return clearCount;
    },
  };
}

const OK = (text: string, hash: string, words: number): DocFetchResult => ({ ok: true, text, hash, words });

describe('createDocWatcher', () => {
  let store: StateStore;
  let clock: ReturnType<typeof makeFakeClock>;
  let timer: ReturnType<typeof makeFakeTimer>;

  beforeEach(() => {
    store = createStateStore();
    clock = makeFakeClock(1_000_000);
    timer = makeFakeTimer();
  });

  function setDocId(docId: string): void {
    const s = store.getState();
    store.setState({ prompter: { ...s.prompter, doc: { ...s.prompter.doc, docId, url: `https://docs.google.com/document/d/${docId}/edit` } } });
  }

  function makeWatcher(fetchDoc: DocFetcher) {
    return createDocWatcher({
      store,
      fetchDoc,
      now: clock.now,
      setIntervalFn: timer.setIntervalFn,
      clearIntervalFn: timer.clearIntervalFn,
    });
  }

  it('is idle (no fetch, no state change) when no docId is configured', async () => {
    let calls = 0;
    const fetchDoc: DocFetcher = async () => {
      calls += 1;
      return OK('hello', 'hash-1', 1);
    };
    const watcher = makeWatcher(fetchDoc);

    await timer.fire();

    expect(calls).toBe(0);
    expect(store.getState().prompter.doc.status).toBe('idle');
    watcher.stop();
  });

  it('picks up a docId configured after the watcher starts, on the next tick', async () => {
    let calls = 0;
    const fetchDoc: DocFetcher = async () => {
      calls += 1;
      return OK('hello world', 'hash-1', 2);
    };
    const watcher = makeWatcher(fetchDoc);

    await timer.fire(); // still idle, no docId yet
    expect(calls).toBe(0);

    setDocId('doc-abc');
    await timer.fire();

    expect(calls).toBe(1);
    expect(store.getState().prompter.doc.staged?.hash).toBe('hash-1');
    watcher.stop();
  });

  it('stages on first difference from loadedHash', async () => {
    setDocId('doc-abc');
    const fetchDoc: DocFetcher = async () => OK('new text', 'hash-new', 2);
    const watcher = makeWatcher(fetchDoc);

    await timer.fire();

    const doc = store.getState().prompter.doc;
    expect(doc.status).toBe('ready');
    expect(doc.staged).toEqual({ text: 'new text', hash: 'hash-new', words: 2, fetchedAt: clock.now() });
    expect(doc.error).toBeNull();
    expect(doc.lastCheckedAt).toBe(clock.now());
    // Safety invariant: fetching never mutates loadedHash directly.
    expect(doc.loadedHash).toBe('');
    watcher.stop();
  });

  it('does not re-stage when the fetched hash matches loadedHash', async () => {
    setDocId('doc-abc');
    const s = store.getState();
    store.setState({ prompter: { ...s.prompter, doc: { ...s.prompter.doc, loadedHash: 'hash-current' } } });

    const fetchDoc: DocFetcher = async () => OK('current text', 'hash-current', 2);
    const watcher = makeWatcher(fetchDoc);

    await timer.fire();

    const doc = store.getState().prompter.doc;
    expect(doc.staged).toBeNull();
    expect(doc.status).toBe('idle'); // untouched
    expect(doc.lastCheckedAt).toBe(clock.now());
    watcher.stop();
  });

  it('does not re-stage content matching an already-staged hash', async () => {
    setDocId('doc-abc');
    const fetchDoc: DocFetcher = async () => OK('draft text', 'hash-draft', 2);
    const watcher = makeWatcher(fetchDoc);

    await timer.fire();
    const firstStaged = store.getState().prompter.doc.staged;
    expect(firstStaged?.hash).toBe('hash-draft');

    clock.advance(60_000);
    await timer.fire(); // same hash again

    const doc = store.getState().prompter.doc;
    // staged object identity/content unchanged beyond lastCheckedAt bookkeeping
    expect(doc.staged?.hash).toBe('hash-draft');
    expect(doc.staged?.fetchedAt).toBe(firstStaged?.fetchedAt); // not re-fetched/re-staged
    expect(doc.lastCheckedAt).toBe(clock.now());
    watcher.stop();
  });

  it('updates lastCheckedAt only on identical content, no other churn', async () => {
    setDocId('doc-abc');
    const s = store.getState();
    store.setState({ prompter: { ...s.prompter, doc: { ...s.prompter.doc, loadedHash: 'hash-same', status: 'idle' } } });

    const fetchDoc: DocFetcher = async () => OK('same text', 'hash-same', 2);
    const watcher = makeWatcher(fetchDoc);

    const before = store.getState().prompter.doc;
    await timer.fire();
    const after = store.getState().prompter.doc;

    expect(after.lastCheckedAt).toBe(clock.now());
    expect(after.status).toBe(before.status);
    expect(after.error).toBe(before.error);
    expect(after.staged).toBe(before.staged);
    expect(after.loadedHash).toBe(before.loadedHash);
    watcher.stop();
  });

  it('sets status error with the fetch error code/message on failure', async () => {
    setDocId('doc-abc');
    const fetchDoc: DocFetcher = async () => ({ ok: false, code: 'DOC_NOT_READABLE', message: 'sign in required' });
    const watcher = makeWatcher(fetchDoc);

    await timer.fire();

    const doc = store.getState().prompter.doc;
    expect(doc.status).toBe('error');
    expect(doc.error).toEqual({ code: 'DOC_NOT_READABLE', message: 'sign in required' });
    expect(doc.lastCheckedAt).toBe(clock.now());
    // Safety invariant: failure never touches loadedHash/staged.
    expect(doc.loadedHash).toBe('');
    expect(doc.staged).toBeNull();
    watcher.stop();
  });

  it('treats a rejected fetchDoc promise as a failure too', async () => {
    setDocId('doc-abc');
    const fetchDoc: DocFetcher = async () => {
      throw new Error('boom');
    };
    const watcher = makeWatcher(fetchDoc);

    await timer.fire();

    const doc = store.getState().prompter.doc;
    expect(doc.status).toBe('error');
    expect(doc.error?.code).toBe('DOC_UNREACHABLE');
    expect(doc.error?.message).toContain('boom');
    watcher.stop();
  });

  it('backs off 60s -> 2m -> 4m -> capped at 10m on consecutive failures', async () => {
    setDocId('doc-abc');
    const fetchDoc: DocFetcher = async () => ({ ok: false, code: 'DOC_UNREACHABLE', message: 'down' });
    const watcher = makeWatcher(fetchDoc);

    // Failure #1 at t0. Next attempt not due until +2m.
    await timer.fire();
    const checkedAt1 = store.getState().prompter.doc.lastCheckedAt!;

    clock.advance(60_000); // only 1m later; still backed off
    await timer.fire();
    expect(store.getState().prompter.doc.lastCheckedAt).toBe(checkedAt1); // no-op, not due yet

    clock.advance(60_000); // now 2m since checkedAt1 -> due
    await timer.fire();
    const checkedAt2 = store.getState().prompter.doc.lastCheckedAt!;
    expect(checkedAt2).toBeGreaterThan(checkedAt1);

    // Failure #2 -> next due at +4m from checkedAt2.
    clock.advance(120_000); // 2m later; not due yet
    await timer.fire();
    expect(store.getState().prompter.doc.lastCheckedAt).toBe(checkedAt2);

    clock.advance(120_000); // now 4m since checkedAt2 -> due
    await timer.fire();
    const checkedAt3 = store.getState().prompter.doc.lastCheckedAt!;
    expect(checkedAt3).toBeGreaterThan(checkedAt2);

    // Failure #3 -> multiplier would be 8x (8m) but cap is 10x (10m).
    // Drive many ticks forward and confirm it never fires before +8m,
    // and does fire by +10m (the cap).
    clock.advance(8 * 60_000 - 1);
    await timer.fire();
    expect(store.getState().prompter.doc.lastCheckedAt).toBe(checkedAt3); // not due at just under 8m from checkedAt3? backoff continues doubling toward cap

    clock.advance(2 * 60_000 + 1); // cross into >10m from checkedAt3, definitely past the 10m cap
    await timer.fire();
    const checkedAt4 = store.getState().prompter.doc.lastCheckedAt!;
    expect(checkedAt4).toBeGreaterThan(checkedAt3);

    watcher.stop();
  });

  it('resets backoff to 60s after a subsequent success', async () => {
    setDocId('doc-abc');
    let shouldFail = true;
    const fetchDoc: DocFetcher = async () => {
      if (shouldFail) return { ok: false, code: 'DOC_UNREACHABLE', message: 'down' };
      return OK('recovered text', 'hash-recovered', 2);
    };
    const watcher = makeWatcher(fetchDoc);

    await timer.fire(); // failure #1, next due at +2m
    const checkedAt1 = store.getState().prompter.doc.lastCheckedAt!;

    clock.advance(2 * 60_000);
    shouldFail = false;
    await timer.fire(); // success, backoff resets
    const doc = store.getState().prompter.doc;
    expect(doc.status).toBe('ready');
    expect(doc.staged?.hash).toBe('hash-recovered');

    // A failure right after should back off by only 60s -> 2m again, not
    // continue from the prior (larger) multiplier.
    shouldFail = true;
    clock.advance(60_000);
    await timer.fire(); // this failure re-arms a 2m backoff from here
    const checkedAtFail = store.getState().prompter.doc.lastCheckedAt!;

    clock.advance(60_000); // only 1m later; should still be backed off at the reset (2m) rate
    await timer.fire();
    expect(store.getState().prompter.doc.lastCheckedAt).toBe(checkedAtFail);

    clock.advance(60_000); // now 2m since checkedAtFail -> due
    await timer.fire();
    expect(store.getState().prompter.doc.lastCheckedAt).toBeGreaterThan(checkedAtFail);

    watcher.stop();
  });

  it('stop() clears the interval and is idempotent', () => {
    setDocId('doc-abc');
    const watcher = makeWatcher(async () => OK('x', 'h', 1));

    expect(timer.isCleared).toBe(false);
    watcher.stop();
    expect(timer.isCleared).toBe(true);
    expect(timer.clearCount).toBe(1);

    watcher.stop(); // idempotent
    expect(timer.clearCount).toBe(1); // clearIntervalFn not called again once already cleared
  });

  it('stop() is safe to call on a watcher that never ticked', () => {
    const watcher = makeWatcher(async () => OK('x', 'h', 1));
    expect(() => watcher.stop()).not.toThrow();
  });
});
