import { Router, Request, Response } from 'express';
import type { StateStore } from '../state';
import type { AuthManager } from '../auth';
import { requireOperator } from './middleware';
import { urlLoadOp, urlReloadOp } from '../services/url-ops';

export function createUrlRouter(store: StateStore, auth: AuthManager): Router {
  const router = Router();
  const opGuard = requireOperator(auth);

  router.post('/', opGuard, (req: Request, res: Response) => {
    const { url, display } = req.body as { url?: string; display?: string };
    const r = urlLoadOp(store, url ?? '', display);
    if (!r.ok) {
      res.status(r.status).json({ error: r.error });
      return;
    }
    res.json(r.body);
  });

  router.post('/reload', opGuard, (req: Request, res: Response) => {
    const { instance } = req.body as { instance?: string };
    const r = urlReloadOp(store, instance);
    if (!r.ok) {
      res.status(r.status).json({ error: r.error });
      return;
    }
    res.json(r.body);
  });

  return router;
}
