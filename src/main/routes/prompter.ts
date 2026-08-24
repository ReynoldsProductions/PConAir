import { Router, Request, Response } from 'express';
import type { StateStore } from '../state';
import type { AuthManager } from '../auth';
import type { PrompterState } from '../../shared/types';
import { requireOperator, requireAdmin } from './middleware';
import { PROMPTER_PAGE_HTML, PROMPTER_CSP } from '../prompter/page';
import { forwardToExternalPrompter, type ForwardResult } from '../prompter/forward';
import {
  positionAt,
  start,
  stop,
  toggle,
  rewind,
  seek,
  nudgePosition,
  setSpeed,
  nudgeSpeed,
  setFontSize,
  nudgeFontSize,
  setLineHeight,
  setScript,
  setMirror,
  SPEED_STEP,
  FONT_SIZE_STEP,
} from '../prompter/transport';

export interface PrompterRouterDeps {
  store: StateStore;
  auth: AuthManager;
  /** Base URL of an optional third-party prompter service ('' when none). */
  getPrompterHost: () => string;
  /** Whether commands should also be forwarded to that service. */
  isPrompterEnabled: () => boolean;
  savePrompterSettings: (patch: { host?: string; enabled?: boolean }) => void;
  /** Fullscreen prompter output window (Electron main only); absent in tests. */
  prompterWindow?: {
    open: (displayId: string | null) => Promise<void>;
    close: () => void;
    status: () => { open: boolean; displayId: string | null };
  };
}

/** The subset of prompter state the talent display needs — no service config. */
function viewState(s: PrompterState) {
  return {
    script: s.script,
    scrolling: s.scrolling,
    speed: s.speed,
    fontSize: s.fontSize,
    lineHeight: s.lineHeight,
    offset: s.offset,
    startedAt: s.startedAt,
    mirrorX: s.mirrorX,
    mirrorY: s.mirrorY,
  };
}

function badRequest(res: Response, message: string): void {
  res.status(400).json({ error: { code: 'INVALID_MODE', message } });
}

