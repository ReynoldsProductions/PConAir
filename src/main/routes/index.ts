import { Express } from 'express';
import cookieParser from 'cookie-parser';
import { createAuthRouter } from './auth';
import { createApiRouter } from './api';
import { createSlidesRouter, type SlidesRouterDeps } from './slides';
import { createUrlRouter } from './url';
import { createOperatorRouter } from './operator';
import { createRemoteRouter } from './remote';
import { createGscCompatRouter, type PerfectCueRouterDeps } from './gsc-compat';
import { createPerfectCueRouter } from './perfectcue';
import { createTunnelRouter } from './tunnel';
import { createStageTimerRouter, type StageTimerRouterDeps } from './stagetimer';
import { createRenderRouter } from './render';
import { createPackagesRouter } from './packages';
import type { PackageHub } from '../packages/state-hub';
import { createAdminRouter } from './admin';
import { createPresetsRouter } from './presets';
import { createL3Router } from './l3';
import { createActionRouter } from './action';
import { createBackgroundRouter } from './background';
import { createMediaLibraryRouter } from './media-library';
import { createProfilesRouter } from './profiles';
import { createBrandingRouter } from './branding';
import { createTeleprompterRouter } from './teleprompter';
import type { StateStore } from '../state';
import type { AuthManager } from '../auth';
import type { PresetsStore } from '../presets';
import type { L3CueStore } from '../l3/cue-store';
import type { L3PlaylistStore } from '../l3/playlist-store';
import type { L3ThemeStore } from '../l3/theme-store';
import type { MediaLibraryStore } from '../media-library/item-store';
import type { SlideshowEngine } from '../media-library/slideshow';
import type { ActionDispatcher } from '../action-dispatch';
import type { ProfilePaths } from '../profiles/paths';
import type { ReliabilityStore } from '../reliability-store';
import type { L3Cue } from '../l3/cue-store';
import type { SlidesWindowManager } from '../slides/window-manager';

export interface RouteServices {
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
  profilePaths: ProfilePaths;
  getActiveProfileId: () => string;
  onProfileActivate?: () => void;
  setAdminShowLocked: (locked: boolean) => void;
  syncAdminShowLockedToStore: () => void;
  closeSocketsForSession: (sessionId: string) => void;
  getAdminShowLocked: () => boolean;
  reliability: ReliabilityStore;
  serverStartedAt: number;
  buildDateIso: string;
  renderManualCue?: (cue: L3Cue) => Promise<Buffer>;
  /** Server port — used for LAN URLs in QR codes. */
  port: number;
  /** Tunnel control hooks (Electron main); absent in tests. */
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
  /** Stagetimer overlay hooks (Electron main); absent in tests. */
  stageTimer?: Omit<StageTimerRouterDeps, 'store' | 'auth'>;
  /** Graphics packages hub; null when the packages system is disabled. */
  packageHub: PackageHub | null;
  /** Google Slides auth hooks (Electron main only). */
  openGoogleAuthWindow?: SlidesRouterDeps['openGoogleAuthWindow'];
  getGoogleAuthState?: SlidesRouterDeps['getGoogleAuthState'];
  /** Returns the current custom logo path from app settings (live, not cached). */
  getCustomLogoPath: () => string | null;
  /** Returns the current custom CSS path from app settings (live, not cached). */
  getCustomCssPath: () => string | null;
  /** Persists a branding settings patch to app-settings.json. */
  saveBrandingSettings: (patch: { customLogoPath?: string | null; customCssPath?: string | null }) => void;
  /** Slides window manager — enables notes scroll/zoom HTTP endpoints. */
  slidesWindowManager?: SlidesWindowManager;
  /** Key/fill window hooks (Electron main only); absent in tests. */
  openKeyFillDisplays?: (opts: {
    fillUrl: string;
    keyUrl: string;
    fillBgColor: string;
    keyBgColor: string;
  }) => Promise<void>;
  closeKeyFillDisplays?: () => void;
  /** PerfectCue listener control hooks (Electron main); absent in tests. */
  perfectcue?: PerfectCueRouterDeps;
  /** Returns the active teleprompter base URL (empty string when not configured). */
  getTeleprompterHost: () => string;
  /** Returns whether teleprompter proxy is enabled. */
  isTeleprompterEnabled: () => boolean;
  /** Persists teleprompter config to app-settings.json. */
  saveTeleprompterSettings: (patch: { host?: string; enabled?: boolean }) => void;
  /** Returns all app settings for GET /api/app-settings. */
  getAppSettings?: () => import('../app-settings').AppSettings;
  /** Persists a patch to app settings for PATCH /api/app-settings. */
  saveAppSettingsPatch?: (patch: Partial<Omit<import('../app-settings').AppSettings, 'schemaVersion'>>) => import('../app-settings').AppSettings;
  /** Returns backup settings for fan-out and GSC status. */
  getBackupSettings?: () => { operationMode: import('../app-settings').AppSettings['operationMode']; backupIps: string[]; port: number };
}

