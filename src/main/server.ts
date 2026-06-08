import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';
import { mountRoutes, type RouteServices } from './routes/index';
import type { StateStore } from './state';
import type { AuthManager } from './auth';
import type { PresetsStore } from './presets';
import type { L3CueStore } from './l3/cue-store';
import type { L3PlaylistStore } from './l3/playlist-store';
import type { L3ThemeStore } from './l3/theme-store';
import type { MediaLibraryStore } from './media-library/item-store';
import type { ActionDispatcher } from './action-dispatch';
import type { WsServerMessage } from '../shared/types';

import type { ProfilePaths } from './profiles/paths';
import { loadProfile } from './profiles/bootstrap';
import { parseCookieHeader } from './cookie-parse';
import { isClientIpAllowlisted } from './security/ip-allowlist';
import { createReliabilityStore } from './reliability-store';

export interface ServerDeps {
  store: StateStore;
  auth: AuthManager;
  presets: PresetsStore;
  l3Cues: L3CueStore;
  l3Playlists: L3PlaylistStore;
  l3ThemeStore: L3ThemeStore;
  l3FilesRoot: string;
  /** Absolute path to the built-in graphics templates dir; when set, served at /graphics. */
  graphicsRoot?: string;
  mediaLibrary: MediaLibraryStore;
  dispatchAction: ActionDispatcher;
  port?: number;
  crashDumpsPath?: string;
  getSlidesNotes?: () => Promise<string | null>;
  getProfileName?: () => string;
  profilePaths: ProfilePaths;
  getActiveProfileId: () => string;
  onProfileActivate?: () => void;
  trustForwardedFor?: boolean;
  /** When omitted, manual-cue export returns 501 (e.g. in tests without Electron). */
  renderManualCue?: (cue: import('./l3/cue-store').L3Cue) => Promise<Buffer>;
}

function getRequestClientIp(req: express.Request, trustForwardedFor: boolean): string {
  if (trustForwardedFor) {
    const xff = req.headers['x-forwarded-for'];
    if (typeof xff === 'string' && xff.length > 0) {
      const first = xff.split(',')[0]?.trim();
      if (first) return first;
    }
  }
  return req.ip || req.socket.remoteAddress || '0.0.0.0';
}

function createWsSessionRegistry() {
  const map = new Map<string, Set<WebSocket>>();
  return {
    register(ws: WebSocket, sessionIds: string[]): void {
      for (const id of sessionIds) {
        let set = map.get(id);
        if (!set) {
          set = new Set();
          map.set(id, set);
        }
        set.add(ws);
      }
      ws.on('close', () => {
        for (const id of sessionIds) {
          map.get(id)?.delete(ws);
        }
      });
    },
    closeFor(sessionId: string): void {
      const set = map.get(sessionId);
      if (!set) return;
      for (const w of set) {
        try {
          w.terminate();
        } catch {
          /* ignore */
        }
      }
      map.delete(sessionId);
    },
  };
}

