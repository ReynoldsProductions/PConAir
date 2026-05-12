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
  });

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/operator');
    expect(res.status).toBe(401);
  });
});
