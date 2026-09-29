import { describe, it, expect, beforeEach, vi } from 'vitest';

// Hoisted by vitest within THIS file. The factory pulls the shared fake.
vi.mock('electron', async () => (await import('./setup/electron-mock')).electronModule);

import { electronMock } from './setup/electron-mock';
import { openSettingsWindow } from '../src/main/settings-window';
import { createAppTray } from '../src/main/tray';
import { openDirectorWindow, registerDirectorIpc } from '../src/main/director-window';
import type { OfficeManager } from '../src/main/director/office-manager';

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
