import { Router, Request, Response } from 'express';
import type { StateStore } from '../state';
import type { AuthManager } from '../auth';
import { requireOperator, requireAdmin } from './middleware';

export interface TeleprompterRouterDeps {
  store: StateStore;
  auth: AuthManager;
  getTeleprompterHost: () => string;
  isTeleprompterEnabled: () => boolean;
  saveTeleprompterSettings: (patch: { host?: string; enabled?: boolean }) => void;
}

interface RemoteState {
  script: string;
  scrolling: boolean;
  speed: number;
  font_size: number;
}

async function patchRemote(host: string, patch: Partial<RemoteState>): Promise<void> {
  await fetch(`${host}/api/state`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
    signal: AbortSignal.timeout(3000),
  });
}

export function createTeleprompterRouter(deps: TeleprompterRouterDeps): Router {
  const { store, auth, getTeleprompterHost, isTeleprompterEnabled, saveTeleprompterSettings } = deps;
  const router = Router();

  function guard(res: Response): string | null {
    const host = getTeleprompterHost();
    if (!isTeleprompterEnabled() || !host) {
      res.json({ ok: true, skipped: true });
      return null;
    }
    return host;
  }

  router.get('/status', requireOperator(auth), async (_req: Request, res: Response) => {
    const host = getTeleprompterHost();
    if (!host) {
      res.json({ connected: false });
      return;
    }
    try {
      const r = await fetch(`${host}/api/state`, { signal: AbortSignal.timeout(3000) });
      const data = await r.json() as RemoteState;
      res.json({ connected: true, scrolling: data.scrolling, speed: data.speed, fontSize: data.font_size });
    } catch {
      res.json({ connected: false });
    }
  });

  router.post('/start', requireOperator(auth), async (_req: Request, res: Response) => {
    const host = guard(res);
    if (!host) return;
    try {
      await patchRemote(host, { scrolling: true });
      store.setState({ teleprompter: { ...store.getState().teleprompter, scrolling: true } });
      res.json({ ok: true });
    } catch {
      res.status(502).json({ error: 'Teleprompter unreachable' });
    }
  });

  router.post('/stop', requireOperator(auth), async (_req: Request, res: Response) => {
    const host = guard(res);
    if (!host) return;
    try {
      await patchRemote(host, { scrolling: false });
      store.setState({ teleprompter: { ...store.getState().teleprompter, scrolling: false } });
      res.json({ ok: true });
    } catch {
      res.status(502).json({ error: 'Teleprompter unreachable' });
    }
  });

  router.post('/scroll', requireOperator(auth), async (req: Request, res: Response) => {
    const host = guard(res);
    if (!host) return;
    const { direction } = req.body as { direction?: string };
    if (direction !== 'faster' && direction !== 'slower') {
      res.status(400).json({ error: 'direction must be "faster" or "slower"' });
      return;
    }
    const current = store.getState().teleprompter.speed;
    const speed = Math.max(0, Math.min(200, direction === 'faster' ? current + 10 : current - 10));
    try {
      await patchRemote(host, { speed });
      store.setState({ teleprompter: { ...store.getState().teleprompter, speed } });
      res.json({ ok: true, speed });
    } catch {
      res.status(502).json({ error: 'Teleprompter unreachable' });
    }
  });

  router.post('/font-size', requireOperator(auth), async (req: Request, res: Response) => {
    const host = guard(res);
    if (!host) return;
    const { direction } = req.body as { direction?: string };
    if (direction !== 'in' && direction !== 'out') {
      res.status(400).json({ error: 'direction must be "in" or "out"' });
      return;
    }
    const current = store.getState().teleprompter.fontSize;
    const fontSize = Math.max(24, Math.min(200, direction === 'in' ? current + 4 : current - 4));
    try {
      await patchRemote(host, { font_size: fontSize });
      store.setState({ teleprompter: { ...store.getState().teleprompter, fontSize } });
      res.json({ ok: true, fontSize });
    } catch {
      res.status(502).json({ error: 'Teleprompter unreachable' });
    }
  });

  router.post('/script', requireOperator(auth), async (req: Request, res: Response) => {
    const host = guard(res);
    if (!host) return;
    const { text } = req.body as { text?: string };
    if (typeof text !== 'string') {
      res.status(400).json({ error: 'text must be a string' });
      return;
    }
    try {
      await patchRemote(host, { script: text });
      res.json({ ok: true });
    } catch {
      res.status(502).json({ error: 'Teleprompter unreachable' });
    }
  });

  router.post('/config', requireAdmin(auth), async (req: Request, res: Response) => {
    const { host, enabled } = req.body as { host?: string; enabled?: boolean };
    const patch: { host?: string; enabled?: boolean } = {};
    if (typeof host === 'string') patch.host = host.trim();
    if (typeof enabled === 'boolean') patch.enabled = enabled;
    saveTeleprompterSettings(patch);
    const next = {
      ...store.getState().teleprompter,
      ...(patch.host !== undefined ? { host: patch.host } : {}),
      ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
    };
    store.setState({ teleprompter: next });
    res.json({ ok: true });
  });

  return router;
}
