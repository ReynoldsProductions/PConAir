import { Router, Request, Response } from 'express';
import type { AuthManager } from '../auth';
import { requireAdmin } from './middleware';
import type { PerfectCuePortConfig } from '../app-settings';
import type { PerfectCueRouterDeps } from './gsc-compat';

/**
 * Admin-authed PerfectCue configuration surface (backs the admin UI panel).
 *
 * GET  /perfectcue/settings — current global enable + port configs.
 * POST /perfectcue/settings — replace global enable and/or the full port list.
 *
 * The full-list POST is the add/remove/edit path for the UI; the lighter-weight
 * GSC-compat endpoints (/api/set-perfectcue-enabled, /api/toggle-perfectcue-port)
 * remain for Companion. Changing the global enable restarts the listeners;
 * editing the port list also restarts (ports may have been added/removed).
 */

export interface PerfectCueAdminDeps extends PerfectCueRouterDeps {
  auth: AuthManager;
}

function sanitizePorts(value: unknown): PerfectCuePortConfig[] | null {
  if (!Array.isArray(value)) return null;
  const out: PerfectCuePortConfig[] = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) return null;
    const e = entry as Record<string, unknown>;
    const port = e.port;
    if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) return null;
    out.push({
      id: typeof e.id === 'string' && e.id.length > 0 ? e.id : `pc-${Date.now().toString(36)}-${out.length}`,
      name: typeof e.name === 'string' ? e.name : '',
      port,
      adapterType: e.adapterType === 'waveshare' ? 'waveshare' : 'dsan',
      enabled: e.enabled !== false,
    });
  }
  return out;
}

export function createPerfectCueRouter(deps: PerfectCueAdminDeps): Router {
  const router = Router();
  const adminGuard = requireAdmin(deps.auth);

  router.get('/settings', adminGuard, (_req: Request, res: Response) => {
    const s = deps.getSettings();
    res.json({ enabled: s.perfectcueEnabled, ports: s.perfectcuePorts });
  });

  router.post('/settings', adminGuard, (req: Request, res: Response) => {
    const body = req.body as { enabled?: unknown; ports?: unknown };
    const patch: { perfectcueEnabled?: boolean; perfectcuePorts?: PerfectCuePortConfig[] } = {};

    if (body.enabled !== undefined) {
      if (typeof body.enabled !== 'boolean') {
        res.status(400).json({ error: 'enabled must be a boolean' });
        return;
      }
      patch.perfectcueEnabled = body.enabled;
    }

    if (body.ports !== undefined) {
      const ports = sanitizePorts(body.ports);
      if (ports === null) {
        res.status(400).json({ error: 'ports must be an array of { name, port, adapterType, enabled }' });
        return;
      }
      patch.perfectcuePorts = ports;
    }

    deps.saveSettings(patch);
    deps.restart();
    const s = deps.getSettings();
    res.json({ enabled: s.perfectcueEnabled, ports: s.perfectcuePorts });
  });

  return router;
}
