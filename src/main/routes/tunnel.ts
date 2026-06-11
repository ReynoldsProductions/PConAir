import { Router, Request, Response } from 'express';
import os from 'os';
import QRCode from 'qrcode';
import bcrypt from 'bcryptjs';
import type { StateStore } from '../state';
import type { AuthManager } from '../auth';
import { requireAdmin, requireOperator } from './middleware';

export interface TunnelRouterDeps {
  store: StateStore;
  auth: AuthManager;
  /** Server port (for LAN URLs in QR codes). */
  port: number;
  /** Start/stop the cloudflared process; absent in tests → 501 on toggle. */
  startTunnel?: () => void;
  stopTunnel?: () => void;
  /** Persist tunnel settings (app-settings.json); absent in tests → in-memory only. */
  saveTunnelSettings?: (patch: { tunnelEnabled?: boolean; tunnelDomain?: string | null; tunnelToken?: string | null; tunnelPinHash?: string | null }) => void;
  /** Show the QR overlay window on a display (Electron); absent in tests → 501. */
  showQrOverlay?: (url: string, durationMs: number) => Promise<void>;
  hideQrOverlay?: () => void;
}

/** Best URL to reach the web GUI: tunnel when active, LAN hostname otherwise. */
export function publicRemoteUrl(store: StateStore, port: number): string {
  const tunnel = store.getState().tunnel;
  if (tunnel.status === 'active' && tunnel.url) {
    return `${tunnel.url.replace(/\/$/, '')}/remote/`;
  }
  return `http://${os.hostname()}:${port}/remote/`;
}

export function createTunnelRouter(deps: TunnelRouterDeps): Router {
  const { store, auth, port } = deps;
  const router = Router();
  const adminGuard = requireAdmin(auth);
  const opGuard = requireOperator(auth);

  router.get('/api/tunnel/status', (_req: Request, res: Response) => {
    res.json(store.getState().tunnel);
  });

  router.post('/api/tunnel', adminGuard, (req: Request, res: Response) => {
    const { enabled } = req.body as { enabled?: boolean };
    if (typeof enabled !== 'boolean') {
      res.status(400).json({ error: { code: 'INVALID_MODE', message: 'enabled must be a boolean' } });
      return;
    }
    if (!deps.startTunnel || !deps.stopTunnel) {
      res.status(501).json({ error: { code: 'INVALID_MODE', message: 'Tunnel control not available in this environment' } });
      return;
    }
    deps.saveTunnelSettings?.({ tunnelEnabled: enabled });
    if (enabled) {
      deps.startTunnel();
    } else {
      deps.stopTunnel();
    }
    res.json({ tunnel: store.getState().tunnel });
  });

  router.post('/api/tunnel/config', adminGuard, async (req: Request, res: Response) => {
    const { domain, token, pin } = req.body as { domain?: string | null; token?: string | null; pin?: string | null };
    const patch: { tunnelDomain?: string | null; tunnelToken?: string | null; tunnelPinHash?: string | null } = {};
    if (domain !== undefined) patch.tunnelDomain = domain === null || domain === '' ? null : String(domain);
    if (token !== undefined) patch.tunnelToken = token === null || token === '' ? null : String(token);
    if (pin !== undefined) {
      if (pin === null || pin === '') {
        patch.tunnelPinHash = null;
      } else {
        if (!/^\d{4,8}$/.test(String(pin))) {
          res.status(400).json({ error: { code: 'AUTH_REQUIRED', message: 'PIN must be 4-8 digits' } });
          return;
        }
        patch.tunnelPinHash = await bcrypt.hash(String(pin), 10);
      }
    }
    deps.saveTunnelSettings?.(patch);
    if (patch.tunnelPinHash !== undefined) {
      const s = store.getState();
      store.setState({ tunnel: { ...s.tunnel, pinRequired: patch.tunnelPinHash !== null } });
    }
    res.json({ tunnel: store.getState().tunnel });
  });

  // QR for the web GUI — one tap from the nav bar (unauthenticated GET on LAN).
  router.get('/api/qr', async (_req: Request, res: Response) => {
    const url = publicRemoteUrl(store, port);
    const qr = await QRCode.toDataURL(url, { width: 280, margin: 1 });
    res.json({ url, qr });
  });

  // GSC compat + plan: share link for the slides page.
  router.post('/api/slides/share-link', opGuard, async (_req: Request, res: Response) => {
    const url = publicRemoteUrl(store, port);
    const qr = await QRCode.toDataURL(url, { width: 280, margin: 1 });
    res.json({ url, qr });
  });

  // GSC compat: QR overlay on a physical display (cookie-less like other GSC endpoints).
  router.post('/api/show-tunnel-qr', async (req: Request, res: Response) => {
    if (!deps.showQrOverlay) {
      res.status(501).json({ error: 'QR overlay not available in this environment' });
      return;
    }
    const { duration } = req.body as { duration?: number };
    const durationMs = typeof duration === 'number' && duration > 0 ? Math.min(duration, 600) * 1000 : 30_000;
    await deps.showQrOverlay(publicRemoteUrl(store, port), durationMs);
    res.json({ success: true });
  });

  router.post('/api/hide-tunnel-qr', (_req: Request, res: Response) => {
    if (!deps.hideQrOverlay) {
      res.status(501).json({ error: 'QR overlay not available in this environment' });
      return;
    }
    deps.hideQrOverlay();
    res.json({ success: true });
  });

  // Plan: show QR on the presentation display from the slides page.
  router.post('/api/slides/show-qr', opGuard, async (req: Request, res: Response) => {
    if (!deps.showQrOverlay) {
      res.status(501).json({ error: { code: 'INVALID_MODE', message: 'QR overlay not available in this environment' } });
      return;
    }
    const { duration } = req.body as { duration?: number };
    const durationMs = typeof duration === 'number' && duration > 0 ? Math.min(duration, 600) * 1000 : 30_000;
    await deps.showQrOverlay(publicRemoteUrl(store, port), durationMs);
    res.json({ success: true });
  });

  return router;
}