export function createServer(deps: ServerDeps) {
  const {
    store,
    auth,
    presets,
    l3Cues,
    l3Playlists,
    l3ThemeStore,
    l3FilesRoot,
    graphicsRoot,
    mediaLibrary,
    dispatchAction,
    port = 8080,
    profilePaths,
    getActiveProfileId,
    onProfileActivate,
    trustForwardedFor = false,
    renderManualCue: renderManualCueDep,
    crashDumpsPath = '',
    getSlidesNotes = async (): Promise<string | null> => null,
    getProfileName = () => 'PC On Air',
  } = deps;

  let adminShowLocked = false;

  function getAdminShowLocked(): boolean {
    return adminShowLocked;
  }

  function setAdminShowLocked(locked: boolean): void {
    adminShowLocked = locked;
  }

  function syncAdminShowLockedToStore(): void {
    const s = store.getState();
    store.setState({
      connectionStatus: {
        ...s.connectionStatus,
        adminShowLocked,
      },
    });
  }

  const reliability = createReliabilityStore();
  const serverStartedAt = Date.now();
  const buildDateIso = process.env.PCONAIR_BUILD_DATE ?? new Date().toISOString();

  const wsRegistry = createWsSessionRegistry();

  function getSecurityNetworkPrefs() {
    const id = getActiveProfileId();
    const p = loadProfile(profilePaths, id);
    if (!p) {
      return { enabled: false, entries: [] as string[] };
    }
    return {
      enabled: p.appPreferences.ipAllowlistEnabled === true,
      entries: p.appPreferences.ipAllowlist ?? [],
    };
  }

  function closeSocketsForSession(sessionId: string): void {
    wsRegistry.closeFor(sessionId);
  }

  const routeServices: RouteServices = {
    store,
    auth,
    presets,
    l3Cues,
    l3Playlists,
    l3ThemeStore,
    l3FilesRoot,
    graphicsRoot,
    mediaLibrary,
    dispatchAction,
    profilePaths,
    getActiveProfileId,
    onProfileActivate,
    setAdminShowLocked,
    syncAdminShowLockedToStore,
    closeSocketsForSession,
    getAdminShowLocked,
    reliability,
    serverStartedAt,
    buildDateIso,
    port,
    crashDumpsPath,
    getSlidesNotes,
    getProfileName,
    renderManualCue: renderManualCueDep,
  };

  const app = express();
  if (trustForwardedFor) {
    app.set('trust proxy', 1);
  }

  app.use(express.urlencoded({ extended: false }));
  app.use(express.json());

  app.use((req, res, next) => {
    const ip = getRequestClientIp(req, trustForwardedFor);
    (req as express.Request & { pconairClientIp?: string }).pconairClientIp = ip;
    const prefs = getSecurityNetworkPrefs();
    if (!isClientIpAllowlisted(ip, prefs)) {
      res.status(403).json({
        error: { code: 'FORBIDDEN', message: 'IP address not allowed' },
      });
      return;
    }
    next();
  });

  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  mountRoutes(app, routeServices);

  const httpServer = http.createServer(app);
  const wss = new WebSocketServer({
    server: httpServer,
    path: '/ws',
    verifyClient: (info, cb) => {
      try {
        const u = new URL(info.req.url ?? '/', 'http://localhost');
        if (u.searchParams.get('graphics') === '1') {
          cb(true); // read-only viewer — no auth required
          return;
        }
      } catch {
        /* malformed URL — fall through to cookie auth */
      }
      const cookies = parseCookieHeader(info.req.headers.cookie);
      const op = cookies.pconair_operator_session;
      const ad = cookies.pconair_admin_session;
      const ok =
        Boolean(op && auth.getSession(op)) || Boolean(ad && auth.getSession(ad));
      cb(ok);
    },
  });

  const companionClients = new Set<WebSocket>();

  function setCompanionConnected(connected: boolean): void {
    store.setState({
      connectionStatus: {
        ...store.getState().connectionStatus,
        companionConnected: connected,
      },
    });
  }

  function broadcast(msg: WsServerMessage): void {
    const data = JSON.stringify(msg);
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    });
  }

  store.subscribe((patch) => {
    broadcast({ type: 'state_patch', payload: patch });
  });

  wss.on('connection', (ws, req) => {
    // Read-only graphics viewer — no auth, no actions, just state broadcast.
    try {
      const u = new URL(req.url ?? '/', 'http://localhost');
      if (u.searchParams.get('graphics') === '1') {
        ws.send(JSON.stringify({ type: 'state', payload: store.getState() } satisfies WsServerMessage));
        ws.on('close', () => {
          store.setState({
            connectionStatus: {
              ...store.getState().connectionStatus,
              webSocketClients: wss.clients.size,
            },
          });
        });
        return;
      }
    } catch {
      /* malformed URL — fall through to standard handler */
    }

    const cookies = parseCookieHeader(req.headers.cookie);
    const opId = cookies.pconair_operator_session;
    const adId = cookies.pconair_admin_session;
    const opSessionId = opId && auth.getSession(opId) ? opId : undefined;
    const adSessionId = adId && auth.getSession(adId) ? adId : undefined;
    const sessionIds = [opSessionId, adSessionId].filter(Boolean) as string[];
    if (sessionIds.length === 0) {
      ws.close(4001, 'Authentication required');
      return;
    }
    wsRegistry.register(ws, sessionIds);

    let isCompanion = false;
    try {
      const u = new URL(req.url || '/', 'http://localhost');
      isCompanion = u.searchParams.get('companion') === '1';
    } catch {
      /* ignore */
    }
    if (isCompanion) {
      companionClients.add(ws);
      setCompanionConnected(companionClients.size > 0);
      reliability.touchCompanionHeartbeat();
    }

    ws.send(JSON.stringify({ type: 'state', payload: store.getState() } satisfies WsServerMessage));

    store.setState({
      connectionStatus: {
        ...store.getState().connectionStatus,
        webSocketClients: wss.clients.size,
      },
    });

    ws.on('message', async (raw) => {
      try {
        const msg = JSON.parse(String(raw)) as {
          type?: string;
          action_id?: string;
          params?: Record<string, unknown>;
          pin?: string;
        };
        if (msg.type !== 'action' || !msg.action_id) return;

        const hasOperator = Boolean(opSessionId && auth.getSession(opSessionId));
        const hasAdmin = Boolean(adSessionId && auth.getSession(adSessionId));
        if (!hasOperator && !hasAdmin) {
          ws.send(
            JSON.stringify({
              type: 'error',
              payload: { code: 'AUTH_REQUIRED', message: 'Session expired' },
            })
          );
          return;
        }

        if (isCompanion) {
          reliability.touchCompanionHeartbeat();
        }

        if (!hasOperator) {
          const pin = typeof msg.pin === 'string' ? msg.pin : undefined;
          if (!pin) {
            ws.send(
              JSON.stringify({
                type: 'error',
                payload: {
                  code: 'AUTH_REQUIRED',
                  message: 'Operator PIN required for actions when using admin session only',
                },
              })
            );
            return;
          }
          const pinOk = await auth.verifyOperatorPin(pin);
          if (!pinOk) {
            ws.send(
              JSON.stringify({
                type: 'error',
                payload: { code: 'AUTH_REQUIRED', message: 'Invalid operator PIN' },
              })
            );
            return;
          }
        }

        const r = await dispatchAction(msg.action_id, msg.params ?? {});
        if (!r.ok) {
          ws.send(JSON.stringify({ type: 'error', payload: r.error }));
          return;
        }
        ws.send(JSON.stringify({ type: 'action_result', payload: r.body }));
      } catch {
        ws.send(JSON.stringify({ type: 'error', payload: { code: 'INVALID_MODE', message: 'Invalid message' } }));
      }
    });

    ws.on('close', () => {
      if (isCompanion) {
        companionClients.delete(ws);
        setCompanionConnected(companionClients.size > 0);
      }
      store.setState({
        connectionStatus: {
          ...store.getState().connectionStatus,
          webSocketClients: wss.clients.size,
        },
      });
    });
  });

  function listen(): Promise<void> {
    return new Promise((resolve) => {
      httpServer.listen(port, resolve);
    });
  }

  function close(): Promise<void> {
    return new Promise((resolve, reject) => {
      wss.clients.forEach((client) => client.terminate());
      wss.close(() => {
        httpServer.close((err) => (err ? reject(err) : resolve()));
      });
    });
  }

  return { app, httpServer, wss, listen, close };
}
