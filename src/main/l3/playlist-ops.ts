import type { StateStore } from '../state';
import type { L3CueStore } from './cue-store';
import type { L3PlaylistStore, L3Playlist } from './playlist-store';
import type { L3State } from '../../shared/types';
import { l3TakeOp } from './take-ops';

type Err = { ok: false; status: number; error: { code: string; message: string } };
type Ok<T> = { ok: true; body: T };

function emptyL3(): L3State {
  return {
    activeCueId: null,
    activeCueName: null,
    activeTitle: null,
    activeTheme: null,
    isStacking: false,
    currentPlaylistId: null,
    playlistPosition: null,
    playlistLength: null,
  };
}

/** Find a playlist by id, falling back to (unique) name match. */
export function findPlaylist(playlists: L3PlaylistStore, idOrName: string): L3Playlist | null {
  return playlists.findById(idOrName) ?? playlists.list().find((p) => p.name === idOrName) ?? null;
}

/** Activate a playlist: set currentPlaylistId + playlistLength/position in state. */
export function playlistActivateOp(
  store: StateStore,
  playlists: L3PlaylistStore,
  idOrName: string
): Err | Ok<{ l3: L3State | null }> {
  const playlist = findPlaylist(playlists, idOrName);
  if (!playlist) {
    return { ok: false, status: 404, error: { code: 'PRESET_NOT_FOUND', message: `Playlist '${idOrName}' not found` } };
  }
  const base = store.getState().l3 ?? emptyL3();
  const activeIdx = base.activeCueId ? playlist.cueIds.indexOf(base.activeCueId) : -1;
  store.setState({
    l3: {
      ...base,
      currentPlaylistId: playlist.id,
      playlistPosition: activeIdx === -1 ? null : activeIdx + 1,
      playlistLength: playlist.cueIds.length,
    },
  });
  return { ok: true, body: { l3: store.getState().l3 } };
}

/**
 * Step through the active playlist (wraps around) and take the cue at the new
 * position. Updates l3.playlistPosition/playlistLength in state.
 */
export function playlistStepOp(
  store: StateStore,
  playlists: L3PlaylistStore,
  cues: L3CueStore,
  direction: 1 | -1
): Err | Ok<{ currentMode: string; l3: L3State | null; playlistPosition: number; playlistLength: number }> {
  const l3 = store.getState().l3;
  const playlistId = l3?.currentPlaylistId ?? null;
  const playlist = playlistId ? playlists.findById(playlistId) : null;
  if (!playlist || playlist.cueIds.length === 0) {
    return { ok: false, status: 400, error: { code: 'PRESET_NOT_FOUND', message: 'No active playlist (activate one first)' } };
  }
  const currentIdx = l3?.activeCueId ? playlist.cueIds.indexOf(l3.activeCueId) : -1;
  const nextIdx =
    currentIdx === -1
      ? direction === 1
        ? 0
        : playlist.cueIds.length - 1
      : (currentIdx + direction + playlist.cueIds.length) % playlist.cueIds.length;
  const r = l3TakeOp(store, cues, { cueId: playlist.cueIds[nextIdx] });
  if (!r.ok) return r;
  const afterTake = store.getState().l3;
  if (afterTake) {
    store.setState({
      l3: { ...afterTake, playlistPosition: nextIdx + 1, playlistLength: playlist.cueIds.length },
    });
  }
  const s = store.getState();
  return {
    ok: true,
    body: {
      currentMode: s.currentMode,
      l3: s.l3,
      playlistPosition: nextIdx + 1,
      playlistLength: playlist.cueIds.length,
    },
  };
}
