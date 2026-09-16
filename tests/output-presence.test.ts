import { describe, it, expect } from 'vitest';
import path from 'path';
import request from 'supertest';
import { WebSocket } from 'ws';
import { createPresenceRegistry } from '../src/main/packages/presence';
import { createStateStore } from '../src/main/state';
import { createFullServer } from './_test-server';

describe('createPresenceRegistry (T1 — registry unit)', () => {
  it('tracks renders, byRender and controls per package; unknown packages are fully zeroed', () => {
    const registry = createPresenceRegistry();
    const renderA1 = Symbol('renderA1');
    const renderA2 = Symbol('renderA2');
    const controlA = Symbol('controlA');
    const renderB1 = Symbol('renderB1');

    registry.add(renderA1, {
      role: 'render',
      packageId: 'pkgA',
      renderId: 'main',
      ip: '127.0.0.1',
      connectedAt: 1,
    });
    registry.add(renderA2, {
      role: 'render',
      packageId: 'pkgA',
      renderId: null,
      ip: '127.0.0.1',
      connectedAt: 2,
    });
    registry.add(controlA, {
      role: 'control',
      packageId: 'pkgA',
      renderId: null,
      ip: '127.0.0.1',
      connectedAt: 3,
    });
    registry.add(renderB1, {
      role: 'render',
      packageId: 'pkgB',
      renderId: 'main',
      ip: '127.0.0.1',
      connectedAt: 4,
    });

    expect(registry.forPackage('pkgA')).toEqual({
      renders: 2,
      byRender: { main: 1 },
      controls: 1,
    });
    expect(registry.forPackage('pkgB')).toEqual({
      renders: 1,
      byRender: { main: 1 },
      controls: 0,
    });
    expect(registry.forPackage('nope')).toEqual({
      renders: 0,
      byRender: {},
      controls: 0,
    });
  });

  it('remove decrements counts', () => {
    const registry = createPresenceRegistry();
    const id = Symbol('r');
    registry.add(id, { role: 'render', packageId: 'pkgA', renderId: 'main', ip: '127.0.0.1', connectedAt: 1 });
    expect(registry.forPackage('pkgA').renders).toBe(1);
    registry.remove(id);
    expect(registry.forPackage('pkgA').renders).toBe(0);
  });

  it('onChange fires once per mutation (add or remove)', () => {
    const registry = createPresenceRegistry();
    let fired = 0;
    const off = registry.onChange(() => { fired += 1; });

    const id = Symbol('r');
    registry.add(id, { role: 'render', packageId: 'pkgA', renderId: 'main', ip: '127.0.0.1', connectedAt: 1 });
    expect(fired).toBe(1);

    registry.remove(id);
    expect(fired).toBe(2);

    // removing an already-removed id (or unknown) is a no-op, not a mutation
    registry.remove(id);
    expect(fired).toBe(2);

    off();
    registry.add(Symbol('r2'), { role: 'render', packageId: 'pkgA', renderId: 'main', ip: '127.0.0.1', connectedAt: 2 });
    expect(fired).toBe(2);
  });

  it('all() returns every entry sorted by connectedAt ascending', () => {
    const registry = createPresenceRegistry();
    registry.add(Symbol('c'), { role: 'render', packageId: 'pkgA', renderId: 'main', ip: '1.1.1.1', connectedAt: 30 });
    registry.add(Symbol('a'), { role: 'control', packageId: 'pkgA', renderId: null, ip: '2.2.2.2', connectedAt: 10 });
    registry.add(Symbol('b'), { role: 'render', packageId: 'pkgB', renderId: null, ip: '3.3.3.3', connectedAt: 20 });

    const all = registry.all();
    expect(all.map((e) => e.connectedAt)).toEqual([10, 20, 30]);
  });
});

