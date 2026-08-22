import type { StateStore } from '../state';
import type { L3State } from '../../shared/types';

/**
 * The empty L3 slice, in one place.
 *
 * This previously existed as three byte-identical copies (take-ops, playlist-ops
 * and routes/l3), which is exactly the kind of duplication that lets a new field
 * be added to two of them and silently forgotten in the third.
 */
export function emptyL3(): L3State {
  return {
    activeCueId: null,
    activeCueName: null,
    activeTitle: null,
    activeTheme: null,
    isStacking: false,
    outputDisplayId: null,
    currentPlaylistId: null,
    playlistPosition: null,
    playlistLength: null,
  };
}

export function ensureL3(state: ReturnType<StateStore['getState']>): L3State {
  return state.l3 ?? emptyL3();
}
