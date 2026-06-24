import type { StateStore } from '../state';
import { isValidUrl } from '../routes/middleware';
import { makeSlidesState } from '../../shared/types';

type Err = { ok: false; status: number; error: { code: string; message: string } };
type Ok<T> = { ok: true; body: T };

const GOOGLE_SLIDES_PATTERN = /^https:\/\/docs\.google\.com\/presentation\/d\/([^/]+)/;

export function extractDeckId(deckUrl: string): string | null {
  const match = GOOGLE_SLIDES_PATTERN.exec(deckUrl);
  return match ? match[1] : null;
}

export function slideNextOp(store: StateStore): Err | Ok<{ slides: { slideIndex: number } }> {
  const state = store.getState();
  if (!state.slides) {
    return { ok: false, status: 400, error: { code: 'NO_ACTIVE_DECK', message: 'No deck is currently loaded' } };
  }
  if (state.slides.isLoading) {
    return { ok: false, status: 400, error: { code: 'NO_ACTIVE_DECK', message: 'Deck is still loading' } };
  }
  if (state.slides.slideIndex >= state.slides.slideCount - 1) {
    return { ok: false, status: 400, error: { code: 'SLIDE_OUT_OF_RANGE', message: 'Already at the last slide' } };
  }
  const newIndex = state.slides.slideIndex + 1;
  store.setState({ slides: { ...state.slides, slideIndex: newIndex } });
  return { ok: true, body: { slides: { slideIndex: newIndex } } };
}

export function slidePrevOp(store: StateStore): Err | Ok<{ slides: { slideIndex: number } }> {
  const state = store.getState();
  if (!state.slides) {
    return { ok: false, status: 400, error: { code: 'NO_ACTIVE_DECK', message: 'No deck is currently loaded' } };
  }
  if (state.slides.isLoading) {
    return { ok: false, status: 400, error: { code: 'NO_ACTIVE_DECK', message: 'Deck is still loading' } };
  }
  if (state.slides.slideIndex <= 0) {
    return { ok: false, status: 400, error: { code: 'SLIDE_OUT_OF_RANGE', message: 'Already at the first slide' } };
  }
  const newIndex = state.slides.slideIndex - 1;
  store.setState({ slides: { ...state.slides, slideIndex: newIndex } });
  return { ok: true, body: { slides: { slideIndex: newIndex } } };
}

export function slideGotoOp(store: StateStore, slideIndex: number): Err | Ok<{ slides: { slideIndex: number } }> {
  const state = store.getState();
  if (!state.slides) {
    return { ok: false, status: 400, error: { code: 'NO_ACTIVE_DECK', message: 'No deck is currently loaded' } };
  }
  if (state.slides.isLoading) {
    return { ok: false, status: 400, error: { code: 'NO_ACTIVE_DECK', message: 'Deck is still loading' } };
  }
  if (
    typeof slideIndex !== 'number' ||
    !Number.isInteger(slideIndex) ||
    slideIndex < 0 ||
    slideIndex >= state.slides.slideCount
  ) {
    return {
      ok: false,
      status: 400,
      error: {
        code: 'SLIDE_OUT_OF_RANGE',
        message: `slideIndex must be in range [0, ${state.slides.slideCount - 1}]`,
      },
    };
  }
  store.setState({ slides: { ...state.slides, slideIndex } });
  return { ok: true, body: { slides: { slideIndex } } };
}

export function slideReloadOp(store: StateStore): Err | Ok<{ slides: { isLoading: boolean } }> {
  const state = store.getState();
  if (!state.slides) {
    return { ok: false, status: 400, error: { code: 'NO_ACTIVE_DECK', message: 'No deck is currently loaded' } };
  }
  if (state.slides.isLoading) {
    return { ok: false, status: 400, error: { code: 'NO_ACTIVE_DECK', message: 'Deck is still loading' } };
  }
  store.setState({ slides: { ...state.slides, isLoading: true } });
  return { ok: true, body: { slides: { isLoading: true } } };
}

export function slideLoadOp(
  store: StateStore,
  deckUrl: string,
  instance?: string,
  backupUrl?: string
): Err | Ok<{ currentMode: string; slides: NonNullable<ReturnType<StateStore['getState']>['slides']>; abState: ReturnType<StateStore['getState']>['abState'] }> {
  if (!deckUrl || !isValidUrl(deckUrl)) {
    return { ok: false, status: 400, error: { code: 'INVALID_URL', message: 'deckUrl must be a valid URL' } };
  }
  if (instance !== undefined && instance !== 'A' && instance !== 'B') {
    return { ok: false, status: 400, error: { code: 'INVALID_MODE', message: 'instance must be "A" or "B"' } };
  }
  const deckId = extractDeckId(deckUrl);
  if (!deckId) {
    return { ok: false, status: 400, error: { code: 'INVALID_URL', message: 'deckUrl must be a Google Slides presentation URL' } };
  }
  let backupDeckId: string | null = null;
  if (backupUrl !== undefined && backupUrl !== '') {
    if (!isValidUrl(backupUrl)) {
      return { ok: false, status: 400, error: { code: 'INVALID_URL', message: 'backupUrl must be a valid URL' } };
    }
    backupDeckId = extractDeckId(backupUrl);
    if (!backupDeckId) {
      return { ok: false, status: 400, error: { code: 'INVALID_URL', message: 'backupUrl must be a Google Slides presentation URL' } };
    }
  }
  const prev = store.getState().slides;
  store.setState({
    currentMode: 'slides',
    l3: null,
    mediaLibrary: null,
    slides: makeSlidesState({
      deckId,
      deckTitle: deckId,
      slideIndex: 0,
      slideCount: 1,
      isLoading: true,
      deckUrl,
      backupDeckId,
      backupDeckUrl: backupDeckId ? backupUrl ?? null : null,
      offlineMode: prev?.offlineMode ?? false,
    }),
  });
  const s = store.getState();
  return {
    ok: true,
    body: { currentMode: s.currentMode, slides: s.slides!, abState: s.abState },
  };
}

export function slideCloseOp(store: StateStore): Ok<{ currentMode: string }> {
  store.setState({ currentMode: 'idle', slides: null });
  return { ok: true, body: { currentMode: 'idle' } };
}

export function slideOfflineModeOp(store: StateStore, enabled: boolean): Err | Ok<{ slides: { offlineMode: boolean } }> {
  const state = store.getState();
  if (!state.slides) {
    return { ok: false, status: 400, error: { code: 'NO_ACTIVE_DECK', message: 'No deck is currently loaded' } };
  }
  store.setState({ slides: { ...state.slides, offlineMode: enabled, cacheWarmed: enabled ? state.slides.cacheWarmed : false } });
  return { ok: true, body: { slides: { offlineMode: enabled } } };
}
