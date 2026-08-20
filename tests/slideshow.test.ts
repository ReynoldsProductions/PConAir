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

describe('slideshow engine with video items', () => {
  let store: StateStore;
  let dir: string;
  let engine: ReturnType<typeof createSlideshowEngine>;
  let stillId: string;
  let videoId: string;

  function box(type: string, payload: Buffer): Buffer {
    const size = Buffer.alloc(4);
    size.writeUInt32BE(8 + payload.length, 0);
    return Buffer.concat([size, Buffer.from(type, 'ascii'), payload]);
  }

  /** Minimal ISO-BMFF file whose mvhd reports `durationMs` at a 1000 timescale. */
  function makeMp4(durationMs: number): Buffer {
    const ftyp = box('ftyp', Buffer.concat([Buffer.from('isom', 'ascii'), Buffer.alloc(4), Buffer.from('isom', 'ascii')]));
    const ts = Buffer.alloc(4);
    ts.writeUInt32BE(1000, 0);
    const dur = Buffer.alloc(4);
    dur.writeUInt32BE(durationMs, 0);
    const mvhd = Buffer.concat([Buffer.alloc(12), ts, dur, Buffer.alloc(80)]);
    return Buffer.concat([ftyp, box('moov', box('mvhd', mvhd)), box('mdat', Buffer.alloc(32))]);
  }

  beforeEach(() => {
    vi.useFakeTimers();
    store = createStateStore();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pconair-ssv-'));
    const media = createMediaLibraryStore({ rootDir: dir });
    stillId = media.ingestBuffer('still.png', PNG_16)!.id;
    // 8s clip — deliberately longer than the 2s still interval below
    videoId = media.ingestBuffer('clip.mp4', makeMp4(8000))!.id;
    engine = createSlideshowEngine({ store, media });
  });

  afterEach(() => {
    engine.destroy();
    vi.useRealTimers();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('holds a video for its own duration instead of the still interval', () => {
    engine.play({ itemIds: [videoId, stillId], intervalSec: 2, transition: 'cut' });
    expect(store.getState().mediaLibrary?.activeItemId).toBe(videoId);

    // The 2s still interval must NOT cut the 8s clip short.
    vi.advanceTimersByTime(2100);
    expect(store.getState().mediaLibrary?.activeItemId).toBe(videoId);

    // It advances once the clip has actually played through.
    vi.advanceTimersByTime(6000);
    expect(store.getState().mediaLibrary?.activeItemId).toBe(stillId);
  });

  it('falls back to the still interval for the still that follows', () => {
    engine.play({ itemIds: [videoId, stillId], intervalSec: 2, transition: 'cut' });
    vi.advanceTimersByTime(8100);
    expect(store.getState().mediaLibrary?.activeItemId).toBe(stillId);
    // Still uses intervalSec, so it wraps back to the video after 2s
    vi.advanceTimersByTime(2100);
    expect(store.getState().mediaLibrary?.activeItemId).toBe(videoId);
  });

  it('publishes the active item mime so the render page can pick <video>', () => {
    engine.play({ itemIds: [videoId, stillId], intervalSec: 2, transition: 'cut' });
    expect(store.getState().mediaLibrary?.activeItemMime).toBe('video/mp4');
    expect(store.getState().mediaLibrary?.activeItemDurationMs).toBe(8000);
    vi.advanceTimersByTime(8100);
    expect(store.getState().mediaLibrary?.activeItemMime).toBe('image/png');
  });

  it('restarts the dwell when the operator steps manually', () => {
    engine.play({ itemIds: [videoId, stillId], intervalSec: 2, transition: 'cut' });
    vi.advanceTimersByTime(1000);
    engine.next();
    expect(store.getState().mediaLibrary?.activeItemId).toBe(stillId);
    // A full 2s still interval from the manual step, not the 1s left on the clip
    vi.advanceTimersByTime(1500);
    expect(store.getState().mediaLibrary?.activeItemId).toBe(stillId);
    vi.advanceTimersByTime(700);
    expect(store.getState().mediaLibrary?.activeItemId).toBe(videoId);
  });
});
