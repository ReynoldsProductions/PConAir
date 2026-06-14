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
import { validateKeyFillUrl } from '../services/key-fill';
import type { PerfectCuePortConfig } from '../app-settings';

/**
 * Electron-main hooks for the PerfectCue HTTP control surface. Absent in tests
 * and on servers without the listener wired (endpoints then 400 like before).
 */
export interface PerfectCueRouterDeps {
  /** Current PerfectCue settings (global enable + port configs). */
  getSettings: () => { perfectcueEnabled: boolean; perfectcuePorts: PerfectCuePortConfig[] };
  /** Persist a PerfectCue settings patch to app-settings.json. */
  saveSettings: (patch: { perfectcueEnabled?: boolean; perfectcuePorts?: PerfectCuePortConfig[] }) => void;
  /** Restart the TCP listeners (called after the global enable flag changes). */
  restart: () => void;
}

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

export interface GscCompatRouterDeps {
  /** Open key/fill windows in Electron (absent in tests — returns 503). */
  openKeyFillDisplays?: (opts: {
    fillUrl: string;
    keyUrl: string;
    fillBgColor: string;
    keyBgColor: string;
  }) => Promise<void>;
  /** Close key/fill windows in Electron (absent in tests — no-op acknowledged). */
  closeKeyFillDisplays?: () => void;
  /** PerfectCue listener control hooks (Electron main); absent in tests. */
  perfectcue?: PerfectCueRouterDeps;
}

export function createGscCompatRouter(store: StateStore, deps: GscCompatRouterDeps = {}): Router {
  const perfectcue = deps.perfectcue;
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

  // POST /open-key-fill — open fill window (color) on presentation display and
  // key window (grayscale luminance key) on notes display.
  router.post('/open-key-fill', (req: Request, res: Response) => {
    const body = req.body as {
      fillUrl?: unknown;
      keyUrl?: unknown;
      fillBgColor?: unknown;
      keyBgColor?: unknown;
    };
    const fillUrl = typeof body.fillUrl === 'string' ? body.fillUrl.trim() : '';
    const keyUrl = typeof body.keyUrl === 'string' ? body.keyUrl.trim() : '';
    const fillBgColor = typeof body.fillBgColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(body.fillBgColor.trim())
      ? body.fillBgColor.trim()
      : '#000000';
    const keyBgColor = typeof body.keyBgColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(body.keyBgColor.trim())
      ? body.keyBgColor.trim()
      : '#000000';

    const fillErr = validateKeyFillUrl(fillUrl);
    if (fillErr) {
      res.status(400).json({ error: `fillUrl: ${fillErr}` });
      return;
    }
    const keyErr = validateKeyFillUrl(keyUrl);
    if (keyErr) {
      res.status(400).json({ error: `keyUrl: ${keyErr}` });
      return;
    }

    if (!deps.openKeyFillDisplays) {
      res.status(503).json({ error: 'Key/fill display not available in this context' });
      return;
    }

    console.log('[API] Opening key/fill — fill:', fillUrl, 'key:', keyUrl, 'fillBg:', fillBgColor, 'keyBg:', keyBgColor);
    deps.openKeyFillDisplays({ fillUrl, keyUrl, fillBgColor, keyBgColor }).then(() => {
      res.json({ success: true, message: 'Key/fill opened' });
    }).catch((err: unknown) => {
      console.error('[API] Error opening key/fill:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: (err as Error).message ?? String(err) });
      }
    });
  });

  // POST /close-key-fill — close both key/fill windows.
  router.post('/close-key-fill', (_req: Request, res: Response) => {
    if (deps.closeKeyFillDisplays) {
      console.log('[API] Closing key/fill');
      deps.closeKeyFillDisplays();
    }
    res.json({ success: true, message: 'Key/fill closed' });
  });

  // Not (yet) supported by PConAir — honest failures so operators notice.
  for (const ep of [
    'toggle-video',
    'scroll-notes-up',
    'scroll-notes-down',
    'zoom-in-notes',
    'zoom-out-notes',
    'relaunch-speaker-notes',
    'open-preset',
    'set-backup-controls',
    'preferences',
  ]) {
    router.post(`/${ep}`, (_req: Request, res: Response) => notSupported(res, `/${ep}`));
  }

  // ── PerfectCue control ────────────────────────────────────────────────────
  // Master enable/disable. Restarts the TCP listeners (ports may differ once
  // re-enabled; disabling tears them down so no hardware can advance slides).
  router.post('/set-perfectcue-enabled', (req: Request, res: Response) => {
    if (!perfectcue) {
      notSupported(res, '/set-perfectcue-enabled');
      return;
    }
    const { enabled } = req.body as { enabled?: boolean };
    if (typeof enabled !== 'boolean') {
      res.status(400).json({ error: 'enabled (boolean) is required' });
      return;
    }
    perfectcue.saveSettings({ perfectcueEnabled: enabled });
    perfectcue.restart();
    res.json({ success: true, enabled });
  });

  // Per-port enable/disable. Applied immediately via the dispatch gate — the
  // TCP connection is NOT restarted, so the extender never disconnects.
  router.post('/toggle-perfectcue-port', (req: Request, res: Response) => {
    if (!perfectcue) {
      notSupported(res, '/toggle-perfectcue-port');
      return;
    }
    const { port, enabled } = req.body as { port?: number; enabled?: boolean };
    if (typeof port !== 'number' || typeof enabled !== 'boolean') {
      res.status(400).json({ error: 'port (number) and enabled (boolean) are required' });
      return;
    }
    const { perfectcuePorts } = perfectcue.getSettings();
    const target = perfectcuePorts.find((p) => p.port === port);
    if (!target) {
      res.status(404).json({ error: `No PerfectCue port configured on ${port}` });
      return;
    }
    const updated = perfectcuePorts.map((p) => (p.port === port ? { ...p, enabled } : p));
    perfectcue.saveSettings({ perfectcuePorts: updated });
    // No restart: gate reads settings live, so the change takes effect at once.
    res.json({ success: true, port, enabled });
  });

  return router;
}
