import { Express } from 'express';
import cookieParser from 'cookie-parser';
import { createAuthRouter } from './auth';
import { createApiRouter } from './api';
import { createSlidesRouter } from './slides';
import { createUrlRouter } from './url';
import { createOperatorRouter } from './operator';
import { createAdminRouter } from './admin';
import { createPresetsRouter } from './presets';
import { createL3Router } from './l3';
import { createActionRouter } from './action';
import { createBackgroundRouter } from './background';
import { createMediaLibraryRouter } from './media-library';
import { createProfilesRouter } from './profiles';
import type { StateStore } from '../state';
import type { AuthManager } from '../auth';
import type { PresetsStore } from '../presets';
import type { L3CueStore } from '../l3/cue-store';
import type { L3PlaylistStore } from '../l3/playlist-store';
import type { L3ThemeStore } from '../l3/theme-store';
import type { MediaLibraryStore } from '../media-library/item-store';
import type { ActionDispatcher } from '../action-dispatch';
import type { ProfilePaths } from '../profiles/paths';
import type { ReliabilityStore } from '../reliability-store';
import type { L3Cue } from '../l3/cue-store';

export interface RouteServices {
  store: StateStore;
  auth: AuthManager;
  presets: PresetsStore;
  l3Cues: L3CueStore;
  l3Playlists: L3PlaylistStore;
  l3ThemeStore: L3ThemeStore;
  l3FilesRoot: string;
  mediaLibrary: MediaLibraryStore;
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
  app.use(
    '/admin',
    createAdminRouter({
      auth: s.auth,
      getAdminShowLocked: s.getAdminShowLocked,
    })
  );
  app.use('/api/slides', createSlidesRouter(s.store, s.auth));
  app.use('/api/url', createUrlRouter(s.store, s.auth));
  app.use('/api/presets', createPresetsRouter(s.store, s.auth, s.presets));
  app.use('/api/l3', createL3Router(s.store, s.auth, s.l3Cues, s.l3Playlists, s.l3ThemeStore, s.l3FilesRoot, s.renderManualCue));
  app.use('/api/media-library', createMediaLibraryRouter(s.store, s.auth, s.mediaLibrary));
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
    })
  );
}
