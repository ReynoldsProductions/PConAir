import { Router, Request, Response } from 'express';
import type { StateStore } from '../state';
import type { AuthManager } from '../auth';
import type { ABInstance, InstanceState } from '../../shared/types';
import { requireOperator, isValidUrl } from './middleware';

export function createUrlRouter(store: StateStore, auth: AuthManager): Router {
  const router = Router();
  const opGuard = requireOperator(auth);

  // POST /api/url — load a URL into the active instance
  router.post('/', opGuard, (req: Request, res: Response) => {
    const { url, display } = req.body as { url?: string; display?: string };

    if (!url || !isValidUrl(url)) {
      res.status(400).json({ error: { code: 'INVALID_URL', message: 'url must be a valid http or https URL' } });
      return;
    }

    const state = store.getState();

    if (display !== undefined) {
      const found = state.displays.find((d) => d.id === display);
      if (!found) {
        res.status(404).json({ error: { code: 'DISPLAY_NOT_FOUND', message: `Display '${display}' not found` } });
        return;
      }
    }

    const active = state.abState.activeInstance;
    const instanceKey = active === 'A' ? 'instanceA' : 'instanceB';
    const updatedInstance: InstanceState = {
      ...state.abState[instanceKey],
      url,
      displayTarget: display ?? null,
      isLoading: true,
      isReady: false,
    };

    store.setState({
      currentMode: 'url',
      currentUrl: url,
      abState: { ...state.abState, [instanceKey]: updatedInstance },
    });

    const next = store.getState();
    res.json({
      currentMode: next.currentMode,
      currentUrl: next.currentUrl,
      abState: next.abState,
    });
  });

  // POST /api/url/reload — reload the specified (or active) instance
  router.post('/reload', opGuard, (req: Request, res: Response) => {
    const state = store.getState();
    const { instance } = req.body as { instance?: string };
    const target: ABInstance = (instance === 'A' || instance === 'B') ? instance : state.abState.activeInstance;
    const instanceKey = target === 'A' ? 'instanceA' : 'instanceB';
    const inst = state.abState[instanceKey];

    if (!inst.url) {
      res.status(400).json({ error: { code: 'INVALID_URL', message: `Instance ${target} has no URL loaded` } });
      return;
    }

    const updatedInstance: InstanceState = { ...inst, isLoading: true, isReady: false };
    store.setState({ abState: { ...state.abState, [instanceKey]: updatedInstance } });

    const next = store.getState();
    res.json({ abState: next.abState });
  });

  return router;
}
