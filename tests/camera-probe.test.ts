import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('electron', async () => (await import('./setup/electron-mock')).electronModule);

import { electronMock, FakeBrowserWindow } from './setup/electron-mock';
import { probeCameraDevices } from '../src/main/camera/probe';

beforeEach(() => {
  electronMock.reset();
});

describe('probeCameraDevices', () => {
  it('returns the enumerated video-input devices and permission status', async () => {
    const win = new FakeBrowserWindow({});
    vi.spyOn(win.webContents, 'executeJavaScript').mockResolvedValue({
      devices: [{ id: 'uvc-1', label: 'Q-SYS USB Video Bridge' }],
      permissionStatus: 'granted',
      error: null,
    });

    const result = await probeCameraDevices(win as unknown as import('electron').BrowserWindow);

    expect(result).toEqual({
      devices: [{ id: 'uvc-1', label: 'Q-SYS USB Video Bridge' }],
      permissionStatus: 'granted',
      error: null,
    });
  });

  it('falls back to an empty, unknown-permission result when executeJavaScript resolves to nothing (the mock default)', async () => {
    const win = new FakeBrowserWindow({});
    const result = await probeCameraDevices(win as unknown as import('electron').BrowserWindow);
    expect(result).toEqual({ devices: [], permissionStatus: 'unknown', error: null });
  });

  it('never rejects -- a thrown/rejected executeJavaScript is reported through the same {error} shape', async () => {
    const win = new FakeBrowserWindow({});
    vi.spyOn(win.webContents, 'executeJavaScript').mockRejectedValue(new Error('window was destroyed'));

    const result = await probeCameraDevices(win as unknown as import('electron').BrowserWindow);

    expect(result.devices).toEqual([]);
    expect(result.permissionStatus).toBe('unknown');
    expect(result.error).toBe('window was destroyed');
  });

  it('drops malformed device entries instead of propagating garbage into state', async () => {
    const win = new FakeBrowserWindow({});
    vi.spyOn(win.webContents, 'executeJavaScript').mockResolvedValue({
      devices: [{ id: 'uvc-1', label: 'Good' }, { id: 42 }, null, { label: 'no id' }],
      permissionStatus: 'granted',
      error: null,
    });

    const result = await probeCameraDevices(win as unknown as import('electron').BrowserWindow);
    expect(result.devices).toEqual([{ id: 'uvc-1', label: 'Good' }]);
  });

  it('falls back to "unknown" permission status for a garbage value', async () => {
    const win = new FakeBrowserWindow({});
    vi.spyOn(win.webContents, 'executeJavaScript').mockResolvedValue({
      devices: [],
      permissionStatus: 'maybe-lol',
      error: null,
    });

    const result = await probeCameraDevices(win as unknown as import('electron').BrowserWindow);
    expect(result.permissionStatus).toBe('unknown');
  });

  it('reports a probe-script error without throwing', async () => {
    const win = new FakeBrowserWindow({});
    vi.spyOn(win.webContents, 'executeJavaScript').mockResolvedValue({
      devices: [],
      permissionStatus: 'unknown',
      error: 'NotFoundError: no camera',
    });

    const result = await probeCameraDevices(win as unknown as import('electron').BrowserWindow);
    expect(result.error).toBe('NotFoundError: no camera');
  });
});
