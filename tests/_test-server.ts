import fs from 'fs';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';
import { createServer } from '../src/main/server';
import { createL3CueStore } from '../src/main/l3/cue-store';
import { createL3PlaylistStore } from '../src/main/l3/playlist-store';
import { createActionDispatcher } from '../src/main/action-dispatch';
import { createMediaLibraryStore } from '../src/main/media-library/item-store';
import type { StateStore } from '../src/main/state';
import type { AuthManager } from '../src/main/auth';
import type { PresetsStore } from '../src/main/presets';

export function createFullServer(opts: {
  store: StateStore;
  auth: AuthManager;
  presets: PresetsStore;
  port?: number;
  mediaLibraryRoot?: string;
}) {
  const mlRoot = opts.mediaLibraryRoot ?? path.join(os.tmpdir(), `pconair-ml-${randomUUID()}`);
  if (!opts.mediaLibraryRoot) fs.mkdirSync(mlRoot, { recursive: true });
  const mediaLibrary = createMediaLibraryStore({ rootDir: mlRoot });

  const l3Cues = createL3CueStore();
  const l3Playlists = createL3PlaylistStore(l3Cues);
  const dispatchAction = createActionDispatcher({
    store: opts.store,
    auth: opts.auth,
    presets: opts.presets,
    cues: l3Cues,
  });
  return createServer({
    store: opts.store,
    auth: opts.auth,
    presets: opts.presets,
    l3Cues,
    l3Playlists,
    mediaLibrary,
    dispatchAction,
    port: opts.port,
  });
}
