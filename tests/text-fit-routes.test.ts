import { describe, it, expect } from 'vitest';
import request from 'supertest';
import path from 'path';
import { createStateStore } from '../src/main/state';
import { createFullServer } from './_test-server';

const BUNDLED = path.join(process.cwd(), 'bundled-packages');

function makeServer() {
  const store = createStateStore();
  return createFullServer({
    store,
    operatorPin: 'test1234',
    adminPin: 'adminpass8',
    port: 0,
    packagesRoot: BUNDLED,
  });
}

async function operatorCookie(app: any) {
  const res = await request(app).post('/auth/operator').send({ pin: 'test1234' });
  return (res.headers['set-cookie'] as unknown as string[])[0];
}

describe('POST /api/packages/:id/warnings (spec 22 T9)', () => {
  it('stores warnings from an allowlisted (cookie-less) caller', async () => {
    const srv = makeServer();
    const post = await request(srv.app)
      .post('/api/packages/news/warnings')
      .send({ renderId: 'l3', warnings: [{ field: 'name', text: 'X', naturalWidth: 900, maxWidth: 620 }] });
    expect(post.status).toBe(200);

    const cookie = await operatorCookie(srv.app);
    const get = await request(srv.app).get('/api/packages/news/warnings').set('Cookie', cookie);
    expect(get.status).toBe(200);
    expect(get.body.warnings).toEqual({
      l3: [{ field: 'name', text: 'X', naturalWidth: 900, maxWidth: 620 }],
    });
  });

  it('404s an unknown package', async () => {
    const srv = makeServer();
    const res = await request(srv.app).post('/api/packages/nope/warnings').send({ renderId: 'l3', warnings: [] });
    expect(res.status).toBe(404);
  });

  it('400s a body with more than 32 warnings', async () => {
    const srv = makeServer();
    const warnings = Array.from({ length: 33 }, (_, i) => ({
      field: 'f' + i,
      text: 'x',
      naturalWidth: 100,
      maxWidth: 50,
    }));
    const res = await request(srv.app).post('/api/packages/news/warnings').send({ renderId: 'l3', warnings });
    expect(res.status).toBe(400);
  });

  it('400s a body over 16KB', async () => {
    const srv = makeServer();
    const bigText = 'x'.repeat(2000);
    const warnings = Array.from({ length: 10 }, (_, i) => ({
      field: 'f' + i,
      text: bigText,
      naturalWidth: 100,
      maxWidth: 50,
    }));
    const res = await request(srv.app).post('/api/packages/news/warnings').send({ renderId: 'l3', warnings });
    expect(res.status).toBe(400);
  });

  it('400s a malformed warning shape', async () => {
    const srv = makeServer();
    const res = await request(srv.app)
      .post('/api/packages/news/warnings')
      .send({ renderId: 'l3', warnings: [{ field: 'name', text: 'X' }] });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/packages/:id/warnings (spec 22 T9)', () => {
  it('requires operator auth', async () => {
    const srv = makeServer();
    const res = await request(srv.app).get('/api/packages/news/warnings');
    expect(res.status).toBe(401);
  });

  it('returns an empty map when nothing has ever reported', async () => {
    const srv = makeServer();
    const cookie = await operatorCookie(srv.app);
    const res = await request(srv.app).get('/api/packages/news/warnings').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.warnings).toEqual({});
  });

  it('404s an unknown package', async () => {
    const srv = makeServer();
    const cookie = await operatorCookie(srv.app);
    const res = await request(srv.app).get('/api/packages/nope/warnings').set('Cookie', cookie);
    expect(res.status).toBe(404);
  });
});
