import { describe, it, expect, vi } from 'vitest';

// Hoisted by vitest within THIS file. The factory pulls the shared fake.
vi.mock('electron', async () => (await import('./setup/electron-mock')).electronModule);

// NOTE: do not `import { electronMock } from './setup/electron-mock'` at
// top level and rely on it inside a test after `vi.resetModules()`.
// `vi.resetModules()` invalidates the mock factory's own cached
// `await import('./setup/electron-mock')` too, so the *next* dynamic
// import of the source module under test resolves a second, disconnected
// instance of electron-mock.ts — the top-level `electronMock` binding
// silently stops matching what `openSettingsWindow()` records against.
// Re-importing `electron-mock` *inside* the test, after `resetModules()`,
// keeps both references in the same module-cache epoch. See Task 2 notes
// in .agent/JOURNAL.md.
describe('settings window', () => {
  it('opens with context isolation on, node integration off, sandbox on', async () => {
    vi.resetModules();
    const { electronMock } = await import('./setup/electron-mock');
    electronMock.reset();

    const { openSettingsWindow } = await import('../src/main/settings-window');
    openSettingsWindow();

    expect(electronMock.windows).toHaveLength(1);
    const wp = electronMock.windows[0].options.webPreferences as Record<string, unknown>;
    expect(wp.contextIsolation).toBe(true);
    expect(wp.nodeIntegration).toBe(false);
    expect(wp.sandbox).toBe(true);
    expect(wp.preload).toBeTruthy();
  });
});
