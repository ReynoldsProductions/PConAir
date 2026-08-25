import http from 'http';
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

    it('panic defaults to toggle and accepts on/off', async () => {
      let res = await act('panic');
      expect(res.status).toBe(200);
      expect(store.getState().reliability.panicActive).toBe(true);

      res = await act('panic');
      expect(store.getState().reliability.panicActive).toBe(false);

      await act('panic', { action: 'on' });
      expect(store.getState().reliability.panicActive).toBe(true);
      await act('panic', { action: 'off' });
      expect(store.getState().reliability.panicActive).toBe(false);
    });

    it('panic rejects an unknown action value', async () => {
      const res = await act('panic', { action: 'explode' });
      expect(res.status).toBe(400);
      expect(store.getState().reliability.panicActive).toBe(false);
    });

    it('reload_instance rejects the on-air instance', async () => {
      const res = await act('reload_instance', { instance: 'A' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_INSTANCE');
    });

    it('reload_instance reloads the off-air instance and settles ready', async () => {
      const res = await act('reload_instance', { instance: 'B' });
      expect(res.status).toBe(200);
      expect(store.getState().abState.instanceB.isLoading).toBe(true);
      await new Promise((r) => setTimeout(r, 120));
      const b = store.getState().abState.instanceB;
      expect(b.isLoading).toBe(false);
      expect(b.isReady).toBe(true);
    });

    it('reload_instance rejects a bad instance value', async () => {
      const res = await act('reload_instance', { instance: 'C' });
      expect(res.status).toBe(400);
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

  describe('prompter (no external service configured)', () => {
    it.each(['prompter_set_speed', 'prompter_set_font_size', 'prompter_load_script', 'prompter_toggle'])(
      '%s drives the built-in prompter and forwards nowhere',
      async (actionId) => {
        const res = await act(actionId, { speed: 50, font_size: 80, text: 'hi' });
        expect(res.status).toBe(200);
        expect(res.body.forwarded).toBe('off');
      }
    );

    it('applies transport, script, and position changes to the built-in prompter', async () => {
      await act('prompter_set_speed', { speed: 120 });
      await act('prompter_set_font_size', { font_size: 90 });
      await act('prompter_load_script', { text: 'Good evening.' });
      expect(store.getState().prompter).toMatchObject({
        speed: 120,
        fontSize: 90,
        script: 'Good evening.',
        scrolling: false,
        offset: 0,
      });

      await act('prompter_start');
      expect(store.getState().prompter.scrolling).toBe(true);
      expect(store.getState().prompter.startedAt).not.toBeNull();

      await act('prompter_stop');
      expect(store.getState().prompter.scrolling).toBe(false);

      // Scrolling ran for a moment above, so the jump is relative to wherever
      // the script had reached — not to the top.
      const parkedAt = store.getState().prompter.offset;
      await act('prompter_jump', { delta: 300 });
      expect(store.getState().prompter.offset).toBeCloseTo(parkedAt + 300, 5);
      await act('prompter_rewind');
      expect(store.getState().prompter.offset).toBe(0);
    });

    it('prompter_jump rejects a missing delta', async () => {
      const res = await act('prompter_jump', {});
      expect(res.status).toBe(400);
    });

    it('prompter_mirror toggles an axis, or sets it outright', async () => {
      await act('prompter_mirror', { axis: 'x' });
      expect(store.getState().prompter.mirrorX).toBe(true);
      await act('prompter_mirror', { axis: 'x' });
      expect(store.getState().prompter.mirrorX).toBe(false);

      await act('prompter_mirror', { axis: 'y', mode: 'on' });
      expect(store.getState().prompter.mirrorY).toBe(true);
      await act('prompter_mirror', { axis: 'y', mode: 'off' });
      expect(store.getState().prompter.mirrorY).toBe(false);

      const bad = await act('prompter_mirror', { axis: 'z' });
      expect(bad.status).toBe(400);
    });
  });
});

describe('action dispatcher — prompter with a configured host', () => {
  let srv: ReturnType<typeof createFullServer>;
  let store: StateStore;
  let app: Express;
  let tpServer: http.Server;
  let tpHost: string;
  let received: Array<Record<string, unknown>>;

  function act(actionId: string, params: Record<string, unknown> = {}) {
    return request(app)
      .post(`/api/action?operator_pin=${PINS.operatorPin}`)
      .send({ action_id: actionId, params });
  }

  beforeEach(async () => {
    received = [];
    tpServer = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        received.push(JSON.parse(Buffer.concat(chunks).toString() || '{}'));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{}');
      });
    });
    await new Promise<void>((r) => tpServer.listen(0, '127.0.0.1', r));
    const addr = tpServer.address() as { port: number };
    tpHost = `http://127.0.0.1:${addr.port}`;

    store = createStateStore();
    srv = createFullServer({
      store,
      ...PINS,
      port: 0,
      getPrompterHost: () => tpHost,
      isPrompterEnabled: () => true,
    });
    await srv.listen();
    app = srv.app;
  });

  afterEach(async () => {
    srv.close();
    await new Promise((r) => tpServer.close(r));
  });

  it('prompter_set_speed clamps to 0-200 and patches the remote + store', async () => {
    let res = await act('prompter_set_speed', { speed: 500 });
    expect(res.status).toBe(200);
    expect(store.getState().prompter.speed).toBe(200);
    expect(received.at(-1)).toEqual({ speed: 200 });

    res = await act('prompter_set_speed', { speed: -10 });
    expect(store.getState().prompter.speed).toBe(0);
    expect(received.at(-1)).toEqual({ speed: 0 });
  });

  it('prompter_set_speed rejects a missing/non-numeric speed', async () => {
    const res = await act('prompter_set_speed', {});
    expect(res.status).toBe(400);
  });

  it('prompter_set_font_size clamps to 24-200 and patches the remote + store', async () => {
    await act('prompter_set_font_size', { font_size: 10 });
    expect(store.getState().prompter.fontSize).toBe(24);
    expect(received.at(-1)).toEqual({ font_size: 24 });

    await act('prompter_set_font_size', { font_size: 96 });
    expect(store.getState().prompter.fontSize).toBe(96);
  });

  it('prompter_set_font_size rejects a missing font_size', async () => {
    const res = await act('prompter_set_font_size', {});
    expect(res.status).toBe(400);
  });

  it('prompter_load_script posts the script text to the remote', async () => {
    const res = await act('prompter_load_script', { text: 'Good evening.' });
    expect(res.status).toBe(200);
    expect(received.at(-1)).toEqual({ script: 'Good evening.' });
  });

  it('prompter_load_script rejects a missing text', async () => {
    const res = await act('prompter_load_script', {});
    expect(res.status).toBe(400);
  });

  it('prompter_toggle flips scrolling on the remote and in the store', async () => {
    await act('prompter_toggle');
    expect(store.getState().prompter.scrolling).toBe(true);
    expect(received.at(-1)).toEqual({ scrolling: true });

    await act('prompter_toggle');
    expect(store.getState().prompter.scrolling).toBe(false);
    expect(received.at(-1)).toEqual({ scrolling: false });
  });
});
