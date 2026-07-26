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
import type { SlideshowEngine } from './media-library/slideshow';
import type { ActionDispatcher } from './action-dispatch';
import type { SlidesWindowManager } from './slides/window-manager';
import type { WsServerMessage } from '../shared/types';

import type { ProfilePaths } from './profiles/paths';
import { loadProfile } from './profiles/bootstrap';
import { parseCookieHeader } from './cookie-parse';
import { isClientIpAllowlisted } from './security/ip-allowlist';
import { createTunnelPinGate } from './security/tunnel-pin';
import { createPackageHub, type PackageHub } from './packages/state-hub';
import { createReliabilityStore } from './reliability-store';

export interface ServerDeps {
  store: StateStore;
  auth: AuthManager;
  presets: PresetsStore;
  l3Cues: L3CueStore;
  l3Playlists: L3PlaylistStore;
  l3ThemeStore: L3ThemeStore;
  l3FilesRoot: string;
  mediaLibrary: MediaLibraryStore;
  /** Shared slideshow engine (same instance the action dispatcher uses). */
  slideshow?: SlideshowEngine;
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
  /** Tunnel PIN gate: bcrypt hash getter; null/omitted = tunnel access not PIN-gated. */
  getTunnelPinHash?: () => string | null;
  /** Tunnel/QR control hooks (Electron main); absent in tests. */
  startTunnel?: () => void;
  stopTunnel?: () => void;
  saveTunnelSettings?: (patch: {
    tunnelEnabled?: boolean;
    tunnelDomain?: string | null;
    tunnelToken?: string | null;
    tunnelPinHash?: string | null;
  }) => void;
  showQrOverlay?: (url: string, durationMs: number) => Promise<void>;
  hideQrOverlay?: () => void;
  /** Stagetimer overlay hooks + settings persistence (Electron main); absent in tests. */
  stageTimer?: RouteServices['stageTimer'];
  /** Directory (or ordered list: bundled first, then user) scanned for graphics packages; omit to disable the packages system. */
  packagesRoot?: string | string[];
  /** Serves static graphics templates at /graphics; omit to disable. */
  graphicsRoot?: string;
  /** Serves the vendored React + Slate bundle at /vendor; omit to fall back to routes/index.ts's self-resolving guess (breaks in a packaged app — see RouteServices.vendorRoot). */
  vendorRoot?: string;
  /** Google Slides auth hooks (Electron main only). */
  openGoogleAuthWindow?: () => void;
  getGoogleAuthState?: () => Promise<{ loggedIn: boolean; email: string | null }>;
  /** Returns the current custom logo path from app settings. */
  getCustomLogoPath?: () => string | null;
  /** Returns the current custom CSS path from app settings. */
  getCustomCssPath?: () => string | null;
  /** Persists branding settings to app-settings.json. */
  saveBrandingSettings?: (patch: { customLogoPath?: string | null; customCssPath?: string | null }) => void;
  /** Slides window manager — enables notes scroll/zoom HTTP endpoints; absent in tests. */
  slidesWindowManager?: SlidesWindowManager;
  /** Teleprompter proxy hooks; absent in tests (no-ops applied). */
  getTeleprompterHost?: () => string;
  isTeleprompterEnabled?: () => boolean;
  saveTeleprompterSettings?: (patch: { host?: string; enabled?: boolean }) => void;
  /** Returns backup settings for fan-out and GSC status. */
  getBackupSettings?: RouteServices['getBackupSettings'];
  /** Returns all app settings (GET /api/app-settings). */
  getAppSettings?: RouteServices['getAppSettings'];
  /** Persists an app settings patch (PATCH /api/app-settings). */
  saveAppSettingsPatch?: RouteServices['saveAppSettingsPatch'];
  /** Opens the Director window (Electron main only); absent in tests. */
  openDirectorWindow?: RouteServices['openDirectorWindow'];
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
    vendorRoot,
    mediaLibrary,
    dispatchAction,
    port = 8080,
    crashDumpsPath = '',
    getSlidesNotes: getSlidesNotesDep,
    getProfileName: getProfileNameDep,
    profilePaths,
    getActiveProfileId,
    onProfileActivate,
    trustForwardedFor = false,
    renderManualCue: renderManualCueDep,
    slidesWindowManager,
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

  const packageHub: PackageHub | null = deps.packagesRoot ? createPackageHub(deps.packagesRoot) : null;