export function createPrompterRouter(deps: PrompterRouterDeps): Router {
  const { store, auth, getPrompterHost, isPrompterEnabled, savePrompterSettings, prompterWindow } = deps;
  const router = Router();
  const opGuard = requireOperator(auth);

  function current(): PrompterState {
    return store.getState().prompter;
  }

  /**
   * Apply a transport op locally — that is what the built-in display follows —
   * then mirror it to a third-party prompter service if one is configured.
   * A service that is down never blocks the local prompter.
   */
  async function apply(
    next: PrompterState,
    forward: Record<string, unknown> | null,
    res: Response
  ): Promise<void> {
    store.setState({ prompter: next });
    const forwarded: ForwardResult = forward
      ? await forwardToExternalPrompter(
          { host: getPrompterHost(), enabled: isPrompterEnabled() },
          forward
        )
      : 'off';
    res.json({ ok: true, forwarded, prompter: next, position: positionAt(next, Date.now()) });
  }

  // ---- talent-facing display -------------------------------------------
  // Public on the LAN, like the render pages: the people reading off it are
  // on a tablet or a glass rig, not signing in with the operator PIN. Remote
  // access still goes through the tunnel PIN gate.
  router.get('/prompter', (_req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Security-Policy', PROMPTER_CSP);
    res.setHeader('Cache-Control', 'no-store, must-revalidate');
    res.send(PROMPTER_PAGE_HTML);
  });

  /** Hydration snapshot for the display, plus the server clock it derives its position from. */
  router.get('/api/prompter/view', (_req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ prompter: viewState(current()), serverNow: Date.now() });
  });

  // ---- operator control -------------------------------------------------
  router.get('/api/prompter/status', opGuard, async (_req: Request, res: Response) => {
    const s = current();
    const host = getPrompterHost();
    let connected = false;
    if (host) {
      try {
        const r = await fetch(`${host}/api/state`, { signal: AbortSignal.timeout(3000) });
        connected = r.ok;
      } catch {
        connected = false;
      }
    }
    res.json({
      prompter: s,
      position: positionAt(s, Date.now()),
      serverNow: Date.now(),
      external: { configured: host !== '', enabled: isPrompterEnabled(), connected },
      window: prompterWindow ? prompterWindow.status() : { open: false, displayId: null, available: false },
    });
  });

  /** Open or close the fullscreen prompter output on one of this machine's monitors. */
  router.post('/api/prompter/window', opGuard, async (req: Request, res: Response) => {
    if (!prompterWindow) {
      res.status(501).json({
        error: { code: 'NOT_IMPLEMENTED', message: 'Prompter output windows are only available in the desktop app' },
      });
      return;
    }
    const { open, displayId } = req.body as { open?: unknown; displayId?: unknown };
    if (typeof open !== 'boolean') {
      badRequest(res, 'open must be a boolean');
      return;
    }
    if (!open) {
      prompterWindow.close();
      res.json({ ok: true, window: prompterWindow.status() });
      return;
    }
    const target = typeof displayId === 'string' && displayId !== '' ? displayId : null;
    try {
      await prompterWindow.open(target);
    } catch {
      res.status(502).json({ error: { code: 'INVALID_MODE', message: 'Could not open the prompter output window' } });
      return;
    }
    res.json({ ok: true, window: prompterWindow.status() });
  });

  router.post('/api/prompter/start', opGuard, async (_req: Request, res: Response) => {
    await apply(start(current(), Date.now()), { scrolling: true }, res);
  });

  router.post('/api/prompter/stop', opGuard, async (_req: Request, res: Response) => {
    await apply(stop(current(), Date.now()), { scrolling: false }, res);
  });

  router.post('/api/prompter/toggle', opGuard, async (_req: Request, res: Response) => {
    const next = toggle(current(), Date.now());
    await apply(next, { scrolling: next.scrolling }, res);
  });

  router.post('/api/prompter/rewind', opGuard, async (_req: Request, res: Response) => {
    await apply(rewind(current(), Date.now()), null, res);
  });

  router.post('/api/prompter/position', opGuard, async (req: Request, res: Response) => {
    const { position, delta } = req.body as { position?: unknown; delta?: unknown };
    const now = Date.now();
    if (typeof position === 'number' && Number.isFinite(position)) {
      await apply(seek(current(), position, now), null, res);
      return;
    }
    if (typeof delta === 'number' && Number.isFinite(delta)) {
      await apply(nudgePosition(current(), delta, now), null, res);
      return;
    }
    badRequest(res, 'position or delta must be a number');
  });

  router.post('/api/prompter/scroll', opGuard, async (req: Request, res: Response) => {
    const { direction } = req.body as { direction?: string };
    if (direction !== 'faster' && direction !== 'slower') {
      badRequest(res, 'direction must be "faster" or "slower"');
      return;
    }
    const next = nudgeSpeed(current(), direction === 'faster' ? SPEED_STEP : -SPEED_STEP, Date.now());
    await apply(next, { speed: next.speed }, res);
  });

  router.post('/api/prompter/speed', opGuard, async (req: Request, res: Response) => {
    const { speed } = req.body as { speed?: unknown };
    if (typeof speed !== 'number' || !Number.isFinite(speed)) {
      badRequest(res, 'speed must be a number');
      return;
    }
    const next = setSpeed(current(), speed, Date.now());
    await apply(next, { speed: next.speed }, res);
  });

  router.post('/api/prompter/font-size', opGuard, async (req: Request, res: Response) => {
    const { direction, fontSize } = req.body as { direction?: string; fontSize?: unknown };
    let next: PrompterState;
    if (direction === 'in' || direction === 'out') {
      next = nudgeFontSize(current(), direction === 'in' ? FONT_SIZE_STEP : -FONT_SIZE_STEP);
    } else if (typeof fontSize === 'number' && Number.isFinite(fontSize)) {
      next = setFontSize(current(), fontSize);
    } else {
      badRequest(res, 'direction must be "in" or "out", or fontSize must be a number');
      return;
    }
    await apply(next, { font_size: next.fontSize }, res);
  });

  router.post('/api/prompter/line-height', opGuard, async (req: Request, res: Response) => {
    const { lineHeight } = req.body as { lineHeight?: unknown };
    if (typeof lineHeight !== 'number' || !Number.isFinite(lineHeight)) {
      badRequest(res, 'lineHeight must be a number');
      return;
    }
    await apply(setLineHeight(current(), lineHeight), null, res);
  });

  router.post('/api/prompter/mirror', opGuard, async (req: Request, res: Response) => {
    const { x, y } = req.body as { x?: unknown; y?: unknown };
    if (typeof x !== 'boolean' && typeof y !== 'boolean') {
      badRequest(res, 'x and/or y must be booleans');
      return;
    }
    const axes = {
      ...(typeof x === 'boolean' ? { x } : {}),
      ...(typeof y === 'boolean' ? { y } : {}),
    };
    await apply(setMirror(current(), axes), null, res);
  });

  router.post('/api/prompter/script', opGuard, async (req: Request, res: Response) => {
    const { text } = req.body as { text?: unknown };
    if (typeof text !== 'string') {
      badRequest(res, 'text must be a string');
      return;
    }
    await apply(setScript(current(), text, Date.now()), { script: text }, res);
  });

  // ---- admin config -----------------------------------------------------
  router.post('/api/prompter/config', requireAdmin(auth), (req: Request, res: Response) => {
    const { host, enabled } = req.body as { host?: string; enabled?: boolean };
    const patch: { host?: string; enabled?: boolean } = {};
    if (typeof host === 'string') patch.host = host.trim();
    if (typeof enabled === 'boolean') patch.enabled = enabled;
    savePrompterSettings(patch);
    const next: PrompterState = {
      ...current(),
      ...(patch.host !== undefined ? { host: patch.host } : {}),
      ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
    };
    store.setState({ prompter: next });
    res.json({ ok: true, prompter: next });
  });

  return router;
}
