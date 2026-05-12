import { Router, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import type { StateStore } from '../state';
import type { AuthManager } from '../auth';
import type { ProfilePaths } from '../profiles/paths';
import { loadProfile, writeProfile } from '../profiles/bootstrap';
import { requireOperator, requireAdmin } from './middleware';

const HEX_COLOR_RE = /^#[0-9A-Fa-f]{6}$/;

export interface BackgroundRouterDeps {
  store: StateStore;
  auth: AuthManager;
  paths: ProfilePaths;
  getActiveProfileId: () => string;
}

export function createBackgroundRouter(d: BackgroundRouterDeps): Router {
  const { store, auth, paths, getActiveProfileId } = d;
  const router = Router();
  const opGuard = requireOperator(auth);
  const adminGuard = requireAdmin(auth);

  // GET /api/background — current live background state
  router.get('/', opGuard, (_req: Request, res: Response) => {
    res.json({ background: store.getState().background });
  });

  // GET /api/background/presets — list presets from active profile
  router.get('/presets', adminGuard, (_req: Request, res: Response) => {
    const profile = loadProfile(paths, getActiveProfileId());
    res.json({ presets: profile?.backgroundPresets ?? [] });
  });

  // POST /api/background/presets — create a new background preset
  router.post('/presets', adminGuard, (req: Request, res: Response) => {
    const { name, type, value } = req.body as { name?: string; type?: string; value?: string };

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      res.status(400).json({ error: { code: 'INVALID_MODE', message: 'name is required' } });
      return;
    }
    if (type !== 'luma' && type !== 'solid') {
      res.status(400).json({ error: { code: 'INVALID_MODE', message: 'type must be "luma" or "solid"' } });
      return;
    }
    if (!value || !HEX_COLOR_RE.test(value)) {
      res.status(400).json({ error: { code: 'INVALID_URL', message: 'value must be #RRGGBB' } });
      return;
    }

    const now = new Date().toISOString();
    const preset = { id: randomUUID(), name: name.trim(), type: type as 'luma' | 'solid', value, createdAt: now, updatedAt: now };

    const id = getActiveProfileId();
    const profile = loadProfile(paths, id);
    if (!profile) {
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'No active profile' } });
      return;
    }
    writeProfile(paths, { ...profile, backgroundPresets: [...profile.backgroundPresets, preset], updatedAt: now });

    res.status(201).json({ preset });
  });

  // DELETE /api/background/presets/:id — remove a background preset
  router.delete('/presets/:id', adminGuard, (req: Request, res: Response) => {
    const activeId = getActiveProfileId();
    const profile = loadProfile(paths, activeId);
    if (!profile) {
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'No active profile' } });
      return;
    }
    const before = profile.backgroundPresets.length;
    const updated = profile.backgroundPresets.filter((p) => p.id !== req.params['id']);
    if (updated.length === before) {
      res.status(404).json({ error: { code: 'PRESET_NOT_FOUND', message: 'Preset not found' } });
      return;
    }
    writeProfile(paths, { ...profile, backgroundPresets: updated, updatedAt: new Date().toISOString() });
    res.status(204).end();
  });

  // POST /api/background — set live background (by presetId or by type+value)
  router.post('/', adminGuard, (req: Request, res: Response) => {
    const { presetId, type, value } = req.body as {
      presetId?: string | null;
      type?: string;
      value?: string;
    };

    // Spec 02 §2.6: presetId optional; null/undefined → direct type/value path.
    if (presetId != null) {
      if (typeof presetId !== 'string') {
        res.status(400).json({ error: { code: 'INVALID_MODE', message: 'presetId must be a string when provided' } });
        return;
      }
      if (presetId.length === 0) {
        res.status(404).json({ error: { code: 'PRESET_NOT_FOUND', message: 'Preset not found' } });
        return;
      }

      const profile = loadProfile(paths, getActiveProfileId());
      if (!profile) {
        res.status(404).json({ error: { code: 'PRESET_NOT_FOUND', message: 'Active profile not found' } });
        return;
      }

      const preset = profile.backgroundPresets.find((p) => p.id === presetId);
      if (!preset) {
        res.status(404).json({ error: { code: 'PRESET_NOT_FOUND', message: 'Preset not found' } });
        return;
      }

      if (preset.type !== 'luma' && preset.type !== 'solid') {
        res.status(500).json({ error: { code: 'INVALID_MODE', message: 'Stored background preset has invalid type' } });
        return;
      }

      if (!HEX_COLOR_RE.test(preset.value)) {
        res.status(500).json({ error: { code: 'INVALID_URL', message: 'Stored background preset has invalid color value' } });
        return;
      }

      const newBackground = { presetId: preset.id, presetName: preset.name, type: preset.type, value: preset.value };
      store.setState({ background: newBackground });
      res.json({ background: newBackground });
      return;
    }

    if (type !== undefined && type !== 'luma' && type !== 'solid') {
      res.status(400).json({ error: { code: 'INVALID_MODE', message: 'Invalid background type; must be "luma" or "solid"' } });
      return;
    }
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
