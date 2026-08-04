import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';
import { WebSocketServer, WebSocket } from 'ws';
import { createOfficeClient } from '../src/main/director/office-client';
import type { DirectorOffice } from '../src/main/app-settings';
import type { AppState } from '../src/shared/types';

// ── helpers ──────────────────────────────────────────────────────────────────

function makeAppState(overrides: Partial<AppState> = {}): AppState {
  return {
    currentMode: 'l3',
    currentPreset: null,
    currentUrl: null,
    slides: null,
    l3: null,
    mediaLibrary: null,
    background: { presetId: null, presetName: null, type: 'solid', value: '#000000' },
    displays: [],
    abState: {
      activeInstance: 'A',
      instanceA: { url: null, isLoading: false, isReady: false, displayTarget: null, sessionMode: 'persistent' },
      instanceB: { url: null, isLoading: false, isReady: false, displayTarget: null, sessionMode: 'persistent' },
    },
    connectionStatus: { webSocketClients: 0, companionConnected: false, adminShowLocked: false },
    reliability: { panicActive: false, panicSlate: { type: 'color', value: '#000000' } },
    watchdog: {
      programUnresponsive: false,
      programUnresponsiveSecs: 0,
      memoryPressure: false,
      memoryPressurePct: 0,
      memoryHeapUsedGb: 0,
      memoryHeapTotalGb: 0,
      lastRendererCrashAt: null,
    },
    tunnel: { enabled: false, status: 'inactive', url: null, pinRequired: false, lastError: null },
    renderOutputs: {
      slides: { bg: 'transparent', chromaColor: '#00ff00', claimedOutput: null },
      l3: { bg: 'transparent', chromaColor: '#00ff00', claimedOutput: null },
      stills: { bg: 'transparent', chromaColor: '#00ff00', claimedOutput: null },
      url: { bg: 'transparent', chromaColor: '#00ff00', claimedOutput: null },
    },
    stageTimer: { overlayEnabled: false, overlayPosition: 'bottom-left', overlaySize: 10, roomId: null, configured: false },
    teleprompter: { enabled: false, host: '', scrolling: false, speed: 40, fontSize: 72 },
    graphics: { scoreboard: null, lowerThird: null },
    ...overrides,
  };
}

interface MockOffice {
  port: number;
  requests: Array<{ path: string; body: string; method: string }>;
  setPin: (pin: string) => void;
  sendState: (state: AppState) => void;
  sendPatch: (patch: Partial<AppState>) => void;
  close: () => Promise<void>;
}

/** Minimal fake PConAir server: /auth/operator, /api/action, and /ws. */
function makeMockOffice(): Promise<MockOffice> {
  return new Promise((resolve) => {
    const requests: MockOffice['requests'] = [];
    let expectedPin = '1234';
    let sessionCookie: string | null = null;
    const wsClients = new Set<WebSocket>();

    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c: Buffer) => { body += c.toString(); });
      req.on('end', () => {
        requests.push({ path: req.url ?? '', body, method: req.method ?? '' });

        if (req.url === '/auth/operator' && req.method === 'POST') {
          const parsed = body ? JSON.parse(body) : {};
          if (parsed.pin !== expectedPin) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { code: 'AUTH_REQUIRED', message: 'bad pin' } }));
            return;
          }
          sessionCookie = 'sess-abc123';
          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Set-Cookie': `pconair_operator_session=${sessionCookie}; HttpOnly; Path=/`,
          });
          res.end(JSON.stringify({ role: 'operator' }));
          return;
        }

        if (req.url === '/api/action' && req.method === 'POST') {
          const cookieHeader = req.headers.cookie ?? '';
          if (!sessionCookie || !cookieHeader.includes(sessionCookie)) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { code: 'AUTH_REQUIRED', message: 'no session' } }));
            return;
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ graphics: { lowerThird: { visible: true } } }));
          return;
        }

        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'no route' } }));
      });
    });

    const wss = new WebSocketServer({ server, path: '/ws' });
    wss.on('connection', (ws, req) => {
      const cookieHeader = req.headers.cookie ?? '';
      if (!sessionCookie || !cookieHeader.includes(sessionCookie)) {
        ws.close(4001, 'Authentication required');
        return;
      }
      wsClients.add(ws);
      ws.on('close', () => wsClients.delete(ws));
    });

    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        port,
        requests,
        setPin: (pin: string) => { expectedPin = pin; },
        sendState: (state: AppState) => {
          for (const ws of wsClients) ws.send(JSON.stringify({ type: 'state', payload: state }));
        },
        sendPatch: (patch: Partial<AppState>) => {
          for (const ws of wsClients) ws.send(JSON.stringify({ type: 'state_patch', payload: patch }));
        },
        close: () => new Promise((res) => { wss.close(); server.close(() => res()); }),
      });
    });
  });
}

