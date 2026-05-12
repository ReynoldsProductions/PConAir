import { Router, Request, Response } from 'express';
import type { StateStore } from '../state';
import type { AuthManager } from '../auth';
import type { ReliabilityStore } from '../reliability-store';
import type { AppState, Mode, ABInstance } from '../../shared/types';
import { requireOperator, requireAdmin } from './middleware';

const VALID_MODES: Mode[] = ['slides', 'url', 'l3', 'media-library', 'idle'];

export interface CreateApiRouterDeps {
  store: StateStore;
  auth: AuthManager;
  reliability: ReliabilityStore;
  serverStartedAt: number;
  buildDateIso: string;
  getAdminShowLocked: () => boolean;
  setAdminShowLocked: (locked: boolean) => void;
  syncAdminShowLockedToStore: () => void;
  getActiveProfileId: () => string;
}

function instKey(instance: ABInstance): 'instanceA' | 'instanceB' {
  return instance === 'A' ? 'instanceA' : 'instanceB';
}

export function createApiRouter(deps: CreateApiRouterDeps): Router {
  const {
    store,
    auth,
    reliability,
    serverStartedAt,
    buildDateIso,
    getAdminShowLocked,
    setAdminShowLocked,
    syncAdminShowLockedToStore,
    getActiveProfileId,
  } = deps;

  const router = Router();
  const opGuard = requireOperator(auth);
  const adminGuard = requireAdmin(auth);
  const reloadTimers = new Map<ABInstance, ReturnType<typeof setTimeout>>();

  router.get('/status', opGuard, (_req: Request, res: Response) => {
    res.json(store.getState());
  });

  router.get('/health', adminGuard, (_req: Request, res: Response) => {
    const state = store.getState();
    const mem = process.memoryUsage();
    const heapUsedMb = Math.round(mem.heapUsed / (1024 * 1024));
    const heapTotalMb = Math.round(mem.heapTotal / (1024 * 1024));
    const pctUsed = mem.heapTotal > 0 ? Math.round((mem.heapUsed / mem.heapTotal) * 100) : 0;
    const trend = reliability.pushHeapSample(mem.heapUsed);
    reliability.maybeLogMemoryPressure(heapUsedMb, heapTotalMb, pctUsed);

    const locked = getAdminShowLocked();
    const hb = reliability.getCompanionLastHeartbeat();
    const electronVer = process.versions.electron ?? null;

    res.json({
      app: {
        version: process.env.npm_package_version ?? '0.1.0',
        buildDate: buildDateIso,
        mode: locked ? 'Show Locked' : 'Rehearsal',
        uptime: Math.floor((Date.now() - serverStartedAt) / 1000),
      },
      environment: {
        node: process.version.replace(/^v/, ''),
        electron: electronVer,
        os: process.platform === 'darwin' ? 'macOS' : process.platform,
        platform: process.platform,
        arch: process.arch,
      },
      operator: {
        activeProfile: getActiveProfileId(),
        currentMode:
          state.currentMode === 'media-library'
            ? 'Media Library'
            : state.currentMode.charAt(0).toUpperCase() + state.currentMode.slice(1),
        connectedClients: state.connectionStatus.webSocketClients,
      },
      companion: {
        connected: state.connectionStatus.companionConnected,
        lastHeartbeat: hb,
        version: null as string | null,
      },
      errors: reliability.getErrors(),
      warnings: reliability.getWarnings(),
      infrastructure: {
        wanTunnel: {
          status: 'Inactive' as const,
          url: null as string | null,
          lastHeartbeat: null as string | null,
        },
        displays: state.displays.map((d) => ({
          id: d.id,
          name: d.name,
          instance: state.abState.activeInstance,
          url: state.currentUrl,
          lastUpdate: new Date().toISOString(),
        })),
      },
      resources: {
        memory: {
          heapUsed: heapUsedMb,
          heapTotal: heapTotalMb,
          percentUsed: pctUsed,
        },
        trend,
      },
      watchdog: state.watchdog,
    });
  });

  router.post('/panic', opGuard, (req: Request, res: Response) => {
    const { action } = req.body as { action?: string };
    if (action !== 'toggle' && action !== 'on' && action !== 'off') {
      res.status(400).json({
        error: { code: 'INVALID_MODE', message: 'action must be "toggle", "on", or "off"' },
      });
      return;
    }
    const rel = store.getState().reliability;
    let next: boolean;
    if (action === 'toggle') next = !rel.panicActive;
    else if (action === 'on') next = true;
    else next = false;
    store.setState({
      reliability: { panicActive: next, panicSlate: rel.panicSlate },
    });
    const slate = store.getState().reliability.panicSlate;
    res.json({
      panicActive: next,
      slate: { type: slate.type, value: slate.value },
      message: next ? 'Panic activated — output hidden' : 'Panic cleared — output restored',
    });
  });

  router.post('/reload-instance', opGuard, (req: Request, res: Response) => {
    const { instance, timeout: timeoutRaw } = req.body as { instance?: string; timeout?: number };
    if (instance !== 'A' && instance !== 'B') {
      res.status(400).json({ error: { code: 'INVALID_MODE', message: 'instance must be "A" or "B"' } });
      return;
    }
    if (
      timeoutRaw !== undefined &&
      (typeof timeoutRaw !== 'number' || timeoutRaw <= 0 || timeoutRaw > 120)
    ) {
      res.status(400).json({
        error: { code: 'INVALID_MODE', message: 'timeout must be between 1 and 120 seconds' },
      });
      return;
    }
    const inst = instance as ABInstance;
    const state = store.getState();
    if (inst === state.abState.activeInstance) {
      res.status(400).json({
        error: {
          code: 'INVALID_INSTANCE',
          message: 'Cannot reload on-air instance; use off-air instance for safe reload.',
        },
      });
      return;
    }
    /** Simulated async completion (real URL/slides reload is slower; short delay for tests/SOP polling). */
    const delayMs = 50;

    const prevT = reloadTimers.get(inst);
    if (prevT) clearTimeout(prevT);

    const key = instKey(inst);
    const cur = state.abState[key];
    store.setState({
      abState: {
        ...state.abState,
        [key]: { ...cur, isLoading: true, isReady: false },
      },
    });

    const startIso = new Date().toISOString();
    const t = setTimeout(() => {
      const s = store.getState();
      const k = instKey(inst);
      const row = s.abState[k];
      store.setState({
        abState: {
          ...s.abState,
          [k]: { ...row, isLoading: false, isReady: true },
        },
      });
      reloadTimers.delete(inst);
    }, delayMs);
    reloadTimers.set(inst, t);

    res.status(202).json({
      status: 'reloading',
      instance: inst,
      startTime: startIso,
      estimatedComplete: new Date(Date.now() + delayMs).toISOString(),
    });
  });

  router.get('/instance-status', opGuard, (req: Request, res: Response) => {
    const q = req.query.instance as string | undefined;
    if (q !== 'A' && q !== 'B') {
      res.status(400).json({ error: { code: 'INVALID_MODE', message: 'instance query must be A or B' } });
      return;
    }
    const inst = q as ABInstance;
    const state = store.getState();
    const row = state.abState[instKey(inst)];
    const status = row.isLoading ? 'loading' : row.isReady ? 'ready' : 'idle';
    const url = row.url ?? state.currentUrl;
    res.json({
      instance: inst,
      status,
      url,
      lastUpdate: new Date().toISOString(),
      message: `Instance ${inst} — ${status === 'ready' ? 'Ready' : status === 'loading' ? 'Loading' : 'Idle'}`,
    });
  });

  router.post('/show-lock', adminGuard, (req: Request, res: Response) => {
    const { action, confirmationToken } = req.body as { action?: string; confirmationToken?: string };
    if (action === 'unlock') {
      setAdminShowLocked(false);
      syncAdminShowLockedToStore();
      res.json({
        showLockActive: false,
        message: 'Show lock cleared — rehearsal mode',
      });
      return;
    }
    if (action !== 'lock') {
      res.status(400).json({ error: { code: 'INVALID_MODE', message: 'action must be "lock" or "unlock"' } });
      return;
    }
    if (getAdminShowLocked()) {
      res.status(400).json({
        error: { code: 'INVALID_MODE', message: 'Show lock is already active' },
      });
      return;
    }
    if (!confirmationToken) {
      const arm = reliability.armShowLock();
      res.status(202).json({
        status: arm.status,
        message: arm.message,
        confirmationToken: arm.confirmationToken,
      });
      return;
    }
    const consumed = reliability.consumeShowLockConfirmation(confirmationToken);
    if (!consumed.ok) {
      res.status(400).json({
        error: {
          code: 'INVALID_TOKEN',
          message: consumed.reason === 'expired' ? 'Confirmation token expired' : 'Invalid confirmation token',
        },
      });
      return;
    }
    setAdminShowLocked(true);
    syncAdminShowLockedToStore();
    res.json({
      showLockActive: true,
      message: 'Admin is now locked — access to /admin is blocked',
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
    const nextMode = mode as Mode;
    const patch: Partial<AppState> = { currentMode: nextMode };
    if (nextMode !== 'l3') patch.l3 = null;
    if (nextMode !== 'media-library') patch.mediaLibrary = null;
    store.setState(patch);
    res.json({ currentMode: nextMode });
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
