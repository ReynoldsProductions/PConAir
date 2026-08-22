import { randomUUID } from 'crypto';
import type { StateStore } from '../state';
import type { L3CueStore } from './cue-store';
import type { L3State } from '../../shared/types';
import { ensureL3 } from './state-defaults';

const autoOutTimers = new Map<string, ReturnType<typeof setTimeout>>();

function scheduleAutoOut(layer: string, ms: number, store: StateStore): void {
  cancelAutoOut(layer);
  autoOutTimers.set(
    layer,
    setTimeout(() => {
      autoOutTimers.delete(layer);
      l3ClearOp(store);
    }, ms)
  );
}

function cancelAutoOut(layer: string): void {
  const t = autoOutTimers.get(layer);
  if (t !== undefined) {
    clearTimeout(t);
    autoOutTimers.delete(layer);
  }
}

type Err = { ok: false; status: number; error: { code: string; message: string } };
type Ok<T> = { ok: true; body: T };



/**
 * Point the L3 program window at a specific display. Kept on L3State (not the
 * profile) so it is per-show-session and visible to every connected client;
 * null hands control back to the Admin → Monitors preference.
 */
export function l3SetOutputDisplayOp(
  store: StateStore,
  displayId: string | null
): Ok<{ l3: L3State }> {
  const base = ensureL3(store.getState());
  const next: L3State = { ...base, outputDisplayId: displayId };
  store.setState({ l3: next });
  return { ok: true, body: { l3: next } };
}

export function l3TakeOp(
  store: StateStore,
  cues: L3CueStore,
  input: { cueId?: string; name?: string; title?: string; theme?: string; autoOutMs?: number | null }
): Err | Ok<{ currentMode: string; l3: L3State | null }> {
  const prev = store.getState();
  const base = ensureL3(prev);

  let nextId: string;
  let nextName: string;
  let nextTitle: string | null;
  let nextTheme: string | null;
  let resolvedAutoOutMs: number | null = null;

  if (input.cueId) {
    const cue = cues.findById(input.cueId);
    if (!cue) {
      return { ok: false, status: 404, error: { code: 'CUE_NOT_FOUND', message: `Cue '${input.cueId}' not found` } };
    }
    // Per-take overrides win; fall back to the cue's stored value. These are
    // ephemeral — the cue store is never written back to, so recalling a preset
    // and retyping its wording changes this take only.
    const nameOverride = typeof input.name === 'string' ? input.name.trim() : '';
    const titleOverride = typeof input.title === 'string' ? input.title.trim() : '';
    nextId = cue.id;
    nextName = nameOverride || cue.name;
    nextTitle = titleOverride || cue.title;
    nextTheme = cue.theme;
    resolvedAutoOutMs = input.autoOutMs != null ? input.autoOutMs : (cue.autoOutMs ?? null);
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
    resolvedAutoOutMs = input.autoOutMs != null ? input.autoOutMs : null;
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

  if (resolvedAutoOutMs != null && resolvedAutoOutMs > 0) {
    scheduleAutoOut('1', resolvedAutoOutMs, store);
  } else {
    cancelAutoOut('1');
  }

  const s = store.getState();
  return { ok: true, body: { currentMode: s.currentMode, l3: s.l3 } };
}

export function l3ClearOp(store: StateStore): Ok<{ l3: L3State | null }> {
  cancelAutoOut('1');
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
