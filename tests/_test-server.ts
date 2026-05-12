import { createServer } from '../src/main/server';
import { createL3CueStore } from '../src/main/l3/cue-store';
import { createL3PlaylistStore } from '../src/main/l3/playlist-store';
import { createActionDispatcher } from '../src/main/action-dispatch';
import type { StateStore } from '../src/main/state';
import type { AuthManager } from '../src/main/auth';
import type { PresetsStore } from '../src/main/presets';

export function createFullServer(opts: {
  store: StateStore;
  auth: AuthManager;
  presets: PresetsStore;
  port?: number;
}) {
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
    dispatchAction,
    port: opts.port,
  });
}
