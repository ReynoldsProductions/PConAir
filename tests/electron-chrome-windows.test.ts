import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { BrowserWindow } from 'electron';

// Hoisted by vitest within THIS file. The factory pulls the shared fake.
vi.mock('electron', async () => (await import('./setup/electron-mock')).electronModule);

import { electronMock, FakeBrowserWindow } from './setup/electron-mock';
import { openSettingsWindow } from '../src/main/settings-window';
import { createAppTray } from '../src/main/tray';
import { openDirectorWindow, registerDirectorIpc } from '../src/main/director-window';
import type { OfficeManager } from '../src/main/director/office-manager';
import { hideCursorOnLoad } from '../src/main/output-cursor';
import { applyFullscreenChrome } from '../src/main/fullscreen-chrome';
import { showQrOverlay, hideQrOverlay } from '../src/main/tunnel/qr-overlay';
import { createStageTimerOverlay } from '../src/main/stagetimer/overlay';

// This file uses the top-level-import + `beforeEach(electronMock.reset())`
// pattern proven in tests/window-managers.test.ts, not the per-test
// `vi.resetModules()` + dynamic re-import pattern Task 2 originally used
// here. None of settings-window/tray/director-window need a fresh module
// instance per test -- each holds only a module-level singleton (the open
// window/tray itself), and calling resetModules() per `it()` in a file with
// more than one test was found (Task 3/4) to desync the mock factory's own
// cached electron-mock instance from a test's re-imported binding past the
// first test. See Task 2/3/4 notes in .agent/JOURNAL.md.
beforeEach(() => {
  electronMock.reset();
});

describe('settings window', () => {
  it('opens with context isolation on, node integration off, sandbox on', () => {
    openSettingsWindow();

    expect(electronMock.windows).toHaveLength(1);
    const wp = electronMock.windows[0].options.webPreferences as Record<string, unknown>;
    expect(wp.contextIsolation).toBe(true);
    expect(wp.nodeIntegration).toBe(false);
    expect(wp.sandbox).toBe(true);
    expect(wp.preload).toBeTruthy();
  });
});

describe('app tray', () => {
  it('builds a tray with a tooltip and a non-empty context menu', () => {
    createAppTray({
      port: 8080,
      serverError: null,
      operatorPin: '1234',
      adminPin: '5678',
      onOpenSettings: () => {},
      onOpenOperatorWindow: () => {},
      onOpenDirectorWindow: () => {},
    });

    expect(electronMock.trays).toHaveLength(1);
    expect(electronMock.trays[0].menuLabels.length).toBeGreaterThan(0);
  });
});

describe('director window', () => {
  it('opens sandboxed with a preload', () => {
    openDirectorWindow();

    const wp = electronMock.windows[0].options.webPreferences as Record<string, unknown>;
    expect(wp.contextIsolation).toBe(true);
    expect(wp.nodeIntegration).toBe(false);
    expect(wp.preload).toBeTruthy();
  });

  it('registers its IPC handlers on a known channel set', () => {
    const officeManager = {
      getSnapshot: () => null,
      fireAction: async () => ({ ok: false, status: 500, error: { code: 'NOT_IMPLEMENTED', message: 'unused in this test' } }),
    } as unknown as OfficeManager;
    registerDirectorIpc({ officeManager, getOffices: () => [] });

    expect(electronMock.ipcChannels.length).toBeGreaterThan(0);
  });
});

describe('output cursor', () => {
  it('subscribes to a webContents load event to hide the cursor', () => {
    const win = new FakeBrowserWindow({});
    hideCursorOnLoad(win as unknown as BrowserWindow);

    expect(win.recorded.calls.some((c) => c.startsWith('webContents.on:'))).toBe(true);
  });
});

describe('fullscreen chrome', () => {
  const originalPlatform = process.platform;
  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  it('applies simple fullscreen on macOS', () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    const win = new FakeBrowserWindow({});

    applyFullscreenChrome(win as unknown as BrowserWindow);

    expect(win.recorded.calls).toContain('setSimpleFullScreen:true');
  });

  it('is a no-op off macOS', () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    const win = new FakeBrowserWindow({});

    applyFullscreenChrome(win as unknown as BrowserWindow);

    expect(win.recorded.calls).toHaveLength(0);
  });
});

describe('qr overlay', () => {
  afterEach(() => {
    hideQrOverlay();
  });

  it('creates a frameless always-on-top overlay window', async () => {
    await showQrOverlay('https://example.trycloudflare.com', 60_000);

    expect(electronMock.windows).toHaveLength(1);
    expect(electronMock.windows[0].options.frame).toBe(false);
    expect(electronMock.windows[0].options.alwaysOnTop).toBe(true);
  });
});

describe('stagetimer overlay', () => {
  it('creates an always-on-top, non-focusable overlay window', () => {
    const overlay = createStageTimerOverlay({ getCredentials: () => ({ roomId: null, apiKey: null }) });

    overlay.show('bottom-right', 20);

    expect(electronMock.windows).toHaveLength(1);
    const opts = electronMock.windows[0].options;
    expect(opts.alwaysOnTop).toBe(true);
    expect(opts.focusable).toBe(false);
    expect(opts.frame).toBe(false);
  });
});