describe('Socket registration (T2, T3, T4)', () => {
  const PINS = { operatorPin: 'test1234', adminPin: 'adminpass8' };
  const bundledRoot = path.join(__dirname, '..', 'bundled-packages');

  async function makeServer() {
    const store = createStateStore();
    const server = createFullServer({ store, ...PINS, port: 0, packagesRoot: bundledRoot });
    await server.listen();
    const addr = server.httpServer.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    const login = await request(server.app).post('/auth/operator').send({ pin: PINS.operatorPin });
    const cookie = (login.headers['set-cookie'] as unknown as string[])[0];
    return { server, store, port, cookie };
  }

  function connectAndSubscribe(port: number, qs: string, namespace: string): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://localhost:${port}/ws${qs}`);
      ws.on('open', () => {
        ws.send(JSON.stringify({ type: 'subscribe', namespace }));
      });
      let gotState = false;
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'state' && msg.namespace === namespace) {
          gotState = true;
          resolve(ws);
        }
      });
      ws.on('error', reject);
      ws.on('close', (code) => {
        if (!gotState) reject(new Error(`closed before subscribe ack: ${code}`));
      });
    });
  }

  it('T2 — a render socket registers presence; closing it drops the count back to zero', async () => {
    const { server, port, cookie } = await makeServer();
    try {
      const before = await request(server.app).get('/api/packages/hoops/presence').set('Cookie', cookie);
      expect(before.status).toBe(200);
      expect(before.body).toEqual({ renders: 0, byRender: {}, controls: 0 });

      const ws = await connectAndSubscribe(port, '?render=1&renderId=main', 'package:hoops');

      // presence should reflect the subscription without any reload
      await new Promise((r) => setTimeout(r, 50));
      const during = await request(server.app).get('/api/packages/hoops/presence').set('Cookie', cookie);
      expect(during.body).toEqual({ renders: 1, byRender: { main: 1 }, controls: 0 });

      ws.close();
      await new Promise((r) => setTimeout(r, 100));
      const after = await request(server.app).get('/api/packages/hoops/presence').set('Cookie', cookie);
      expect(after.body).toEqual({ renders: 0, byRender: {}, controls: 0 });
    } finally {
      await server.close();
    }
  });

  it('T3 — a control socket increments controls, never renders', async () => {
    const { server, port, cookie } = await makeServer();
    try {
      const ws = await connectAndSubscribe(port, '?control=1', 'package:hoops');
      await new Promise((r) => setTimeout(r, 50));
      const p = await request(server.app).get('/api/packages/hoops/presence').set('Cookie', cookie);
      expect(p.body).toEqual({ renders: 0, byRender: {}, controls: 1 });
      ws.close();
    } finally {
      await server.close();
    }
  });

  it('T4 — connectionStatus.webSocketClients is accurate while a render socket is open, not only after close', async () => {
    const { server, port, cookie, store } = await makeServer();
    try {
      expect(store.getState().connectionStatus.webSocketClients).toBe(0);
      const ws = await connectAndSubscribe(port, '?render=1&renderId=main', 'package:hoops');
      await new Promise((r) => setTimeout(r, 50));
      // this is the assertion that fails on main: the count never rises for a render socket
      expect(store.getState().connectionStatus.webSocketClients).toBeGreaterThan(0);
      ws.close();
      await new Promise((r) => setTimeout(r, 100));
      expect(store.getState().connectionStatus.webSocketClients).toBe(0);
    } finally {
      await server.close();
    }
  });
});

