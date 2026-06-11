import { Router, Request, Response } from 'express';
import type { StateStore } from '../state';
import {
  slideLoadOp,
  slideNextOp,
  slidePrevOp,
  slideGotoOp,
  slideReloadOp,
  slideCloseOp,
  slideOfflineModeOp,
} from '../services/slide-ops';
import { urlLoadOp } from '../services/url-ops';

/**
 * Backwards-compatibility surface for the Google Slides Controller Companion
 * module (companion-module-gslide-opener). It sends no cookies and no PIN —
 * GSC gates these endpoints by IP allowlist only, and so does PConAir (the
 * global allowlist middleware runs before this router). Response contract:
 * 200 + JSON on success; non-200 with { error: string } on failure (the module
 * surfaces `response.error` as the failure message).
 */

type OpResult = { ok: true; body: unknown } | { ok: false; status: number; error: { code: string; message: string } };

function send(res: Response, r: OpResult): void {
  if (r.ok) {
    res.json({ success: true, ...(typeof r.body === 'object' && r.body !== null ? r.body : {}) });
    return;
  }
  res.status(r.status).json({ error: r.error.message });
}

function notSupported(res: Response, what: string): void {
  res.status(400).json({ error: `${what} is not supported by PConAir` });
}

export function createGscCompatRouter(store: StateStore): Router {
  const router = Router();

  router.post('/open-presentation', (req: Request, res: Response) => {
    const { url } = req.body as { url?: string };
    send(res, slideLoadOp(store, url ?? ''));
  });

  router.post('/open-presentation-with-notes', (req: Request, res: Response) => {
    // PConAir always opens the presenter-notes capture window; same as open-presentation.
    const { url } = req.body as { url?: string };
    send(res, slideLoadOp(store, url ?? ''));
  });

  router.post('/next-slide', (_req: Request, res: Response) => {
    send(res, slideNextOp(store));
  });

  router.post('/previous-slide', (_req: Request, res: Response) => {
    send(res, slidePrevOp(store));
  });

  router.post('/go-to-slide', (req: Request, res: Response) => {
    const { slide } = req.body as { slide?: number };
    if (typeof slide !== 'number' || !Number.isInteger(slide) || slide < 1) {
      res.status(400).json({ error: 'slide must be a positive integer (1-based)' });
      return;
    }
    send(res, slideGotoOp(store, slide - 1));
  });

  router.post('/reload-presentation', (_req: Request, res: Response) => {
    send(res, slideReloadOp(store));
  });

  router.post('/close-presentation', (_req: Request, res: Response) => {
    send(res, slideCloseOp(store));
  });

  // GSC's "Slido" mode is PConAir's URL mode (plan: rename Slido → Web URL).
  router.post('/open-slido', (req: Request, res: Response) => {
    const { url } = req.body as { url?: string };
    send(res, urlLoadOp(store, url ?? ''));
  });

  router.post('/open-url', (req: Request, res: Response) => {
    const { url } = req.body as { url?: string };
    send(res, urlLoadOp(store, url ?? ''));
  });

  router.post('/set-offline-mode', (req: Request, res: Response) => {
    const { enabled } = req.body as { enabled?: boolean };
    send(res, slideOfflineModeOp(store, enabled === true));
  });

  // Speaker-notes window management is automatic in PConAir (capture window is
  // always opened with the deck); acknowledge so existing buttons don't error.
  router.post('/open-speaker-notes', (_req: Request, res: Response) => {
    res.json({ success: true });
  });
  router.post('/close-speaker-notes', (_req: Request, res: Response) => {
    res.json({ success: true });
  });

  // Not (yet) supported by PConAir — honest failures so operators notice.
  for (const ep of [
    'toggle-video',
    'scroll-notes-up',
    'scroll-notes-down',
    'zoom-in-notes',
    'zoom-out-notes',
    'relaunch-speaker-notes',
    'open-key-fill',
    'close-key-fill',
    'open-preset',
    'set-backup-controls',
    'preferences',
    'set-perfectcue-enabled',
    'toggle-perfectcue-port',
  ]) {
    router.post(`/${ep}`, (_req: Request, res: Response) => notSupported(res, `/${ep}`));
  }

  return router;
}
