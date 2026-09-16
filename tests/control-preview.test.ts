// Spec 17 — Control-Page Preview.
//
// T1 is the correctness-critical test (spec 17 §3.3): a preview must never
// count as a live output. It subscribes exactly like a real render page
// (?render=1&renderId=...) except for one added param, `preview=1`, and that
// param alone must zero it out of presence and `delivered` — both of which
// spec 16 built specifically so an operator can trust "is anything actually
// listening". Follows the shape of tests/output-presence.test.ts (T1-T5).
import { describe, it, expect } from 'vitest';
import path from 'path';
import request from 'supertest';
import { WebSocket } from 'ws';
import { createStateStore } from '../src/main/state';
import { createFullServer } from './_test-server';

describe('T1 — preview socket is excluded from presence and delivered (spec 17 §3.3)', () => {
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
    return { server, port, cookie };
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

  it('a socket subscribed with ?render=1&preview=1 reports zero presence and zero delivered', async () => {
    const { server, port, cookie } = await makeServer();
    try {
      const before = await request(server.app).get('/api/packages/hoops/presence').set('Cookie', cookie);
      expect(before.body).toEqual({ renders: 0, byRender: {}, controls: 0 });

      const previewWs = await connectAndSubscribe(port, '?render=1&renderId=scorebug&preview=1', 'package:hoops');
      await new Promise((r) => setTimeout(r, 50));

      const duringPreview = await request(server.app).get('/api/packages/hoops/presence').set('Cookie', cookie);
      expect(duringPreview.body).toEqual({ renders: 0, byRender: {}, controls: 0 });

      const patchWithOnlyPreview = await request(server.app).post('/api/packages/hoops/state').send({ scoreA: 1 });
      expect(patchWithOnlyPreview.status).toBe(200);
      expect(patchWithOnlyPreview.body.delivered).toBe(0);

      previewWs.close();
      await new Promise((r) => setTimeout(r, 100));

      // Same socket shape, without preview=1, DOES report as a real output —
      // proves the exclusion is specific to preview=1, not some accident of
      // this test's setup.
      const realWs = await connectAndSubscribe(port, '?render=1&renderId=scorebug', 'package:hoops');
      await new Promise((r) => setTimeout(r, 50));

      const withRealRender = await request(server.app).get('/api/packages/hoops/presence').set('Cookie', cookie);
      expect(withRealRender.body).toEqual({ renders: 1, byRender: { scorebug: 1 }, controls: 0 });

      const patchWithRealRender = await request(server.app).post('/api/packages/hoops/state').send({ scoreA: 2 });
      expect(patchWithRealRender.status).toBe(200);
      expect(patchWithRealRender.body.delivered).toBe(1);

      realWs.close();
    } finally {
      await server.close();
    }
  });

  it('a control socket with preview=1 also does not register presence (belt-and-suspenders: no role counts while previewing)', async () => {
    const { server, port, cookie } = await makeServer();
    try {
      const ws = await connectAndSubscribe(port, '?control=1&preview=1', 'package:hoops');
      await new Promise((r) => setTimeout(r, 50));
      const p = await request(server.app).get('/api/packages/hoops/presence').set('Cookie', cookie);
      expect(p.body).toEqual({ renders: 0, byRender: {}, controls: 0 });
      ws.close();
    } finally {
      await server.close();
    }
  });
});

