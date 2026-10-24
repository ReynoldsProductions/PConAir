import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('electron', async () => (await import('./setup/electron-mock')).electronModule);

import { electronMock, FakeBrowserWindow } from './setup/electron-mock';
import { createStateStore } from '../src/main/state';
import { createCameraManager } from '../src/main/camera/manager';
import type { CameraProbeResult } from '../src/main/camera/probe';

beforeEach(() => {
  electronMock.reset();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

/** A scripted probe stub: each call returns the next queued result (last one repeats). */
function scriptedProbe(...results: CameraProbeResult[]) {
  let i = 0;
  const calls: number[] = [];
  const fn = vi.fn(async () => {
    calls.push(Date.now());
    const r = results[Math.min(i, results.length - 1)];
    i += 1;
    return r;
  });
  return { fn, calls };
}

const GRANTED_EMPTY: CameraProbeResult = { devices: [], permissionStatus: 'granted', error: null };

describe('camera manager', () => {
  it('does nothing while currentMode is not "camera"', async () => {
    const store = createStateStore();
    const probe = scriptedProbe(GRANTED_EMPTY);
    const mgr = createCameraManager({ store, probe: probe.fn, createProbeWindow: () => new FakeBrowserWindow({}) as unknown as import('electron').BrowserWindow });

    mgr.initialize();
    await vi.advanceTimersByTimeAsync(10000);

    expect(probe.fn).not.toHaveBeenCalled();
    mgr.destroy();
  });

  it('starts probing (immediately, then on an interval) when the store already says "camera" at initialize()', async () => {
    const store = createStateStore();
    store.setState({ currentMode: 'camera' });
    const probe = scriptedProbe(GRANTED_EMPTY);
    const mgr = createCameraManager({
      store,
      probe: probe.fn,
      pollIntervalMs: 1000,
      createProbeWindow: () => new FakeBrowserWindow({}) as unknown as import('electron').BrowserWindow,
    });

    mgr.initialize();
    await vi.advanceTimersByTimeAsync(0);
    expect(probe.fn).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(3000);
    expect(probe.fn).toHaveBeenCalledTimes(4);

    mgr.destroy();
  });

  it('starts probing when currentMode later switches to "camera"', async () => {
    const store = createStateStore();
    const probe = scriptedProbe(GRANTED_EMPTY);
    const mgr = createCameraManager({
      store,
      probe: probe.fn,
      pollIntervalMs: 1000,
      createProbeWindow: () => new FakeBrowserWindow({}) as unknown as import('electron').BrowserWindow,
    });
    mgr.initialize();

    store.setState({ currentMode: 'camera' });
    await vi.advanceTimersByTimeAsync(0);

    expect(probe.fn).toHaveBeenCalledTimes(1);
    mgr.destroy();
  });

  it('stops polling and destroys the probe window when leaving camera mode', async () => {
    const store = createStateStore();
    store.setState({ currentMode: 'camera' });
    const probe = scriptedProbe(GRANTED_EMPTY);
    const win = new FakeBrowserWindow({});
    const mgr = createCameraManager({
      store,
      probe: probe.fn,
      pollIntervalMs: 1000,
      createProbeWindow: () => win as unknown as import('electron').BrowserWindow,
    });
    mgr.initialize();
    await vi.advanceTimersByTimeAsync(0);

    store.setState({ currentMode: 'idle' });

    expect(win.recorded.destroyed).toBe(true);
    const callsAtExit = probe.fn.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10000);
    expect(probe.fn).toHaveBeenCalledTimes(callsAtExit); // no further polling

    mgr.destroy();
  });

  it('leaving camera mode resets connectionStatus but preserves the persisted device selection', async () => {
    const store = createStateStore();
    store.setState({
      currentMode: 'camera',
      camera: { ...store.getState().camera, selectedDevice: { id: 'uvc-1', label: 'Q-SYS' } },
    });
    const probe = scriptedProbe({ devices: [{ id: 'uvc-1', label: 'Q-SYS' }], permissionStatus: 'granted', error: null });
    const mgr = createCameraManager({
      store,
      probe: probe.fn,
      createProbeWindow: () => new FakeBrowserWindow({}) as unknown as import('electron').BrowserWindow,
    });
    mgr.initialize();
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getState().camera.connectionStatus).toBe('connected');

    store.setState({ currentMode: 'idle' });

    const cam = store.getState().camera;
    expect(cam.connectionStatus).toBe('disconnected');
    expect(cam.selectedDevice).toEqual({ id: 'uvc-1', label: 'Q-SYS' });

    mgr.destroy();
  });

  it('marks connected when the selected device is in the enumerated list', async () => {
    const store = createStateStore();
    store.setState({
      currentMode: 'camera',
      camera: { ...store.getState().camera, selectedDevice: { id: 'uvc-1', label: 'Q-SYS' } },
    });
    const probe = scriptedProbe({
      devices: [{ id: 'uvc-1', label: 'Q-SYS' }, { id: 'uvc-2', label: 'Other' }],
      permissionStatus: 'granted',
      error: null,
    });
    const mgr = createCameraManager({ store, probe: probe.fn, createProbeWindow: () => new FakeBrowserWindow({}) as unknown as import('electron').BrowserWindow });
    mgr.initialize();
    await vi.advanceTimersByTimeAsync(0);

    const cam = store.getState().camera;
    expect(cam.connectionStatus).toBe('connected');
    expect(cam.lastError).toBeNull();
    expect(cam.permissionStatus).toBe('granted');

    mgr.destroy();
  });

  it('marks error with a message when the selected device drops out of the enumerated list (hotplug unplug)', async () => {
    const store = createStateStore();
    store.setState({
      currentMode: 'camera',
      camera: { ...store.getState().camera, selectedDevice: { id: 'uvc-1', label: 'Q-SYS' } },
    });
    const probe = scriptedProbe(
      { devices: [{ id: 'uvc-1', label: 'Q-SYS' }], permissionStatus: 'granted', error: null },
      { devices: [], permissionStatus: 'granted', error: null }
    );
    const mgr = createCameraManager({ store, probe: probe.fn, pollIntervalMs: 1000, createProbeWindow: () => new FakeBrowserWindow({}) as unknown as import('electron').BrowserWindow });
    mgr.initialize();
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getState().camera.connectionStatus).toBe('connected');

    await vi.advanceTimersByTimeAsync(1000);
    const cam = store.getState().camera;
    expect(cam.connectionStatus).toBe('error');
    expect(cam.lastError).toContain('Q-SYS');

    mgr.destroy();
  });

  it('recovers to connected once a replugged device reappears in a later poll', async () => {
    const store = createStateStore();
    store.setState({
      currentMode: 'camera',
      camera: { ...store.getState().camera, selectedDevice: { id: 'uvc-1', label: 'Q-SYS' } },
    });
    const probe = scriptedProbe(
      { devices: [], permissionStatus: 'granted', error: null },
      { devices: [{ id: 'uvc-1', label: 'Q-SYS' }], permissionStatus: 'granted', error: null }
    );
    const mgr = createCameraManager({ store, probe: probe.fn, pollIntervalMs: 1000, createProbeWindow: () => new FakeBrowserWindow({}) as unknown as import('electron').BrowserWindow });
    mgr.initialize();
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getState().camera.connectionStatus).toBe('error');

    await vi.advanceTimersByTimeAsync(1000);
    expect(store.getState().camera.connectionStatus).toBe('connected');

    mgr.destroy();
  });

  it('reports disconnected (not an error) when no device is selected at all', async () => {
    const store = createStateStore();
    store.setState({ currentMode: 'camera' });
    const probe = scriptedProbe({ devices: [{ id: 'uvc-1', label: 'Q-SYS' }], permissionStatus: 'granted', error: null });
    const mgr = createCameraManager({ store, probe: probe.fn, createProbeWindow: () => new FakeBrowserWindow({}) as unknown as import('electron').BrowserWindow });
    mgr.initialize();
    await vi.advanceTimersByTimeAsync(0);

    const cam = store.getState().camera;
    expect(cam.connectionStatus).toBe('disconnected');
    expect(cam.lastError).toBeNull();

    mgr.destroy();
  });

  it('reports connectionStatus "error" with the probe error message when the probe script itself fails', async () => {
    const store = createStateStore();
    store.setState({
      currentMode: 'camera',
      camera: { ...store.getState().camera, selectedDevice: { id: 'uvc-1', label: 'Q-SYS' } },
    });
    const probe = scriptedProbe({ devices: [], permissionStatus: 'unknown', error: 'boom' });
    const mgr = createCameraManager({ store, probe: probe.fn, createProbeWindow: () => new FakeBrowserWindow({}) as unknown as import('electron').BrowserWindow });
    mgr.initialize();
    await vi.advanceTimersByTimeAsync(0);

    const cam = store.getState().camera;
    expect(cam.connectionStatus).toBe('error');
    expect(cam.lastError).toBe('boom');

    mgr.destroy();
  });

  it('re-validates immediately (without waiting for the next poll tick) when the operator switches the selected device', async () => {
    const store = createStateStore();
    store.setState({
      currentMode: 'camera',
      camera: { ...store.getState().camera, selectedDevice: { id: 'uvc-1', label: 'A' } },
    });
    const probe = scriptedProbe({
      devices: [{ id: 'uvc-1', label: 'A' }, { id: 'uvc-2', label: 'B' }],
      permissionStatus: 'granted',
      error: null,
    });
    const mgr = createCameraManager({ store, probe: probe.fn, pollIntervalMs: 60000, createProbeWindow: () => new FakeBrowserWindow({}) as unknown as import('electron').BrowserWindow });
    mgr.initialize();
    await vi.advanceTimersByTimeAsync(0);
    const callsAfterFirstProbe = probe.fn.mock.calls.length;

    const s = store.getState();
    store.setState({ camera: { ...s.camera, selectedDevice: { id: 'uvc-2', label: 'B' } } });

    // Re-validated against the cached device list -- no new probe call needed,
    // and no infinite loop from the manager's own setState() re-entering the
    // same subscriber (this is the regression this test guards against).
    expect(probe.fn.mock.calls.length).toBe(callsAfterFirstProbe);
    expect(store.getState().camera.connectionStatus).toBe('connected');

    mgr.destroy();
  });

  it('does not loop or recurse on its own store writes (reentrancy guard)', async () => {
    const store = createStateStore();
    store.setState({
      currentMode: 'camera',
      camera: { ...store.getState().camera, selectedDevice: { id: 'uvc-1', label: 'A' } },
    });
    const probe = scriptedProbe({ devices: [{ id: 'uvc-1', label: 'A' }], permissionStatus: 'granted', error: null });
    let setStateCalls = 0;
    const rawSetState = store.setState.bind(store);
    store.setState = ((patch) => {
      setStateCalls += 1;
      if (setStateCalls > 50) throw new Error('runaway setState loop');
      rawSetState(patch);
    }) as typeof store.setState;

    const mgr = createCameraManager({ store, probe: probe.fn, createProbeWindow: () => new FakeBrowserWindow({}) as unknown as import('electron').BrowserWindow });
    mgr.initialize();
    await vi.advanceTimersByTimeAsync(0);

    mgr.destroy();
  });

  it('does not overlap probes when a poll tick fires while the previous probe is still in flight', async () => {
    const store = createStateStore();
    store.setState({ currentMode: 'camera' });
    let inFlight = 0;
    let maxConcurrent = 0;
    const probe = vi.fn(async (): Promise<CameraProbeResult> => {
      inFlight += 1;
      maxConcurrent = Math.max(maxConcurrent, inFlight);
      await new Promise((r) => setTimeout(r, 5000));
      inFlight -= 1;
      return GRANTED_EMPTY;
    });
    const mgr = createCameraManager({ store, probe, pollIntervalMs: 1000, createProbeWindow: () => new FakeBrowserWindow({}) as unknown as import('electron').BrowserWindow });
    mgr.initialize();

    await vi.advanceTimersByTimeAsync(4000); // several poll ticks while the first probe is still "in flight"
    expect(maxConcurrent).toBe(1);

    mgr.destroy();
  });

  it('reports connectionStatus "error" instead of an unhandled rejection when the probe function itself rejects', async () => {
    const store = createStateStore();
    store.setState({ currentMode: 'camera' });
    const probe = vi.fn().mockRejectedValue(new Error('window destroyed mid-probe'));
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    const mgr = createCameraManager({ store, probe, createProbeWindow: () => new FakeBrowserWindow({}) as unknown as import('electron').BrowserWindow });
    mgr.initialize();
    await vi.advanceTimersByTimeAsync(0);
    // Let any unhandled rejection surface before asserting it didn't.
    await Promise.resolve();

    expect(store.getState().camera.connectionStatus).toBe('error');
    expect(store.getState().camera.lastError).toBe('window destroyed mid-probe');
    expect(unhandled).not.toHaveBeenCalled();

    process.off('unhandledRejection', unhandled);
    mgr.destroy();
  });

  it('listDevices() reflects the most recent probe result', async () => {
    const store = createStateStore();
    store.setState({ currentMode: 'camera' });
    const probe = scriptedProbe({ devices: [{ id: 'uvc-1', label: 'Q-SYS' }], permissionStatus: 'granted', error: null });
    const mgr = createCameraManager({ store, probe: probe.fn, createProbeWindow: () => new FakeBrowserWindow({}) as unknown as import('electron').BrowserWindow });
    mgr.initialize();
    await vi.advanceTimersByTimeAsync(0);

    expect(mgr.listDevices()).toEqual([{ id: 'uvc-1', label: 'Q-SYS' }]);
    mgr.destroy();
  });

  it('refreshDevices() forces an immediate probe and returns the result', async () => {
    const store = createStateStore();
    const probe = scriptedProbe({ devices: [{ id: 'uvc-9', label: 'Forced' }], permissionStatus: 'granted', error: null });
    const mgr = createCameraManager({ store, probe: probe.fn, createProbeWindow: () => new FakeBrowserWindow({}) as unknown as import('electron').BrowserWindow });
    mgr.initialize(); // currentMode is not 'camera' -- no automatic probing

    const devices = await mgr.refreshDevices();
    expect(devices).toEqual([{ id: 'uvc-9', label: 'Forced' }]);
    expect(probe.fn).toHaveBeenCalledTimes(1);

    mgr.destroy();
  });

  it('refreshDevices() does not leave the hidden window running when camera mode is not active', async () => {
    const store = createStateStore();
    const probe = scriptedProbe(GRANTED_EMPTY);
    const win = new FakeBrowserWindow({});
    const mgr = createCameraManager({ store, probe: probe.fn, createProbeWindow: () => win as unknown as import('electron').BrowserWindow });
    mgr.initialize(); // currentMode is not 'camera'

    await mgr.refreshDevices();
    expect(win.recorded.destroyed).toBe(true);

    mgr.destroy();
  });

  it('refreshDevices() leaves the window running when it coincides with an active camera-mode polling cycle', async () => {
    const store = createStateStore();
    store.setState({ currentMode: 'camera' });
    const probe = scriptedProbe(GRANTED_EMPTY);
    const win = new FakeBrowserWindow({});
    const mgr = createCameraManager({ store, probe: probe.fn, pollIntervalMs: 60000, createProbeWindow: () => win as unknown as import('electron').BrowserWindow });
    mgr.initialize();
    await vi.advanceTimersByTimeAsync(0);

    await mgr.refreshDevices();
    expect(win.recorded.destroyed).toBe(false);

    mgr.destroy();
  });

  it('destroy() stops polling and tears down the window even while active', async () => {
    const store = createStateStore();
    store.setState({ currentMode: 'camera' });
    const probe = scriptedProbe(GRANTED_EMPTY);
    const win = new FakeBrowserWindow({});
    const mgr = createCameraManager({ store, probe: probe.fn, pollIntervalMs: 1000, createProbeWindow: () => win as unknown as import('electron').BrowserWindow });
    mgr.initialize();
    await vi.advanceTimersByTimeAsync(0);

    mgr.destroy();
    expect(win.recorded.destroyed).toBe(true);

    const callsAtDestroy = probe.fn.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10000);
    expect(probe.fn).toHaveBeenCalledTimes(callsAtDestroy);
  });
});
