import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createStateStore } from '../src/main/state';
import { makeSlidesState } from '../src/shared/types';
import { createFullServer } from './_test-server';

const AUTH_CONFIG = {
  operatorPin: '1234',
  adminPin: 'supersecret',
  operatorSessionMs: 3600000,
  adminSessionMs: 3600000,
};

async function makeApp() {
  const store = createStateStore();
  const { app } = createFullServer({
    store,
    operatorPin: AUTH_CONFIG.operatorPin,
    adminPin: AUTH_CONFIG.adminPin,
    operatorSessionMs: AUTH_CONFIG.operatorSessionMs,
    adminSessionMs: AUTH_CONFIG.adminSessionMs,
  });
  const loginRes = await request(app).post('/auth/operator').send({ pin: '1234' });
  const cookie = loginRes.headers['set-cookie'][0].split(';')[0];
  return { app, store, cookie };
}

describe('POST /api/slides/load', () => {
  it('loads a deck and transitions to slides mode', async () => {
    const { app, cookie } = await makeApp();
    const res = await request(app)
      .post('/api/slides/load')
      .set('Cookie', cookie)
      .send({ deckUrl: 'https://docs.google.com/presentation/d/abc123/edit' });
    expect(res.status).toBe(200);
    expect(res.body.currentMode).toBe('slides');
    expect(res.body.slides.deckId).toBe('abc123');
    expect(res.body.slides.slideIndex).toBe(0);
    expect(res.body.slides.isLoading).toBe(true);
  });

  it('returns 400 INVALID_URL for malformed deckUrl', async () => {
    const { app, cookie } = await makeApp();
    const res = await request(app)
      .post('/api/slides/load')
      .set('Cookie', cookie)
      .send({ deckUrl: 'not-a-url' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_URL');
  });

  it('returns 400 INVALID_URL if deckUrl is not a Google Slides URL', async () => {
    const { app, cookie } = await makeApp();
    const res = await request(app)
      .post('/api/slides/load')
      .set('Cookie', cookie)
      .send({ deckUrl: 'https://example.com/not-slides' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_URL');
  });

  it('returns 401 without auth', async () => {
    const { app } = await makeApp();
    const res = await request(app)
      .post('/api/slides/load')
      .send({ deckUrl: 'https://docs.google.com/presentation/d/abc/edit' });
    expect(res.status).toBe(401);
  });
});

describe('POST /api/slides/next', () => {
  it('increments slideIndex', async () => {
    const { app, store, cookie } = await makeApp();
    store.setState({
      currentMode: 'slides',
      slides: makeSlidesState({ deckId: 'abc', deckTitle: 'Test', slideIndex: 0, slideCount: 5, isLoading: false }),
    });
    const res = await request(app)
      .post('/api/slides/next')
      .set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.slides.slideIndex).toBe(1);
  });

  it('returns 400 SLIDE_OUT_OF_RANGE at last slide', async () => {
    const { app, store, cookie } = await makeApp();
    store.setState({
      currentMode: 'slides',
      slides: makeSlidesState({ deckId: 'abc', deckTitle: 'Test', slideIndex: 4, slideCount: 5, isLoading: false }),
    });
    const res = await request(app)
      .post('/api/slides/next')
      .set('Cookie', cookie);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('SLIDE_OUT_OF_RANGE');
  });

  it('returns 400 NO_ACTIVE_DECK when not in slides mode', async () => {
    const { app, cookie } = await makeApp();
    const res = await request(app)
      .post('/api/slides/next')
      .set('Cookie', cookie);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('NO_ACTIVE_DECK');
  });

  it('returns 400 NO_ACTIVE_DECK when deck is still loading', async () => {
    const { app, store, cookie } = await makeApp();
    store.setState({
      currentMode: 'slides',
      slides: makeSlidesState({ deckId: 'abc', deckTitle: 'Test', slideIndex: 0, slideCount: 1, isLoading: true }),
    });
    const res = await request(app)
      .post('/api/slides/next')
      .set('Cookie', cookie);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('NO_ACTIVE_DECK');
  });
});

describe('POST /api/slides/prev', () => {
  it('decrements slideIndex', async () => {
    const { app, store, cookie } = await makeApp();
    store.setState({
      currentMode: 'slides',
      slides: makeSlidesState({ deckId: 'abc', deckTitle: 'Test', slideIndex: 3, slideCount: 5, isLoading: false }),
    });
    const res = await request(app)
      .post('/api/slides/prev')
      .set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.slides.slideIndex).toBe(2);
  });

  it('returns 400 SLIDE_OUT_OF_RANGE at first slide', async () => {
    const { app, store, cookie } = await makeApp();
    store.setState({
      currentMode: 'slides',
      slides: makeSlidesState({ deckId: 'abc', deckTitle: 'Test', slideIndex: 0, slideCount: 5, isLoading: false }),
    });
    const res = await request(app)
      .post('/api/slides/prev')
      .set('Cookie', cookie);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('SLIDE_OUT_OF_RANGE');
  });
});

describe('POST /api/slides/goto', () => {
  it('jumps to specified slide index', async () => {
    const { app, store, cookie } = await makeApp();
    store.setState({
      currentMode: 'slides',
      slides: makeSlidesState({ deckId: 'abc', deckTitle: 'Test', slideIndex: 0, slideCount: 10, isLoading: false }),
    });
    const res = await request(app)
      .post('/api/slides/goto')
      .set('Cookie', cookie)
      .send({ slideIndex: 7 });
    expect(res.status).toBe(200);
    expect(res.body.slides.slideIndex).toBe(7);
  });

  it('returns 400 SLIDE_OUT_OF_RANGE for index >= slideCount', async () => {
    const { app, store, cookie } = await makeApp();
    store.setState({
      currentMode: 'slides',
      slides: makeSlidesState({ deckId: 'abc', deckTitle: 'Test', slideIndex: 0, slideCount: 5, isLoading: false }),
    });
    const res = await request(app)
      .post('/api/slides/goto')
      .set('Cookie', cookie)
      .send({ slideIndex: 5 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('SLIDE_OUT_OF_RANGE');
  });

  it('returns 400 SLIDE_OUT_OF_RANGE for negative index', async () => {
    const { app, store, cookie } = await makeApp();
    store.setState({
      currentMode: 'slides',
      slides: makeSlidesState({ deckId: 'abc', deckTitle: 'Test', slideIndex: 0, slideCount: 5, isLoading: false }),
    });
    const res = await request(app)
      .post('/api/slides/goto')
      .set('Cookie', cookie)
      .send({ slideIndex: -1 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('SLIDE_OUT_OF_RANGE');
  });
});

describe('POST /api/slides/reload', () => {
  it('sets isLoading: true on active instance', async () => {
    const { app, store, cookie } = await makeApp();
    store.setState({
      currentMode: 'slides',
      slides: makeSlidesState({ deckId: 'abc', deckTitle: 'Test', slideIndex: 2, slideCount: 5, isLoading: false }),
    });
    const res = await request(app)
      .post('/api/slides/reload')
      .set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.slides.isLoading).toBe(true);
  });

  it('returns 400 NO_ACTIVE_DECK when not in slides mode', async () => {
    const { app, cookie } = await makeApp();
    const res = await request(app)
      .post('/api/slides/reload')
      .set('Cookie', cookie);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('NO_ACTIVE_DECK');
  });
});

describe('POST /api/ab/switch', () => {
  it('switches active instance to B', async () => {
    const { app, cookie } = await makeApp();
    const res = await request(app)
      .post('/api/ab/switch')
      .set('Cookie', cookie)
      .send({ instance: 'B' });
    expect(res.status).toBe(200);
    expect(res.body.abState.activeInstance).toBe('B');
  });

  it('switches active instance back to A', async () => {
    const { app, store, cookie } = await makeApp();
    store.setState({ abState: { ...store.getState().abState, activeInstance: 'B' } });
    const res = await request(app)
      .post('/api/ab/switch')
      .set('Cookie', cookie)
      .send({ instance: 'A' });
    expect(res.status).toBe(200);
    expect(res.body.abState.activeInstance).toBe('A');
  });

  it('returns 400 INVALID_MODE for invalid instance value', async () => {
    const { app, cookie } = await makeApp();
    const res = await request(app)
      .post('/api/ab/switch')
      .set('Cookie', cookie)
      .send({ instance: 'C' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_MODE');
  });

  it('returns 401 without auth', async () => {
    const { app } = await makeApp();
    const res = await request(app)
      .post('/api/ab/switch')
      .send({ instance: 'B' });
    expect(res.status).toBe(401);
  });
});
