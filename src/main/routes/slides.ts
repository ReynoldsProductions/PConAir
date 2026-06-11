import { Router, Request, Response } from 'express';
import type { StateStore } from '../state';
import type { AuthManager } from '../auth';
import { requireOperator, isValidUrl } from './middleware';
import { slideLoadOp, slideNextOp, slidePrevOp, slideGotoOp, slideReloadOp, slideOfflineModeOp } from '../services/slide-ops';
import { gscStatusFields } from '../services/gsc-status';

export function createSlidesRouter(store: StateStore, auth: AuthManager): Router {
  const router = Router();
  const opGuard = requireOperator(auth);

  router.post('/load', opGuard, (req: Request, res: Response) => {
    const { deckUrl, instance, backupUrl } = req.body as { deckUrl?: string; instance?: string; backupUrl?: string };
    if (!deckUrl || !isValidUrl(deckUrl)) {
      res.status(400).json({ error: { code: 'INVALID_URL', message: 'deckUrl must be a valid URL' } });
      return;
    }
    const r = slideLoadOp(store, deckUrl, instance, backupUrl);
    if (!r.ok) {
      res.status(r.status).json({ error: r.error });
      return;
    }
    res.json(r.body);
  });

  // Read-only; unauthenticated on LAN (gated by global IP allowlist).
  router.get('/status', (_req: Request, res: Response) => {
    const state = store.getState();
    const gsc = gscStatusFields(state);
    res.json({
      slide: gsc.currentSlide,
      total: gsc.totalSlides,
      notes: state.slides?.notes ?? '',
      deckTitle: state.slides?.deckTitle ?? null,
      contentKind: state.slides?.contentKind ?? 'none',
      deckLoaded: state.slides !== null && !state.slides.isLoading,
      backupLoaded: state.slides?.backupLoaded ?? false,
      offlineMode: state.slides?.offlineMode ?? false,
      cacheWarmed: state.slides?.cacheWarmed ?? false,
    });
  });

  router.get('/thumbnails', (_req: Request, res: Response) => {
    const slides = store.getState().slides;
    res.json({
      current: slides?.thumbnailCurrent ?? null,
      next: slides?.thumbnailNext ?? null,
    });
  });

  router.post('/offline-mode', opGuard, (req: Request, res: Response) => {
    const { enabled } = req.body as { enabled?: boolean };
    const r = slideOfflineModeOp(store, enabled === true);
    if (!r.ok) {
      res.status(r.status).json({ error: r.error });
      return;
    }
    res.json(r.body);
  });

  router.post('/next', opGuard, (_req: Request, res: Response) => {
    const r = slideNextOp(store);
    if (!r.ok) {
      res.status(r.status).json({ error: r.error });
      return;
    }
    res.json(r.body);
  });

  router.post('/prev', opGuard, (_req: Request, res: Response) => {
    const r = slidePrevOp(store);
    if (!r.ok) {
      res.status(r.status).json({ error: r.error });
      return;
    }
    res.json(r.body);
  });

  router.post('/goto', opGuard, (req: Request, res: Response) => {
    const { slideIndex } = req.body as { slideIndex?: number };
    if (typeof slideIndex !== 'number' || !Number.isInteger(slideIndex)) {
      res.status(400).json({ error: { code: 'SLIDE_OUT_OF_RANGE', message: 'slideIndex must be an integer' } });
      return;
    }
    const r = slideGotoOp(store, slideIndex);
    if (!r.ok) {
      res.status(r.status).json({ error: r.error });
      return;
    }
    res.json(r.body);
  });

  router.post('/reload', opGuard, (_req: Request, res: Response) => {
    const r = slideReloadOp(store);
    if (!r.ok) {
      res.status(r.status).json({ error: r.error });
      return;
    }
    res.json(r.body);
  });

  return router;
}
