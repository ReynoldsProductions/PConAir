import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';
import path from 'path';
import { mountRoutes, type RouteServices } from './routes/index';
import type { StateStore } from './state';
import type { AuthManager } from './auth';
import type { PresetsStore } from './presets';
import type { L3CueStore } from './l3/cue-store';
import type { L3ThemeStore } from './l3/theme-store';
import type { L3LogoStore } from './l3/logo-store';
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
import { createPresenceRegistry } from './packages/presence';
import { createWarningsStore } from './packages/warnings';
import type { FitWarning } from '../shared/types';
import type { PackagePresence } from '../shared/types';
import { createTransportEngine, type TransportEngine } from './packages/transport';
import { ensurePackageRenderPresets } from './packages/render-presets';
import { createReliabilityStore } from './reliability-store';
import { createDataSourcePoller, type DataSourcePoller } from './packages/data-sources';
import { createDataOverridesStore, type DataOverridesStore } from './packages/data-overrides';
import type { ScriptDocsStore } from './prompter/script-docs';
import type { DocFetchResult } from './prompter/doc-source';

export interface ServerDeps {
  store: StateStore;
  auth: AuthManager;
  presets: PresetsStore;
  l3Cues: L3CueStore;
  l3ThemeStore: L3ThemeStore;
  l3Logos: L3LogoStore;
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
  /** Ad-hoc "export whatever is currently typed" render, for the live Lower Thirds tab. */
  renderAdHocCard?: (input: {
    name: string;
    title?: string | null;
    subtitle?: string | null;
    theme?: string | null;
    logoDataUrl?: string | null;
  }) => Promise<Buffer>;
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
  /**
   * Where to persist package state across restarts. Omit (as tests do) to keep
   * package state purely in-memory.
   */
  packageStatePath?: string;
  /**
   * Injected fetch for the data source poller (spec 20). Tests MUST supply a
   * stub here — the poller otherwise defaults to Node's global `fetch`, which
   * would make a real outbound request for any package declaring a data
   * source with a real URL.
   */
  dataSourceFetchImpl?: typeof fetch;
  /** Serves static graphics templates at /graphics; omit to disable. */
  graphicsRoot?: string;
  runtimeRoot?: string;
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
  /** Prompter proxy hooks; absent in tests (no-ops applied). */
  getPrompterHost?: () => string;
  isPrompterEnabled?: () => boolean;
  savePrompterSettings?: (patch: { host?: string; enabled?: boolean }) => void;
  /** Fullscreen prompter output window (Electron main only); absent in tests. */
  prompterWindow?: RouteServices['prompterWindow'];
  /** Saved Google Doc script library — pure JS, always required (no Electron dependency). */
  scriptDocsStore: ScriptDocsStore;
  /**
   * Fetches a Google Doc's plain text (wraps `fetchDocText` with a real or
   * fake `DocTransport`). Tests MUST supply a stub here, same posture as
   * `dataSourceFetchImpl` — the default rejects so a forgotten stub fails
   * loudly instead of making a real request to Google Docs.
   */
  fetchDoc?: (docId: string) => Promise<DocFetchResult>;
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
    l3ThemeStore,
    l3Logos,
    l3FilesRoot,
    graphicsRoot,
    runtimeRoot,
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
    renderAdHocCard: renderAdHocCardDep,
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

  const packageHub: PackageHub | null = deps.packagesRoot
    ? createPackageHub(deps.packagesRoot, { persistPath: deps.packageStatePath })
    : null;
  // Owns the transport setTimeout state, so it must be the single instance
  // both the HTTP routes and `panic` dispatch through — see index.ts/
  // _test-server.ts's getTransportEngine wiring for how `panic` reaches it.
  const transportEngine: TransportEngine | null = packageHub ? createTransportEngine(packageHub) : null;

  // Renders that declare a preset get one in the shared preset list, so a whole
  // scene can be launched by name from admin → URL Presets or remote → URLs.
  if (packageHub) {
    ensurePackageRenderPresets({ hub: packageHub, presets, port });
  }

  // Output presence (spec 16): tracks which render/control pages are
  // actually subscribed to each package namespace. Kept alongside the hub
  // rather than inside it, since presence is purely a fact about open
  // sockets and never persisted.
  const presence = createPresenceRegistry();
  const presenceSubs = new Map<string, Set<(p: PackagePresence) => void>>();
  // Spec 22 -- live text-fit overflow warnings. In-memory only, same lifetime
  // rule as presence: nothing here survives a restart.
  const warningsStore = createWarningsStore();
  presence.onChange(() => {
    for (const [namespace, fns] of presenceSubs) {
      if (fns.size === 0) continue;
      const id = namespace.slice('package:'.length);
      const p = presence.forPackage(id);
      for (const fn of fns) fn(p);
    }
  });

