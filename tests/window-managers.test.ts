import { describe, it, expect, beforeEach, vi } from 'vitest';

// Hoisted by vitest within THIS file. The factory pulls the shared fake.
vi.mock('electron', async () => (await import('./setup/electron-mock')).electronModule);

import { electronMock } from './setup/electron-mock';
import { createUrlWindowManager } from '../src/main/url/window-manager';
import { createSlidesWindowManager } from '../src/main/slides/window-manager';
import { createStateStore } from '../src/main/state';

// NOTE: unlike tests/electron-chrome-windows.test.ts (Task 2), this file does
// NOT combine a top-level `electronMock` import with `vi.resetModules()`.
// Neither window manager under test holds module-level mutable state --
// all state lives inside the closure each create*WindowManager() call
// returns -- so there is nothing that needs a fresh module instance per
// test, and calling resetModules() per `it()` in a multi-test file was
// found to desync the mock factory's own cached electron-mock instance from
// this file's top-level `electronMock` binding across the second and later
// tests (passed individually, failed once combined). Plain `electronMock.reset()`
// in beforeEach is sufficient here.
beforeEach(() => {
  electronMock.reset();
});

describe('url window manager', () => {
  it('gives each A/B instance its own persistent partition', () => {
    const mgr = createUrlWindowManager({ store: createStateStore(), getDisplayPreference: () => null });
    mgr.initialize();

    expect(electronMock.partitionsRequested).toContain('persist:pconair-url-A');
    expect(electronMock.partitionsRequested).toContain('persist:pconair-url-B');
  });

  it('honours an explicit display target over the profile preference', () => {
    const store = createStateStore();
    const mgr = createUrlWindowManager({ store, getDisplayPreference: () => '1' });
    mgr.initialize();

    // windowA is created against the profile preference ('1'); moving it to
    // an explicit per-instance displayTarget ('2') must win over that
    // preference. Display targeting is driven through store state, not a
    // loadUrl() parameter -- see applyDisplayTarget() in the source.
    const state = store.getState();
    store.setState({
      abState: { ...state.abState, instanceA: { ...state.abState.instanceA, displayTarget: '2' } },
    });

    const setBounds = electronMock.windows[0].calls.find((c) => c.startsWith('setBounds'));
    expect(setBounds).toContain('1920'); // display 2 origin x
  });
});

describe('slides window manager', () => {
  it('requests the persistent Google Slides partition', () => {
    const mgr = createSlidesWindowManager({ store: createStateStore() });
    mgr.initialize();
    try {
      expect(electronMock.partitionsRequested).toContain('persist:google-slides');
    } finally {
      // initialize() starts real setInterval polling/thumbnail timers; stop
      // them so they don't leak into later tests.
      mgr.destroy();
    }
  });
});
