import { Router, Request, Response } from 'express';
import type { StateStore } from '../state';
import type { AuthManager } from '../auth';
import { requireOperator, isValidUrl } from './middleware';
import { slideLoadOp, slideNextOp, slidePrevOp, slideGotoOp, slideReloadOp } from '../services/slide-ops';

export function createSlidesRouter(store: StateStore, auth: AuthManager): Router {
  const router = Router();
  const opGuard = requireOperator(auth);

  router.post('/load', opGuard, (req: Request, res: Response) => {
    const { deckUrl, instance } = req.body as { deckUrl?: string; instance?: string };
    if (!deckUrl || !isValidUrl(deckUrl)) {
      res.status(400).json({ error: { code: 'INVALID_URL', message: 'deckUrl must be a valid URL' } });
      return;
    }
    const r = slideLoadOp(store, deckUrl, instance);
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
