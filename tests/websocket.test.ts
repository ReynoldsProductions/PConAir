import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { WebSocket } from 'ws';
import type { Express } from 'express';
import { createStateStore } from '../src/main/state';
import { createFullServer } from './_test-server';
import type { WsServerMessage } from '../src/shared/types';

function makeHttpServer() {
  const store = createStateStore();
  const server = createFullServer({
    store,
    operatorPin: 'test1234',
    adminPin: 'adminpass8',
    operatorSessionMs: 60000,
    adminSessionMs: 60000,
    port: 0,
  });
  return { server, store };
}

const AUTH_CONFIG = {
  operatorPin: '1234',
  adminPin: 'secret99',
  operatorSessionMs: 3600000,
  adminSessionMs: 3600000,
};

/** Connects a WebSocket with optional session cookie. */
function connectWs(port: number, cookieHeader?: string): {
  ws: WebSocket;
  nextMessage: () => Promise<WsServerMessage>;
} {
  const ws = new WebSocket(`ws://localhost:${port}/ws`, {
    headers: cookieHeader ? { Cookie: cookieHeader } : undefined,
  });
  const queue: WsServerMessage[] = [];
  const waiters: Array<{ resolve: (msg: WsServerMessage) => void; reject: (err: Error) => void }> = [];

  ws.on('message', (data) => {
    const msg: WsServerMessage = JSON.parse(data.toString());
    if (waiters.length > 0) {
      waiters.shift()!.resolve(msg);
    } else {
      queue.push(msg);
    }
  });

  ws.on('close', () => {
    const err = new Error('WebSocket closed before message was received');
    for (const waiter of waiters.splice(0)) waiter.reject(err);
  });

  ws.on('error', (err) => {
    const error = err instanceof Error ? err : new Error(String(err));
    for (const waiter of waiters.splice(0)) waiter.reject(error);
  });

  function nextMessage(): Promise<WsServerMessage> {
    if (queue.length > 0) {
      return Promise.resolve(queue.shift()!);
    }
    return new Promise((resolve, reject) => waiters.push({ resolve, reject }));
  }

  return { ws, nextMessage };
}

/** Scans forward through messages until it finds a state_patch containing the given key. */
async function nextPatchWith(
  getMsg: () => Promise<WsServerMessage>,
  key: string
): Promise<WsServerMessage> {
  let msg: WsServerMessage;
  do { msg = await getMsg(); } while (
    msg.type !== 'state_patch' || !(key in (msg as { type: 'state_patch'; payload: Record<string, unknown> }).payload)
  );
  return msg;
}

describe('WebSocket', () => {
  let server: ReturnType<typeof createFullServer>;
  let store: ReturnType<typeof createStateStore>;
  let port: number;
  let operatorCookie: string;

  beforeEach(async () => {
    store = createStateStore();
    server = createFullServer({
      store,
      operatorPin: AUTH_CONFIG.operatorPin,
      adminPin: AUTH_CONFIG.adminPin,
      operatorSessionMs: AUTH_CONFIG.operatorSessionMs,
      adminSessionMs: AUTH_CONFIG.adminSessionMs,
      port: 0,
    });
    await server.listen();
    const addr = server.httpServer.address();
    port = typeof addr === 'object' && addr ? addr.port : 8080;
    const login = await request(server.app)
      .post('/auth/operator')
      .send({ pin: AUTH_CONFIG.operatorPin });
    operatorCookie = login.headers['set-cookie'][0].split(';')[0];
  });

  afterEach(async () => {
    await server.close();
  });

  it('sends full state immediately on connect', async () => {
    const { ws, nextMessage } = connectWs(port, operatorCookie);
    const msg = await nextMessage();
    expect(msg).toMatchObject({ type: 'state', payload: { currentMode: 'idle' } });
    ws.close();
  });

  it('broadcasts a state_patch when state changes', async () => {
    const { ws, nextMessage } = connectWs(port, operatorCookie);

    // Wait for the initial full-state message so we know the connection is open,
    // then trigger the state change. nextPatchWith scans forward for the specific
    // patch regardless of how many other messages arrive in between.
    await nextMessage(); // full state on connect

    store.setState({ currentMode: 'slides' });

    const patch = await nextPatchWith(nextMessage, 'currentMode');
    expect(patch).toMatchObject({ type: 'state_patch', payload: { currentMode: 'slides' } });
    ws.close();
  });
});

