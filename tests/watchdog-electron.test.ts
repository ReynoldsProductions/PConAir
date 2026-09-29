import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { BrowserWindow } from 'electron';

// Hoisted by vitest within THIS file. The factory pulls the shared fake.
vi.mock('electron', async () => (await import('./setup/electron-mock')).electronModule);

import { electronMock, FakeBrowserWindow } from './setup/electron-mock';
import { createStateStore } from '../src/main/state';
import { PING_CHANNEL, PONG_CHANNEL, startWatchdog } from '../src/main/watchdog-electron';

// Same top-level-import + beforeEach(electronMock.reset()) pattern as
// tests/window-managers.test.ts and tests/electron-chrome-windows.test.ts
// (Tasks 3/5/6) -- no per-describe resetModules().
beforeEach(() => {
  electronMock.reset();
});

describe('electron watchdog', () => {
  it('uses matching ping and pong channel names', () => {
    expect(PING_CHANNEL).toBeTruthy();
    expect(PONG_CHANNEL).toBeTruthy();
    expect(PING_CHANNEL).not.toBe(PONG_CHANNEL);
  });

  it('subscribes to crashed/unresponsive/responsive on the program window webContents', () => {
    const store = createStateStore();
    const win = new FakeBrowserWindow({});
    const stop = startWatchdog({
      store,
      getProgramWindow: () => win as unknown as BrowserWindow,
      recreateProgramWindow: () => {},
    });

    try {
      expect(win.recorded.calls).toContain('webContents.on:crashed');
      expect(win.recorded.calls).toContain('webContents.on:unresponsive');
      expect(win.recorded.calls).toContain('webContents.on:responsive');
    } finally {
      stop();
    }
  });

  it('marks the program unresponsive in state when the event fires', () => {
    const store = createStateStore();
    const win = new FakeBrowserWindow({});
    const stop = startWatchdog({
      store,
      getProgramWindow: () => win as unknown as BrowserWindow,
      recreateProgramWindow: () => {},
    });

    try {
      win.webContents.emit('unresponsive');
      expect(store.getState().watchdog.programUnresponsive).toBe(true);
    } finally {
      stop();
    }
  });
});
