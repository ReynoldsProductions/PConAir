import { Router, Request, Response } from 'express';
import type { StateStore } from '../state';
import type { AuthManager } from '../auth';
import type { Mode } from '../../shared/types';
import { requireOperator } from './middleware';

const VALID_MODES: Mode[] = ['slides', 'url', 'l3', 'media-library', 'idle'];
const START_TIME = Date.now();

export function createApiRouter(store: StateStore, auth: AuthManager): Router {
  const router = Router();
  const opGuard = requireOperator(auth);

  router.get('/status', opGuard, (_req: Request, res: Response) => {
    res.json(store.getState());
  });

  router.get('/health', opGuard, (_req: Request, res: Response) => {
    const state = store.getState();
    res.json({
      version: process.env.npm_package_version ?? '0.1.0',
      uptime: Math.floor((Date.now() - START_TIME) / 1000),
      currentMode: state.currentMode,
      wsClients: state.connectionStatus.webSocketClients,
      companionConnected: state.connectionStatus.companionConnected,
      lastError: null,
    });
  });

  router.get('/displays', opGuard, (_req: Request, res: Response) => {
    res.json({ displays: store.getState().displays });
  });

  router.post('/mode', opGuard, (req: Request, res: Response) => {
    const { mode } = req.body as { mode?: string };
    if (!mode || !VALID_MODES.includes(mode as Mode)) {
      res.status(400).json({
        error: { code: 'INVALID_MODE', message: `mode must be one of: ${VALID_MODES.join(', ')}` },
      });
      return;
    }
    store.setState({ currentMode: mode as Mode });
    res.json({ currentMode: mode as Mode });
  });

  router.post('/ab/switch', opGuard, (req: Request, res: Response) => {
    const { instance } = req.body as { instance?: string };
    if (instance !== 'A' && instance !== 'B') {
      res.status(400).json({ error: { code: 'INVALID_MODE', message: 'instance must be "A" or "B"' } });
      return;
    }
    const state = store.getState();
    store.setState({
      abState: { ...state.abState, activeInstance: instance as 'A' | 'B' },
    });
    res.json({ abState: { activeInstance: instance as 'A' | 'B' } });
  });

  return router;
}