export function mountRoutes(app: Express, s: RouteServices): void {
  app.use(cookieParser());
  app.use(
    '/auth',
    createAuthRouter(s.auth, {
      setAdminShowLocked: s.setAdminShowLocked,
      syncAdminShowLockedToStore: s.syncAdminShowLockedToStore,
      closeSocketsForSession: s.closeSocketsForSession,
    })
  );
  app.use('/operator', createOperatorRouter(s.auth));
  app.use('/remote', createRemoteRouter(s.auth));
  app.use(
    '/branding',
    createBrandingRouter({
      auth: s.auth,
      getCustomLogoPath: s.getCustomLogoPath,
      getCustomCssPath: s.getCustomCssPath,
      saveBrandingSettings: s.saveBrandingSettings,
    })
  );
  app.use(
    '/admin',
    createAdminRouter({
      auth: s.auth,
      getAdminShowLocked: s.getAdminShowLocked,
    })
  );
  if (s.perfectcue) {
    app.use('/perfectcue', createPerfectCueRouter({ auth: s.auth, ...s.perfectcue }));
  }
  app.use('/api/teleprompter', createTeleprompterRouter({
    store: s.store,
    auth: s.auth,
    getTeleprompterHost: s.getTeleprompterHost,
    isTeleprompterEnabled: s.isTeleprompterEnabled,
    saveTeleprompterSettings: s.saveTeleprompterSettings,
  }));
  app.use('/api/slides', createSlidesRouter(s.store, s.auth, {
    openGoogleAuthWindow: s.openGoogleAuthWindow,
    getGoogleAuthState: s.getGoogleAuthState,
    windowManager: s.slidesWindowManager,
    getBackupSettings: s.getBackupSettings,
  }));
  // GSC Companion module compat — cookie-less, IP-allowlist-gated (see gsc-compat.ts)
  app.use('/api', createGscCompatRouter(s.store, {
    openKeyFillDisplays: s.openKeyFillDisplays,
    closeKeyFillDisplays: s.closeKeyFillDisplays,
    perfectcue: s.perfectcue,
  }));
  app.use(createRenderRouter(s.store, s.auth));
  if (s.packageHub) {
    app.use(createPackagesRouter(s.packageHub));
  }
  app.use(
    createTunnelRouter({
      store: s.store,
      auth: s.auth,
      port: s.port,
      startTunnel: s.startTunnel,
      stopTunnel: s.stopTunnel,
      saveTunnelSettings: s.saveTunnelSettings,
      showQrOverlay: s.showQrOverlay,
      hideQrOverlay: s.hideQrOverlay,
    })
  );
  app.use(createStageTimerRouter({ store: s.store, auth: s.auth, ...s.stageTimer }));
  app.use('/api/url', createUrlRouter(s.store, s.auth));
  app.use('/api/presets', createPresetsRouter(s.store, s.auth, s.presets));
  app.use('/api/l3', createL3Router(s.store, s.auth, s.l3Cues, s.l3Playlists, s.l3ThemeStore, s.l3FilesRoot, s.renderManualCue));
  app.use('/api/media-library', createMediaLibraryRouter(s.store, s.auth, s.mediaLibrary, s.slideshow));
  app.use('/api/background', createBackgroundRouter({
    store: s.store,
    auth: s.auth,
    paths: s.profilePaths,
    getActiveProfileId: s.getActiveProfileId,
  }));
  app.use('/api/action', createActionRouter(s.auth, s.dispatchAction));
  app.use(
    '/api/profiles',
    createProfilesRouter({
      paths: s.profilePaths,
      getActiveProfileId: s.getActiveProfileId,
      auth: s.auth,
      presets: s.presets,
      l3Cues: s.l3Cues,
      l3Playlists: s.l3Playlists,
      mediaLibrary: s.mediaLibrary,
      store: s.store,
      onProfileActivate: s.onProfileActivate,
    })
  );
  app.use(
    '/api',
    createApiRouter({
      store: s.store,
      auth: s.auth,
      reliability: s.reliability,
      serverStartedAt: s.serverStartedAt,
      buildDateIso: s.buildDateIso,
      getAdminShowLocked: s.getAdminShowLocked,
      setAdminShowLocked: s.setAdminShowLocked,
      syncAdminShowLockedToStore: s.syncAdminShowLockedToStore,
      getActiveProfileId: s.getActiveProfileId,
      getBackupSettings: s.getBackupSettings,
      getAppSettings: s.getAppSettings,
      saveAppSettingsPatch: s.saveAppSettingsPatch,
    })
  );
}
