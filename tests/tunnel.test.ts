import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import type { Express } from 'express';
import { createStateStore } from '../src/main/state';
import type { StateStore } from '../src/main/state';
import { createFullServer } from './_test-server';
import { extractTrycloudflareUrl } from '../src/main/tunnel/manager';
import { publicRemoteUrl } from '../src/main/routes/tunnel';

const PINS = { operatorPin: '1234', adminPin: 'supersecret' };

describe('extractTrycloudflareUrl', () => {
  it('finds the quick-tunnel URL in log output', () => {
    const line = '2026-06-10T00:00:00Z INF +  https://abc-def-123.trycloudflare.com  +';
    expect(extractTrycloudflareUrl(line)).toBe('https://abc-def-123.trycloudflare.com');
  });

  it('returns null when no URL present', () => {
    expect(extractTrycloudflareUrl('starting tunnel...')).toBeNull();
    expect(extractTrycloudflareUrl(null)).toBeNull();
  });
});

describe('publicRemoteUrl', () => {
  it('prefers the active tunnel URL', () => {
    const store = createStateStore();
    store.setState({
      tunnel: { enabled: true, status: 'active', url: 'https://x.trycloudflare.com', pinRequired: false, lastError: null },
    });
    expect(publicRemoteUrl(store, 8080)).toBe('https://x.trycloudflare.com/remote/');
  });

  it('falls back to the LAN hostname', () => {
    const store = createStateStore();
    expect(publicRemoteUrl(store, 8123)).toMatch(/^http:\/\/.+:8123\/remote\/$/);
  });
});

describe('tunnel API', () => {
  let app: Express;
  let store: StateStore;
  let saved: Record<string, unknown>[];
  let started: number;
  let stopped: number;

  beforeEach(() => {
    store = createStateStore();
    saved = [];
    started = 0;
    stopped = 0;
    ({ app } = createFullServer({
      store,
      ...PINS,
      startTunnel: () => {
        started += 1;
      },
      stopTunnel: () => {
        stopped += 1;
      },
      saveTunnelSettings: (patch) => {
        saved.push(patch);
      },
    }));
  });

  async function adminCookie(): Promise<string> {
    const res = await request(app).post('/auth/admin').send({ pin: PINS.adminPin });
    return res.headers['set-cookie'][0].split(';')[0];
  }

  it('GET /api/tunnel/status is unauthenticated', async () => {
    const res = await request(app).get('/api/tunnel/status');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('inactive');
  });

  it('POST /api/tunnel requires admin', async () => {
    const res = await request(app).post('/api/tunnel').send({ enabled: true });
    expect(res.status).toBe(401);
  });

  it('POST /api/tunnel starts and persists', async () => {
    const cookie = await adminCookie();
    const res = await request(app).post('/api/tunnel').set('Cookie', cookie).send({ enabled: true });
    expect(res.status).toBe(200);
    expect(started).toBe(1);
    expect(saved).toContainEqual({ tunnelEnabled: true });
    const off = await request(app).post('/api/tunnel').set('Cookie', cookie).send({ enabled: false });
    expect(off.status).toBe(200);
    expect(stopped).toBe(1);
  });

  it('POST /api/tunnel/config hashes the PIN and flags pinRequired', async () => {
    const cookie = await adminCookie();
    const res = await request(app).post('/api/tunnel/config').set('Cookie', cookie).send({ pin: '4321' });
    expect(res.status).toBe(200);
    expect(res.body.tunnel.pinRequired).toBe(true);
    const patch = saved.find((p) => 'tunnelPinHash' in p) as { tunnelPinHash: string };
    expect(patch.tunnelPinHash).not.toBe('4321');
    expect(await bcrypt.compare('4321', patch.tunnelPinHash)).toBe(true);
  });

  it('POST /api/tunnel/config rejects a non-numeric PIN', async () => {
    const cookie = await adminCookie();
    const res = await request(app).post('/api/tunnel/config').set('Cookie', cookie).send({ pin: 'abcd' });
    expect(res.status).toBe(400);
  });

  it('GET /api/qr returns a data-URL QR for the remote', async () => {
    const res = await request(app).get('/api/qr');
    expect(res.status).toBe(200);
    expect(res.body.qr).toMatch(/^data:image\/png;base64,/);
    expect(res.body.url).toContain('/remote/');
  });
});

describe('tunnel PIN gate', () => {
  let app: Express;

  beforeEach(async () => {
    const hash = await bcrypt.hash('9876', 10);
    const store = createStateStore();
    ({ app } = createFullServer({
      store,
      ...PINS,
      getTunnelPinHash: () => hash,
    }));
  });

  it('LAN clients (no cf headers) are not gated', async () => {
    const res = await request(app).get('/api/status');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('tunnel clients get the PIN page on any path', async () => {
    for (const path of ['/remote/', '/api/status', '/operator/']) {
      const res = await request(app).get(path).set('cf-ray', 'abc123');
      expect(res.status).toBe(401);
      expect(res.text).toContain('PIN');
    }
  });

  it('wrong PIN is rejected; correct PIN unlocks with a cookie', async () => {
    const bad = await request(app)
      .post('/auth/tunnel-pin')
      .set('cf-ray', 'abc')
      .set('cf-connecting-ip', '203.0.113.5')
      .type('form')
      .send({ pin: '0000' });
    expect(bad.status).toBe(401);

    const good = await request(app)
      .post('/auth/tunnel-pin')
      .set('cf-ray', 'abc')
      .set('cf-connecting-ip', '203.0.113.5')
      .type('form')
      .send({ pin: '9876' });
    expect(good.status).toBe(303);
    const cookie = good.headers['set-cookie'][0].split(';')[0];

    const after = await request(app).get('/api/status').set('cf-ray', 'abc').set('Cookie', cookie);
    expect(after.status).toBe(200);
  });

  it('locks out after repeated failures from the same client', async () => {
    for (let i = 0; i < 5; i++) {
      await request(app)
        .post('/auth/tunnel-pin')
        .set('cf-ray', 'x')
        .set('cf-connecting-ip', '203.0.113.9')
        .type('form')
        .send({ pin: '1111' });
    }
    const blocked = await request(app)
      .post('/auth/tunnel-pin')
      .set('cf-ray', 'x')
      .set('cf-connecting-ip', '203.0.113.9')
      .type('form')
      .send({ pin: '9876' });
    expect(blocked.status).toBe(429);
  });
});

describe('tunnel PIN gate disabled', () => {
  it('tunnel clients pass through when no PIN configured', async () => {
    const store = createStateStore();
    const { app } = createFullServer({ store, ...PINS });
    const res = await request(app).get('/api/status').set('cf-ray', 'abc');
    expect(res.status).toBe(200);
  });
});
