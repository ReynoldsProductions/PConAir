import { Router, Request, Response } from 'express';
import type { StateStore } from '../state';
import type { AuthManager } from '../auth';
import type { L3CueStore } from '../l3/cue-store';
import type { L3PlaylistStore } from '../l3/playlist-store';
import type { L3State } from '../../shared/types';
import { requireOperator, requireAdmin } from './middleware';
import { l3ClearOp, l3StackingOp, l3TakeOp } from '../l3/take-ops';

function emptyL3(): L3State {
  return {
    activeCueId: null,
    activeCueName: null,
    activeTitle: null,
    isStacking: false,
    currentPlaylistId: null,
  };
}

function ensureL3(state: ReturnType<StateStore['getState']>): L3State {
  return state.l3 ?? emptyL3();
}

export function createL3Router(
  store: StateStore,
  auth: AuthManager,
  cues: L3CueStore,
  playlists: L3PlaylistStore
): Router {
  const router = Router();
  const opGuard = requireOperator(auth);
  const adminGuard = requireAdmin(auth);

  router.post('/take', opGuard, (req: Request, res: Response) => {
    const { cueId, name, title, theme } = req.body as {
      cueId?: string;
      name?: string;
      title?: string;
      theme?: string;
    };
    void theme;
    const r = l3TakeOp(store, cues, { cueId, name, title, theme });
    if (!r.ok) {
      res.status(r.status).json({ error: r.error });
      return;
    }
    res.json(r.body);
  });

  router.post('/clear', opGuard, (_req: Request, res: Response) => {
    const r = l3ClearOp(store);
    res.json(r.body);
  });

  router.post('/stacking', opGuard, (req: Request, res: Response) => {
    const { enabled } = req.body as { enabled?: unknown };
    if (typeof enabled !== 'boolean') {
      res.status(400).json({ error: { code: 'INVALID_MODE', message: 'enabled must be a boolean' } });
      return;
    }
    const r = l3StackingOp(store, enabled);
    if (!r.ok) {
      res.status(r.status).json({ error: r.error });
      return;
    }
    res.json(r.body);
  });

  router.get('/cues', opGuard, (_req: Request, res: Response) => {
    res.json({ cues: cues.list() });
  });

  router.post('/cues', adminGuard, (req: Request, res: Response) => {
    const { name, title, subtitle, theme } = req.body as {
      name?: string;
      title?: string;
      subtitle?: string | null;
      theme?: string;
    };
    if (!name || typeof name !== 'string' || !name.trim()) {
      res.status(400).json({ error: { code: 'INVALID_MODE', message: 'name is required' } });
      return;
    }
    if (!title || typeof title !== 'string' || !title.trim()) {
      res.status(400).json({ error: { code: 'INVALID_MODE', message: 'title is required' } });
      return;
    }
    const th = theme && typeof theme === 'string' && theme.trim() ? theme.trim() : 'default';
    const cue = cues.create({
      name: name.trim().slice(0, 100),
      title: title.trim().slice(0, 100),
      subtitle: subtitle != null ? String(subtitle).slice(0, 100) : null,
      theme: th,
    });
    res.status(201).json(cue);
  });

  router.delete('/cues/:cueId', adminGuard, (req: Request, res: Response) => {
    const { cueId } = req.params;
    if (!cues.findById(cueId)) {
      res.status(404).json({ error: { code: 'CUE_NOT_FOUND', message: `Cue '${cueId}' not found` } });
      return;
    }
    cues.remove(cueId);
    const st = store.getState();
    if (st.l3?.activeCueId === cueId) {
      store.setState({
        l3: st.l3
          ? { ...st.l3, activeCueId: null, activeCueName: null, activeTitle: null }
          : emptyL3(),
      });
    }
    res.status(204).end();
  });

  router.get('/playlists', opGuard, (_req: Request, res: Response) => {
    res.json({ playlists: playlists.list() });
  });

  router.post('/playlists', adminGuard, (req: Request, res: Response) => {
    const { name, cueIds } = req.body as { name?: string; cueIds?: unknown };
    if (!name || typeof name !== 'string' || !name.trim()) {
      res.status(400).json({ error: { code: 'INVALID_MODE', message: 'name is required' } });
      return;
    }
    if (!Array.isArray(cueIds)) {
      res.status(400).json({ error: { code: 'INVALID_MODE', message: 'cueIds must be an array' } });
      return;
    }
    const ids = cueIds.map((x) => String(x));
    const created = playlists.create({ name: name.trim(), cueIds: ids });
    if (!created.ok) {
      res.status(404).json({
        error: { code: 'CUE_NOT_FOUND', message: `Cue '${created.missingCueId}' not found` },
      });
      return;
    }
    res.status(201).json(created.playlist);
  });

  router.get('/playlists/:id', opGuard, (req: Request, res: Response) => {
    const p = playlists.findById(req.params.id);
    if (!p) {
      res.status(404).json({ error: { code: 'PRESET_NOT_FOUND', message: `Playlist '${req.params.id}' not found` } });
      return;
    }
    res.json(p);
  });

  router.put('/playlists/:id', adminGuard, (req: Request, res: Response) => {
    const { name, cueIds } = req.body as { name?: string; cueIds?: unknown };
    const patch: { name?: string; cueIds?: string[] } = {};
    if (name !== undefined) {
      if (typeof name !== 'string' || !name.trim()) {
        res.status(400).json({ error: { code: 'INVALID_MODE', message: 'name must be a non-empty string' } });
        return;
      }
      patch.name = name.trim();
    }
    if (cueIds !== undefined) {
      if (!Array.isArray(cueIds)) {
        res.status(400).json({ error: { code: 'INVALID_MODE', message: 'cueIds must be an array' } });
        return;
      }
      patch.cueIds = cueIds.map((x) => String(x));
    }
    const updated = playlists.update(req.params.id, patch);
    if (!updated.ok) {
      if (updated.reason === 'not_found') {
        res.status(404).json({ error: { code: 'PRESET_NOT_FOUND', message: `Playlist '${req.params.id}' not found` } });
        return;
      }
      res.status(404).json({
        error: { code: 'CUE_NOT_FOUND', message: `Cue '${updated.missingCueId}' not found` },
      });
      return;
    }
    res.json(updated.playlist);
  });

  router.delete('/playlists/:id', adminGuard, (req: Request, res: Response) => {
    const id = req.params.id;
    if (!playlists.findById(id)) {
      res.status(404).json({ error: { code: 'PRESET_NOT_FOUND', message: `Playlist '${id}' not found` } });
      return;
    }
    playlists.remove(id);
    const st = store.getState();
    if (st.l3?.currentPlaylistId === id) {
      store.setState({ l3: st.l3 ? { ...st.l3, currentPlaylistId: null } : emptyL3() });
    }
    res.status(204).end();
  });

  router.post('/playlists/:id/activate', adminGuard, (req: Request, res: Response) => {
    const id = req.params.id;
    if (!playlists.findById(id)) {
      res.status(404).json({ error: { code: 'PRESET_NOT_FOUND', message: `Playlist '${id}' not found` } });
      return;
    }
    const base = ensureL3(store.getState());
    store.setState({ l3: { ...base, currentPlaylistId: id } });
    res.json({ l3: { currentPlaylistId: id } });
  });

  return router;
}
