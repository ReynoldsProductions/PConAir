import { describe, it, expect, beforeEach, vi } from 'vitest';

// Hoisted by vitest within THIS file. The factory pulls the shared fake.
vi.mock('electron', async () => (await import('./setup/electron-mock')).electronModule);

import { electronMock, fakeSessionFor, electronModule } from './setup/electron-mock';
import { createCameraProbeWindow, CAMERA_PROBE_PARTITION } from '../src/main/camera/probe-window';

// Top-level-import + `beforeEach(electronMock.reset())` pattern (see
// tests/window-managers.test.ts and tests/prompter-doc-transport.test.ts) --
// createCameraProbeWindow() holds no module-level state, so a fresh module
// instance per test buys nothing here.
beforeEach(() => {
  electronMock.reset();
  electronModule.session.fromPartition.mockImplementation((p: string) => {
    electronMock.partitionsRequested.push(p);
    return fakeSessionFor(p);
  });
});

describe('camera probe window', () => {
  it('uses a dedicated persistent partition, not the default session', () => {
    createCameraProbeWindow();
    expect(electronMock.partitionsRequested).toEqual([CAMERA_PROBE_PARTITION]);
  });

  it('is created hidden, offscreen, with context isolation and no node integration', () => {
    createCameraProbeWindow();
    const opts = electronMock.windows[0].options as { show?: boolean; webPreferences?: Record<string, unknown> };
    expect(opts.show).toBe(false);
    expect(opts.webPreferences?.offscreen).toBe(true);
    expect(opts.webPreferences?.contextIsolation).toBe(true);
    expect(opts.webPreferences?.nodeIntegration).toBe(false);
  });

  it('loads a page so navigator.mediaDevices has a document to live in', () => {
    createCameraProbeWindow();
    expect(electronMock.windows[0].loadedUrl).toBe('about:blank');
  });

  it('auto-grants the media permission request on its own partition (spec 24 non-negotiable 4: no operator present at boot)', () => {
    createCameraProbeWindow();
    const sess = electronModule.session.fromPartition.mock.results[0].value as ReturnType<typeof fakeSessionFor>;

    expect(sess.setPermissionRequestHandler).toHaveBeenCalledTimes(1);
    const handler = sess.setPermissionRequestHandler.mock.calls[0][0] as (
      wc: unknown,
      permission: string,
      callback: (granted: boolean) => void
    ) => void;
    const callback = vi.fn();
    handler(null, 'media', callback);
    expect(callback).toHaveBeenCalledWith(true);

    // A permission this window has no business granting (e.g. geolocation)
    // must not be silently allowed just because the handler fires for it.
    const callback2 = vi.fn();
    handler(null, 'geolocation', callback2);
    expect(callback2).toHaveBeenCalledWith(false);
  });

  it('auto-allows the media permission check the same way', () => {
    createCameraProbeWindow();
    const sess = electronModule.session.fromPartition.mock.results[0].value as ReturnType<typeof fakeSessionFor>;

    expect(sess.setPermissionCheckHandler).toHaveBeenCalledTimes(1);
    const checker = sess.setPermissionCheckHandler.mock.calls[0][0] as (wc: unknown, permission: string) => boolean;
    expect(checker(null, 'media')).toBe(true);
    expect(checker(null, 'notifications')).toBe(false);
  });
});
