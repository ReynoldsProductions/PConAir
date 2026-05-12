import type { StateStore } from '../state';
import type { ABInstance, InstanceState } from '../../shared/types';

type Err = { ok: false; status: number; error: { code: string; message: string } };
type Ok<T> = { ok: true; body: T };

const URL_PATTERN = /^https?:\/\/.+/;

export function urlLoadOp(
  store: StateStore,
  url: string,
  display?: string
): Err | Ok<{ currentMode: string; currentUrl: string | null; abState: ReturnType<StateStore['getState']>['abState'] }> {
  if (!url || !URL_PATTERN.test(url)) {
    return { ok: false, status: 400, error: { code: 'INVALID_URL', message: 'url must be a valid http or https URL' } };
  }
  const state = store.getState();
  let resolvedDisplay: string | null | undefined;
  if (display !== undefined) {
    const found = state.displays.find((d) => d.id === display || d.name === display);
    if (!found) {
      return {
        ok: false,
        status: 404,
        error: { code: 'DISPLAY_NOT_FOUND', message: `Display '${display}' not found` },
      };
    }
    resolvedDisplay = found.id;
  }
  const active = state.abState.activeInstance;
  const instanceKey = active === 'A' ? 'instanceA' : 'instanceB';
  const updatedInstance: InstanceState = {
    ...state.abState[instanceKey],
    url,
    displayTarget: resolvedDisplay ?? null,
    isLoading: true,
    isReady: false,
  };
  store.setState({
    currentMode: 'url',
    currentUrl: url,
    l3: null,
    mediaLibrary: null,
    abState: { ...state.abState, [instanceKey]: updatedInstance },
  });
  const next = store.getState();
  return { ok: true, body: { currentMode: next.currentMode, currentUrl: next.currentUrl, abState: next.abState } };
}

/** Set `displayTarget` for a URL instance without reloading the page (URL mode only). */
export function setDisplayTargetOp(
  store: StateStore,
  display: string,
  targetInstance?: ABInstance
): Err | Ok<{ abState: ReturnType<StateStore['getState']>['abState'] }> {
  const state = store.getState();
  if (state.currentMode !== 'url') {
    return {
      ok: false,
      status: 400,
      error: { code: 'INVALID_MODE', message: 'set_display only applies in url mode' },
    };
  }
  const active: ABInstance = targetInstance ?? state.abState.activeInstance;
  const instanceKey = active === 'A' ? 'instanceA' : 'instanceB';
  const inst = state.abState[instanceKey];
  if (!inst.url) {
    return {
      ok: false,
      status: 400,
      error: { code: 'INVALID_URL', message: `Instance ${active} has no URL loaded` },
    };
  }
  const found = state.displays.find((d) => d.id === display || d.name === display);
  if (!found) {
    return {
      ok: false,
      status: 404,
      error: { code: 'DISPLAY_NOT_FOUND', message: `Display '${display}' not found` },
    };
  }
  const displayId = found.id;
  const updatedInstance: InstanceState = { ...inst, displayTarget: displayId };
  store.setState({
    abState: { ...state.abState, [instanceKey]: updatedInstance },
  });
  return { ok: true, body: { abState: store.getState().abState } };
}

export function urlReloadOp(
  store: StateStore,
  instance?: string
): Err | Ok<{ abState: ReturnType<StateStore['getState']>['abState'] }> {
  const state = store.getState();
  const target: ABInstance = (instance === 'A' || instance === 'B') ? instance : state.abState.activeInstance;
  const instanceKey = target === 'A' ? 'instanceA' : 'instanceB';
  const inst = state.abState[instanceKey];
  if (!inst.url) {
    return {
      ok: false,
      status: 400,
      error: { code: 'INVALID_URL', message: `Instance ${target} has no URL loaded` },
    };
  }
  const updatedInstance: InstanceState = { ...inst, isLoading: true, isReady: false };
  store.setState({ abState: { ...state.abState, [instanceKey]: updatedInstance } });
  return { ok: true, body: { abState: store.getState().abState } };
}
