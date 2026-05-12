import { Router, Request, Response } from 'express';
import type { StateStore } from '../state';
import type { AuthManager } from '../auth';
import { requireOperator, isValidUrl } from './middleware';

const GOOGLE_SLIDES_PATTERN = /^https:\/\/docs\.google\.com\/presentation\/d\/([^/]+)/;

function extractDeckId(deckUrl: string): string | null {
  const match = GOOGLE_SLIDES_PATTERN.exec(deckUrl);
  return match ? match[1] : null;
}

export function createSlidesRouter(store: StateStore, auth: AuthManager): Router {
  const router = Router();
  const opGuard = requireOperator(auth);

  // POST /api/slides/load
  router.post('/load', opGuard, (req: Request, res: Response) => {
    const { deckUrl, instance } = req.body as { deckUrl?: string; instance?: string };

    if (!deckUrl || !isValidUrl(deckUrl)) {
      res.status(400).json({ error: { code: 'INVALID_URL', message: 'deckUrl must be a valid URL' } });
      return;
    }

    const deckId = extractDeckId(deckUrl);
    if (!deckId) {
      res.status(400).json({ error: { code: 'INVALID_URL', message: 'deckUrl must be a Google Slides presentation URL' } });
      return;
    }

    if (instance !== undefined && instance !== 'A' && instance !== 'B') {
      res.status(400).json({ error: { code: 'INVALID_MODE', message: 'instance must be "A" or "B"' } });
      return;
    }

    store.setState({
      currentMode: 'slides',
      slides: {
        deckId,
        deckTitle: deckId,
        slideIndex: 0,
        slideCount: 1,
        isLoading: true,
      },
    });

    const state = store.getState();
    res.json({
      currentMode: state.currentMode,
      slides: state.slides,
      abState: state.abState,
    });
  });

  // POST /api/slides/next
  router.post('/next', opGuard, (_req: Request, res: Response) => {
    const state = store.getState();
    if (!state.slides) {
      res.status(400).json({ error: { code: 'NO_ACTIVE_DECK', message: 'No deck is currently loaded' } });
      return;
    }
    if (state.slides.isLoading) {
      res.status(400).json({ error: { code: 'NO_ACTIVE_DECK', message: 'Deck is still loading' } });
      return;
    }
    if (state.slides.slideIndex >= state.slides.slideCount - 1) {
      res.status(400).json({ error: { code: 'SLIDE_OUT_OF_RANGE', message: 'Already at the last slide' } });
      return;
    }
    const newIndex = state.slides.slideIndex + 1;
    store.setState({ slides: { ...state.slides, slideIndex: newIndex } });
    res.json({ slides: { slideIndex: newIndex } });
  });

  // POST /api/slides/prev
  router.post('/prev', opGuard, (_req: Request, res: Response) => {
    const state = store.getState();
    if (!state.slides) {
      res.status(400).json({ error: { code: 'NO_ACTIVE_DECK', message: 'No deck is currently loaded' } });
      return;
    }
    if (state.slides.isLoading) {
      res.status(400).json({ error: { code: 'NO_ACTIVE_DECK', message: 'Deck is still loading' } });
      return;
    }
    if (state.slides.slideIndex <= 0) {
      res.status(400).json({ error: { code: 'SLIDE_OUT_OF_RANGE', message: 'Already at the first slide' } });
      return;
    }
    const newIndex = state.slides.slideIndex - 1;
    store.setState({ slides: { ...state.slides, slideIndex: newIndex } });
    res.json({ slides: { slideIndex: newIndex } });
  });

  // POST /api/slides/goto
  router.post('/goto', opGuard, (req: Request, res: Response) => {
    const { slideIndex } = req.body as { slideIndex?: number };
    const state = store.getState();
    if (!state.slides) {
      res.status(400).json({ error: { code: 'NO_ACTIVE_DECK', message: 'No deck is currently loaded' } });
      return;
    }
    if (state.slides.isLoading) {
      res.status(400).json({ error: { code: 'NO_ACTIVE_DECK', message: 'Deck is still loading' } });
      return;
    }
    if (
      typeof slideIndex !== 'number' ||
      !Number.isInteger(slideIndex) ||
      slideIndex < 0 ||
      slideIndex >= state.slides.slideCount
    ) {
      res.status(400).json({
        error: { code: 'SLIDE_OUT_OF_RANGE', message: `slideIndex must be in range [0, ${state.slides.slideCount - 1}]` },
      });
      return;
    }
    store.setState({ slides: { ...state.slides, slideIndex } });
    res.json({ slides: { slideIndex } });
  });

  // POST /api/slides/reload
  router.post('/reload', opGuard, (_req: Request, res: Response) => {
    const state = store.getState();
    if (!state.slides) {
      res.status(400).json({ error: { code: 'NO_ACTIVE_DECK', message: 'No deck is currently loaded' } });
      return;
    }
    if (state.slides.isLoading) {
      res.status(400).json({ error: { code: 'NO_ACTIVE_DECK', message: 'Deck is still loading' } });
      return;
    }
    store.setState({ slides: { ...state.slides, isLoading: true } });
    res.json({ slides: { isLoading: true } });
  });

  return router;
}
