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

describe('Graphics viewer WebSocket (?graphics=1)', () => {
  it('allows connection without auth and receives initial state', async () => {
    const store = createStateStore();
    const srv = createFullServer({
      store,
      operatorPin: 'test1234',
      adminPin: 'adminpass8',
      operatorSessionMs: 60000,
      adminSessionMs: 60000,
      port: 0,
    });
    await new Promise<void>((resolve) => srv.httpServer.listen(0, resolve));
    const port = (srv.httpServer.address() as { port: number }).port;

    const ws = new WebSocket(`ws://localhost:${port}/ws?graphics=1`);
    const msg = await new Promise<WsServerMessage>((resolve, reject) => {
      ws.on('message', (data) => resolve(JSON.parse(data.toString()) as WsServerMessage));
      ws.on('error', reject);
    });

    expect(msg.type).toBe('state');
    expect((msg as { type: 'state'; payload: unknown }).payload).toBeTruthy();

    ws.close();
    await new Promise<void>((resolve) => srv.httpServer.close(() => resolve()));
  });

  it('receives state_patch when store state changes', async () => {
    const store = createStateStore();
    const srv = createFullServer({
      store,
      operatorPin: 'test1234',
      adminPin: 'adminpass8',
      operatorSessionMs: 60000,
      adminSessionMs: 60000,
      port: 0,
    });
    await new Promise<void>((resolve) => srv.httpServer.listen(0, resolve));
    const port = (srv.httpServer.address() as { port: number }).port;

    const ws = new WebSocket(`ws://localhost:${port}/ws?graphics=1`);
    // skip initial 'state' message
    await new Promise<void>((resolve, reject) => {
      ws.once('message', () => resolve());
      ws.on('error', reject);
    });

    const patchPromise = new Promise<WsServerMessage>((resolve, reject) => {
      ws.once('message', (data) => resolve(JSON.parse(data.toString()) as WsServerMessage));
      ws.on('error', reject);
    });

    // mutate state — should broadcast to all clients including graphics viewer
    store.setState({ graphics: { scoreboard: { teamA: 'BOS', teamB: 'LAL', scoreA: 10, scoreB: 8, quarter: 'Q2', gameClock: '5:00', gameClockRunning: true, shotClock: 24, shotClockRunning: true, possession: 'a', foulsA: 2, foulsB: 3, timeoutsA: 5, timeoutsB: 6 } } });

    const patch = await patchPromise;
    expect(patch.type).toBe('state_patch');
    expect((patch as { type: 'state_patch'; payload: { graphics?: unknown } }).payload.graphics).toBeTruthy();

    ws.close();
    await new Promise<void>((resolve) => srv.httpServer.close(() => resolve()));
  });

  it('rejects action messages from graphics viewers silently', async () => {
    const store = createStateStore();
    const srv = createFullServer({
      store,
      operatorPin: 'test1234',
      adminPin: 'adminpass8',
      operatorSessionMs: 60000,
      adminSessionMs: 60000,
      port: 0,
    });
    await new Promise<void>((resolve) => srv.httpServer.listen(0, resolve));
    const port = (srv.httpServer.address() as { port: number }).port;

    const ws = new WebSocket(`ws://localhost:${port}/ws?graphics=1`);
    // wait for initial state
    await new Promise<void>((resolve, reject) => {
      ws.once('message', () => resolve());
      ws.on('error', reject);
    });

    // send an action — graphics viewer must not trigger state change
    ws.send(JSON.stringify({ type: 'action', action_id: 'set_mode', params: { mode: 'url' } }));

    // wait 200ms; if store didn't change, mode is still 'idle'
    await new Promise<void>((resolve) => setTimeout(resolve, 200));
    expect(store.getState().currentMode).toBe('idle');

    ws.close();
    await new Promise<void>((resolve) => srv.httpServer.close(() => resolve()));
  });
});
