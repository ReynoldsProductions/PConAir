import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createStateStore } from '../src/main/state';
import { createFullServer } from './_test-server';

function makeServer() {
  const store = createStateStore();
  const server = createFullServer({
    store,
    operatorPin: 'test1234',
    adminPin: 'testadmin8',
    operatorSessionMs: 60000,
    adminSessionMs: 60000,
    port: 0,
  });
  return { server, store, presets: server.presets };
}

async function login(app: Express, pin: string, route: string): Promise<string> {
  const res = await request(app).post(route).send({ pin });
  const cookie = res.headers['set-cookie'] as string | string[];
  return Array.isArray(cookie) ? cookie[0] : cookie;
}

describe('POST /api/url', () => {
  let app: Express;
  let cookie: string;
  let server: ReturnType<typeof makeServer>['server'];

  beforeEach(async () => {
    const made = makeServer();
    server = made.server;
    await server.listen();
    app = server.app;
    cookie = await login(app, 'test1234', '/auth/operator');
  });

  afterEach(() => server.close());

  it('loads a valid HTTPS URL, sets mode=url, returns currentMode/currentUrl/abState', async () => {
    const res = await request(app)
      .post('/api/url')
      .set('Cookie', cookie)
      .send({ url: 'https://slido.com/event/123' });

    expect(res.status).toBe(200);
    expect(res.body.currentMode).toBe('url');
    expect(res.body.currentUrl).toBe('https://slido.com/event/123');
    expect(res.body.abState.activeInstance).toBe('A');
    expect(res.body.abState.instanceA.url).toBe('https://slido.com/event/123');
    expect(res.body.abState.instanceA.isLoading).toBe(true);
    expect(res.body.abState.instanceA.isReady).toBe(false);
    expect(res.body.abState.instanceB.url).toBeNull();
  });

  it('accepts http:// URLs', async () => {
    const res = await request(app)
      .post('/api/url')
      .set('Cookie', cookie)
      .send({ url: 'http://example.com' });
    expect(res.status).toBe(200);
    expect(res.body.currentUrl).toBe('http://example.com');
  });

  it('rejects ftp:// scheme', async () => {
    const res = await request(app)
      .post('/api/url')
      .set('Cookie', cookie)
      .send({ url: 'ftp://bad.url' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_URL');
  });

  it('rejects empty url', async () => {
    const res = await request(app)
      .post('/api/url')
      .set('Cookie', cookie)
      .send({ url: '' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_URL');
  });

  it('rejects missing url field', async () => {
    const res = await request(app)
      .post('/api/url')
      .set('Cookie', cookie)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_URL');
  });

  it('returns 401 without auth', async () => {
    const res = await request(app).post('/api/url').send({ url: 'https://example.com' });
    expect(res.status).toBe(401);
  });

  it('returns 404 when display param does not match any display', async () => {
    const res = await request(app)
      .post('/api/url')
      .set('Cookie', cookie)
      .send({ url: 'https://example.com', display: 'NONEXISTENT' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('DISPLAY_NOT_FOUND');
  });

  it('accepts valid display param when display exists in state', async () => {
    const made = makeServer();
    const store = made.store;
    const s2 = createFullServer({
      store,
      operatorPin: 'test1234',
      adminPin: 'testadmin8',
      operatorSessionMs: 60000,
      adminSessionMs: 60000,
      port: 0,
    });
    await s2.listen();
    store.setState({ displays: [{ id: 'HDMI-1', name: 'HDMI-1', isPrimary: true }] });
    const c2 = await login(s2.app, 'test1234', '/auth/operator');
    const res = await request(s2.app)
      .post('/api/url')
      .set('Cookie', c2)
      .send({ url: 'https://example.com', display: 'HDMI-1' });
    expect(res.status).toBe(200);
    expect(res.body.abState.instanceA.displayTarget).toBe('HDMI-1');
    await s2.close();
  });
});

describe('POST /api/url/reload', () => {
  let app: Express;
  let cookie: string;
  let store: ReturnType<typeof createStateStore>;
  let server: ReturnType<typeof makeServer>['server'];

  beforeEach(async () => {
    const made = makeServer();
    store = made.store;
    server = made.server;
    await server.listen();
    app = server.app;
    cookie = await login(app, 'test1234', '/auth/operator');
    // Pre-load a URL so reload has something to work with
    store.setState({
      currentMode: 'url',
      currentUrl: 'https://example.com',
      abState: {
        activeInstance: 'A',
        instanceA: {
          url: 'https://example.com',
          isLoading: false,
          isReady: true,
          displayTarget: null,
          sessionMode: 'persistent',
        },
        instanceB: {
          url: null,
          isLoading: false,
          isReady: false,
          displayTarget: null,
          sessionMode: 'persistent',
        },
      },
    });
  });

  afterEach(() => server.close());

  it('reloads the active instance by default (sets isLoading:true)', async () => {
    const res = await request(app)
      .post('/api/url/reload')
      .set('Cookie', cookie)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.abState.instanceA.isLoading).toBe(true);
    expect(res.body.abState.instanceA.isReady).toBe(false);
    expect(res.body.abState.instanceA.url).toBe('https://example.com');
  });

  it('reloads the specified instance B', async () => {
    store.setState({
      abState: {
        activeInstance: 'A',
        instanceA: {
          url: 'https://example.com',
          isLoading: false,
          isReady: true,
          displayTarget: null,
          sessionMode: 'persistent',
        },
        instanceB: {
          url: 'https://other.com',
          isLoading: false,
          isReady: true,
          displayTarget: null,
          sessionMode: 'persistent',
        },
      },
    });
    const res = await request(app)
      .post('/api/url/reload')
      .set('Cookie', cookie)
      .send({ instance: 'B' });
    expect(res.status).toBe(200);
    expect(res.body.abState.instanceB.isLoading).toBe(true);
    expect(res.body.abState.instanceB.isReady).toBe(false);
    expect(res.body.abState.instanceA.isLoading).toBe(false);
  });

  it('returns 400 INVALID_URL when the target instance has no URL', async () => {
    const res = await request(app)
      .post('/api/url/reload')
      .set('Cookie', cookie)
      .send({ instance: 'B' }); // B has no URL in beforeEach state
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_URL');
  });

  it('returns 401 without auth', async () => {
    const res = await request(app).post('/api/url/reload').send({});
    expect(res.status).toBe(401);
  });
});