function waitFor(check: () => boolean, timeoutMs = 3000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      if (check()) { resolve(); return; }
      if (Date.now() - start > timeoutMs) { reject(new Error('waitFor timed out')); return; }
      setTimeout(tick, 20);
    };
    tick();
  });
}

function makeOffice(port: number, overrides: Partial<DirectorOffice> = {}): DirectorOffice {
  return {
    id: 'office-1',
    name: 'Nashville',
    baseUrl: `http://127.0.0.1:${port}`,
    operatorPin: '1234',
    ...overrides,
  };
}

let mock: MockOffice;

beforeEach(async () => {
  mock = await makeMockOffice();
});

afterEach(async () => {
  await mock.close();
});

describe('createOfficeClient', () => {
  it('authenticates, connects the WS, and reaches online status', async () => {
    const statuses: string[] = [];
    const client = createOfficeClient(makeOffice(mock.port), { onStatus: (s) => statuses.push(s) });

    client.start();
    await waitFor(() => client.getStatus() === 'online');

    expect(statuses).toContain('connecting');
    expect(statuses).toContain('online');
    expect(mock.requests.some((r) => r.path === '/auth/operator')).toBe(true);

    client.stop();
  });

  it('reports auth_error and does not connect the WS when the PIN is wrong', async () => {
    const statuses: string[] = [];
    const client = createOfficeClient(makeOffice(mock.port, { operatorPin: 'wrong' }), {
      onStatus: (s) => statuses.push(s),
    });

    client.start();
    await waitFor(() => statuses.includes('auth_error'));

    expect(client.getStatus()).toBe('auth_error');
    client.stop();
  });

  it('forwards state and state_patch messages received over the WS', async () => {
    const states: AppState[] = [];
    const patches: Array<Partial<AppState>> = [];
    const client = createOfficeClient(makeOffice(mock.port), {
      onState: (s) => states.push(s),
      onStatePatch: (p) => patches.push(p),
    });

    client.start();
    await waitFor(() => client.getStatus() === 'online');

    mock.sendState(makeAppState({ currentMode: 'l3' }));
    await waitFor(() => states.length === 1);
    expect(states[0].currentMode).toBe('l3');

    mock.sendPatch({ currentMode: 'idle' });
    await waitFor(() => patches.length === 1);
    expect(patches[0]).toEqual({ currentMode: 'idle' });

    client.stop();
  });

  it('fireAction posts to /api/action with the session cookie once connected', async () => {
    const client = createOfficeClient(makeOffice(mock.port));
    client.start();
    await waitFor(() => client.getStatus() === 'online');

    const result = await client.fireAction('lower_third_apply', { name: 'Jane Doe', title: 'Speaker' });

    expect(result.ok).toBe(true);
    const actionReq = mock.requests.find((r) => r.path === '/api/action');
    expect(actionReq).toBeTruthy();
    expect(JSON.parse(actionReq!.body)).toEqual({
      action_id: 'lower_third_apply',
      params: { name: 'Jane Doe', title: 'Speaker' },
    });

    client.stop();
  });

  it('fireAction fails fast when not yet connected', async () => {
    const client = createOfficeClient(makeOffice(mock.port));
    const result = await client.fireAction('lower_third_hide');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('OFFICE_NOT_CONNECTED');
    }
  });

  it('stop() closes the socket and further status updates are suppressed', async () => {
    const statuses: string[] = [];
    const client = createOfficeClient(makeOffice(mock.port), { onStatus: (s) => statuses.push(s) });
    client.start();
    await waitFor(() => client.getStatus() === 'online');

    client.stop();
    expect(client.getStatus()).toBe('offline');

    // Give any in-flight reconnect timers a chance to fire — there should be none.
    const countAfterStop = statuses.length;
    await new Promise((r) => setTimeout(r, 200));
    expect(statuses.length).toBe(countAfterStop);
  });
});
