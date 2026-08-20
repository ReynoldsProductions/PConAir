import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { Express } from 'express';
import { createStateStore } from '../src/main/state';
import type { StateStore } from '../src/main/state';
import { createMediaLibraryStore } from '../src/main/media-library/item-store';
import { createSlideshowEngine } from '../src/main/media-library/slideshow';
import { createFullServer } from './_test-server';

const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

describe('transition reaches the render page for a plain take', () => {
  let app: Express;
  let cookie: string;

  beforeEach(async () => {
    const store = createStateStore();
    ({ app } = createFullServer({
      store, operatorPin: '1234', adminPin: 'supersecret',
      operatorSessionMs: 3600000, adminSessionMs: 3600000,
    }));
    const op = await request(app).post('/auth/operator').send({ pin: '1234' });
    cookie = op.headers['set-cookie'][0].split(';')[0];
  });

  async function upload(name: string): Promise<string> {
    const r = await request(app).post('/api/media-library/upload')
      .set('Cookie', cookie).attach('files[]', PNG_1PX, name);
    return r.body.items[0].id;
  }

  // Regression: a take has no slideshow, and the render page used to read the
  // transition only from the slideshow — so every take was a hard cut.
  it('a take with fade publishes fade, not cut', async () => {
    const id = await upload('a.png');
    const res = await request(app).post('/api/media-library/take')
      .set('Cookie', cookie).send({ itemId: id, transition: 'fade' });
    expect(res.status).toBe(200);
    expect(res.body.mediaLibrary.slideshow).toBeNull();
    expect(res.body.mediaLibrary.transition).toBe('fade');
  });

  it('a take with no transition specified stays a hard cut', async () => {
    const id = await upload('b.png');
    const res = await request(app).post('/api/media-library/take')
      .set('Cookie', cookie).send({ itemId: id });
    expect(res.body.mediaLibrary.transition).toBe('cut');
  });

  it('rejects a bogus transition rather than passing it through', async () => {
    const id = await upload('c.png');
    const res = await request(app).post('/api/media-library/take')
      .set('Cookie', cookie).send({ itemId: id, transition: 'wipe-left' });
    expect(res.body.mediaLibrary.transition).toBe('cut');
  });

  it('a slideshow also publishes it at the top level', async () => {
    const ids = [await upload('d.png'), await upload('e.png')];
    const res = await request(app).post('/api/media-library/slideshow')
      .set('Cookie', cookie)
      .send({ action: 'play', itemIds: ids, intervalSec: 5, transition: 'fade' });
    expect(res.body.mediaLibrary.transition).toBe('fade');
    expect(res.body.mediaLibrary.slideshow.transition).toBe('fade');
  });
});

describe('slideshow shuffle', () => {
  let store: StateStore;
  let dir: string;
  let engine: ReturnType<typeof createSlideshowEngine>;
  let ids: string[];

  beforeEach(() => {
    vi.useFakeTimers();
    store = createStateStore();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pconair-shuf-'));
    const media = createMediaLibraryStore({ rootDir: dir });
    ids = [];
    for (let i = 0; i < 12; i += 1) {
      ids.push(media.ingestBuffer(`i${i}.png`, PNG_1PX)!.id);
    }
    engine = createSlideshowEngine({ store, media });
  });

  afterEach(() => {
    engine.destroy();
    vi.useRealTimers();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const order = (): string[] => store.getState().mediaLibrary?.slideshow?.itemIds ?? [];

  it('plays in the given order when shuffle is off', () => {
    engine.play({ itemIds: ids, intervalSec: 5, transition: 'cut' });
    expect(order()).toEqual(ids);
    expect(store.getState().mediaLibrary?.slideshow?.shuffle).toBe(false);
  });

  it('reorders when shuffle is on, keeping exactly the same items', () => {
    engine.play({ itemIds: ids, intervalSec: 5, transition: 'cut', shuffle: true });
    const played = order();
    expect(store.getState().mediaLibrary?.slideshow?.shuffle).toBe(true);
    // Same multiset — nothing dropped or duplicated.
    expect([...played].sort()).toEqual([...ids].sort());
    expect(played).toHaveLength(ids.length);
  });

  it('shows every item exactly once per cycle', () => {
    engine.play({ itemIds: ids, intervalSec: 5, transition: 'cut', shuffle: true });
    const seen: string[] = [];
    for (let i = 0; i < ids.length; i += 1) {
      seen.push(store.getState().mediaLibrary!.activeItemId!);
      vi.advanceTimersByTime(5000);
    }
    expect(new Set(seen).size).toBe(ids.length);
  });

  it('reshuffles on wrap so cycles are not identical', () => {
    engine.play({ itemIds: ids, intervalSec: 5, transition: 'cut', shuffle: true });
    const first = order();
    // Advance a full cycle back to position 0.
    vi.advanceTimersByTime(5000 * ids.length);
    expect(store.getState().mediaLibrary?.slideshow?.position).toBe(0);
    const second = order();
    expect([...second].sort()).toEqual([...ids].sort());
    // With 12 items an identical reshuffle is ~1 in 479 million.
    expect(second).not.toEqual(first);
  });

  it('turning shuffle on mid-show keeps the current item on screen', () => {
    engine.play({ itemIds: ids, intervalSec: 5, transition: 'cut' });
    vi.advanceTimersByTime(5000 * 3);
    const onAir = store.getState().mediaLibrary!.activeItemId;
    expect(engine.setShuffle(true)).toBe(true);
    // No visible jump: what was on air stays on air.
    expect(store.getState().mediaLibrary?.activeItemId).toBe(onAir);
    expect(store.getState().mediaLibrary?.slideshow?.shuffle).toBe(true);
    expect([...order()].sort()).toEqual([...ids].sort());
  });

  it('turning shuffle off restores the supplied source order', () => {
    engine.play({ itemIds: ids, intervalSec: 5, transition: 'cut', shuffle: true });
    expect(engine.setShuffle(false, ids)).toBe(true);
    expect(order()).toEqual(ids);
    expect(store.getState().mediaLibrary?.slideshow?.shuffle).toBe(false);
  });

  it('does nothing when no slideshow is loaded', () => {
    expect(engine.setShuffle(true)).toBe(false);
  });
});
