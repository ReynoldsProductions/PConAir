import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createStateStore, type StateStore } from '../src/main/state';
import { createFullServer } from './_test-server';
import { makeSlidesState } from '../src/shared/types';

const PINS = { operatorPin: '1234', adminPin: 'supersecret' };

/** Minimal valid 1×1 PNG */
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

describe('action dispatcher — phase 9 Companion actions', () => {
  let srv: ReturnType<typeof createFullServer>;
  let store: StateStore;
  let app: Express;

  // /api/action with ?operator_pin= exercises the same dispatcher Companion uses.
  function act(actionId: string, params: Record<string, unknown> = {}) {
    return request(app)
      .post(`/api/action?operator_pin=${PINS.operatorPin}`)
      .send({ action_id: actionId, params });
  }

  beforeEach(async () => {
    store = createStateStore();
    srv = createFullServer({ store, ...PINS, port: 0 });
    await srv.listen();
    app = srv.app;
  });

  afterEach(() => srv.close());

  describe('L3 playlists', () => {
    let cueIds: string[];

    beforeEach(() => {
      cueIds = ['Alice', 'Bob', 'Carol'].map(
        (name) => srv.l3Cues.create({ name, title: `${name} Title`, theme: 'default', subtitle: null }).id
      );
      const created = srv.l3Playlists.create({ name: 'Show Open', cueIds });
      expect(created.ok).toBe(true);
    });

    it('l3_activate_playlist accepts a playlist name and seeds length', async () => {
      const res = await act('l3_activate_playlist', { playlist: 'Show Open' });
      expect(res.status).toBe(200);
      const l3 = store.getState().l3;
      expect(l3?.currentPlaylistId).toBeTruthy();
      expect(l3?.playlistLength).toBe(3);
      expect(l3?.playlistPosition).toBeNull();
    });

    it('l3_next / l3_prev step with wrap and update playlistPosition in state', async () => {
      await act('l3_activate_playlist', { playlist: 'Show Open' });

      let res = await act('l3_next');
      expect(res.status).toBe(200);
      expect(res.body.playlistPosition).toBe(1);
      expect(store.getState().l3?.activeCueName).toBe('Alice');
      expect(store.getState().l3?.playlistPosition).toBe(1);
      expect(store.getState().l3?.playlistLength).toBe(3);

      res = await act('l3_next');
      expect(store.getState().l3?.activeCueName).toBe('Bob');
      expect(store.getState().l3?.playlistPosition).toBe(2);

      // prev wraps backwards from position 2 → 1, then 1 → 3
      await act('l3_prev');
      expect(store.getState().l3?.playlistPosition).toBe(1);
      await act('l3_prev');
      expect(store.getState().l3?.activeCueName).toBe('Carol');
      expect(store.getState().l3?.playlistPosition).toBe(3);
    });

    it('l3_next without an active playlist fails honestly', async () => {
      const res = await act('l3_next');
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('PRESET_NOT_FOUND');
    });

    it('l3_toggle_stacking flips the stacking flag', async () => {
      await act('l3_toggle_stacking');
      expect(store.getState().l3?.isStacking).toBe(true);
      await act('l3_toggle_stacking');
      expect(store.getState().l3?.isStacking).toBe(false);
    });
  });

  describe('still store', () => {
    let itemId: string;

    beforeEach(() => {
      const rec = srv.mediaLibrary.ingestBuffer('logo.png', PNG_1PX);
      expect(rec).toBeTruthy();
      itemId = rec!.id;
    });

    it('stills_take accepts an item id', async () => {
      const res = await act('stills_take', { item: itemId });
      expect(res.status).toBe(200);
      expect(store.getState().currentMode).toBe('media-library');
      expect(store.getState().mediaLibrary?.activeItemId).toBe(itemId);
    });

    it('stills_take accepts a display name', async () => {
      const res = await act('stills_take', { item: 'logo.png' });
      expect(res.status).toBe(200);
      expect(store.getState().mediaLibrary?.activeItemId).toBe(itemId);
    });

    it('stills_clear returns to idle', async () => {
      await act('stills_take', { item: itemId });
      await act('stills_clear');
      expect(store.getState().currentMode).toBe('idle');
      expect(store.getState().mediaLibrary).toBeNull();
    });

    it('unknown item is a 404', async () => {
      const res = await act('stills_take', { item: 'nope.png' });
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('ITEM_NOT_FOUND');
    });
  });

  describe('slideshow', () => {
    let ids: string[];

    beforeEach(() => {
      ids = ['a.png', 'b.png', 'c.png'].map((n) => srv.mediaLibrary.ingestBuffer(n, PNG_1PX)!.id);
    });

    it('play / pause / resume / next / stop drive the shared engine', async () => {
      let res = await act('stills_slideshow_play', { item_ids: ids, interval_sec: 60, transition: 'fade' });
      expect(res.status).toBe(200);
      let show = store.getState().mediaLibrary?.slideshow;
      expect(show?.running).toBe(true);
      expect(show?.transition).toBe('fade');
      expect(show?.position).toBe(0);

      await act('stills_slideshow_next');
      expect(store.getState().mediaLibrary?.slideshow?.position).toBe(1);
      expect(store.getState().mediaLibrary?.activeItemId).toBe(ids[1]);

      await act('stills_slideshow_pause');
      expect(store.getState().mediaLibrary?.slideshow?.paused).toBe(true);

      // play with no items resumes the paused show
      res = await act('stills_slideshow_play');
      expect(res.status).toBe(200);
      show = store.getState().mediaLibrary?.slideshow;
      expect(show?.paused).toBe(false);
      expect(show?.position).toBe(1);

      await act('stills_slideshow_stop');
      expect(store.getState().mediaLibrary?.slideshow).toBeNull();
      // stop keeps the current image on air
      expect(store.getState().mediaLibrary?.activeItemId).toBe(ids[1]);
    });

    it('play with no items and no loaded show plays the whole library', async () => {
      const res = await act('stills_slideshow_play', { interval_sec: 60 });
      expect(res.status).toBe(200);
      expect(store.getState().mediaLibrary?.slideshow?.itemIds).toEqual(ids);
    });

    it('pause without a show fails honestly', async () => {
      const res = await act('stills_slideshow_pause');
      expect(res.status).toBe(400);
    });
  });

  describe('slides extras', () => {
    it('slides_load accepts a backup_url', async () => {
      const res = await act('slides_load', {
        deck_url: 'https://docs.google.com/presentation/d/PRIMARY123/edit',
        backup_url: 'https://docs.google.com/presentation/d/BACKUP456/edit',
      });
      expect(res.status).toBe(200);
      const slides = store.getState().slides;
      expect(slides?.deckId).toBe('PRIMARY123');
      expect(slides?.backupDeckId).toBe('BACKUP456');
    });

    it('slides_goto_first / slides_goto_last clamp to the deck', async () => {
      store.setState({
        currentMode: 'slides',
        slides: makeSlidesState({ deckId: 'd', deckTitle: 'Deck', slideIndex: 2, slideCount: 7, isLoading: false }),
      });
      await act('slides_goto_last');
      expect(store.getState().slides?.slideIndex).toBe(6);
      await act('slides_goto_first');
      expect(store.getState().slides?.slideIndex).toBe(0);
    });

    it('slides_goto_last without a deck is NO_ACTIVE_DECK', async () => {
      const res = await act('slides_goto_last');
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('NO_ACTIVE_DECK');
    });

    it('slides_offline_mode toggles when enabled is omitted', async () => {
      store.setState({
        currentMode: 'slides',
        slides: makeSlidesState({ deckId: 'd', deckTitle: 'Deck', slideIndex: 0, slideCount: 3, isLoading: false }),
      });
      await act('slides_offline_mode');
      expect(store.getState().slides?.offlineMode).toBe(true);
      await act('slides_offline_mode', { enabled: false });
      expect(store.getState().slides?.offlineMode).toBe(false);
    });
  });
});
