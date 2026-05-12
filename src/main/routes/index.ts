import { Express } from 'express';
import cookieParser from 'cookie-parser';
import { createAuthRouter } from './auth';
import { createApiRouter } from './api';
import { createSlidesRouter } from './slides';
import { createUrlRouter } from './url';
import { createOperatorRouter } from './operator';
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
import type { MediaLibraryStore } from '../media-library/item-store';
import type { ActionDispatcher } from '../action-dispatch';
import type { ProfilePaths } from '../profiles/paths';

export interface RouteServices {
  store: StateStore;
  auth: AuthManager;
  presets: PresetsStore;
  l3Cues: L3CueStore;
  l3Playlists: L3PlaylistStore;
  mediaLibrary: MediaLibraryStore;
  dispatchAction: ActionDispatcher;
  profilePaths: ProfilePaths;
  getActiveProfileId: () => string;
  onProfileActivate?: () => void;
}

export function mountRoutes(app: Express, s: RouteServices): void {
  app.use(cookieParser());
  app.use('/auth', createAuthRouter(s.auth));
  app.use('/operator', createOperatorRouter(s.auth));
  app.use('/api/slides', createSlidesRouter(s.store, s.auth));
  app.use('/api/url', createUrlRouter(s.store, s.auth));
  app.use('/api/presets', createPresetsRouter(s.store, s.auth, s.presets));
  app.use('/api/l3', createL3Router(s.store, s.auth, s.l3Cues, s.l3Playlists));
  app.use('/api/media-library', createMediaLibraryRouter(s.store, s.auth, s.mediaLibrary));
  app.use('/api/background', createBackgroundRouter(s.store, s.auth));
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
  app.use('/api', createApiRouter(s.store, s.auth));
}
