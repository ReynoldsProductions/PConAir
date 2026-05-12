import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WebSocket } from 'ws';
import { createServer } from '../src/main/server';
import { createStateStore } from '../src/main/state';
import { createAuthManager } from '../src/main/auth';
import type { WsServerMessage } from '../src/shared/types';

const AUTH_CONFIG = {
  operatorPin: '1234',
  adminPin: 'secret99',
  operatorSessionMs: 3600000,
  adminSessionMs: 3600000,
  maxFailures: 5,
  lockoutMs: 300000,
};

/** Connects a WebSocket and returns helpers to consume messages in order. */
function connectWs(port: number): {
  ws: WebSocket;
  nextMessage: () => Promise<WsServerMessage>;
} {
  const ws = new WebSocket(`ws://localhost:${port}/ws`);
  const queue: WsServerMessage[] = [];
  const waiters: Array<(msg: WsServerMessage) => void> = [];

  ws.on('message', (data) => {
    const msg: WsServerMessage = JSON.parse(data.toString());
    if (waiters.length > 0) {
      waiters.shift()!(msg);
    } else {
      queue.push(msg);
    }
  });

  function nextMessage(): Promise<WsServerMessage> {
    if (queue.length > 0) {
      return Promise.resolve(queue.shift()!);
    }
    return new Promise((resolve) => waiters.push(resolve));
  }

  return { ws, nextMessage };
}

describe('WebSocket', () => {
  let server: ReturnType<typeof createServer>;
  let store: ReturnType<typeof createStateStore>;
  let port: number;

  beforeEach(async () => {
    store = createStateStore();
    const auth = createAuthManager(AUTH_CONFIG);
    server = createServer({ store, auth, port: 0 }); // port 0 = OS assigns
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
    expect(msg.type).toBe('state');
    expect((msg as { type: 'state'; payload: { currentMode: string } }).payload.currentMode).toBe('idle');
    ws.close();
  });

  it('broadcasts a state_patch when state changes', async () => {
    const { ws, nextMessage } = connectWs(port);

    // Consume messages until the server has finished its own connection-time
    // setState (webSocketClients update), then trigger our state change.
    await nextMessage(); // full state on connect
    await nextMessage(); // connectionStatus patch from server tracking client count

    store.setState({ currentMode: 'slides' });

    const patch = await nextMessage();
    expect(patch.type).toBe('state_patch');
    expect((patch as { type: 'state_patch'; payload: { currentMode: string } }).payload.currentMode).toBe('slides');
    ws.close();
  });
});
