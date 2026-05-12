import type { AppState } from '../shared/types';

const INITIAL_STATE: AppState = {
  currentMode: 'idle',
  currentPreset: null,
  currentUrl: null,
  slides: null,
  l3: null, // populated in l3 mode; shape includes activeTitle for two-line cues
  mediaLibrary: null,
  background: {
    presetId: null,
    presetName: null,
    type: 'luma',
    value: '#000000',
  },
  displays: [],
  abState: {
    activeInstance: 'A',
    instanceA: { url: null, isLoading: false, isReady: false, displayTarget: null, sessionMode: 'persistent' },
    instanceB: { url: null, isLoading: false, isReady: false, displayTarget: null, sessionMode: 'persistent' },
  },
  connectionStatus: {
    webSocketClients: 0,
    companionConnected: false,
    adminShowLocked: false,
  },
  reliability: {
    panicActive: false,
    panicSlate: { type: 'color', value: '#000000' },
  },
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

type Subscriber = (patch: Partial<AppState>) => void;

export function createStateStore() {
  let state: AppState = structuredClone(INITIAL_STATE);
  const subscribers = new Set<Subscriber>();

  function getState(): AppState {
    return structuredClone(state);
  }

  function setState(patch: Partial<AppState>): void {
    state = { ...state, ...patch };
    for (const sub of subscribers) {
      sub(structuredClone(patch));
    }
  }

  function subscribe(fn: Subscriber): () => void {
    subscribers.add(fn);
    return () => subscribers.delete(fn);
  }

  return { getState, setState, subscribe };
}

export type StateStore = ReturnType<typeof createStateStore>;

// Module-level singleton for use by the Electron main process
let _store: StateStore | null = null;

export function getStore(): StateStore {
  if (!_store) _store = createStateStore();
  return _store;
}

// Only call this in tests to reset between cases
export function _resetStore(): void {
  _store = null;
}
