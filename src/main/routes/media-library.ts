import { Router, Request, Response } from 'express';
import multer from 'multer';
import type { StateStore } from '../state';
import type { AuthManager } from '../auth';
import type { MediaLibraryStore } from '../media-library/item-store';
import { requireOperator, requireAdmin } from './middleware';
import { createSlideshowEngine, type SlideshowEngine } from '../media-library/slideshow';
import { stillsTakeOp, stillsClearOp } from '../media-library/stills-ops';
import type { SlideshowTransition } from '../../shared/types';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

function listPayload(items: ReturnType<MediaLibraryStore['list']>) {
  return {
    items: items.map((it) => ({
      id: it.id,
      displayName: it.displayName,
      filename: it.filename,
      mimeType: it.mimeType,
      fileSize: it.fileSize,
      width: it.width,
      height: it.height,
      hasTransparency: it.hasTransparency,
      uploadedAt: it.uploadedAt,
    })),
  };
}

export function createMediaLibraryRouter(
  store: StateStore,
  auth: AuthManager,
  media: MediaLibraryStore,
  slideshowEngine?: SlideshowEngine
): Router {
  const router = Router();
  const opGuard = requireOperator(auth);
  const adminGuard = requireAdmin(auth);
  // Shared with the action dispatcher when injected (Companion drives the same engine).
  const slideshow = slideshowEngine ?? createSlideshowEngine({ store, media });

  router.post('/slideshow', opGuard, (req: Request, res: Response) => {
    const body = req.body as {
      action?: string;
      itemIds?: string[];
      intervalSec?: number;
      transition?: string;
    };
    const action = body.action;
    if (action === 'play') {
      const itemIds = Array.isArray(body.itemIds) ? body.itemIds.filter((x): x is string => typeof x === 'string') : [];
      const intervalSec = typeof body.intervalSec === 'number' ? body.intervalSec : 5;
      const transition: SlideshowTransition = body.transition === 'fade' ? 'fade' : 'cut';
      const r = slideshow.play({ itemIds, intervalSec, transition });
      if (!r.ok) {
        res.status(400).json({ error: { code: 'ITEM_NOT_FOUND', message: r.error } });
        return;
      }
    } else if (action === 'pause') {
      if (!slideshow.pause()) {
        res.status(400).json({ error: { code: 'INVALID_MODE', message: 'No slideshow running' } });
        return;
      }
    } else if (action === 'resume') {
      if (!slideshow.resume()) {
        res.status(400).json({ error: { code: 'INVALID_MODE', message: 'No slideshow running' } });
        return;
      }
    } else if (action === 'stop') {
      slideshow.stop();
    } else if (action === 'next' || action === 'prev') {
      const moved = action === 'next' ? slideshow.next() : slideshow.prev();
      if (!moved) {
        res.status(400).json({ error: { code: 'INVALID_MODE', message: 'No slideshow loaded' } });
        return;
      }
    } else {
      res.status(400).json({ error: { code: 'INVALID_MODE', message: "action must be play|pause|resume|stop|next|prev" } });
      return;
    }
    res.json({ mediaLibrary: store.getState().mediaLibrary });
  });

  router.get('/', opGuard, (_req: Request, res: Response) => {
    res.json(listPayload(media.list()));
  });

  router.post(
    '/upload',
    adminGuard,
    upload.fields([
      { name: 'files[]', maxCount: 25 },
      { name: 'files', maxCount: 25 },
    ]),
    (req: Request, res: Response) => {
      const grouped = req.files as Record<string, Express.Multer.File[]> | undefined;
      const raw = [...(grouped?.['files[]'] ?? []), ...(grouped?.files ?? [])];
      if (raw.length === 0) {
        res.status(400).json({ error: { code: 'INVALID_MODE', message: 'No files uploaded (use field files[] or files)' } });
        return;
      }
      let imported = 0;
      let failed = 0;
      const items: Array<{
        id: string;
        displayName: string;
        mimeType: string;
        fileSize: number;
        width?: number;
        height?: number;
      }> = [];
      const failures: string[] = [];

      for (const file of raw) {
        const rec = media.ingestBuffer(file.originalname, file.buffer);
        if (!rec) {
          failed += 1;
          failures.push(`${file.originalname}: unsupported or invalid image`);
          continue;
        }
        imported += 1;
        items.push({
          id: rec.id,
          displayName: rec.displayName,
          mimeType: rec.mimeType,
          fileSize: rec.fileSize,
          width: rec.width,
          height: rec.height,
        });
      }

      res.json({ imported, failed, items, failures });
    }
  );

  router.post('/take', opGuard, (req: Request, res: Response) => {
    const { itemId } = req.body as { itemId?: string };
    if (!itemId || typeof itemId !== 'string') {
      res.status(400).json({ error: { code: 'INVALID_MODE', message: 'itemId is required' } });
      return;
    }
    const r = stillsTakeOp(store, media, itemId);
    if (!r.ok) {
      res.status(r.status).json({ error: r.error });
      return;
    }
    res.json(r.body);
  });

  router.post('/clear', opGuard, (_req: Request, res: Response) => {
    res.json(stillsClearOp(store).body);
  });

  // Unauthenticated: consumed by /render pages in OBS (no cookies on LAN).
  router.get('/:itemId/download', (req: Request, res: Response) => {
    const { itemId } = req.params;
    const item = media.findById(itemId);
    if (!item) {
      res.status(404).json({ error: { code: 'ITEM_NOT_FOUND', message: `Media item '${itemId}' not found` } });
      return;
    }
    const abs = media.absolutePath(item);
    res.setHeader('Content-Type', item.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(item.filename)}"`);
    res.sendFile(abs, (err) => {
      if (err && !res.headersSent) {
        res.status(500).json({ error: { code: 'INVALID_MODE', message: 'Failed to read file' } });
      }
    });
  });

  router.delete('/:itemId', adminGuard, (req: Request, res: Response) => {
    const { itemId } = req.params;
    if (!media.findById(itemId)) {
      res.status(404).json({ error: { code: 'ITEM_NOT_FOUND', message: `Media item '${itemId}' not found` } });
      return;
    }
    const st = store.getState();
    if (st.currentMode === 'media-library' && st.mediaLibrary?.activeItemId === itemId) {
      store.setState({ currentMode: 'idle', mediaLibrary: null });
    }
    media.remove(itemId);
    res.status(204).end();
  });

  return router;
}
