import type { BrowserWindow } from 'electron';
import type { StateStore } from '../state';
import type { CameraDevice } from '../../shared/types';
import { createCameraProbeWindow } from './probe-window';
import { probeCameraDevices, type CameraProbeResult } from './probe';

export interface CameraManagerConfig {
  store: StateStore;
  /** Test/Phase-2 seam: override hidden-window creation. */
  createProbeWindow?: () => BrowserWindow;
  /** Test seam: override the enumeration/permission probe. */
  probe?: (win: BrowserWindow) => Promise<CameraProbeResult>;
  /**
   * Hotplug poll interval. There is no Electron event for a UVC device
   * appearing/disappearing (see spec 24 Phase 1); `navigator.mediaDevices`
   * only knows this from inside the hidden window, so this manager polls it
   * on a timer rather than relying on a push event. 3s balances prompt
   * on-air feedback against re-running the probe script needlessly often.
   */
  pollIntervalMs?: number;
}

export interface CameraManager {
  initialize(): void;
  destroy(): void;
  /** Last known enumerated device list (from the most recent probe). */
  listDevices(): CameraDevice[];
  /** Forces an immediate probe, independent of the poll timer. */
  refreshDevices(): Promise<CameraDevice[]>;
}

/**
 * Starts/stops the hidden-window probe cycle as camera mode is entered and
 * left, and keeps `camera.permissionStatus`/`connectionStatus`/`lastError`
 * in the store up to date -- the mode-machine reaction Track 1A owes (spec
 * 24 Phase 1A). Device *selection* and persistence are handled by
 * `routes/camera.ts` / `app-settings.ts`; this module only ever reads
 * `selectedDevice`, never writes it.
 */
export function createCameraManager(config: CameraManagerConfig): CameraManager {
  const { store } = config;
  const makeWindow = config.createProbeWindow ?? createCameraProbeWindow;
  const runProbe = config.probe ?? probeCameraDevices;
  const pollIntervalMs = config.pollIntervalMs ?? 3000;

  let win: BrowserWindow | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  // Guards against two probes running at once -- a slow probe plus the next
  // poll tick firing before it resolves would otherwise race to apply stale
  // results out of order.
  let probing = false;
  let active = false;
  let lastDevices: CameraDevice[] = [];
  // Cached independently of store reads so the subscribe callback below can
  // tell "the operator actually changed the selection" apart from "this is
  // our own setState() patch echoing the unchanged selection back to us" --
  // without this, applyResult()'s own store.setState() call would re-trigger
  // the same subscriber synchronously, forever.
  let lastSelectedId: string | null = null;
  let unsubscribe: (() => void) | null = null;

  function ensureWindow(): BrowserWindow {
    if (!win || win.isDestroyed()) {
      win = makeWindow();
    }
    return win;
  }

  function applyResult(result: CameraProbeResult): void {
    const state = store.getState();
    const selected = state.camera.selectedDevice;
    lastSelectedId = selected?.id ?? null;

    if (result.error) {
      store.setState({
        camera: { ...state.camera, connectionStatus: 'error', lastError: result.error },
      });
      return;
    }

    let connectionStatus: 'disconnected' | 'connected' | 'error';
    let lastError: string | null;
    if (!selected) {
      connectionStatus = 'disconnected';
      lastError = null;
    } else if (result.devices.some((d) => d.id === selected.id)) {
      connectionStatus = 'connected';
      lastError = null;
    } else {
      connectionStatus = 'error';
      lastError = `Selected camera "${selected.label}" not found`;
    }

    store.setState({
      camera: {
        ...state.camera,
        permissionStatus: result.permissionStatus,
        connectionStatus,
        lastError,
      },
    });
  }

  async function runOnce(): Promise<void> {
    if (probing) return;
    probing = true;
    try {
      const w = ensureWindow();
      // `probeCameraDevices` (the default `runProbe`) never rejects -- it
      // normalizes its own failures into `{ error }` -- but this function is
      // also the `probe` test/Phase-2 seam, so a caller-supplied
      // implementation that *does* throw must not turn into an unhandled
      // rejection off the `void runOnce()` call in start()'s poll timer.
      const result = await runProbe(w);
      lastDevices = result.devices;
      applyResult(result);
    } catch (err) {
      const state = store.getState();
      store.setState({
        camera: { ...state.camera, connectionStatus: 'error', lastError: String((err as Error)?.message ?? err) },
      });
    } finally {
      probing = false;
    }
  }

  function start(): void {
    if (active) return;
    active = true;
    void runOnce();
    pollTimer = setInterval(() => void runOnce(), pollIntervalMs);
  }

  function stop(): void {
    if (!active) return;
    active = false;
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    if (win && !win.isDestroyed()) win.destroy();
    win = null;
    // Leaving camera mode tears down the *runtime* connection state only --
    // selectedDevice/outputMode/ndi (the persisted operator choices) are
    // left untouched, per spec 24 non-negotiable 4.
    const state = store.getState();
    store.setState({ camera: { ...state.camera, connectionStatus: 'disconnected', lastError: null } });
  }

  function initialize(): void {
    lastSelectedId = store.getState().camera.selectedDevice?.id ?? null;

    unsubscribe = store.subscribe((patch) => {
      if (patch.currentMode !== undefined) {
        if (store.getState().currentMode === 'camera') {
          start();
        } else {
          stop();
        }
      }

      if (patch.camera !== undefined) {
        const newId = patch.camera.selectedDevice?.id ?? null;
        if (newId !== lastSelectedId) {
          lastSelectedId = newId;
          // Re-validate against the already-known device list immediately,
          // rather than waiting out the rest of the poll interval, so an
          // operator picking a different device sees connectionStatus
          // settle right away.
          if (active) {
            applyResult({
              devices: lastDevices,
              permissionStatus: store.getState().camera.permissionStatus,
              error: null,
            });
          }
        }
      }
    });

    if (store.getState().currentMode === 'camera') start();
  }

  function destroy(): void {
    unsubscribe?.();
    unsubscribe = null;
    stop();
  }

  function listDevices(): CameraDevice[] {
    return lastDevices;
  }

  async function refreshDevices(): Promise<CameraDevice[]> {
    await runOnce();
    // A manual refresh outside an active camera-mode polling cycle (e.g. a
    // device picker calling this before the operator has switched into
    // camera mode) must not leave the hidden window running indefinitely --
    // only `start()`'s own cycle keeps one alive between calls.
    if (!active && win && !win.isDestroyed()) {
      win.destroy();
      win = null;
    }
    return lastDevices;
  }

  return { initialize, destroy, listDevices, refreshDevices };
}
