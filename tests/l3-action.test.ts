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

describe('PUT /api/l3/cues/:id', () => {
  let app: Express;
  let srv: ReturnType<typeof createFullServer>;
  let adm: string;
  let op: string;

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
    adm = await adminCookie(app);
    op = await opCookie(app);
  });

  afterEach(() => srv.close());

  it('updates cue fields and returns updated cue', async () => {
    const created = await request(app)
      .post('/api/l3/cues')
      .set('Cookie', adm)
      .send({ name: 'Alice', title: 'Engineer', theme: 'default' });
    expect(created.status).toBe(201);
    const id = created.body.id;

    const res = await request(app)
      .put(`/api/l3/cues/${id}`)
      .set('Cookie', adm)
      .send({ name: 'Alice B', title: 'Sr Engineer', subtitle: 'Infra', themeId: 'default' });
    expect(res.status).toBe(200);
    expect(res.body.cue.name).toBe('Alice B');
    expect(res.body.cue.title).toBe('Sr Engineer');
    expect(res.body.cue.subtitle).toBe('Infra');
    expect(res.body.cue.theme).toBe('default');
  });

  it('returns 404 for unknown cue id', async () => {
    const res = await request(app)
      .put('/api/l3/cues/nonexistent')
      .set('Cookie', adm)
      .send({ name: 'Ghost' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('CUE_NOT_FOUND');
  });

  it('requires admin auth', async () => {
    const created = await request(app)
      .post('/api/l3/cues')
      .set('Cookie', adm)
      .send({ name: 'Bob', title: 'Dev', theme: 'default' });
    const id = created.body.id;

    const res = await request(app)
      .put(`/api/l3/cues/${id}`)
      .set('Cookie', op)
      .send({ name: 'Bob Updated' });
    expect(res.status).toBe(403);
  });

  it('accepts themeId as field name on POST /cues', async () => {
    const res = await request(app)
      .post('/api/l3/cues')
      .set('Cookie', adm)
      .send({ name: 'Carol', title: 'PM', themeId: 'default' });
    expect(res.status).toBe(201);
    expect(res.body.theme).toBe('default');
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
