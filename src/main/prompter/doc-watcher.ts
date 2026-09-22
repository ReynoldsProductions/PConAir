import type { StateStore } from '../state';
import type { PrompterDocState } from '../../shared/types';
import type { DocErrorCode, DocFetchResult } from './doc-source';

/**
 * Server-side poller that keeps `PrompterState.doc.staged` fresh from a
 * Google Doc, per design section 4 ("Watcher") and decision #4 ("Poll every
 * 60s and pre-stage"). Modeled on `createSlideshowEngine`
 * (`src/main/media-library/slideshow.ts`): store-driven, fully injectable,
 * no Electron import, no real timers.
 *
 * Safety invariant this module must never break (design "Error handling"):
 * a failed fetch, or a fetch that only fills `staged`, must never touch
 * `PrompterState.script` or `doc.loadedHash` — those change only when an
 * operator explicitly Takes (routes phase, not here).
 */

/** Wraps `fetchDocText` with the doc id and transport already bound. */
export type DocFetcher = (docId: string) => Promise<DocFetchResult>;

export interface DocWatcherDeps {
  store: StateStore;
  fetchDoc: DocFetcher;
  /** Injected clock so tests never depend on wall time. */
  now: () => number;
  setIntervalFn: (handler: () => void | Promise<void>, ms: number) => unknown;
  clearIntervalFn: (handle: unknown) => void;
}

export interface DocWatcher {
  /** Stop polling. Safe to call more than once, and safe if never started ticking. */
  stop: () => void;
}

/** Poll cadence per decision #4. */
const BASE_INTERVAL_MS = 60_000;

/** "60s → 2m → 4m, cap at 10m" — expressed as a multiplier cap on the base interval. */
const MAX_BACKOFF_MULTIPLIER = 10; // 10 * 60s = 10m

function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).filter(Boolean).length : 0;
}

/**
 * Normalize a rejected `fetchDoc()` promise into the same shape as a typed
 * `{ ok: false }` result, so the tick logic only has one failure path.
 */
function toFailure(err: unknown): { code: DocErrorCode; message: string } {
  return {
    code: 'DOC_UNREACHABLE',
    message: `Unexpected error fetching document: ${err instanceof Error ? err.message : String(err)}`,
  };
}

export function createDocWatcher(deps: DocWatcherDeps): DocWatcher {
  const { store, fetchDoc, now, setIntervalFn, clearIntervalFn } = deps;

  let handle: unknown = null;
  // Multiplier on BASE_INTERVAL_MS for the next allowed attempt after a
  // failure; 1 means "no backoff, try on the next normal tick".
  let backoffMultiplier = 1;
  // Epoch ms before which a backed-off tick should no-op. 0 means "no backoff in effect".
  let nextAttemptAt = 0;
  // Guards against a slow fetch overlapping the next 60s tick.
  let inFlight = false;

  function patchDoc(fields: Partial<PrompterDocState>): void {
    const s = store.getState();
    store.setState({ prompter: { ...s.prompter, doc: { ...s.prompter.doc, ...fields } } });
  }

  async function tick(): Promise<void> {
    if (inFlight) return;

    const doc = store.getState().prompter.doc;
    // Idle whenever no doc is configured. Still ticks every 60s so a doc
    // loaded after the watcher starts is picked up on the next tick.
    if (!doc.docId) return;

    const t = now();
    if (nextAttemptAt !== 0 && t < nextAttemptAt) return; // backing off, not due yet

    inFlight = true;
    let outcome: DocFetchResult;
    try {
      outcome = await fetchDoc(doc.docId);
    } catch (err) {
      outcome = { ok: false, ...toFailure(err) };
    } finally {
      inFlight = false;
    }

    const checkedAt = now();

    if (!outcome.ok) {
      backoffMultiplier = Math.min(backoffMultiplier * 2, MAX_BACKOFF_MULTIPLIER);
      nextAttemptAt = checkedAt + BASE_INTERVAL_MS * backoffMultiplier;
      patchDoc({
        status: 'error',
        error: { code: outcome.code, message: outcome.message },
        lastCheckedAt: checkedAt,
      });
      return;
    }

    // Success resets backoff, whether or not the content actually changed.
    backoffMultiplier = 1;
    nextAttemptAt = 0;

    const latest = store.getState().prompter.doc; // re-read: state may have moved while the fetch was in flight
    const alreadyStaged = latest.staged?.hash === outcome.hash;
    const alreadyLoaded = latest.loadedHash === outcome.hash;

    if (alreadyLoaded || alreadyStaged) {
      // Identical content: touch lastCheckedAt only. No status/error/staged
      // churn, so this setState carries no WS-visible change beyond the
      // timestamp itself.
      patchDoc({ lastCheckedAt: checkedAt });
      return;
    }

    patchDoc({
      staged: { text: outcome.text, hash: outcome.hash, words: outcome.words ?? countWords(outcome.text), fetchedAt: checkedAt },
      status: 'ready',
      error: null,
      lastCheckedAt: checkedAt,
    });
  }

  handle = setIntervalFn(() => {
    void tick();
  }, BASE_INTERVAL_MS);

  function stop(): void {
    if (handle !== null) {
      clearIntervalFn(handle);
      handle = null;
    }
  }

  return { stop };
}