describe('T7 — bundled control pages wire a live preview (spec 17 §3.6)', () => {
  const PINS = { operatorPin: 'test1234', adminPin: 'adminpass8' };
  const bundledRoot = path.join(__dirname, '..', 'bundled-packages');

  it('hoops, news and ffg control pages each mount PConAir.preview with the right packageId', async () => {
    const store = createStateStore();
    const server = createFullServer({ store, ...PINS, port: 0, packagesRoot: bundledRoot });
    await server.listen();
    try {
      const hoops = await request(server.app).get('/packages/hoops/control');
      expect(hoops.status).toBe(200);
      expect(hoops.text).toContain('PConAir.preview(');
      expect(hoops.text).toContain("packageId: 'hoops'");
      expect(hoops.text).toContain("renderId: 'scorebug'");

      const ffg = await request(server.app).get('/packages/ffg/control');
      expect(ffg.status).toBe(200);
      expect(ffg.text).toContain('PConAir.preview(');
      expect(ffg.text).toContain("packageId: 'ffg'");

      const news = await request(server.app).get('/packages/news/control');
      expect(news.status).toBe(200);
      expect(news.text).toContain('PConAir.preview(');
      expect(news.text).toContain("packageId: 'news'");
      // news ships three renders (ticker, l3, all) — its preview needs a
      // selector driving setRender, not a single hardcoded renderId.
      expect(news.text).toContain('.setRender(');
      expect(news.text).toMatch(/<option[^>]*value="ticker"/);
      expect(news.text).toMatch(/<option[^>]*value="l3"/);
      expect(news.text).toMatch(/<option[^>]*value="all"/);
    } finally {
      await server.close();
    }
  });
});

describe('Acceptance — a preview is genuinely live while never counting as an output (spec 17 §5)', () => {
  const PINS = { operatorPin: 'test1234', adminPin: 'adminpass8' };
  const bundledRoot = path.join(__dirname, '..', 'bundled-packages');

  it('a socket subscribed exactly as the preview iframe would be receives every state patch instantly, with no reload, while presence/delivered stay zero', async () => {
    const store = createStateStore();
    const server = createFullServer({ store, ...PINS, port: 0, packagesRoot: bundledRoot });
    await server.listen();
    const addr = server.httpServer.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    const login = await request(server.app).post('/auth/operator').send({ pin: PINS.operatorPin });
    const cookie = (login.headers['set-cookie'] as unknown as string[])[0];
    try {
      // This is exactly the query string PConAir.preview()'s framed render
      // page opens, per pconair.js's wsUrl() (?render=1&renderId=...) plus
      // the preview=1 the outer page's own URL carries (spec 17 §3.3).
      const messages: Array<Record<string, unknown>> = [];
      const previewWs = await new Promise<WebSocket>((resolve, reject) => {
        const ws = new WebSocket(`ws://localhost:${port}/ws?render=1&renderId=scorebug&preview=1`);
        ws.on('message', (data) => {
          const msg = JSON.parse(data.toString());
          messages.push(msg);
          if (msg.type === 'state' && msg.namespace === 'package:hoops') resolve(ws);
        });
        ws.on('open', () => ws.send(JSON.stringify({ type: 'subscribe', namespace: 'package:hoops' })));
        ws.on('error', reject);
      });

      const countBeforePatch = messages.length;

      // Change a field — the same patch an operator's control page would send.
      const patchRes = await request(server.app).post('/api/packages/hoops/state').send({ scoreA: 7 });
      expect(patchRes.status).toBe(200);
      // Never counts as an output, even while it is demonstrably live below.
      expect(patchRes.body.delivered).toBe(0);

      // The very same socket receives the new state — no reload, no
      // reconnect, just the next frame over the WS it already has open.
      const sawUpdate = await new Promise<boolean>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('preview socket never received the patched state')), 3000);
        const iv = setInterval(() => {
          for (let i = countBeforePatch; i < messages.length; i++) {
            const m = messages[i];
            if (m.type === 'state' && m.namespace === 'package:hoops' && (m.state as { scoreA: number }).scoreA === 7) {
              clearInterval(iv);
              clearTimeout(timer);
              resolve(true);
              return;
            }
          }
        }, 20);
      });
      expect(sawUpdate).toBe(true);

      // And presence/GET still reports nothing listening throughout.
      const presence = await request(server.app).get('/api/packages/hoops/presence').set('Cookie', cookie);
      expect(presence.body).toEqual({ renders: 0, byRender: {}, controls: 0 });

      previewWs.close();
    } finally {
      await server.close();
    }
  });
});
