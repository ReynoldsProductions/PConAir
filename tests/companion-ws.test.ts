import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';
import { WebSocket } from 'ws';
import { createStateStore, type StateStore } from '../src/main/state';
import { createFullServer } from './_test-server';
import { makeSlidesState } from '../src/shared/types';

const PINS = { operatorPin: '1234', adminPin: 'supersecret' };

function writePkg(root: string): void {
  const dir = path.join(root, 'demo');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({
      id: 'demo',
      name: 'Demo',
      version: '1.0.0',
      renders: [{ id: 'main', label: 'Main', file: 'render.html' }],
      stateSchema: { score: 'number' },
      companionActions: [
        { id: 'bump', label: 'Bump score', ops: [{ op: 'add', field: 'score', value: 1 }] },
      ],
      companionVariables: [{ id: 'score', label: 'Score', field: 'score' }],
      companionFeedbacks: [{ id: 'scored', label: 'Has score', field: 'score' }],
    })
  );
  fs.writeFileSync(path.join(dir, 'render.html'), '<html></html>');
}

interface CompanionConn {
  ws: WebSocket;
  // Messages are buffered from socket creation: the server pushes the state
  // snapshot in the same tick the upgrade completes, so a listener attached
  // after awaiting 'open' would miss it. Matched messages are consumed.
  nextMessage: (predicate: (msg: Record<string, unknown>) => boolean) => Promise<Record<string, unknown>>;
}

function wrapSocket(ws: WebSocket): CompanionConn {
  const buffer: Array<Record<string, unknown>> = [];
  const waiters: Array<{
    predicate: (msg: Record<string, unknown>) => boolean;
    resolve: (msg: Record<string, unknown>) => void;
  }> = [];
  ws.on('message', (raw) => {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(String(raw)) as Record<string, unknown>;
    } catch {
      return;
    }
    const i = waiters.findIndex((w) => w.predicate(msg));
    if (i >= 0) {
      waiters.splice(i, 1)[0].resolve(msg);
      return;
    }
    buffer.push(msg);
  });
  return {
    ws,
    nextMessage(predicate) {
      const i = buffer.findIndex(predicate);
      if (i >= 0) return Promise.resolve(buffer.splice(i, 1)[0]);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('timeout waiting for message')), 4000);
        waiters.push({
          predicate,
          resolve: (msg) => {
            clearTimeout(timer);
            resolve(msg);
          },
        });
      });
    },
  };
}

describe('cookie-less Companion WebSocket (?companion=1)', () => {
  let srv: ReturnType<typeof createFullServer>;
  let store: StateStore;
  let port: number;
  let pkgRoot: string;

  beforeEach(async () => {
    pkgRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pconair-cws-'));
    writePkg(pkgRoot);
    store = createStateStore();
    srv = createFullServer({ store, ...PINS, port: 0, packagesRoot: pkgRoot });
    await srv.listen();
    port = (srv.httpServer.address() as { port: number }).port;
  });

  afterEach(async () => {
    await srv.close();
    fs.rmSync(pkgRoot, { recursive: true, force: true });
  });

  function connect(): Promise<CompanionConn> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://localhost:${port}/ws?companion=1`);
      const conn = wrapSocket(ws);
      ws.on('open', () => resolve(conn));
      ws.on('error', reject);
    });
  }

  it('connects without cookies, receives the AppState snapshot, and marks companionConnected', async () => {
    const { ws, nextMessage } = await connect();
    const snap = await nextMessage((m) => m.type === 'state' && m.payload !== undefined);
    expect((snap.payload as Record<string, unknown>).currentMode).toBe('idle');
    // companionConnected flips true in state
    await new Promise((r) => setTimeout(r, 50));
    expect(store.getState().connectionStatus.companionConnected).toBe(true);
    ws.close();
    await new Promise((r) => setTimeout(r, 50));
    expect(store.getState().connectionStatus.companionConnected).toBe(false);
  });

  it('dispatches actions without a session or PIN', async () => {
    const { ws, nextMessage } = await connect();
    await nextMessage((m) => m.type === 'state');
    ws.send(JSON.stringify({ type: 'action', action_id: 'l3_take', params: { name: 'Jane', title: 'Host' } }));
    const result = await nextMessage((m) => m.type === 'action_result');
    expect((result.payload as Record<string, unknown>).currentMode).toBe('l3');
    expect(store.getState().l3?.activeCueName).toBe('Jane');
    ws.close();
  });

  it('returns errors for unknown actions', async () => {
    const { ws, nextMessage } = await connect();
    await nextMessage((m) => m.type === 'state');
    ws.send(JSON.stringify({ type: 'action', action_id: 'nope', params: {} }));
    const err = await nextMessage((m) => m.type === 'error');
    expect((err.payload as Record<string, unknown>).code).toBe('UNKNOWN_ACTION');
    ws.close();
  });

  it('supports package namespace subscriptions on the same socket', async () => {
    const { ws, nextMessage } = await connect();
    await nextMessage((m) => m.type === 'state');
    ws.send(JSON.stringify({ type: 'subscribe', namespace: 'package:demo' }));
    const snap = await nextMessage((m) => m.namespace === 'package:demo');
    expect((snap.state as Record<string, unknown>).score).toBe(0);

    // A cookie-less HTTP patch (the module's action path) is pushed live.
    const push = nextMessage((m) => m.namespace === 'package:demo' && (m.state as Record<string, unknown>).score === 5);
    await request(srv.app).post('/api/packages/demo/state').send({ score: 5 }).expect(200);
    await push;
    ws.close();
  });

  it('navigates slides via dispatched actions', async () => {
    store.setState({
      currentMode: 'slides',
      slides: makeSlidesState({ deckId: 'd', deckTitle: 'Deck', slideIndex: 0, slideCount: 5, isLoading: false }),
    });
    const { ws, nextMessage } = await connect();
    await nextMessage((m) => m.type === 'state');
    ws.send(JSON.stringify({ type: 'action', action_id: 'slides_goto_last', params: {} }));
    await nextMessage((m) => m.type === 'action_result');
    expect(store.getState().slides?.slideIndex).toBe(4);
    ws.send(JSON.stringify({ type: 'action', action_id: 'slides_goto_first', params: {} }));
    await nextMessage((m) => m.type === 'action_result');
    expect(store.getState().slides?.slideIndex).toBe(0);
    ws.close();
  });

  it('rejects cookie-less upgrades that arrive through the Cloudflare tunnel', async () => {
    const refused = await new Promise<boolean>((resolve) => {
      const ws = new WebSocket(`ws://localhost:${port}/ws?companion=1`, {
        headers: { 'cf-ray': '8c0ffee-IAD' },
      });
      ws.on('open', () => {
        ws.close();
        resolve(false);
      });
      ws.on('error', () => resolve(true));
      ws.on('unexpected-response', () => resolve(true));
    });
    expect(refused).toBe(true);
  });

  it('GET /api/packages exposes declarative companion interfaces', async () => {
    const res = await request(srv.app).get('/api/packages').expect(200);
    const demo = (res.body.packages as Array<Record<string, unknown>>).find((p) => p.id === 'demo');
    expect(demo).toBeDefined();
    expect(demo!.companionActions).toEqual([
      { id: 'bump', label: 'Bump score', ops: [{ op: 'add', field: 'score', value: 1 }] },
    ]);
    expect(demo!.companionVariables).toEqual([{ id: 'score', label: 'Score', field: 'score' }]);
    expect(demo!.companionFeedbacks).toEqual([{ id: 'scored', label: 'Has score', field: 'score' }]);
  });
});
