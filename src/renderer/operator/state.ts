import type { AppState } from '../../shared/types';

export type StateListener = (state: AppState) => void;

const DEFAULT_STATE: AppState = {
  currentMode: 'idle',
  currentPreset: null,
  currentUrl: null,
  slides: null,
  l3: null,
  mediaLibrary: null,
  background: { presetId: null, presetName: null, type: 'luma', value: '#000000' },
  displays: [],
  abState: {
    activeInstance: 'A',
    instanceA: { url: null, isLoading: false, isReady: false, displayTarget: null, sessionMode: 'persistent' },
    instanceB: { url: null, isLoading: false, isReady: false, displayTarget: null, sessionMode: 'persistent' },
  },
  connectionStatus: { webSocketClients: 0, companionConnected: false, adminShowLocked: false },
  reliability: { panicActive: false, panicSlate: { type: 'color', value: '#000000' } },
  watchdog: {
    programUnresponsive: false,
    programUnresponsiveSecs: 0,
    memoryPressure: false,
    memoryPressurePct: 0,
    memoryHeapUsedGb: 0,
    memoryHeapTotalGb: 0,
    lastRendererCrashAt: null,
  },
};

export function createClientStore() {
  let state: AppState = structuredClone(DEFAULT_STATE);
  const listeners = new Set<StateListener>();

  function getState(): AppState { return state; }

  function applyFullState(newState: AppState): void {
    state = structuredClone(newState);
    notify();
  }

  function applyPatch(patch: Partial<AppState>): void {
    state = { ...state, ...patch };
    notify();
  }

  function subscribe(fn: StateListener): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  function notify(): void {
    for (const fn of listeners) fn(state);
  }

  return { getState, applyFullState, applyPatch, subscribe };
}

export type ClientStore = ReturnType<typeof createClientStore>;
