import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createStateStore } from '../src/main/state';
import type { StateStore } from '../src/main/state';
import { createFullServer } from './_test-server';

const PINS = { operatorPin: '1234', adminPin: 'supersecret' };

describe('render pages and output API', () => {
  let app: Express;
  let store: StateStore;
  let opCookie: string;

  beforeEach(async () => {
    store = createStateStore();
    ({ app } = createFullServer({ store, ...PINS }));
    const login = await request(app).post('/auth/operator').send({ pin: PINS.operatorPin });
    opCookie = login.headers['set-cookie'][0].split(';')[0];
  });

  it('serves /render/:type without auth for all content types', async () => {
    for (const type of ['slides', 'l3', 'stills', 'url']) {
      const res = await request(app).get(`/render/${type}`);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/html');
      expect(res.text).toContain('/ws?render=1');
      expect(res.text).toContain(`"${type}"`);
    }
  });

  it('404s unknown render types', async () => {
    const res = await request(app).get('/render/nope');
    expect(res.status).toBe(404);
  });

  it('GET /api/render/outputs returns defaults without auth', async () => {
    const res = await request(app).get('/api/render/outputs');
    expect(res.status).toBe(200);
    expect(res.body.renderOutputs.l3.bg).toBe('transparent');
    expect(res.body.renderOutputs.slides.bg).toBe('opaque');
    expect(res.body.renderOutputs.l3.chromaColor).toBe('#00b140');
  });

  it('POST /api/render/:type/background updates bg and chroma (operator)', async () => {
    const res = await request(app)
      .post('/api/render/l3/background')
      .set('Cookie', opCookie)
      .send({ bg: 'chroma', chromaColor: '#ff00aa' });
    expect(res.status).toBe(200);
    expect(store.getState().renderOutputs.l3.bg).toBe('chroma');
    expect(store.getState().renderOutputs.l3.chromaColor).toBe('#ff00aa');
  });

  it('rejects invalid bg and chroma values', async () => {
    expect(
      (await request(app).post('/api/render/l3/background').set('Cookie', opCookie).send({ bg: 'plaid' })).status
    ).toBe(400);
    expect(
      (await request(app).post('/api/render/l3/background').set('Cookie', opCookie).send({ chromaColor: 'green' }))
        .status
    ).toBe(400);
  });

  it('requires auth for background changes', async () => {
    const res = await request(app).post('/api/render/l3/background').send({ bg: 'black' });
    expect(res.status).toBe(401);
  });

  it('output claim warns on conflict but does not block', async () => {
    const first = await request(app)
      .post('/api/render/l3/output')
      .set('Cookie', opCookie)
      .send({ output: 'display-1' });
    expect(first.status).toBe(200);
    expect(first.body.warning).toBeNull();

    const second = await request(app)
      .post('/api/render/stills/output')
      .set('Cookie', opCookie)
      .send({ output: 'display-1' });
    expect(second.status).toBe(200);
    expect(second.body.warning).toContain('already in use by: l3');
    expect(store.getState().renderOutputs.stills.claimedOutput).toBe('display-1');
  });

  it('theme CSS endpoint is unauthenticated for render pages', async () => {
    const res = await request(app).get('/api/l3/themes/faire-default/css');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/css');
    expect(res.text).toContain('.lower-third');
    expect((await request(app).get('/api/l3/themes/nope/css')).status).toBe(404);
  });
});
