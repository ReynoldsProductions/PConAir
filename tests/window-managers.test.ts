import { describe, it, expect, beforeEach, vi } from 'vitest';

// Hoisted by vitest within THIS file. The factory pulls the shared fake.
vi.mock('electron', async () => (await import('./setup/electron-mock')).electronModule);

import { electronMock } from './setup/electron-mock';
import { createUrlWindowManager } from '../src/main/url/window-manager';
import { createSlidesWindowManager } from '../src/main/slides/window-manager';
import { createPrompterWindowManager } from '../src/main/prompter/window-manager';
import { createMediaLibraryWindowManager } from '../src/main/media-library/window-manager';
import type { MediaLibraryStore, MediaLibraryItemRecord } from '../src/main/media-library/item-store';
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

describe('prompter window manager', () => {
  // Unlike url/slides/media-library, the prompter window is built with its
  // target display's bounds passed straight into the BrowserWindow
  // constructor (x/y/width/height) -- there is no separate setBounds() call
  // on first open (setBounds() is only used on the "already open" reuse
  // path), so the assertion below reads electronMock.windows[0].options
  // rather than a recorded setBounds() call.
  it('places the prompter window on the requested display', async () => {
    const mgr = createPrompterWindowManager({ getPort: () => 4000 });
    await mgr.open('2');

    expect(electronMock.windows[0].options.x).toBe(1920); // display 2 origin x
  });

  it('opens with context isolation on and node integration off', async () => {
    const mgr = createPrompterWindowManager({ getPort: () => 4000 });
    await mgr.open(null);

    const wp = electronMock.windows[0].options.webPreferences as Record<string, unknown>;
    expect(wp.contextIsolation).toBe(true);
    expect(wp.nodeIntegration).toBe(false);
  });
});

describe('media library window manager', () => {
  // There is no open() on this manager -- window creation lives entirely
  // inside the store.subscribe() callback wired up by initialize(), driven
  // by currentMode + mediaLibrary.activeItemId. `media` only needs the two
  // methods the window manager actually calls (findById, absolutePath), so
  // the fake below duck-types MediaLibraryStore rather than standing up the
  // real fs-backed createMediaLibraryStore().
  it('creates exactly one window and reuses it on a second open', () => {
    const store = createStateStore();
    const record: MediaLibraryItemRecord = {
      id: 'item-1',
      filename: 'a.png',
      displayName: 'a.png',
      mimeType: 'image/png',
      relativePath: 'files/item-1.png',
      fileSize: 10,
      fileHash: 'hash',
      uploadedAt: 0,
      updatedAt: 0,
    };
    const media = {
      findById: (id: string) => (id === record.id ? record : null),
      absolutePath: (item: MediaLibraryItemRecord) => `/tmp/pconair-test-media/${item.relativePath}`,
    } as unknown as MediaLibraryStore;

    const mgr = createMediaLibraryWindowManager({ store, media });
    mgr.initialize();
    try {
      const activate = () =>
        store.setState({
          currentMode: 'media-library',
          mediaLibrary: { activeItemId: record.id, activeItemName: record.displayName, slideshow: null },
        });
      activate();
      activate();

      expect(electronMock.windows).toHaveLength(1);
    } finally {
      mgr.destroy();
    }
  });
});