  // Spec 22 -- push a `{type:'warnings'}` frame only to sockets subscribed to
  // the ONE namespace that changed, carrying only the ONE render's current
  // list (not the whole package's map) -- warningsStore.onChange already
  // tells us exactly which (packageId, renderId) changed, so there is no
  // need to recompute every namespace the way presence's broadcast does.
  const warningsSubs = new Map<string, Set<(renderId: string, warnings: FitWarning[]) => void>>();
  warningsStore.onChange((packageId, renderId) => {
    const namespace = 'package:' + packageId;
    const fns = warningsSubs.get(namespace);
    if (!fns || fns.size === 0) return;
    const warnings = warningsStore.get(packageId)[renderId] ?? [];
    for (const fn of fns) fn(renderId, warnings);
  });

  /**
   * Spec 20 -- normalized data sources. Overrides persist next to package
   * state (same userData dir); omitted (as most tests do) keeps them
   * in-memory only. The allowed-hosts list for the SSRF guard reuses the
   * active profile's security preferences, same source as the IP allowlist.
   */
  function getDataSourceAllowedHosts(): string[] {
    const id = getActiveProfileId();
    const p = loadProfile(profilePaths, id);
    return p?.appPreferences.dataSourceAllowedHosts ?? [];
  }

  const dataOverridesPath = deps.packageStatePath
    ? path.join(path.dirname(deps.packageStatePath), 'package-data-overrides.json')
    : undefined;
  const dataOverrides: DataOverridesStore | null = packageHub ? createDataOverridesStore(dataOverridesPath) : null;
  const dataSourcePoller: DataSourcePoller | null = packageHub
    ? createDataSourcePoller({
        hub: packageHub,
        getPackages: () => packageHub.list(),
        getOverrides: () => dataOverrides!.get(),
        getAllowedHosts: getDataSourceAllowedHosts,
        fetchImpl: deps.dataSourceFetchImpl,
      })
    : null;
  if (dataSourcePoller) {
    dataSourcePoller.reload();
  }

  const routeServices: RouteServices = {
    store,
    auth,
    presets,
    l3Cues,
    l3ThemeStore,
    l3Logos,
    l3FilesRoot,
    graphicsRoot,
    runtimeRoot,
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
    renderAdHocCard: renderAdHocCardDep,
    startTunnel: deps.startTunnel,
    stopTunnel: deps.stopTunnel,
    saveTunnelSettings: deps.saveTunnelSettings,
    showQrOverlay: deps.showQrOverlay,
    hideQrOverlay: deps.hideQrOverlay,
    stageTimer: deps.stageTimer,
    packageHub,
    presence,
    transportEngine,
    dataOverrides,
    dataSourcePoller,
    warningsStore,
    openGoogleAuthWindow: deps.openGoogleAuthWindow,
    getGoogleAuthState: deps.getGoogleAuthState,
    getCustomLogoPath: deps.getCustomLogoPath ?? (() => null),
    getCustomCssPath: deps.getCustomCssPath ?? (() => null),
    saveBrandingSettings: deps.saveBrandingSettings ?? (() => { /* no-op in tests */ }),
    slidesWindowManager,
    getPrompterHost: deps.getPrompterHost ?? (() => ''),
    isPrompterEnabled: deps.isPrompterEnabled ?? (() => false),
    savePrompterSettings: deps.savePrompterSettings ?? (() => { /* no-op in tests */ }),
    prompterWindow: deps.prompterWindow,
    scriptDocsStore: deps.scriptDocsStore,
    fetchDoc:
      deps.fetchDoc ??
      (async () => {
        throw new Error(
          'fetchDoc was not stubbed for this test — a prompter doc fetch would otherwise hit the real network. ' +
            'Pass fetchDoc to createServer()/createFullServer().'
        );
      }),
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
      // Render pages (OBS browser sources, ?render=1), package control pages
      // (?control=1) and Companion (?companion=1) connect cookie-less — LAN-only via the IP allowlist, same model as the
      // GSC-compat and packages HTTP surfaces. Connections arriving through the
      // Cloudflare tunnel (cf-* headers) never get the cookie-less path: the
      // tunnel PIN gate is HTTP middleware and can't protect WS upgrades.
      try {
        const u = new URL(info.req.url || '/', 'http://localhost');
        if (u.searchParams.get('graphics') === '1') {
          cb(true); // read-only viewer — no auth required
          return;
        }
        const cookieLess =
          u.searchParams.get('render') === '1' ||
          u.searchParams.get('control') === '1' ||
          u.searchParams.get('companion') === '1';
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

  function touchWebSocketClientCount(): void {
    store.setState({
      connectionStatus: {
        ...store.getState().connectionStatus,
        webSocketClients: wss.clients.size,
      },
    });
  }

  wss.on('connection', (ws, req) => {
    // Every role (?graphics=1, ?render=1, ?control=1, companion, authenticated
    // operator/admin) counts toward the same live-socket gauge. Previously
    // this only updated for the authenticated-session path — never on
    // connect for a render/graphics socket, and never at all for a render
    // socket, which returns early below (spec 16 §1 / T4). The recompute is
    // called after each branch's own initial send below, not here — calling
    // it first would broadcast a state_patch (from the store.setState it
    // does) to this very socket before its first real message went out.
    ws.on('close', touchWebSocketClientCount);

    // Read-only graphics viewer — no auth, no actions, just state broadcast.
    try {
      const u = new URL(req.url ?? '/', 'http://localhost');
      if (u.searchParams.get('graphics') === '1') {
        ws.send(JSON.stringify({ type: 'state', payload: store.getState() } satisfies WsServerMessage));
        touchWebSocketClientCount();
        return;
      }
    } catch {
      /* malformed URL — fall through to standard handler */
    }

    let isCompanion = false;
    let isRender = false;
    let isControl = false;
    let isPreview = false;
    let renderIdParam: string | null = null;
    try {
      const u = new URL(req.url || '/', 'http://localhost');
      isCompanion = u.searchParams.get('companion') === '1';
      isRender = u.searchParams.get('render') === '1';
      isControl = u.searchParams.get('control') === '1';
      // Spec 17 §3.3: a control page's live preview iframe connects as a real
      // render socket (so it gets the exact same state frames a real output
      // would), but must never count toward presence/`delivered` — otherwise
      // opening a preview would make "is anything actually listening" lie.
      isPreview = u.searchParams.get('preview') === '1';
      renderIdParam = u.searchParams.get('renderId');
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

        // Presence (spec 16): a render page (?render=1) counts as an output;
        // a control page (?control=1) counts as a control, never an output.
        // Anything else that subscribes (e.g. an authenticated debug tool)
        // is treated like a render, per spec 16 §3.2.
        //
        // Spec 17 §3.3: a preview socket (`preview=1`) skips this entirely —
        // it still subscribes and still receives every state frame above, it
        // is simply never added to the registry, so it never counts toward
        // presence or `delivered` regardless of which role param it carries.
        if (!isPreview) {
          const presenceToken = Symbol('presence');
          presence.add(presenceToken, {
            role: isControl ? 'control' : 'render',
            packageId: m[1],
            renderId: isControl ? null : renderIdParam,
            ip: req.socket.remoteAddress ?? '0.0.0.0',
            connectedAt: Date.now(),
          });
          namespaceUnsubs.push(() => presence.remove(presenceToken));
        }

        // Push presence changes to every socket subscribed to this namespace
        // instead of making control pages poll for it (spec 16 §3.5).
        let presenceFns = presenceSubs.get(namespace);
        if (!presenceFns) {
          presenceFns = new Set();
          presenceSubs.set(namespace, presenceFns);
        }
        const presenceFn = (p: PackagePresence) => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'presence', namespace, presence: p }));
          }
        };
        presenceFns.add(presenceFn);
        namespaceUnsubs.push(() => {
          presenceSubs.get(namespace)?.delete(presenceFn);
        });

