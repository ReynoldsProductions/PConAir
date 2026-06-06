import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createStateStore } from '../src/main/state';
import { createFullServer } from './_test-server';

const AUTH_CONFIG = {
  operatorPin: '1234',
  adminPin: 'supersecret',
  operatorSessionMs: 3600000,
  adminSessionMs: 3600000,
};

describe('GET /operator', () => {
  let app: Express;
  let operatorCookie: string;

  beforeEach(async () => {
    const store = createStateStore();
    ({ app } = createFullServer({
      store,
      operatorPin: AUTH_CONFIG.operatorPin,
      adminPin: AUTH_CONFIG.adminPin,
      operatorSessionMs: AUTH_CONFIG.operatorSessionMs,
      adminSessionMs: AUTH_CONFIG.adminSessionMs,
    }));
    const loginRes = await request(app).post('/auth/operator').send({ pin: '1234' });
    operatorCookie = loginRes.headers['set-cookie'][0].split(';')[0];
  });

  it('returns 200 with HTML content for authenticated operator', async () => {
    const res = await request(app)
      .get('/operator')
      .set('Cookie', operatorCookie);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.text).toContain('PC On Air');
    expect(res.text).toContain('Live Control');
  });

  it('returns 200 with operator bundle for authenticated operator', async () => {
    const res = await request(app)
      .get('/operator/index.js')
      .set('Cookie', operatorCookie);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/javascript/);
    expect(res.text.length).toBeGreaterThan(100);
  });

  it('returns 401 for operator bundle without auth', async () => {
    const res = await request(app).get('/operator/index.js');
    expect(res.status).toBe(401);
  });

  it('returns sign-in HTML without session', async () => {
    const res = await request(app).get('/operator/');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.text).toContain('Operator sign-in');
    expect(res.text).toContain('/auth/operator/browser');
  });

  it('browser form login sets cookie and opens operator shell', async () => {
    const res = await request(app).post('/auth/operator/browser').type('form').send({ pin: '1234' });
    expect(res.status).toBe(303);
    const raw = res.headers['set-cookie'];
    expect(raw).toBeDefined();
    const op = raw![0].split(';')[0];
    const page = await request(app).get('/operator/').set('Cookie', op);
    expect(page.status).toBe(200);
    expect(page.text).toContain('Live Control');
  });
});