describe('set_display action via POST /api/action', () => {
  let app: Express;
  let opCookie: string;
  let srv: ReturnType<typeof makeHttpServer>['server'];
  let store: ReturnType<typeof makeHttpServer>['store'];

  beforeEach(async () => {
    const made = makeHttpServer();
    srv = made.server;
    store = made.store;
    // setDisplayTargetOp requires url mode + a loaded URL; seed both along with displays
    store.setState({
      currentMode: 'url',
      displays: [
        { id: 'disp-1', name: 'HDMI-1', isPrimary: true },
        { id: 'disp-2', name: 'HDMI-2', isPrimary: false },
      ],
      abState: {
        activeInstance: 'A',
        instanceA: { url: 'https://example.com', isLoading: false, isReady: true, displayTarget: null, sessionMode: 'persistent' },
        instanceB: { url: 'https://example.com', isLoading: false, isReady: true, displayTarget: null, sessionMode: 'persistent' },
      },
    });
    await srv.listen();
    app = srv.app;
    const res = await request(app).post('/auth/operator').send({ pin: 'test1234' });
    opCookie = ((res.headers['set-cookie'] as unknown) as string[])[0];
  });

  afterEach(() => srv.close());

  it('set_display updates instanceA.displayTarget', async () => {
    const res = await request(app)
      .post('/api/action')
      .set('Cookie', opCookie)
      .send({ action_id: 'set_display', params: { display: 'disp-2', instance: 'A' } });
    expect(res.status).toBe(200);
    expect(store.getState().abState.instanceA.displayTarget).toBe('disp-2');
    expect(res.body.abState.instanceA.displayTarget).toBe('disp-2');
  });

  it('set_display updates instanceB.displayTarget', async () => {
    const res = await request(app)
      .post('/api/action')
      .set('Cookie', opCookie)
      .send({ action_id: 'set_display', params: { display: 'disp-1', instance: 'B' } });
    expect(res.status).toBe(200);
    expect(store.getState().abState.instanceB.displayTarget).toBe('disp-1');
    expect(res.body.abState.instanceB.displayTarget).toBe('disp-1');
  });

  it('set_display returns 404 for unknown display id', async () => {
    const res = await request(app)
      .post('/api/action')
      .set('Cookie', opCookie)
      .send({ action_id: 'set_display', params: { display: 'nope', instance: 'A' } });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('DISPLAY_NOT_FOUND');
  });

  it('set_display returns 400 when display param is missing', async () => {
    const res = await request(app)
      .post('/api/action')
      .set('Cookie', opCookie)
      .send({ action_id: 'set_display', params: { instance: 'A' } });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MISSING_PARAM');
  });

  it('set_display with invalid instance value defaults to active instance', async () => {
    const res = await request(app)
      .post('/api/action')
      .set('Cookie', opCookie)
      .send({ action_id: 'set_display', params: { display: 'disp-1', instance: 'C' } });
    expect(res.status).toBe(200);
    // 'C' is not a valid ABInstance so it falls back to the active instance (A)
    expect(store.getState().abState.instanceA.displayTarget).toBe('disp-1');
  });

  it('set_display with missing instance param defaults to active instance', async () => {
    const res = await request(app)
      .post('/api/action')
      .set('Cookie', opCookie)
      .send({ action_id: 'set_display', params: { display: 'disp-1' } });
    expect(res.status).toBe(200);
    expect(store.getState().abState.instanceA.displayTarget).toBe('disp-1');
  });
});

describe('render WebSocket connections (cookie-less, read-only)', () => {
  let server: ReturnType<typeof makeHttpServer>['server'];
  let store: ReturnType<typeof makeHttpServer>['store'];
  let port: number;

  beforeEach(async () => {
    ({ server, store } = makeHttpServer());
    await server.listen();
    const addr = server.httpServer.address();
    port = typeof addr === 'object' && addr ? addr.port : 0;
  });

  afterEach(async () => {
    await server.close();
  });

  it('accepts ?render=1 without a cookie and pushes state', async () => {
    const ws = new WebSocket(`ws://localhost:${port}/ws?render=1`);
    const first = await new Promise<WsServerMessage>((resolve, reject) => {
      ws.on('message', (data) => resolve(JSON.parse(data.toString())));
      ws.on('error', reject);
      ws.on('close', (code) => reject(new Error(`closed ${code}`)));
    });
    expect(first.type).toBe('state');

    const patchPromise = new Promise<WsServerMessage>((resolve) => {
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString()) as WsServerMessage;
        if (msg.type === 'state_patch' && 'currentUrl' in (msg.payload as Record<string, unknown>)) resolve(msg);
      });
    });
    store.setState({ currentUrl: 'https://example.com' });
    const patch = await patchPromise;
    expect(patch.type).toBe('state_patch');
    ws.close();
  });

  it('ignores action messages from render connections', async () => {
    const ws = new WebSocket(`ws://localhost:${port}/ws?render=1`);
    await new Promise<void>((resolve, reject) => {
      ws.on('message', () => resolve());
      ws.on('error', reject);
    });
    ws.send(JSON.stringify({ type: 'action', action_id: 'panic_toggle', params: {} }));
    // Give the server a beat; the action must not mutate state.
    await new Promise((r) => setTimeout(r, 150));
    expect(store.getState().reliability.panicActive).toBe(false);
    ws.close();
  });

  it('still rejects normal connections without a cookie', async () => {
    const ws = new WebSocket(`ws://localhost:${port}/ws`);
    const result = await new Promise<string>((resolve) => {
      ws.on('close', () => resolve('closed'));
      ws.on('error', () => resolve('error'));
      ws.on('open', () => setTimeout(() => resolve('open'), 300));
    });
    expect(result === 'closed' || result === 'error').toBe(true);
  });
});
