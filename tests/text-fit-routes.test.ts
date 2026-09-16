import { describe, it, expect } from 'vitest';
import request from 'supertest';
import path from 'path';
import { WebSocket } from 'ws';
import { createStateStore } from '../src/main/state';
import { createFullServer } from './_test-server';
import type { WsServerMessage } from '../src/shared/types';

const BUNDLED = path.join(process.cwd(), 'bundled-packages');

function makeServer() {
  const store = createStateStore();
  return createFullServer({
    store,
    operatorPin: 'test1234',
    adminPin: 'adminpass8',
    port: 0,
    packagesRoot: BUNDLED,
  });
}

async function operatorCookie(app: any) {
  const res = await request(app).post('/auth/operator').send({ pin: 'test1234' });
  return (res.headers['set-cookie'] as unknown as string[])[0];
}

describe('POST /api/packages/:id/warnings (spec 22 T9)', () => {
  it('stores warnings from an allowlisted (cookie-less) caller', async () => {
    const srv = makeServer();
    const post = await request(srv.app)
      .post('/api/packages/news/warnings')
      .send({ renderId: 'l3', warnings: [{ field: 'name', text: 'X', naturalWidth: 900, maxWidth: 620, min: 0.5 }] });
    expect(post.status).toBe(200);

    const cookie = await operatorCookie(srv.app);
    const get = await request(srv.app).get('/api/packages/news/warnings').set('Cookie', cookie);
    expect(get.status).toBe(200);
    expect(get.body.warnings).toEqual({
      l3: [{ field: 'name', text: 'X', naturalWidth: 900, maxWidth: 620, min: 0.5 }],
    });
  });

  it('404s an unknown package', async () => {
    const srv = makeServer();
    const res = await request(srv.app).post('/api/packages/nope/warnings').send({ renderId: 'l3', warnings: [] });
    expect(res.status).toBe(404);
  });

  it('400s a body with more than 32 warnings', async () => {
    const srv = makeServer();
    const warnings = Array.from({ length: 33 }, (_, i) => ({
      field: 'f' + i,
      text: 'x',
      naturalWidth: 100,
      maxWidth: 50,
    }));
    const res = await request(srv.app).post('/api/packages/news/warnings').send({ renderId: 'l3', warnings });
    expect(res.status).toBe(400);
  });

  it('400s a body over 16KB', async () => {
    const srv = makeServer();
    const bigText = 'x'.repeat(2000);
    const warnings = Array.from({ length: 10 }, (_, i) => ({
      field: 'f' + i,
      text: bigText,
      naturalWidth: 100,
      maxWidth: 50,
    }));
    const res = await request(srv.app).post('/api/packages/news/warnings').send({ renderId: 'l3', warnings });
    expect(res.status).toBe(400);
  });

  it('400s a malformed warning shape', async () => {
    const srv = makeServer();
    const res = await request(srv.app)
      .post('/api/packages/news/warnings')
      .send({ renderId: 'l3', warnings: [{ field: 'name', text: 'X' }] });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/packages/:id/warnings (spec 22 T9)', () => {
  it('requires operator auth', async () => {
    const srv = makeServer();
    const res = await request(srv.app).get('/api/packages/news/warnings');
    expect(res.status).toBe(401);
  });

  it('returns an empty map when nothing has ever reported', async () => {
    const srv = makeServer();
    const cookie = await operatorCookie(srv.app);
    const res = await request(srv.app).get('/api/packages/news/warnings').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.warnings).toEqual({});
  });

  it('404s an unknown package', async () => {
    const srv = makeServer();
    const cookie = await operatorCookie(srv.app);
    const res = await request(srv.app).get('/api/packages/nope/warnings').set('Cookie', cookie);
    expect(res.status).toBe(404);
  });
});

describe('warnings push frame + disconnect-clearing (spec 22 T10)', () => {
  const BUNDLED2 = path.join(process.cwd(), 'bundled-packages');

  async function bundledServer() {
    const store = createStateStore();
    const srv = createFullServer({
      store,
      operatorPin: 'test1234',
      adminPin: 'adminpass8',
      port: 0,
      packagesRoot: BUNDLED2,
    });
    await new Promise<void>((resolve) => srv.httpServer.listen(0, resolve));
    const port = (srv.httpServer.address() as { port: number }).port;
    return { srv, port, close: () => new Promise<void>((r) => srv.httpServer.close(() => r())) };
  }

  function connectAndSubscribe(port: number, qs: string): Promise<{ ws: WebSocket; frames: WsServerMessage[] }> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://localhost:${port}/ws${qs}`);
      const frames: WsServerMessage[] = [];
      ws.on('message', (d) => frames.push(JSON.parse(d.toString())));
      ws.on('open', () => {
        ws.send(JSON.stringify({ type: 'subscribe', namespace: 'package:news' }));
        // give the subscribe a beat to land before the caller starts asserting
        setTimeout(() => resolve({ ws, frames }), 100);
      });
      ws.on('error', reject);
    });
  }

  it('a subscribed control socket receives a warnings frame after a POST', async () => {
    const { srv, port, close } = await bundledServer();
    try {
      const { ws, frames } = await connectAndSubscribe(port, '?control=1');
      const before = frames.length;

      const res = await request(srv.app)
        .post('/api/packages/news/warnings')
        .send({ renderId: 'l3', warnings: [{ field: 'name', text: 'X', naturalWidth: 900, maxWidth: 620, min: 0.5 }] });
      expect(res.status).toBe(200);

      await new Promise((r) => setTimeout(r, 150));
      const frame = frames.slice(before).find((f) => f.type === 'warnings') as
        | { type: 'warnings'; namespace: string; renderId: string; warnings: unknown[] }
        | undefined;
      expect(frame, 'no warnings frame arrived').toBeTruthy();
      expect(frame!.namespace).toBe('package:news');
      expect(frame!.renderId).toBe('l3');
      expect(frame!.warnings).toEqual([{ field: 'name', text: 'X', naturalWidth: 900, maxWidth: 620, min: 0.5 }]);

      ws.close();
    } finally {
      await close();
    }
  });

  it('a render socket for a DIFFERENT renderId does not receive the frame', async () => {
    const { srv, port, close } = await bundledServer();
    try {
      const { ws, frames } = await connectAndSubscribe(port, '?render=1&renderId=ticker');
      const before = frames.length;

      await request(srv.app)
        .post('/api/packages/news/warnings')
        .send({ renderId: 'l3', warnings: [{ field: 'name', text: 'X', naturalWidth: 900, maxWidth: 620, min: 0.5 }] });

      await new Promise((r) => setTimeout(r, 150));
      expect(frames.slice(before).some((f) => f.type === 'warnings')).toBe(false);

      ws.close();
    } finally {
      await close();
    }
  });

  it('clears when the reporting render disconnects (last output for that render)', async () => {
    const { srv, port, close } = await bundledServer();
    try {
      // The render itself, whose disconnect should trigger the clear.
      const { ws: renderWs } = await connectAndSubscribe(port, '?render=1&renderId=l3');
      // A separate control observer to witness the cleared frame.
      const { ws: controlWs, frames } = await connectAndSubscribe(port, '?control=1');

      await request(srv.app)
        .post('/api/packages/news/warnings')
        .send({ renderId: 'l3', warnings: [{ field: 'name', text: 'X', naturalWidth: 900, maxWidth: 620, min: 0.5 }] });
      await new Promise((r) => setTimeout(r, 150));

      const before = frames.length;
      renderWs.close();
      await new Promise((r) => setTimeout(r, 200));

      const cleared = frames.slice(before).find(
        (f) => f.type === 'warnings' && (f as { renderId: string }).renderId === 'l3'
      ) as { warnings: unknown[] } | undefined;
      expect(cleared, 'no cleared frame arrived after the render disconnected').toBeTruthy();
      expect(cleared!.warnings).toEqual([]);

      const check = await request(srv.app).get('/api/packages/news/warnings').set(
        'Cookie',
        (await request(srv.app).post('/auth/operator').send({ pin: 'test1234' })).headers['set-cookie']![0]
      );
      expect(check.body.warnings).toEqual({});

      controlWs.close();
    } finally {
      await close();
    }
  });

  it('a second render output for the same renderId keeps the warning (not last output)', async () => {
    const { srv, port, close } = await bundledServer();
    try {
      const { ws: renderA } = await connectAndSubscribe(port, '?render=1&renderId=l3');
      const { ws: renderB, frames } = await connectAndSubscribe(port, '?render=1&renderId=l3');

      await request(srv.app)
        .post('/api/packages/news/warnings')
        .send({ renderId: 'l3', warnings: [{ field: 'name', text: 'X', naturalWidth: 900, maxWidth: 620, min: 0.5 }] });
      await new Promise((r) => setTimeout(r, 150));

      renderA.close();
      await new Promise((r) => setTimeout(r, 150));

      const cookie = (await request(srv.app).post('/auth/operator').send({ pin: 'test1234' })).headers[
        'set-cookie'
      ]![0];
      const check = await request(srv.app).get('/api/packages/news/warnings').set('Cookie', cookie);
      expect(check.body.warnings.l3).toEqual([{ field: 'name', text: 'X', naturalWidth: 900, maxWidth: 620, min: 0.5 }]);

      renderB.close();
    } finally {
      await close();
    }
  });
});
