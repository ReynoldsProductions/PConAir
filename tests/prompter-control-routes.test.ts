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

describe('GET /prompter-control', () => {
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

  it('returns the page shell for an authenticated operator', async () => {
    const res = await request(app).get('/prompter-control/').set('Cookie', operatorCookie);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.text).toContain('PConAir');
    // The Script Source block itself is injected client-side by
    // src/renderer/shared/prompter-controls.ts; the mount point is what the
    // server-rendered shell carries.
    expect(res.text).toContain('id="pcp-mount"');
  });

  it('returns sign-in HTML without a session, posting back to /prompter-control/', async () => {
    const res = await request(app).get('/prompter-control/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Operator PIN');
    expect(res.text).toContain('name="next" value="/prompter-control/"');
  });

  it('browser form login with next=/prompter-control/ redirects back to the page', async () => {
    const res = await request(app)
      .post('/auth/operator/browser')
      .type('form')
      .send({ pin: '1234', next: '/prompter-control/' });
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe('/prompter-control/');
    const cookie = res.headers['set-cookie']![0].split(';')[0];
    const page = await request(app).get('/prompter-control/').set('Cookie', cookie);
    expect(page.status).toBe(200);
    expect(page.text).toContain('id="pcp-mount"');
  });

  it('rejects unknown next values (no open redirect)', async () => {
    const res = await request(app)
      .post('/auth/operator/browser')
      .type('form')
      .send({ pin: '1234', next: 'https://evil.example/' });
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe('/operator/');
  });

  it('admin session also opens the page', async () => {
    const loginRes = await request(app).post('/auth/admin').send({ pin: 'supersecret' });
    const adminCookie = loginRes.headers['set-cookie'][0].split(';')[0];
    const res = await request(app).get('/prompter-control/').set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(res.text).toContain('id="pcp-mount"');
  });

  it('failed login redirects back to /prompter-control/ with a hint', async () => {
    const res = await request(app)
      .post('/auth/operator/browser')
      .type('form')
      .send({ pin: '9999', next: '/prompter-control/' });
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe('/prompter-control/?login=bad');
  });

  it('gates the JS bundle route behind the operator session too', async () => {
    const res = await request(app).get('/prompter-control/index.js');
    expect(res.status).toBe(401);
  });
});
