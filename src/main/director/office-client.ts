import { WebSocket } from 'ws';
import type { DirectorOffice } from '../app-settings';
import type { AppState, WsServerMessage } from '../../shared/types';

/**
 * Talks the same HTTP/WS action protocol every other PConAir surface uses
 * (operator UI, remote, Companion) to a single *remote* PConAir instance —
 * from Node (Electron main), not from a browser, so there's no CORS/frame
 * concern. Pure Node module, no Electron imports, testable standalone
 * (same philosophy as services/backup-fanout.ts).
 */

export type OfficeConnectionStatus = 'connecting' | 'online' | 'offline' | 'auth_error';

export type OfficeActionResult =
  | { ok: true; body: unknown }
  | { ok: false; status: number; error: { code: string; message: string } };

export interface OfficeClientEvents {
  onStatus?: (status: OfficeConnectionStatus) => void;
  onState?: (state: AppState) => void;
  onStatePatch?: (patch: Partial<AppState>) => void;
}

export interface OfficeClient {
  start(): void;
  stop(): void;
  getStatus(): OfficeConnectionStatus;
  fireAction(actionId: string, params?: Record<string, unknown>): Promise<OfficeActionResult>;
}

const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30000;

class OfficeAuthError extends Error {}

function wsUrl(baseUrl: string): string {
  const u = new URL('/ws', baseUrl);
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
  return u.toString();
}

/** Node's fetch (undici) exposes multi-value Set-Cookie via getSetCookie(); fall back to the single-header form for other runtimes/mocks. */
function extractSetCookies(headers: Headers): string[] {
  const withGetSetCookie = headers as Headers & { getSetCookie?: () => string[] };
  if (typeof withGetSetCookie.getSetCookie === 'function') {
    return withGetSetCookie.getSetCookie();
  }
  const single = headers.get('set-cookie');
  return single ? [single] : [];
}

function extractSessionCookie(headers: Headers): string | null {
  for (const raw of extractSetCookies(headers)) {
    const match = /pconair_operator_session=([^;]+)/.exec(raw);
    if (match) return `pconair_operator_session=${match[1]}`;
  }
  return null;
}

async function authenticate(office: DirectorOffice): Promise<string> {
  let res: Response;
  try {
    res = await fetch(new URL('/auth/operator', office.baseUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: office.operatorPin }),
    });
  } catch (err) {
    throw new Error(`network error contacting ${office.baseUrl}: ${(err as Error).message}`);
  }
  if (res.status === 401 || res.status === 400) {
    throw new OfficeAuthError(`operator PIN rejected by ${office.baseUrl} (${res.status})`);
  }
  if (!res.ok) {
    throw new Error(`unexpected status ${res.status} authenticating with ${office.baseUrl}`);
  }
  const cookie = extractSessionCookie(res.headers);
  if (!cookie) {
    throw new OfficeAuthError(`no session cookie returned by ${office.baseUrl}`);
  }
  return cookie;
}

async function postAction(
  office: DirectorOffice,
  cookie: string,
  actionId: string,
  params: Record<string, unknown>
): Promise<OfficeActionResult> {
  let res: Response;
  try {
    res = await fetch(new URL('/api/action', office.baseUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ action_id: actionId, params }),
    });
  } catch (err) {
    return {
      ok: false,
      status: 502,
      error: { code: 'OFFICE_UNREACHABLE', message: `Could not reach ${office.name}: ${(err as Error).message}` },
    };
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const body = json as { error?: { code?: string; message?: string } };
    return {
      ok: false,
      status: res.status,
      error: {
        code: body.error?.code ?? 'UNKNOWN_ERROR',
        message: body.error?.message ?? `Request to ${office.name} failed (${res.status})`,
      },
    };
  }
  return { ok: true, body: json };
}

export function createOfficeClient(office: DirectorOffice, events: OfficeClientEvents = {}): OfficeClient {
  let status: OfficeConnectionStatus = 'offline';
  let cookie: string | null = null;
  let socket: WebSocket | null = null;
  let stopped = true;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let backoffMs = INITIAL_BACKOFF_MS;

  function setStatus(next: OfficeConnectionStatus): void {
    if (status === next) return;
    status = next;
    events.onStatus?.(next);
  }

  function scheduleReconnect(): void {
    if (stopped || reconnectTimer) return;
    const delay = backoffMs;
    backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void connectOnce();
    }, delay);
  }

  async function connectOnce(): Promise<void> {
    if (stopped) return;
    setStatus('connecting');
    try {
      cookie = await authenticate(office);
    } catch (err) {
      cookie = null;
      setStatus(err instanceof OfficeAuthError ? 'auth_error' : 'offline');
      scheduleReconnect();
      return;
    }
    if (stopped) return;

    const ws = new WebSocket(wsUrl(office.baseUrl), { headers: { Cookie: cookie } });
    socket = ws;

    ws.on('open', () => {
      backoffMs = INITIAL_BACKOFF_MS;
      setStatus('online');
    });

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(String(raw)) as WsServerMessage;
        if (msg.type === 'state') events.onState?.(msg.payload);
        else if (msg.type === 'state_patch') events.onStatePatch?.(msg.payload);
      } catch {
        /* ignore malformed frames */
      }
    });

    ws.on('close', () => {
      if (socket === ws) socket = null;
      if (stopped) return;
      setStatus('offline');
      scheduleReconnect();
    });

    ws.on('error', () => {
      /* 'close' always follows 'error' on ws — reconnect handled there */
    });
  }

  return {
    start(): void {
      if (!stopped) return;
      stopped = false;
      backoffMs = INITIAL_BACKOFF_MS;
      void connectOnce();
    },
    stop(): void {
      stopped = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      socket?.terminate();
      socket = null;
      cookie = null;
      setStatus('offline');
    },
    getStatus(): OfficeConnectionStatus {
      return status;
    },
    async fireAction(actionId: string, params: Record<string, unknown> = {}): Promise<OfficeActionResult> {
      if (!cookie) {
        return {
          ok: false,
          status: 409,
          error: { code: 'OFFICE_NOT_CONNECTED', message: `Not connected to ${office.name}` },
        };
      }
      return postAction(office, cookie, actionId, params);
    },
  };
}
