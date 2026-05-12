import { Router, Request, Response } from 'express';
import type { StateStore } from '../state';
import type { AuthManager } from '../auth';
import { requireOperator, requireAdmin } from './middleware';

const HEX_COLOR_RE = /^#[0-9A-Fa-f]{6}$/;

export function createBackgroundRouter(store: StateStore, auth: AuthManager): Router {
  const router = Router();

  // GET /api/background
  router.get('/', requireOperator(auth), (_req: Request, res: Response): void => {
    const { background } = store.getState();
    res.json({ background });
  });

  // POST /api/background
  router.post('/', requireAdmin(auth), (req: Request, res: Response): void => {
    const { presetId, type, value } = req.body as {
      presetId?: string;
      type?: string;
      value?: string;
    };

    // If presetId provided, always 404
    if (presetId !== undefined) {
      res.status(404).json({ error: { code: 'PRESET_NOT_FOUND', message: 'Preset not found' } });
      return;
    }

    // Validate type if provided
    if (type !== undefined && type !== 'luma' && type !== 'solid') {
      res.status(400).json({ error: { code: 'INVALID_MODE', message: 'Invalid background type; must be "luma" or "solid"' } });
      return;
    }

    // Validate value if provided
    if (value !== undefined && !HEX_COLOR_RE.test(value)) {
      res.status(400).json({ error: { code: 'INVALID_URL', message: 'Invalid background value; must match #RRGGBB format' } });
      return;
    }

    const current = store.getState().background;
    const newBackground = {
      presetId: null,
      presetName: null,
      type: (type as 'luma' | 'solid') ?? current.type,
      value: value ?? current.value,
    };

    store.setState({ background: newBackground });
    res.json({ background: newBackground });
  });

  return router;
}
