import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createStateStore } from '../src/main/state';
import { createFullServer } from './_test-server';

// The admin Appearance page saved appPreferences.operatorTheme correctly, but
// GET /api/profiles/active — the unauthenticated endpoint every web UI reads on
// boot — omitted appPreferences entirely. So every client fell back to 'light'
// and the setting appeared to do nothing. The endpoint now exposes the theme,
// and *only* the theme: appPreferences also holds the IP allowlist and session
// durations, which must not leak to an unauthenticated caller.

function makeServer() {
  const store = createStateStore();
  return createFullServer({
    store,
    operatorPin: 'test1234',
    adminPin: 'adminpass8',
    port: 0,
  });
}

async function adminCookie(app: Express): Promise<string> {
  const res = await request(app).post('/auth/admin').send({ pin: 'adminpass8' });
  return ((res.headers['set-cookie'] as unknown) as string[])[0].split(';')[0];
}

describe('GET /api/profiles/active — UI theme', () => {
  let app: Express;
  let srv: ReturnType<typeof makeServer>;
  let adm: string;

  beforeEach(async () => {
    srv = makeServer();
    await srv.listen();
    app = srv.app;
    adm = await adminCookie(app);
  });

  afterEach(() => srv.close());

  it('defaults to light when nothing has been saved', async () => {
    const res = await request(app).get('/api/profiles/active');
    expect(res.status).toBe(200);
    expect(res.body.appPreferences.operatorTheme).toBe('light');
  });

  it('reports a saved dark theme without auth', async () => {
    const active = await request(app).get('/api/profiles/active');
    await request(app)
      .patch('/api/profiles/' + active.body.id)
      .set('Cookie', adm)
      .send({ appPreferences: { operatorTheme: 'dark' } })
      .expect(200);

    const res = await request(app).get('/api/profiles/active');
    expect(res.status).toBe(200);
    expect(res.body.appPreferences.operatorTheme).toBe('dark');
  });

  it('round-trips back to light', async () => {
    const active = await request(app).get('/api/profiles/active');
    const id = active.body.id;
    await request(app).patch('/api/profiles/' + id).set('Cookie', adm)
      .send({ appPreferences: { operatorTheme: 'dark' } }).expect(200);
    await request(app).patch('/api/profiles/' + id).set('Cookie', adm)
      .send({ appPreferences: { operatorTheme: 'light' } }).expect(200);

    const res = await request(app).get('/api/profiles/active');
    expect(res.body.appPreferences.operatorTheme).toBe('light');
  });

  it('does not leak other appPreferences to unauthenticated callers', async () => {
    // NB: deliberately not exercising ipAllowlist here — switching it on would
    // lock this very test client out with a 403 on the next request.
    const active = await request(app).get('/api/profiles/active');
    await request(app)
      .patch('/api/profiles/' + active.body.id)
      .set('Cookie', adm)
      .send({
        appPreferences: {
          operatorTheme: 'dark',
          operatorSessionDurationMinutes: 480,
          adminSessionDurationMinutes: 15,
        },
      })
      .expect(200);

    const res = await request(app).get('/api/profiles/active');
    expect(Object.keys(res.body.appPreferences)).toEqual(['operatorTheme']);
    expect(res.body.appPreferences).not.toHaveProperty('operatorSessionDurationMinutes');
    expect(res.body.appPreferences).not.toHaveProperty('adminSessionDurationMinutes');
    expect(res.body.appPreferences).not.toHaveProperty('ipAllowlist');
    expect(res.body.appPreferences).not.toHaveProperty('ipAllowlistEnabled');
    expect(res.body).not.toHaveProperty('operatorPinHash');
    expect(res.body).not.toHaveProperty('adminPinHash');
  });

  it('falls back to light if a bad value was persisted', async () => {
    const active = await request(app).get('/api/profiles/active');
    await request(app)
      .patch('/api/profiles/' + active.body.id)
      .set('Cookie', adm)
      .send({ appPreferences: { operatorTheme: 'chartreuse' } })
      .expect(200);

    const res = await request(app).get('/api/profiles/active');
    expect(res.body.appPreferences.operatorTheme).toBe('light');
  });
});