        // Warnings (spec 22): push this socket the current warnings for its
        // OWN renderId whenever that render's set changes. A control page
        // (isControl, renderIdParam is always null for it) subscribes with no
        // renderId, so it gets every render's frames instead -- narrowing to
        // one render, if it wants that, is warningsPanel's opts.renderId job
        // on the client side, same division of labour as presenceIndicator.
        const warningsFn = (changedRenderId: string, warnings: FitWarning[]) => {
          if (isControl || changedRenderId === renderIdParam) {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: 'warnings', namespace, renderId: changedRenderId, warnings }));
            }
          }
        };
        let warningsFns = warningsSubs.get(namespace);
        if (!warningsFns) {
          warningsFns = new Set();
          warningsSubs.set(namespace, warningsFns);
        }
        warningsFns.add(warningsFn);
        namespaceUnsubs.push(() => {
          warningsSubs.get(namespace)?.delete(warningsFn);
        });

        // Clear a render's warnings once its LAST output disconnects (spec 22
        // §3.2) -- checked after presence.remove() above has already run, so
        // forPackage() reflects the drop. Skipped for control sockets and for
        // a render page that never sent a renderId (nothing to key on).
        if (!isControl && renderIdParam) {
          namespaceUnsubs.push(() => {
            const remaining = presence.forPackage(m[1]).byRender[renderIdParam] ?? 0;
            if (remaining === 0) warningsStore.clear(m[1], renderIdParam);
          });
        }
      } catch {
        /* ignore malformed frames */
      }
    });

    if (isRender || isControl) {
      // Read-only AppState push for render pages: send snapshot; package
      // subscriptions above are the only messages honored. Control pages
      // (?control=1) never received this treatment before spec 16 — they hit
      // the cookie-auth check just below and were closed with 4001 right
      // after opening, which meant a control page could never actually stay
      // subscribed to a package namespace. They still get no AppState
      // snapshot: they only care about the package namespace they subscribe to.
      if (isRender) {
        ws.send(JSON.stringify({ type: 'state', payload: store.getState() } satisfies WsServerMessage));
      }
      touchWebSocketClientCount();
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
    touchWebSocketClientCount();

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
    transportEngine?.dispose();
    dataSourcePoller?.dispose();
    return new Promise((resolve, reject) => {
      wss.clients.forEach((client) => client.terminate());
      wss.close(() => {
        httpServer.close((err) => (err ? reject(err) : resolve()));
      });
    });
  }

  return { app, httpServer, wss, listen, close, transportEngine };
}
