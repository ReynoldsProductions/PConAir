import { randomUUID } from 'crypto';
import type { StateStore } from '../state';
import type { L3CueStore } from './cue-store';
import type { L3State } from '../../shared/types';

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

function ensureL3(state: ReturnType<StateStore['getState']>): L3State {
  return state.l3 ?? emptyL3();
}

export function l3TakeOp(
  store: StateStore,
  cues: L3CueStore,
  input: { cueId?: string; name?: string; title?: string; theme?: string }
): Err | Ok<{ currentMode: string; l3: L3State | null }> {
  const prev = store.getState();
  const base = ensureL3(prev);

  let nextId: string;
  let nextName: string;
  let nextTitle: string | null;
  let nextTheme: string | null;

  if (input.cueId) {
    const cue = cues.findById(input.cueId);
    if (!cue) {
      return { ok: false, status: 404, error: { code: 'CUE_NOT_FOUND', message: `Cue '${input.cueId}' not found` } };
    }
    nextId = cue.id;
    nextName = cue.name;
    nextTitle = cue.title;
    nextTheme = cue.theme;
  } else {
    if (!input.name || typeof input.name !== 'string' || !input.name.trim()) {
      return { ok: false, status: 400, error: { code: 'INVALID_MODE', message: 'name is required when cueId is omitted' } };
    }
    if (!input.title || typeof input.title !== 'string' || !input.title.trim()) {
      return { ok: false, status: 400, error: { code: 'INVALID_MODE', message: 'title is required when cueId is omitted' } };
    }
    nextId = randomUUID();
    nextName = input.name.trim();
    nextTitle = input.title.trim();
    nextTheme = typeof input.theme === 'string' && input.theme.trim() ? input.theme.trim() : 'default';
  }

  const nextL3: L3State = {
    ...base,
    activeCueId: nextId,
    activeCueName: nextName,
    activeTitle: nextTitle,
    activeTheme: nextTheme,
  };

  store.setState({
    currentMode: 'l3',
    l3: nextL3,
    mediaLibrary: null,
  });

  const s = store.getState();
  return { ok: true, body: { currentMode: s.currentMode, l3: s.l3 } };
}

export function l3ClearOp(store: StateStore): Ok<{ l3: L3State | null }> {
  const base = ensureL3(store.getState());
  const nextL3: L3State = {
    ...base,
    activeCueId: null,
    activeCueName: null,
    activeTitle: null,
    activeTheme: null,
  };
  store.setState({ l3: nextL3 });
  return { ok: true, body: { l3: store.getState().l3 } };
}

export function l3StackingOp(store: StateStore, enabled: boolean): Err | Ok<{ l3: L3State | null }> {
  if (typeof enabled !== 'boolean') {
    return { ok: false, status: 400, error: { code: 'INVALID_MODE', message: 'enabled must be a boolean' } };
  }
  const base = ensureL3(store.getState());
  store.setState({ l3: { ...base, isStacking: enabled } });
  return { ok: true, body: { l3: store.getState().l3 } };
}
