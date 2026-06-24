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

describe('Auth routes', () => {
  let app: Express;

  beforeEach(() => {
    const store = createStateStore();
    ({ app } = createFullServer({
      store,
      operatorPin: AUTH_CONFIG.operatorPin,
      adminPin: AUTH_CONFIG.adminPin,
      operatorSessionMs: AUTH_CONFIG.operatorSessionMs,
      adminSessionMs: AUTH_CONFIG.adminSessionMs,
    }));
  });

  it('POST /auth/operator with correct PIN sets session cookie', async () => {
    const res = await request(app)
      .post('/auth/operator')
      .send({ pin: '1234' });
    expect(res.status).toBe(200);
    expect(res.body.role).toBe('operator');
    expect(res.headers['set-cookie']).toBeDefined();
    expect(res.headers['set-cookie'][0]).toContain('pconair_operator_session');
  });

  it('POST /auth/operator with wrong PIN returns 401', async () => {
    const res = await request(app)
      .post('/auth/operator')
      .send({ pin: 'wrong' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTH_REQUIRED');
  });

  it('POST /auth/admin with correct PIN sets admin cookie', async () => {
    const res = await request(app)
      .post('/auth/admin')
      .send({ pin: 'supersecret' });
    expect(res.status).toBe(200);
    expect(res.body.role).toBe('admin');
    expect(res.headers['set-cookie'][0]).toContain('pconair_admin_session');
  });

  it('returns 429 after 5 failed PIN attempts in 5 minutes', async () => {
    for (let i = 0; i < 5; i++) {
      const r = await request(app).post('/auth/operator').send({ pin: 'nope' });
      expect(r.status).toBe(401);
    }
    const blocked = await request(app).post('/auth/operator').send({ pin: '1234' });
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
    expect(blocked.headers['x-retry-after']).toBeDefined();
    expect(blocked.headers['x-ratelimit-remaining']).toBe('0');
  });

  it('POST /auth/logout clears operator session', async () => {
    const login = await request(app).post('/auth/operator').send({ pin: '1234' });
    const cookie = login.headers['set-cookie'][0].split(';')[0];
    const out = await request(app)
      .post('/auth/logout')
      .set('Cookie', cookie)
      .send({ role: 'operator' });
    expect(out.status).toBe(200);
    expect(out.body.message).toMatch(/logged out/i);
    // /api/status is unauthenticated (v2); use a guarded endpoint to prove the session died.
    const after = await request(app).get('/api/instance-status').set('Cookie', cookie);
    expect(after.status).toBe(401);
  });
});

describe('API routes', () => {
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
    const res = await request(app)
      .post('/auth/operator')
      .send({ pin: '1234' });
    operatorCookie = res.headers['set-cookie'][0].split(';')[0];
  });

  it('GET /api/status returns full AppState for authenticated operator', async () => {
    const res = await request(app)
      .get('/api/status')
      .set('Cookie', operatorCookie);
    expect(res.status).toBe(200);
    expect(res.body.currentMode).toBe('idle');
    expect(res.body.connectionStatus.adminShowLocked).toBe(false);
    expect(res.body.reliability.panicActive).toBe(false);
  });

  it('GET /api/status works without auth and includes GSC-compat fields', async () => {
    const res = await request(app).get('/api/status');
    expect(res.status).toBe(200);
    expect(res.body.presentationOpen).toBe(false);
    expect(res.body.contentKind).toBe('slides');
    expect(res.body.currentSlide).toBeNull();
  });

  it('POST /api/mode switches mode', async () => {
    const res = await request(app)
      .post('/api/mode')
      .set('Cookie', operatorCookie)
      .send({ mode: 'url' });
    expect(res.status).toBe(200);
    expect(res.body.currentMode).toBe('url');
    // Response should be lean — not the full AppState
    expect(res.body).not.toHaveProperty('connectionStatus');
  });

  it('POST /api/mode rejects invalid mode', async () => {
    const res = await request(app)
      .post('/api/mode')
      .set('Cookie', operatorCookie)
      .send({ mode: 'banana' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_MODE');
  });

  it('GET /api/health requires admin; returns spec-shaped JSON for admin', async () => {
    const denied = await request(app).get('/api/health').set('Cookie', operatorCookie);
    expect(denied.status).toBe(403);

    const adminLogin = await request(app).post('/auth/admin').send({ pin: 'supersecret' });
    const adminCookie = adminLogin.headers['set-cookie'][0].split(';')[0];
    const res = await request(app).get('/api/health').set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.app.version).toBeTruthy();
    expect(res.body.app.mode).toMatch(/Rehearsal|Show Locked/);
    expect(typeof res.body.app.uptime).toBe('number');
    expect(res.body.environment.node).toBeTruthy();
    expect(res.body.operator.connectedClients).toBeGreaterThanOrEqual(0);
    expect(res.body.resources.memory.heapUsed).toBeGreaterThanOrEqual(0);
    expect(res.body.resources.trend).toMatch(/Stable|Rising/);
  });

  it('GET /admin/health returns dashboard HTML for admin session', async () => {
    const adminLogin = await request(app).post('/auth/admin').send({ pin: 'supersecret' });
    const adminCookie = adminLogin.headers['set-cookie'][0].split(';')[0];
    const res = await request(app).get('/admin/health').set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Health dashboard');
    expect(res.text).toContain('health-dashboard.js');
  });

  it('POST /api/panic toggles panic state', async () => {
    const on = await request(app)
      .post('/api/panic')
      .set('Cookie', operatorCookie)
      .send({ action: 'on' });
    expect(on.status).toBe(200);
    expect(on.body.panicActive).toBe(true);
    expect(on.body.slate).toEqual({ type: 'color', value: '#000000' });

    const st = await request(app).get('/api/status').set('Cookie', operatorCookie);
    expect(st.body.reliability.panicActive).toBe(true);

    const off = await request(app)
      .post('/api/panic')
      .set('Cookie', operatorCookie)
      .send({ action: 'off' });
    expect(off.status).toBe(200);
    expect(off.body.panicActive).toBe(false);
  });

  it('POST /api/reload-instance rejects on-air instance', async () => {
    const res = await request(app)
      .post('/api/reload-instance')
      .set('Cookie', operatorCookie)
      .send({ instance: 'A' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_INSTANCE');
  });

  it('POST /api/reload-instance and GET /api/instance-status for off-air', async () => {
    const arm = await request(app)
      .post('/api/reload-instance')
      .set('Cookie', operatorCookie)
      .send({ instance: 'B' });
    expect(arm.status).toBe(202);
    expect(arm.body.status).toBe('reloading');

    await new Promise((r) => setTimeout(r, 80));

    const st = await request(app)
      .get('/api/instance-status?instance=B')
      .set('Cookie', operatorCookie);
    expect(st.status).toBe(200);
    expect(st.body.instance).toBe('B');
    expect(st.body.status).toBe('ready');
  });

  it('POST /api/show-lock uses arm then take', async () => {
    const adminLogin = await request(app).post('/auth/admin').send({ pin: 'supersecret' });
    const adminCookie = adminLogin.headers['set-cookie'][0].split(';')[0];

    const arm = await request(app)
      .post('/api/show-lock')
      .set('Cookie', adminCookie)
      .send({ action: 'lock' });
    expect(arm.status).toBe(202);
    expect(arm.body.confirmationToken).toBeTruthy();

    const take = await request(app)
      .post('/api/show-lock')
      .set('Cookie', adminCookie)
      .send({ action: 'lock', confirmationToken: arm.body.confirmationToken });
    expect(take.status).toBe(200);
    expect(take.body.showLockActive).toBe(true);

    const lockedHealth = await request(app).get('/api/health').set('Cookie', adminCookie);
    expect(lockedHealth.body.app.mode).toBe('Show Locked');

    const unlock = await request(app)
      .post('/api/show-lock')
      .set('Cookie', adminCookie)
      .send({ action: 'unlock' });
    expect(unlock.status).toBe(200);
    expect(unlock.body.showLockActive).toBe(false);
  });
});

describe('Security headers', () => {
  let app: Express;

  beforeEach(() => {
    const store = createStateStore();
    ({ app } = createFullServer({
      store,
      operatorPin: AUTH_CONFIG.operatorPin,
      adminPin: AUTH_CONFIG.adminPin,
      operatorSessionMs: AUTH_CONFIG.operatorSessionMs,
      adminSessionMs: AUTH_CONFIG.adminSessionMs,
    }));
  });

  it('sets X-Content-Type-Options: nosniff', async () => {
    const res = await request(app).get('/api/status');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('sets X-Frame-Options: DENY', async () => {
    const res = await request(app).get('/api/status');
    expect(res.headers['x-frame-options']).toBe('DENY');
  });

  it('sets Cache-Control: no-store on API responses', async () => {
    const res = await request(app).get('/api/status');
    expect(res.headers['cache-control']).toBe('no-store');
  });
});
