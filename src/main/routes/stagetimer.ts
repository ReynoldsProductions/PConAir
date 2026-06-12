import { Router, Request, Response } from 'express';
import type { StateStore } from '../state';
import type { AuthManager } from '../auth';
import type { StageTimerOverlayPosition } from '../../shared/types';
import { isValidOverlayPosition, isValidOverlaySize } from '../app-settings';
import { requireAdmin, requireOperator } from './middleware';

export interface StageTimerRouterDeps {
  store: StateStore;
  auth: AuthManager;
  /** Electron overlay window hooks; absent in tests → state still updates. */
  showOverlay?: (position: StageTimerOverlayPosition, sizePercent: number) => void;
  hideOverlay?: () => void;
  updateOverlaySettings?: (position: StageTimerOverlayPosition, sizePercent: number) => void;
  /** Persist stagetimer settings (app-settings.json); absent in tests → in-memory only. */
  saveStageTimerSettings?: (patch: {
    stagetimerRoomId?: string | null;
    stagetimerApiKey?: string | null;
    stageTimerOverlayPosition?: StageTimerOverlayPosition;
    stageTimerOverlaySize?: number;
    stageTimerOverlayEnabled?: boolean;
  }) => void;
  /** Current API key presence (config, not state); used to compute `configured`. */
  hasApiKey?: () => boolean;
}

/**
 * Stagetimer.io overlay control. The GSC-compat endpoints
 * (/api/show-stage-timer-overlay etc.) are cookie-less like the rest of the
 * GSC surface — the global IP-allowlist middleware gates them.
 */
export function createStageTimerRouter(deps: StageTimerRouterDeps): Router {
  const { store, auth } = deps;
  const router = Router();
  const adminGuard = requireAdmin(auth);
  const opGuard = requireOperator(auth);

  function setOverlayEnabled(enabled: boolean): void {
    const st = store.getState().stageTimer;
    store.setState({ stageTimer: { ...st, overlayEnabled: enabled } });
    deps.saveStageTimerSettings?.({ stageTimerOverlayEnabled: enabled });
    if (enabled) {
      deps.showOverlay?.(st.overlayPosition, st.overlaySize);
    } else {
      deps.hideOverlay?.();
    }
  }

  function applyOverlaySettings(position?: StageTimerOverlayPosition, size?: number): void {
    const st = store.getState().stageTimer;
    const newPosition = position ?? st.overlayPosition;
    const newSize = size ?? st.overlaySize;
    store.setState({ stageTimer: { ...st, overlayPosition: newPosition, overlaySize: newSize } });
    deps.saveStageTimerSettings?.({
      stageTimerOverlayPosition: newPosition,
      stageTimerOverlaySize: newSize,
    });
    if (st.overlayEnabled) {
      deps.updateOverlaySettings?.(newPosition, newSize);
    }
  }

  // ── native API ──────────────────────────────────────────────────────────

  router.get('/api/stagetimer', (_req: Request, res: Response) => {
    res.json({ stageTimer: store.getState().stageTimer });
  });

  router.post('/api/stagetimer/overlay', opGuard, (req: Request, res: Response) => {
    const { enabled } = req.body as { enabled?: boolean };
    if (typeof enabled !== 'boolean') {
      res.status(400).json({ error: { code: 'INVALID_MODE', message: 'enabled must be a boolean' } });
      return;
    }
    setOverlayEnabled(enabled);
    res.json({ stageTimer: store.getState().stageTimer });
  });

  router.post('/api/stagetimer/config', adminGuard, (req: Request, res: Response) => {
    const { roomId, apiKey, position, size } = req.body as {
      roomId?: string | null;
      apiKey?: string | null;
      position?: string;
      size?: number;
    };
    if (position !== undefined && !isValidOverlayPosition(position)) {
      res.status(400).json({
        error: { code: 'INVALID_MODE', message: 'position must be one of: bottom-left, bottom-right, top-left, top-right' },
      });
      return;
    }
    if (size !== undefined && !isValidOverlaySize(size)) {
      res.status(400).json({ error: { code: 'INVALID_MODE', message: 'size must be an integer 1-100' } });
      return;
    }

    const credPatch: { stagetimerRoomId?: string | null; stagetimerApiKey?: string | null } = {};
    if (roomId !== undefined) credPatch.stagetimerRoomId = roomId === null || roomId === '' ? null : String(roomId);
    if (apiKey !== undefined) credPatch.stagetimerApiKey = apiKey === null || apiKey === '' ? null : String(apiKey);
    if (Object.keys(credPatch).length > 0) {
      deps.saveStageTimerSettings?.(credPatch);
      const st = store.getState().stageTimer;
      const newRoomId = credPatch.stagetimerRoomId !== undefined ? credPatch.stagetimerRoomId : st.roomId;
      const keySet = credPatch.stagetimerApiKey !== undefined ? credPatch.stagetimerApiKey !== null : (deps.hasApiKey?.() ?? false);
      store.setState({
        stageTimer: { ...st, roomId: newRoomId, configured: newRoomId !== null && keySet },
      });
      // Credentials are baked into the overlay page — reopen a visible overlay.
      if (st.overlayEnabled && deps.showOverlay && deps.hideOverlay) {
        deps.hideOverlay();
        const after = store.getState().stageTimer;
        deps.showOverlay(after.overlayPosition, after.overlaySize);
      }
    }
    if (position !== undefined || size !== undefined) {
      applyOverlaySettings(position as StageTimerOverlayPosition | undefined, size);
    }
    res.json({ stageTimer: store.getState().stageTimer });
  });

  // ── GSC compat (cookie-less, IP-allowlist-gated) ───────────────────────

  router.post('/api/show-stage-timer-overlay', (_req: Request, res: Response) => {
    setOverlayEnabled(true);
    res.json({ success: true, stageTimerOverlayEnabled: true });
  });

  router.post('/api/hide-stage-timer-overlay', (_req: Request, res: Response) => {
    setOverlayEnabled(false);
    res.json({ success: true, stageTimerOverlayEnabled: false });
  });

  router.post('/api/update-stage-timer-overlay-settings', (req: Request, res: Response) => {
    const body = (req.body ?? {}) as { position?: unknown; size?: unknown };
    const position = typeof body.position === 'string' ? body.position : undefined;
    const size = typeof body.size === 'number' ? Math.round(body.size) : undefined;
    if (position !== undefined && !isValidOverlayPosition(position)) {
      res.status(400).json({ error: 'Invalid position. Must be one of: bottom-left, bottom-right, top-left, top-right' });
      return;
    }
    if (size !== undefined && !isValidOverlaySize(size)) {
      res.status(400).json({ error: 'Invalid size. Must be integer 1–100' });
      return;
    }
    applyOverlaySettings(position as StageTimerOverlayPosition | undefined, size);
    const st = store.getState().stageTimer;
    res.json({
      success: true,
      stageTimerOverlayPosition: st.overlayPosition,
      stageTimerOverlaySize: st.overlaySize,
    });
  });

  return router;
}
