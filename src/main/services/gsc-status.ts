import type { AppState } from '../../shared/types';

/**
 * Flat status fields matching Google Slides Controller's GET /api/status response.
 * The GSC Companion module (companion-module-gslide-opener) polls these at 1 Hz and
 * reads every field below by name — keep names and semantics exactly as GSC serves
 * them. Merged into PConAir's /api/status response alongside the AppState fields.
 */
export interface GscStatusFields {
  status: 'ok';
  presentationOpen: boolean;
  notesOpen: boolean;
  currentSlide: number | null; // 1-based
  totalSlides: number | null;
  slideInfo: string | null; // "3 / 10"
  isFirstSlide: boolean | null;
  isLastSlide: boolean | null;
  nextSlide: number | null;
  previousSlide: number | null;
  presentationUrl: string | null;
  presentationTitle: string | null;
  contentKind: 'slides' | 'slido';
  timerElapsed: string | null;
  presentationDisplayId: string | null;
  notesDisplayId: string | null;
  loginState: boolean;
  loggedInUser: string | null;
  backupControlsEnabled: boolean;
  notesZoomSteps: number;
  notesZoomDefault: number;
  notesLayout: 'hide' | 'default';
  offlineModeEnabled: boolean;
  perfectcue: { enabled: boolean; ports: unknown[] };
}

export function gscStatusFields(state: AppState): GscStatusFields {
  const slides = state.slides;
  const open = slides !== null;
  const ready = open && !slides.isLoading;
  const currentSlide = ready ? slides.slideIndex + 1 : null;
  const totalSlides = ready ? slides.slideCount : null;

  return {
    status: 'ok',
    presentationOpen: open,
    notesOpen: slides?.notesOpen ?? false,
    currentSlide,
    totalSlides,
    slideInfo: currentSlide !== null && totalSlides !== null ? `${currentSlide} / ${totalSlides}` : null,
    isFirstSlide: currentSlide !== null ? currentSlide === 1 : null,
    isLastSlide: currentSlide !== null && totalSlides !== null ? currentSlide === totalSlides : null,
    nextSlide: currentSlide !== null && totalSlides !== null && currentSlide < totalSlides ? currentSlide + 1 : null,
    previousSlide: currentSlide !== null && currentSlide > 1 ? currentSlide - 1 : null,
    presentationUrl: slides?.deckUrl ?? (state.currentMode === 'url' ? state.currentUrl : null),
    presentationTitle: slides?.deckTitle ?? null,
    contentKind: state.currentMode === 'url' ? 'slido' : 'slides',
    timerElapsed: null,
    presentationDisplayId: null,
    notesDisplayId: null,
    loginState: false,
    loggedInUser: null,
    backupControlsEnabled: false,
    notesZoomSteps: 0,
    notesZoomDefault: 0,
    notesLayout: 'hide',
    offlineModeEnabled: slides?.offlineMode ?? false,
    perfectcue: { enabled: false, ports: [] },
  };
}
