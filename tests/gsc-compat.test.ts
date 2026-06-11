import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createStateStore } from '../src/main/state';
import { makeSlidesState } from '../src/shared/types';
import type { StateStore } from '../src/main/state';
import { createFullServer } from './_test-server';

const AUTH_CONFIG = {
  operatorPin: '1234',
  adminPin: 'supersecret',
};

let app: Express;
let store: StateStore;

beforeEach(() => {
  store = createStateStore();
  ({ app } = createFullServer({
    store,
    operatorPin: AUTH_CONFIG.operatorPin,
    adminPin: AUTH_CONFIG.adminPin,
  }));
});

function loadReadyDeck(slideIndex = 0, slideCount = 10): void {
  store.setState({
    currentMode: 'slides',
    slides: makeSlidesState({
      deckId: 'abc123',
      deckTitle: 'Test Deck',
      slideIndex,
      slideCount,
      isLoading: false,
      deckUrl: 'https://docs.google.com/presentation/d/abc123/edit',
      notes: 'Hello notes',
    }),
  });
}

describe('GSC-compat /api/status fields', () => {
  it('reports closed state with nulls when no deck is loaded', async () => {
    const res = await request(app).get('/api/status');
    expect(res.status).toBe(200);
    expect(res.body.presentationOpen).toBe(false);
    expect(res.body.notesOpen).toBe(false);
    expect(res.body.currentSlide).toBeNull();
    expect(res.body.totalSlides).toBeNull();
    expect(res.body.slideInfo).toBeNull();
    expect(res.body.contentKind).toBe('slides');
    expect(res.body.perfectcue).toEqual({ enabled: false, ports: [] });
    // PConAir AppState fields still present for the native Companion module
    expect(res.body.currentMode).toBe('idle');
    expect(res.body.connectionStatus).toBeDefined();
  });

  it('reports 1-based slide position and derived fields for a ready deck', async () => {
    loadReadyDeck(2, 10);
    const res = await request(app).get('/api/status');
    expect(res.body.presentationOpen).toBe(true);
    expect(res.body.currentSlide).toBe(3);
    expect(res.body.totalSlides).toBe(10);
    expect(res.body.slideInfo).toBe('3 / 10');
    expect(res.body.isFirstSlide).toBe(false);
    expect(res.body.isLastSlide).toBe(false);
    expect(res.body.nextSlide).toBe(4);
    expect(res.body.previousSlide).toBe(2);
    expect(res.body.presentationTitle).toBe('Test Deck');
    expect(res.body.presentationUrl).toContain('abc123');
  });

  it('marks first/last slide edges', async () => {
    loadReadyDeck(0, 5);
    let res = await request(app).get('/api/status');
    expect(res.body.isFirstSlide).toBe(true);
    expect(res.body.previousSlide).toBeNull();
    loadReadyDeck(4, 5);
    res = await request(app).get('/api/status');
    expect(res.body.isLastSlide).toBe(true);
    expect(res.body.nextSlide).toBeNull();
  });

  it('reports contentKind slido in url mode', async () => {
    store.setState({ currentMode: 'url', currentUrl: 'https://example.com' });
    const res = await request(app).get('/api/status');
    expect(res.body.contentKind).toBe('slido');
    expect(res.body.presentationUrl).toBe('https://example.com');
  });
});

