import type { StateStore } from '../state';
import { isVideoMime } from './image-meta';
import type { MediaLibraryStore } from './item-store';
import type { SlideshowState, SlideshowTransition } from '../../shared/types';

/**
 * Server-side slideshow engine for the still store. Drives state only — the
 * Electron media window and the /render pages follow `mediaLibrary.activeItemId`
 * over the normal state subscription, so the engine stays Electron-free and
 * fully testable.
 */
export function createSlideshowEngine(deps: { store: StateStore; media: MediaLibraryStore }) {
  const { store, media } = deps;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function currentSlideshow(): SlideshowState | null {
    return store.getState().mediaLibrary?.slideshow ?? null;
  }

  function applyPosition(show: SlideshowState, position: number): void {
    const itemId = show.itemIds[position];
    const item = itemId ? media.findById(itemId) : null;
    store.setState({
      currentMode: 'media-library',
      l3: null,
      mediaLibrary: {
        activeItemId: item?.id ?? null,
        activeItemName: item?.displayName ?? null,
        activeItemMime: item?.mimeType ?? null,
        activeItemDurationMs: item?.durationMs ?? null,
        slideshow: { ...show, position },
      },
    });
  }

  function clearTimer(): void {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }

  /**
   * Dwell for whatever is on screen right now. A video plays through once and
   * then the show moves on, so its own duration wins over the still interval;
   * a video of unknown length (e.g. WebM) falls back to the interval.
   */
  function dwellMs(show: SlideshowState): number {
    const itemId = show.itemIds[show.position];
    const item = itemId ? media.findById(itemId) : null;
    if (item && isVideoMime(item.mimeType) && item.durationMs) return item.durationMs;
    return show.intervalSec * 1000;
  }

  /**
   * Self-rescheduling timeout rather than a fixed interval, so each slide's
   * dwell is computed from the item actually on screen.
   */
  function scheduleNext(): void {
    clearTimer();
    const show = currentSlideshow();
    if (!show || !show.running) return;
    timer = setTimeout(() => {
      timer = null;
      const cur = currentSlideshow();
      if (!cur || !cur.running) return;
      if (cur.paused) {
        // Hold position, keep checking so resume() needs no extra wiring.
        scheduleNext();
        return;
      }
      applyPosition(cur, (cur.position + 1) % cur.itemIds.length);
      scheduleNext();
    }, dwellMs(show));
  }

  function play(opts: { itemIds: string[]; intervalSec: number; transition: SlideshowTransition }): { ok: true } | { ok: false; error: string } {
    const validIds = opts.itemIds.filter((id) => media.findById(id) !== null);
    if (validIds.length === 0) {
      return { ok: false, error: 'No valid items for slideshow' };
    }
    if (!(opts.intervalSec >= 1 && opts.intervalSec <= 3600)) {
      return { ok: false, error: 'intervalSec must be between 1 and 3600' };
    }
    const show: SlideshowState = {
      running: true,
      paused: false,
      itemIds: validIds,
      position: 0,
      intervalSec: opts.intervalSec,
      transition: opts.transition,
    };
    applyPosition(show, 0);
    scheduleNext();
    return { ok: true };
  }

  function pause(): boolean {
    const show = currentSlideshow();
    if (!show || !show.running) return false;
    const s = store.getState();
    store.setState({ mediaLibrary: { ...s.mediaLibrary!, slideshow: { ...show, paused: true } } });
    return true;
  }

  function resume(): boolean {
    const show = currentSlideshow();
    if (!show || !show.running) return false;
    const s = store.getState();
    store.setState({ mediaLibrary: { ...s.mediaLibrary!, slideshow: { ...show, paused: false } } });
    return true;
  }

  function stop(): void {
    clearTimer();
    const s = store.getState();
    if (s.mediaLibrary) {
      store.setState({ mediaLibrary: { ...s.mediaLibrary, slideshow: null } });
    }
  }

  function step(direction: 1 | -1): boolean {
    const show = currentSlideshow();
    if (!show) return false;
    const len = show.itemIds.length;
    applyPosition(show, (show.position + direction + len) % len);
    scheduleNext();
    return true;
  }

  function destroy(): void {
    clearTimer();
  }

  return { play, pause, resume, stop, next: () => step(1), prev: () => step(-1), destroy };
}

export type SlideshowEngine = ReturnType<typeof createSlideshowEngine>;