  const routeServices: RouteServices = {
    store,
    auth,
    presets,
    l3Cues,
    l3Playlists,
    l3ThemeStore,
    l3FilesRoot,
    graphicsRoot,
    vendorRoot,
    mediaLibrary,
    slideshow: deps.slideshow,
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
    getSlidesNotes: getSlidesNotesDep ?? (async () => null),
    getProfileName: getProfileNameDep ?? (() => ''),
    renderManualCue: renderManualCueDep,
    startTunnel: deps.startTunnel,
    stopTunnel: deps.stopTunnel,
    saveTunnelSettings: deps.saveTunnelSettings,
    showQrOverlay: deps.showQrOverlay,
    hideQrOverlay: deps.hideQrOverlay,
    stageTimer: deps.stageTimer,
    packageHub,
    openGoogleAuthWindow: deps.openGoogleAuthWindow,
    getGoogleAuthState: deps.getGoogleAuthState,
    getCustomLogoPath: deps.getCustomLogoPath ?? (() => null),
    getCustomCssPath: deps.getCustomCssPath ?? (() => null),
    saveBrandingSettings: deps.saveBrandingSettings ?? (() => { /* no-op in tests */ }),
    slidesWindowManager,
    getTeleprompterHost: deps.getTeleprompterHost ?? (() => ''),
    isTeleprompterEnabled: deps.isTeleprompterEnabled ?? (() => false),
    saveTeleprompterSettings: deps.saveTeleprompterSettings ?? (() => { /* no-op in tests */ }),
    getBackupSettings: deps.getBackupSettings,
    getAppSettings: deps.getAppSettings,
    saveAppSettingsPatch: deps.saveAppSettingsPatch,
    openDirectorWindow: deps.openDirectorWindow,
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

  // Tunnel access always requires the PIN when one is configured (v2 plan §Connections).
  const tunnelGate = createTunnelPinGate({
    getTunnelPinHash: deps.getTunnelPinHash ?? (() => null),
  });
  app.use(tunnelGate.middleware);

  mountRoutes(app, routeServices);

  if (deps.graphicsRoot) {
    app.use('/graphics', express.static(deps.graphicsRoot, { index: false, fallthrough: false }));
  }

  const httpServer = http.createServer(app);
  const wss = new WebSocketServer({
    server: httpServer,
    path: '/ws',
    verifyClient: (info, cb) => {
      // Render pages (OBS browser sources, ?render=1) and Companion (?companion=1)
      // connect cookie-less — LAN-only via the IP allowlist, same model as the
      // GSC-compat and packages HTTP surfaces. Connections arriving through the
      // Cloudflare tunnel (cf-* headers) never get the cookie-less path: the
      // tunnel PIN gate is HTTP middleware and can't protect WS upgrades.
      try {
        const u = new URL(info.req.url || '/', 'http://localhost');
        if (u.searchParams.get('graphics') === '1') {
          cb(true); // read-only viewer — no auth required
          return;
        }
        const cookieLess = u.searchParams.get('render') === '1' || u.searchParams.get('companion') === '1';
        const viaTunnel = Boolean(
          info.req.headers['cf-connecting-ip'] ?? info.req.headers['cf-ray'] ?? info.req.headers['cf-visitor']
        );
        if (cookieLess && !viaTunnel) {
          const ip = info.req.socket.remoteAddress ?? '0.0.0.0';
          cb(isClientIpAllowlisted(ip, getSecurityNetworkPrefs()));
          return;
        }
        if (cookieLess && viaTunnel) {
          cb(false);
          return;
        }
      } catch {
        /* fall through to cookie auth */
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

    let isCompanion = false;
    let isRender = false;
    try {
      const u = new URL(req.url || '/', 'http://localhost');
      isCompanion = u.searchParams.get('companion') === '1';
      isRender = u.searchParams.get('render') === '1';
    } catch {
      /* ignore */
    }

    // Package namespace pub/sub ({type:'subscribe', namespace:'package:<id>'}) —
    // available to render pages and authenticated clients alike.
    const namespaceUnsubs: Array<() => void> = [];
    ws.on('close', () => {
      for (const u of namespaceUnsubs) u();
    });
    ws.on('message', (raw) => {
      if (!packageHub) return;
      try {
        const msg = JSON.parse(String(raw)) as { type?: string; namespace?: string };
        if (msg.type !== 'subscribe' || typeof msg.namespace !== 'string') return;
        const m = /^package:(.+)$/.exec(msg.namespace);
        if (!m) return;
        const state = packageHub.getState(m[1]);
        if (state === null) {
          ws.send(JSON.stringify({ type: 'error', payload: { code: 'ITEM_NOT_FOUND', message: `Unknown package '${m[1]}'` } }));
          return;
        }
        const namespace = msg.namespace;
        ws.send(JSON.stringify({ type: 'state', namespace, state }));
        namespaceUnsubs.push(
          packageHub.subscribe(namespace, (s) => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: 'state', namespace, state: s }));
            }
          })
        );
      } catch {
        /* ignore malformed frames */
      }
    });

    if (isRender) {
      // Read-only AppState push for render pages: send snapshot; package
      // subscriptions above are the only messages honored.
      ws.send(JSON.stringify({ type: 'state', payload: store.getState() } satisfies WsServerMessage));
      return;
    }

    const cookies = parseCookieHeader(req.headers.cookie);
    const opId = cookies.pconair_operator_session;
    const adId = cookies.pconair_admin_session;
    const opSessionId = opId && auth.getSession(opId) ? opId : undefined;
    const adSessionId = adId && auth.getSession(adId) ? adId : undefined;
    const sessionIds = [opSessionId, adSessionId].filter(Boolean) as string[];
    // Companion connects cookie-less on LAN (IP-allowlist-gated at upgrade,
    // same trust model as the GSC-compat HTTP action endpoints).
    const cookieLessCompanion = isCompanion && sessionIds.length === 0;
    if (sessionIds.length === 0 && !cookieLessCompanion) {
      ws.close(4001, 'Authentication required');
      return;
    }
    if (sessionIds.length > 0) {
      wsRegistry.register(ws, sessionIds);
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

        if (cookieLessCompanion) {
          reliability.touchCompanionHeartbeat();
          const r = await dispatchAction(msg.action_id, msg.params ?? {});
          if (!r.ok) {
            ws.send(JSON.stringify({ type: 'error', payload: r.error }));
            return;
          }
          ws.send(JSON.stringify({ type: 'action_result', payload: r.body }));
          return;
        }

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
    return new Promise((resolve, reject) => {
      httpServer.once('error', reject);
      httpServer.listen(port, () => {
        httpServer.removeListener('error', reject);
        resolve();
      });
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