describe('GSC-compat action endpoints (no auth required)', () => {
  it('POST /api/open-presentation loads a deck', async () => {
    const res = await request(app)
      .post('/api/open-presentation')
      .send({ url: 'https://docs.google.com/presentation/d/deck9/edit' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(store.getState().slides?.deckId).toBe('deck9');
    expect(store.getState().currentMode).toBe('slides');
  });

  it('POST /api/open-presentation rejects a non-Slides URL', async () => {
    const res = await request(app).post('/api/open-presentation').send({ url: 'https://example.com' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
  });

  it('next/previous-slide navigate a ready deck', async () => {
    loadReadyDeck(0, 3);
    let res = await request(app).post('/api/next-slide');
    expect(res.status).toBe(200);
    expect(store.getState().slides?.slideIndex).toBe(1);
    res = await request(app).post('/api/previous-slide');
    expect(res.status).toBe(200);
    expect(store.getState().slides?.slideIndex).toBe(0);
  });

  it('next-slide without a deck returns an error string', async () => {
    const res = await request(app).post('/api/next-slide');
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
  });

  it('go-to-slide is 1-based', async () => {
    loadReadyDeck(0, 10);
    const res = await request(app).post('/api/go-to-slide').send({ slide: 7 });
    expect(res.status).toBe(200);
    expect(store.getState().slides?.slideIndex).toBe(6);
  });

  it('go-to-slide rejects slide 0', async () => {
    loadReadyDeck(0, 10);
    const res = await request(app).post('/api/go-to-slide').send({ slide: 0 });
    expect(res.status).toBe(400);
  });

  it('close-presentation returns to idle', async () => {
    loadReadyDeck();
    const res = await request(app).post('/api/close-presentation');
    expect(res.status).toBe(200);
    expect(store.getState().currentMode).toBe('idle');
    expect(store.getState().slides).toBeNull();
  });

  it('open-slido switches to url mode', async () => {
    const res = await request(app).post('/api/open-slido').send({ url: 'https://app.sli.do/event/x' });
    expect(res.status).toBe(200);
    expect(store.getState().currentMode).toBe('url');
  });

  it('speaker-notes open/close are acknowledged no-ops', async () => {
    expect((await request(app).post('/api/open-speaker-notes')).status).toBe(200);
    expect((await request(app).post('/api/close-speaker-notes')).status).toBe(200);
  });

  it('unsupported endpoints return an honest error', async () => {
    for (const ep of ['toggle-video', 'open-key-fill', 'set-perfectcue-enabled']) {
      const res = await request(app).post(`/api/${ep}`);
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('not supported');
    }
  });
});

describe('PConAir-native slides additions', () => {
  it('GET /api/slides/status returns the slides summary without auth', async () => {
    loadReadyDeck(1, 4);
    const res = await request(app).get('/api/slides/status');
    expect(res.status).toBe(200);
    expect(res.body.slide).toBe(2);
    expect(res.body.total).toBe(4);
    expect(res.body.notes).toBe('Hello notes');
    expect(res.body.deckLoaded).toBe(true);
    expect(res.body.backupLoaded).toBe(false);
  });

  it('GET /api/slides/thumbnails returns nulls before capture', async () => {
    const res = await request(app).get('/api/slides/thumbnails');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ current: null, next: null });
  });

  it('POST /api/slides/load accepts a backupUrl', async () => {
    const login = await request(app).post('/auth/operator').send({ pin: '1234' });
    const cookie = login.headers['set-cookie'][0].split(';')[0];
    const res = await request(app)
      .post('/api/slides/load')
      .set('Cookie', cookie)
      .send({
        deckUrl: 'https://docs.google.com/presentation/d/primary1/edit',
        backupUrl: 'https://docs.google.com/presentation/d/backup1/edit',
      });
    expect(res.status).toBe(200);
    expect(res.body.slides.backupDeckId).toBe('backup1');
    expect(res.body.slides.backupLoaded).toBe(false);
  });

  it('POST /api/slides/load rejects a non-Slides backupUrl', async () => {
    const login = await request(app).post('/auth/operator').send({ pin: '1234' });
    const cookie = login.headers['set-cookie'][0].split(';')[0];
    const res = await request(app)
      .post('/api/slides/load')
      .set('Cookie', cookie)
      .send({
        deckUrl: 'https://docs.google.com/presentation/d/primary1/edit',
        backupUrl: 'https://example.com/deck',
      });
    expect(res.status).toBe(400);
  });

  it('POST /api/slides/offline-mode toggles and survives reload of state', async () => {
    loadReadyDeck();
    const login = await request(app).post('/auth/operator').send({ pin: '1234' });
    const cookie = login.headers['set-cookie'][0].split(';')[0];
    const res = await request(app).post('/api/slides/offline-mode').set('Cookie', cookie).send({ enabled: true });
    expect(res.status).toBe(200);
    expect(store.getState().slides?.offlineMode).toBe(true);
    const status = await request(app).get('/api/status');
    expect(status.body.offlineModeEnabled).toBe(true);
  });
});
