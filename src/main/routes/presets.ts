import { Router, Request, Response } from 'express';
import type { StateStore } from '../state';
import type { AuthManager } from '../auth';
import type { PresetsStore } from '../presets';
import type { SessionMode } from '../../shared/types';
import { requireOperator, requireAdmin, isValidUrl } from './middleware';

export function createPresetsRouter(store: StateStore, auth: AuthManager, presets: PresetsStore): Router {
  const router = Router();
  const opGuard = requireOperator(auth);
  const adminGuard = requireAdmin(auth);

  // GET /api/presets — list all presets (operator)
  router.get('/', opGuard, (_req: Request, res: Response) => {
    res.json({ presets: presets.list() });
  });

  // POST /api/presets — create or update preset (admin)
  router.post('/', adminGuard, (req: Request, res: Response) => {
    const { id, name, url, sessionMode, displayTarget, description } = req.body as {
      id?: string;
      name?: string;
      url?: string;
      sessionMode?: string;
      displayTarget?: string | null;
      description?: string | null;
    };

    if (!url || !isValidUrl(url)) {
      res.status(400).json({ error: { code: 'INVALID_URL', message: 'url must be a valid http or https URL' } });
      return;
    }
    if (!name) {
      res.status(400).json({ error: { code: 'INVALID_URL', message: 'name is required' } });
      return;
    }
    if (sessionMode !== 'persistent' && sessionMode !== 'ephemeral') {
      res.status(400).json({ error: { code: 'INVALID_MODE', message: 'sessionMode must be "persistent" or "ephemeral"' } });
      return;
    }

    if (id && presets.findById(id)) {
      const updated = presets.update(id, {
        name,
        url,
        sessionMode: sessionMode as SessionMode,
        displayTarget: displayTarget ?? null,
        description: description ?? null,
      });
      if (!updated) {
        res.status(404).json({ error: { code: 'PRESET_NOT_FOUND', message: `Preset '${id}' not found` } });
        return;
      }
      res.json(updated);
    } else {
      const created = presets.create({
        name,
        url,
        sessionMode: sessionMode as SessionMode,
        displayTarget: displayTarget ?? null,
        description: description ?? null,
      });
      res.status(201).json(created);
    }
  });

  // DELETE /api/presets/:id — delete preset (admin)
  router.delete('/:id', adminGuard, (req: Request, res: Response) => {
    const { id } = req.params;
    if (!presets.findById(id)) {
      res.status(404).json({ error: { code: 'PRESET_NOT_FOUND', message: `Preset '${id}' not found` } });
      return;
    }
    presets.remove(id);
    // Nullify currentPreset in app state if the deleted preset was active
    const state = store.getState();
    if (state.currentPreset?.id === id) {
      store.setState({ currentPreset: null });
    }
    res.status(204).end();
  });

  return router;
}