describe('delivered on POST /api/packages/:id/state (T5)', () => {
  const PINS = { operatorPin: 'test1234', adminPin: 'adminpass8' };
  const bundledRoot = path.join(__dirname, '..', 'bundled-packages');

  it('is 0 with no sockets subscribed, and matches the count with render sockets subscribed', async () => {
    const store = createStateStore();
    const server = createFullServer({ store, ...PINS, port: 0, packagesRoot: bundledRoot });
    await server.listen();
    const addr = server.httpServer.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    try {
      const withNoSockets = await request(server.app).post('/api/packages/hoops/state').send({ scoreA: 1 });
      expect(withNoSockets.status).toBe(200);
      expect(withNoSockets.body.delivered).toBe(0);
      expect(withNoSockets.body.state.scoreA).toBe(1);

      const openRender = (renderId: string) =>
        new Promise<WebSocket>((resolve, reject) => {
          const ws = new WebSocket(`ws://localhost:${port}/ws?render=1&renderId=${renderId}`);
          ws.on('open', () => ws.send(JSON.stringify({ type: 'subscribe', namespace: 'package:hoops' })));
          ws.on('message', (data) => {
            const msg = JSON.parse(data.toString());
            if (msg.type === 'state' && msg.namespace === 'package:hoops') resolve(ws);
          });
          ws.on('error', reject);
        });

      const wsA = await openRender('main');
      const wsB = await openRender('secondary');
      await new Promise((r) => setTimeout(r, 50));

      const withTwoSockets = await request(server.app).post('/api/packages/hoops/state').send({ scoreA: 2 });
      expect(withTwoSockets.status).toBe(200);
      expect(withTwoSockets.body.delivered).toBe(2);

      wsA.close();
      wsB.close();
    } finally {
      await server.close();
    }
  });
});

describe('presence endpoints (T6)', () => {
  const PINS = { operatorPin: 'test1234', adminPin: 'adminpass8' };
  const bundledRoot = path.join(__dirname, '..', 'bundled-packages');

  async function makeServer() {
    const store = createStateStore();
    const server = createFullServer({ store, ...PINS, port: 0, packagesRoot: bundledRoot });
    await server.listen();
    const addr = server.httpServer.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    return { server, store, port };
  }

  async function operatorCookie(server: Awaited<ReturnType<typeof makeServer>>['server']) {
    const login = await request(server.app).post('/auth/operator').send({ pin: PINS.operatorPin });
    return (login.headers['set-cookie'] as unknown as string[])[0];
  }

  it('GET /api/packages/:id/presence requires operator auth and returns the right shape', async () => {
    const { server } = await makeServer();
    try {
      const unauth = await request(server.app).get('/api/packages/hoops/presence');
      expect(unauth.status).toBe(401);

      const cookie = await operatorCookie(server);
      const res = await request(server.app).get('/api/packages/hoops/presence').set('Cookie', cookie);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ renders: 0, byRender: {}, controls: 0 });
    } finally {
      await server.close();
    }
  });

  it('GET /api/presence requires operator auth, lists every package, and sorts clients by connectedAt', async () => {
    const { server, port } = await makeServer();
    try {
      const unauth = await request(server.app).get('/api/presence');
      expect(unauth.status).toBe(401);

      const cookie = await operatorCookie(server);

      const connect = (qs: string, namespace: string) =>
        new Promise<WebSocket>((resolve, reject) => {
          const ws = new WebSocket(`ws://localhost:${port}/ws${qs}`);
          ws.on('open', () => ws.send(JSON.stringify({ type: 'subscribe', namespace })));
          ws.on('message', (data) => {
            const msg = JSON.parse(data.toString());
            if (msg.type === 'state' && msg.namespace === namespace) resolve(ws);
          });
          ws.on('error', reject);
        });

      const wsHoopsRender = await connect('?render=1&renderId=main', 'package:hoops');
      await new Promise((r) => setTimeout(r, 20));
      const wsNewsControl = await connect('?control=1', 'package:news');
      await new Promise((r) => setTimeout(r, 50));

      const res = await request(server.app).get('/api/presence').set('Cookie', cookie);
      expect(res.status).toBe(200);
      expect(Object.keys(res.body.packages).sort()).toEqual(['ffg', 'hoops', 'news']);
      expect(res.body.packages.hoops).toEqual({ renders: 1, byRender: { main: 1 }, controls: 0 });
      expect(res.body.packages.news).toEqual({ renders: 0, byRender: {}, controls: 1 });

      expect(res.body.clients).toHaveLength(2);
      expect(res.body.clients.map((c: { packageId: string }) => c.packageId)).toEqual(['hoops', 'news']);
      expect(res.body.clients[0].connectedAt).toBeLessThanOrEqual(res.body.clients[1].connectedAt);
      expect(res.body.clients[0]).toHaveProperty('ip');

      wsHoopsRender.close();
      wsNewsControl.close();
    } finally {
      await server.close();
    }
  });
});
