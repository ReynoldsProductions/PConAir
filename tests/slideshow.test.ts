import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createStateStore } from '../src/main/state';
import type { StateStore } from '../src/main/state';
import { createMediaLibraryStore } from '../src/main/media-library/item-store';
import { createSlideshowEngine } from '../src/main/media-library/slideshow';

const PNG_16 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAN0lEQVR4nGNgoBaQkpL6TwqmSDOGIYPbgKeWpuQZANKIjulnADbN2AwZxF6gSizQNyFRnJkoAQCmlBdhZhfnBgAAAABJRU5ErkJggg==',
  'base64'
);

describe('slideshow engine', () => {
  let store: StateStore;
  let dir: string;
  let engine: ReturnType<typeof createSlideshowEngine>;
  let ids: string[];

  beforeEach(() => {
    vi.useFakeTimers();
    store = createStateStore();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pconair-ss-'));
    const media = createMediaLibraryStore({ rootDir: dir });
    ids = [];
    for (const name of ['one.png', 'two.png', 'three.png']) {
      const rec = media.ingestBuffer(name, PNG_16);
      expect(rec).not.toBeNull();
      ids.push(rec!.id);
    }
    engine = createSlideshowEngine({ store, media });
  });

  afterEach(() => {
    engine.destroy();
    vi.useRealTimers();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('play takes the first image and switches to media-library mode', () => {
    const r = engine.play({ itemIds: ids, intervalSec: 5, transition: 'cut' });
    expect(r.ok).toBe(true);
    const s = store.getState();
    expect(s.currentMode).toBe('media-library');
    expect(s.mediaLibrary?.activeItemId).toBe(ids[0]);
    expect(s.mediaLibrary?.slideshow?.running).toBe(true);
    expect(s.mediaLibrary?.slideshow?.position).toBe(0);
    expect(s.mediaLibrary?.slideshow?.transition).toBe('cut');
  });

  it('advances on the interval and wraps', () => {
    engine.play({ itemIds: ids, intervalSec: 5, transition: 'fade' });
    vi.advanceTimersByTime(5000);
    expect(store.getState().mediaLibrary?.activeItemId).toBe(ids[1]);
    vi.advanceTimersByTime(10000);
    expect(store.getState().mediaLibrary?.activeItemId).toBe(ids[0]); // wrapped
  });

  it('pause freezes advancement; resume continues', () => {
    engine.play({ itemIds: ids, intervalSec: 5, transition: 'cut' });
    expect(engine.pause()).toBe(true);
    vi.advanceTimersByTime(15000);
    expect(store.getState().mediaLibrary?.activeItemId).toBe(ids[0]);
    expect(engine.resume()).toBe(true);
    vi.advanceTimersByTime(5000);
    expect(store.getState().mediaLibrary?.activeItemId).toBe(ids[1]);
  });

  it('next/prev step manually', () => {
    engine.play({ itemIds: ids, intervalSec: 60, transition: 'cut' });
    engine.next();
    expect(store.getState().mediaLibrary?.slideshow?.position).toBe(1);
    engine.prev();
    engine.prev();
    expect(store.getState().mediaLibrary?.slideshow?.position).toBe(2); // wrapped backwards
  });

  it('stop clears the slideshow but keeps the current image on air', () => {
    engine.play({ itemIds: ids, intervalSec: 5, transition: 'cut' });
    engine.stop();
    const s = store.getState();
    expect(s.mediaLibrary?.slideshow).toBeNull();
    expect(s.mediaLibrary?.activeItemId).toBe(ids[0]);
    vi.advanceTimersByTime(20000);
    expect(store.getState().mediaLibrary?.activeItemId).toBe(ids[0]);
  });

  it('rejects empty or invalid item lists and bad intervals', () => {
    expect(engine.play({ itemIds: [], intervalSec: 5, transition: 'cut' }).ok).toBe(false);
    expect(engine.play({ itemIds: ['nope'], intervalSec: 5, transition: 'cut' }).ok).toBe(false);
    expect(engine.play({ itemIds: ids, intervalSec: 0, transition: 'cut' }).ok).toBe(false);
  });
});
