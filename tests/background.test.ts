import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createStateStore } from '../src/main/state';
import { createFullServer } from './_test-server';

function makeHttpServer() {
  const store = createStateStore();
  const server = createFullServer({
    store,
    operatorPin: 'test1234',
    adminPin: 'adminpass8',
    operatorSessionMs: 60000,
    adminSessionMs: 60000,
    port: 0,
  });
  return { server, store, presets: server.presets };
}

async function getCookies(app: Express) {
  const op = await request(app).post('/auth/operator').send({ pin: 'test1234' });
  const adm = await request(app).post('/auth/admin').send({ pin: 'adminpass8' });
  return {
    operator: ((op.headers['set-cookie'] as unknown) as string[])[0],
    admin: ((adm.headers['set-cookie'] as unknown) as string[])[0],
  };
}

describe('GET /api/background', () => {
  let app: Express;
  let cookies: { operator: string; admin: string };
  let srv: ReturnType<typeof makeHttpServer>['server'];

  beforeEach(async () => {
    const made = makeHttpServer();
    srv = made.server;
    await srv.listen();
    app = srv.app;
    cookies = await getCookies(app);
  });

  afterEach(() => srv.close());

  it('returns current background state (200)', async () => {
    const res = await request(app).get('/api/background').set('Cookie', cookies.operator);
    expect(res.status).toBe(200);
    expect(res.body.background).toEqual({
      presetId: null,
      presetName: null,
      type: 'luma',
      value: '#000000',
    });
  });

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/background');
    expect(res.status).toBe(401);
  });
});

describe('POST /api/background', () => {
  let app: Express;
  let cookies: { operator: string; admin: string };
  let srv: ReturnType<typeof makeHttpServer>['server'];
  let store: ReturnType<typeof makeHttpServer>['store'];

  beforeEach(async () => {
    const made = makeHttpServer();
    srv = made.server;
    store = made.store;
    await srv.listen();
    app = srv.app;
    cookies = await getCookies(app);
  });

  afterEach(() => srv.close());

  it('sets type and value (200, admin)', async () => {
    const res = await request(app)
      .post('/api/background')
      .set('Cookie', cookies.admin)
      .send({ type: 'solid', value: '#FF0000' });
    expect(res.status).toBe(200);
    expect(res.body.background).toEqual({
      presetId: null,
      presetName: null,
      type: 'solid',
      value: '#FF0000',
    });
    expect(store.getState().background.type).toBe('solid');
    expect(store.getState().background.value).toBe('#FF0000');
  });

  it('sets only type (value unchanged)', async () => {
    const res = await request(app)
      .post('/api/background')
      .set('Cookie', cookies.admin)
      .send({ type: 'solid' });
    expect(res.status).toBe(200);
    expect(res.body.background.type).toBe('solid');
    expect(res.body.background.value).toBe('#000000'); // default unchanged
  });

  it('sets only value (type unchanged)', async () => {
    const res = await request(app)
      .post('/api/background')
      .set('Cookie', cookies.admin)
      .send({ value: '#AABBCC' });
    expect(res.status).toBe(200);
    expect(res.body.background.type).toBe('luma'); // default unchanged
    expect(res.body.background.value).toBe('#AABBCC');
  });

  it('returns 400 INVALID_URL for invalid hex value', async () => {
    const res = await request(app)
      .post('/api/background')
      .set('Cookie', cookies.admin)
      .send({ value: 'notahex' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_URL');
  });

  it('returns 400 INVALID_URL for malformed hex (5 digits)', async () => {
    const res = await request(app)
      .post('/api/background')
      .set('Cookie', cookies.admin)
      .send({ value: '#AABBC' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_URL');
  });

  it('returns 400 INVALID_MODE for invalid type', async () => {
    const res = await request(app)
      .post('/api/background')
      .set('Cookie', cookies.admin)
      .send({ type: 'chroma' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_MODE');
  });

  it('returns 404 PRESET_NOT_FOUND when presetId is provided', async () => {
    const res = await request(app)
      .post('/api/background')
      .set('Cookie', cookies.admin)
      .send({ presetId: 'some-id' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('PRESET_NOT_FOUND');
  });

  it('returns 401 for operator (admin-only)', async () => {
    const res = await request(app)
      .post('/api/background')
      .set('Cookie', cookies.operator)
      .send({ type: 'solid', value: '#FF0000' });
    expect(res.status).toBe(401);
  });

  it('returns 401 without auth', async () => {
    const res = await request(app)
      .post('/api/background')
      .send({ type: 'solid', value: '#FF0000' });
    expect(res.status).toBe(401);
  });
});
