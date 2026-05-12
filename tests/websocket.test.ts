import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WebSocket } from 'ws';
import { createStateStore } from '../src/main/state';
import { createFullServer } from './_test-server';
import type { WsServerMessage } from '../src/shared/types';

const AUTH_CONFIG = {
  operatorPin: '1234',
  adminPin: 'secret99',
  operatorSessionMs: 3600000,
  adminSessionMs: 3600000,
};

/** Connects a WebSocket and returns helpers to consume messages in order. */
function connectWs(port: number): {
  ws: WebSocket;
  nextMessage: () => Promise<WsServerMessage>;
} {
  const ws = new WebSocket(`ws://localhost:${port}/ws`);
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
    // Get the assigned port
    const addr = server.httpServer.address();
    port = typeof addr === 'object' && addr ? addr.port : 8080;
  });

  afterEach(async () => {
    await server.close();
  });

  it('sends full state immediately on connect', async () => {
    const { ws, nextMessage } = connectWs(port);
    const msg = await nextMessage();
    expect(msg).toMatchObject({ type: 'state', payload: { currentMode: 'idle' } });
    ws.close();
  });

  it('broadcasts a state_patch when state changes', async () => {
    const { ws, nextMessage } = connectWs(port);

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
