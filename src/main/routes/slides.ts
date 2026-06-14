import { Router, Request, Response } from 'express';
import type { StateStore } from '../state';
import type { AuthManager } from '../auth';
import { requireOperator, isValidUrl } from './middleware';
import { slideLoadOp, slideNextOp, slidePrevOp, slideGotoOp, slideReloadOp } from '../services/slide-ops';
import { broadcastToBackups } from '../services/backup-broadcast';

/** Minimal backup-settings slice needed by the slides router. */
export interface BackupSettings {
  backupRole: 'primary' | 'backup' | 'standalone';
  backupMachineIps: string[];
}

/**
 * Return the current backup settings for fan-out decisions.
 * Injected as a dependency so the route stays decoupled from profile I/O.
 */
export type GetBackupSettings = () => BackupSettings;

const DEFAULT_BACKUP_SETTINGS: BackupSettings = {
  backupRole: 'standalone',
  backupMachineIps: [],
};

export function createSlidesRouter(
  store: StateStore,
  auth: AuthManager,
  getBackupSettings: GetBackupSettings = () => DEFAULT_BACKUP_SETTINGS,
): Router {
  const router = Router();
  const opGuard = requireOperator(auth);

  /**
   * Fan-out `path` + `body` to all backup machines when running as primary.
   * Fire-and-forget — never blocks the local response.
   */
  function fanOut(path: string, body: unknown): void {
    const { backupRole, backupMachineIps } = getBackupSettings();
    if (backupRole !== 'primary' || backupMachineIps.length === 0) return;
    // Intentionally not awaited — fire and forget.
    broadcastToBackups(backupMachineIps, path, body, (msg) => console.warn(msg));
  }

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
    fanOut('/api/slides/load', req.body);
    res.json(r.body);
  });

  router.post('/next', opGuard, (_req: Request, res: Response) => {
    const r = slideNextOp(store);
    if (!r.ok) {
      res.status(r.status).json({ error: r.error });
      return;
    }
    fanOut('/api/slides/next', {});
    res.json(r.body);
  });

  router.post('/prev', opGuard, (_req: Request, res: Response) => {
    const r = slidePrevOp(store);
    if (!r.ok) {
      res.status(r.status).json({ error: r.error });
      return;
    }
    fanOut('/api/slides/prev', {});
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
    fanOut('/api/slides/goto', req.body);
    res.json(r.body);
  });

  router.post('/reload', opGuard, (_req: Request, res: Response) => {
    const r = slideReloadOp(store);
    if (!r.ok) {
      res.status(r.status).json({ error: r.error });
      return;
    }
    // reload is a local-only operation; backups self-manage their cached state
    res.json(r.body);
  });

  return router;
}
