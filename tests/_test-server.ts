import fs from 'fs';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';
import { createServer } from '../src/main/server';
import { createL3CueStore } from '../src/main/l3/cue-store';
import { createL3PlaylistStore } from '../src/main/l3/playlist-store';
import { createL3ThemeStore } from '../src/main/l3/theme-store';
import { createActionDispatcher } from '../src/main/action-dispatch';
import { createMediaLibraryStore } from '../src/main/media-library/item-store';
import { createSlideshowEngine } from '../src/main/media-library/slideshow';
import { createAuthManager } from '../src/main/auth';
import { createPresetsStore } from '../src/main/presets';
import { bootstrapProfiles, syncActiveProfileUrlPresets, getActiveMarker } from '../src/main/profiles/bootstrap';
import { profileRuntimeStatePath } from '../src/main/profiles/paths';
import { wireRuntimePersistence } from '../src/main/runtime-persistence';
import type { StateStore } from '../src/main/state';

export interface FullServerTestOpts {
  store: StateStore;
  operatorPin: string;
  adminPin: string;
  operatorSessionMs?: number;
  adminSessionMs?: number;
  port?: number;
  mediaLibraryRoot?: string;
  trustForwardedFor?: boolean;
  getTunnelPinHash?: () => string | null;
  startTunnel?: () => void;
  stopTunnel?: () => void;
  saveTunnelSettings?: (patch: Record<string, unknown>) => void;
  packagesRoot?: string | string[];
}

export function createFullServer(opts: FullServerTestOpts) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), `pconair-${randomUUID()}-`));
  const boot = bootstrapProfiles(userData, {
    operatorPin: opts.operatorPin,
    adminPin: opts.adminPin,
  });

  const auth = createAuthManager({
    operatorPinHash: boot.profile.operatorPinHash,
    adminPinHash: boot.profile.adminPinHash,
    operatorSessionMs: opts.operatorSessionMs ?? boot.profile.appPreferences.operatorSessionDurationMinutes * 60 * 1000,
    adminSessionMs: opts.adminSessionMs ?? boot.profile.appPreferences.adminSessionDurationMinutes * 60 * 1000,
    maxFailures: 5,
    failureWindowMs: 5 * 60 * 1000,
    lockoutMs: 5 * 60 * 1000,
  });

  let markRuntimeFlush: () => void = () => {};
  const chain = () => {
    markRuntimeFlush();
    const id = getActiveMarker(boot.paths)?.id ?? boot.activeId;
    syncActiveProfileUrlPresets(boot.paths, id, presets.list());
  };

  const presets = createPresetsStore(chain);
  presets.replaceAll(boot.profile.urlPresets);
  const l3Cues = createL3CueStore(chain);
  const l3Playlists = createL3PlaylistStore(l3Cues, chain);

  const persistPath = profileRuntimeStatePath(boot.paths, boot.activeId);
  markRuntimeFlush = wireRuntimePersistence(persistPath, { presets, cues: l3Cues, playlists: l3Playlists }).markDirty;

  const mlRoot = opts.mediaLibraryRoot ?? path.join(userData, 'media-library');
  if (!opts.mediaLibraryRoot) fs.mkdirSync(mlRoot, { recursive: true });
  const mediaLibrary = createMediaLibraryStore({ rootDir: mlRoot });

  const l3FilesRoot = path.join(userData, 'still-store');
  fs.mkdirSync(l3FilesRoot, { recursive: true });
  const l3ThemeStore = createL3ThemeStore({ l3FilesRoot });

  const slideshow = createSlideshowEngine({ store: opts.store, media: mediaLibrary });
  const dispatchAction = createActionDispatcher({
    store: opts.store,
    auth,
    presets,
    cues: l3Cues,
    playlists: l3Playlists,
    media: mediaLibrary,
    slideshow,
  });

  const server = createServer({
    store: opts.store,
    auth,
    presets,
    l3Cues,
    l3Playlists,
    l3ThemeStore,
    l3FilesRoot,
    mediaLibrary,
    slideshow,
    dispatchAction,
    port: opts.port,
    profilePaths: boot.paths,
    getActiveProfileId: () => getActiveMarker(boot.paths)?.id ?? boot.activeId,
    trustForwardedFor: opts.trustForwardedFor,
    getTunnelPinHash: opts.getTunnelPinHash,
    startTunnel: opts.startTunnel,
    stopTunnel: opts.stopTunnel,
    saveTunnelSettings: opts.saveTunnelSettings,
    packagesRoot: opts.packagesRoot,
  });

  return {
    ...server,
    presets,
    l3Cues,
    l3Playlists,
    l3ThemeStore,
    l3FilesRoot,
    auth,
    mediaLibrary,
    profilePaths: boot.paths,
    activeProfileId: boot.activeId,
  };
}
