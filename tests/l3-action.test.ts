import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createStateStore } from '../src/main/state';
import { createFullServer } from './_test-server';

const AUTH = {
  operatorPin: 'op1234',
  adminPin: 'adminpass8',
  operatorSessionMs: 60000,
  adminSessionMs: 60000,
};

async function opCookie(app: Express): Promise<string> {
  const res = await request(app).post('/auth/operator').send({ pin: 'op1234' });
  return (res.headers['set-cookie'] as unknown as string[])[0];
}

async function adminCookie(app: Express): Promise<string> {
  const res = await request(app).post('/auth/admin').send({ pin: 'adminpass8' });
  return (res.headers['set-cookie'] as unknown as string[])[0];
}

describe('POST /api/l3/take', () => {
  let app: Express;
  let srv: ReturnType<typeof createFullServer>;
  let cookie: string;

  beforeEach(async () => {
    const store = createStateStore();
    srv = createFullServer({
      store,
      operatorPin: AUTH.operatorPin,
      adminPin: AUTH.adminPin,
      operatorSessionMs: AUTH.operatorSessionMs,
      adminSessionMs: AUTH.adminSessionMs,
      port: 0,
    });
    await srv.listen();
    app = srv.app;
    cookie = await opCookie(app);
  });

  afterEach(() => srv.close());

  it('takes inline cue (name + title)', async () => {
    const res = await request(app)
      .post('/api/l3/take')
      .set('Cookie', cookie)
      .send({ name: 'Jane', title: 'Host', theme: 'default' });
    expect(res.status).toBe(200);
    expect(res.body.currentMode).toBe('l3');
    expect(res.body.l3.activeCueName).toBe('Jane');
    expect(res.body.l3.activeTitle).toBe('Host');
    expect(res.body.l3.activeCueId).toBeTruthy();
  });

  it('returns 404 for unknown cueId', async () => {
    const res = await request(app)
      .post('/api/l3/take')
      .set('Cookie', cookie)
      .send({ cueId: 'missing' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('CUE_NOT_FOUND');
  });
});

describe('POST /api/l3/clear and stacking', () => {
  let app: Express;
  let srv: ReturnType<typeof createFullServer>;
  let cookie: string;

  beforeEach(async () => {
    const store = createStateStore();
    srv = createFullServer({
      store,
      operatorPin: AUTH.operatorPin,
      adminPin: AUTH.adminPin,
      operatorSessionMs: AUTH.operatorSessionMs,
      adminSessionMs: AUTH.adminSessionMs,
      port: 0,
    });
    await srv.listen();
    app = srv.app;
    cookie = await opCookie(app);
    await request(app).post('/api/l3/take').set('Cookie', cookie).send({ name: 'A', title: 'B' });
  });

  afterEach(() => srv.close());

  it('clears active cue fields', async () => {
    const res = await request(app).post('/api/l3/clear').set('Cookie', cookie).send({});
    expect(res.status).toBe(200);
    expect(res.body.l3.activeCueId).toBeNull();
    expect(res.body.l3.activeCueName).toBeNull();
  });

  it('sets stacking flag', async () => {
    const res = await request(app).post('/api/l3/stacking').set('Cookie', cookie).send({ enabled: true });
    expect(res.status).toBe(200);
    expect(res.body.l3.isStacking).toBe(true);
  });
});

describe('L3 playlists', () => {
  let app: Express;
  let srv: ReturnType<typeof createFullServer>;
  let op: string;
  let adm: string;

  beforeEach(async () => {
    const store = createStateStore();
    srv = createFullServer({
      store,
      operatorPin: AUTH.operatorPin,
      adminPin: AUTH.adminPin,
      operatorSessionMs: AUTH.operatorSessionMs,
      adminSessionMs: AUTH.adminSessionMs,
      port: 0,
    });
    await srv.listen();
    app = srv.app;
    op = await opCookie(app);
    adm = await adminCookie(app);
    const cue = await request(app).post('/api/l3/cues').set('Cookie', adm).send({
      name: 'Spk', title: 'Role', theme: 'default',
    });
    expect(cue.status).toBe(201);
  });

  afterEach(() => srv.close());

  it('creates and lists playlist', async () => {
    const list = await request(app).get('/api/l3/cues').set('Cookie', op);
    const cueId = list.body.cues[0].id;
    const create = await request(app)
      .post('/api/l3/playlists')
      .set('Cookie', adm)
      .send({ name: 'Show', cueIds: [cueId] });
    expect(create.status).toBe(201);
    const all = await request(app).get('/api/l3/playlists').set('Cookie', op);
    expect(all.status).toBe(200);
    expect(all.body.playlists).toHaveLength(1);
  });
});

describe('POST /api/action', () => {
  let app: Express;
  let srv: ReturnType<typeof createFullServer>;
  let cookie: string;
  let store: ReturnType<typeof createStateStore>;

  beforeEach(async () => {
    store = createStateStore();
    srv = createFullServer({
      store,
      operatorPin: AUTH.operatorPin,
      adminPin: AUTH.adminPin,
      operatorSessionMs: AUTH.operatorSessionMs,
      adminSessionMs: AUTH.adminSessionMs,
      port: 0,
    });
    await srv.listen();
    app = srv.app;
    cookie = await opCookie(app);
    await request(app)
      .post('/api/slides/load')
      .set('Cookie', cookie)
      .send({ deckUrl: 'https://docs.google.com/presentation/d/xyz789/edit' });
    const s = store.getState().slides!;
    store.setState({ slides: { ...s, slideCount: 10, slideIndex: 0, isLoading: false } });
  });

  afterEach(() => srv.close());

  it('runs slides_next with session cookie', async () => {
    const res = await request(app)
      .post('/api/action')
      .set('Cookie', cookie)
      .send({ action_id: 'slides_next', params: {} });
    expect(res.status).toBe(200);
    expect(res.body.slides.slideIndex).toBe(1);
  });

  it('accepts operator_pin query instead of cookie', async () => {
    const res = await request(app)
      .post('/api/action?operator_pin=op1234')
      .send({ action_id: 'slides_next', params: {} });
    expect(res.status).toBe(200);
    expect(res.body.slides.slideIndex).toBe(1);
  });
});
