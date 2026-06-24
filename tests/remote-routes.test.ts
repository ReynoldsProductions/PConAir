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

describe('GET /remote', () => {
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

  it('returns the SPA shell for an authenticated operator', async () => {
    const res = await request(app).get('/remote/').set('Cookie', operatorCookie);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.text).toContain('PConAir');
    // All seven nav pages exist in the shell
    for (const page of ['page-slides', 'page-l3', 'page-stills', 'page-packages', 'page-urls', 'page-timer', 'page-settings']) {
      expect(res.text).toContain(page);
    }
  });

  it('returns sign-in HTML without a session, posting back to /remote/', async () => {
    const res = await request(app).get('/remote/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Operator PIN');
    expect(res.text).toContain('name="next" value="/remote/"');
  });

  it('browser form login with next=/remote/ redirects back to the remote', async () => {
    const res = await request(app)
      .post('/auth/operator/browser')
      .type('form')
      .send({ pin: '1234', next: '/remote/' });
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe('/remote/');
    const cookie = res.headers['set-cookie']![0].split(';')[0];
    const page = await request(app).get('/remote/').set('Cookie', cookie);
    expect(page.status).toBe(200);
    expect(page.text).toContain('page-slides');
  });

  it('rejects unknown next values (no open redirect)', async () => {
    const res = await request(app)
      .post('/auth/operator/browser')
      .type('form')
      .send({ pin: '1234', next: 'https://evil.example/' });
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe('/operator/');
  });

  it('admin session also opens the remote', async () => {
    const loginRes = await request(app).post('/auth/admin').send({ pin: 'supersecret' });
    const adminCookie = loginRes.headers['set-cookie'][0].split(';')[0];
    const res = await request(app).get('/remote/').set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(res.text).toContain('page-slides');
  });

  it('failed login redirects back to /remote/ with a hint', async () => {
    const res = await request(app)
      .post('/auth/operator/browser')
      .type('form')
      .send({ pin: '9999', next: '/remote/' });
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe('/remote/?login=bad');
  });
});
