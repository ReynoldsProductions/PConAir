// @vitest-environment jsdom
//
// Client-side half of spec 14. Split from tests/package-runtime.test.ts because
// that file is node-environment (supertest + real ws) and vitest picks one
// environment per file.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

const SRC = fs.readFileSync(path.join(process.cwd(), 'src', 'runtime', 'pconair.js'), 'utf8');

interface StubSocket {
  url: string;
  sent: string[];
  readyState: number;
  onopen: (() => void) | null;
  onmessage: ((e: { data: string }) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  send(data: string): void;
  close(): void;
  /** test helpers */
  fireOpen(): void;
  fireMessage(msg: unknown): void;
  fireClose(): void;
}

let sockets: StubSocket[] = [];

function installStubWebSocket() {
  sockets = [];
  function Stub(this: StubSocket, url: string) {
    this.url = url;
    this.sent = [];
    this.readyState = 0;
    this.onopen = this.onmessage = this.onclose = this.onerror = null;
    this.send = (d: string) => { this.sent.push(d); };
    this.close = () => { this.readyState = 3; };
    this.fireOpen = () => { this.readyState = 1; this.onopen?.(); };
    this.fireMessage = (m: unknown) => { this.onmessage?.({ data: JSON.stringify(m) }); };
    this.fireClose = () => { this.readyState = 3; this.onclose?.(); };
    sockets.push(this);
  }
  (window as unknown as { WebSocket: unknown }).WebSocket = Stub as unknown;
}

function loadRuntime() {
  delete (window as unknown as Record<string, unknown>).PConAir;
  new Function(SRC)();
  return (window as unknown as { PConAir: any }).PConAir;
}

function last(): StubSocket { return sockets[sockets.length - 1]; }

beforeEach(() => {
  installStubWebSocket();
  window.history.replaceState({}, '', '/packages/p/render/main');
});

afterEach(() => { vi.useRealTimers(); });

describe('PConAir.connect — subscribe and state frames', () => {
  it('sends the namespace subscribe frame on open', () => {
    const PConAir = loadRuntime();
    PConAir.connect('hoops', { role: 'render', renderId: 'main' });
    last().fireOpen();
    expect(JSON.parse(last().sent[0])).toEqual({ type: 'subscribe', namespace: 'package:hoops' });
  });

  it('uses ?render=1 and carries renderId for a render page', () => {
    const PConAir = loadRuntime();
    PConAir.connect('hoops', { role: 'render', renderId: 'main' });
    expect(last().url).toContain('render=1');
    expect(last().url).toContain('renderId=main');
  });

  it('uses ?control=1 for a control page and sends no renderId', () => {
    const PConAir = loadRuntime();
    PConAir.connect('hoops', { role: 'control' });
    expect(last().url).toContain('control=1');
    expect(last().url).not.toContain('render=1');
    expect(last().url).not.toContain('renderId');
  });

  it('dispatches matching namespace frames', () => {
    const PConAir = loadRuntime();
    const c = PConAir.connect('hoops', { role: 'render' });
    const seen: unknown[] = [];
    c.on((s: unknown) => seen.push(s));
    last().fireOpen();
    last().fireMessage({ type: 'state', namespace: 'package:hoops', state: { scoreA: 3 } });
    expect(seen).toEqual([{ scoreA: 3 }]);
    expect(c.state).toEqual({ scoreA: 3 });
  });

  it('ignores the initial AppState snapshot, which uses payload not state', () => {
    const PConAir = loadRuntime();
    const c = PConAir.connect('hoops', { role: 'render' });
    last().fireOpen();
    last().fireMessage({ type: 'state', payload: { currentMode: 'idle' } });
    expect(c.state).toBeNull();
  });

  it('ignores frames for another package namespace', () => {
    const PConAir = loadRuntime();
    const c = PConAir.connect('hoops', { role: 'render' });
    last().fireOpen();
    last().fireMessage({ type: 'state', namespace: 'package:news', state: { x: 1 } });
    expect(c.state).toBeNull();
  });

  it('fires on() immediately when state is already known', () => {
    const PConAir = loadRuntime();
    const c = PConAir.connect('hoops', { role: 'render' });
    last().fireOpen();
    last().fireMessage({ type: 'state', namespace: 'package:hoops', state: { a: 1 } });
    const seen: unknown[] = [];
    c.on((s: unknown) => seen.push(s));
    expect(seen).toEqual([{ a: 1 }]);
  });

  it('unsubscribes cleanly', () => {
    const PConAir = loadRuntime();
    const c = PConAir.connect('hoops', { role: 'render' });
    const seen: unknown[] = [];
    const off = c.on((s: unknown) => seen.push(s));
    last().fireOpen();
    off();
    last().fireMessage({ type: 'state', namespace: 'package:hoops', state: { a: 1 } });
    expect(seen).toEqual([]);
  });
});

describe('PConAir.connect — reconnect backoff', () => {
  it('widens the gap 1s, 2s, 4s, 8s, 15s, 15s', () => {
    vi.useFakeTimers();
    const PConAir = loadRuntime();
    PConAir.connect('hoops', { role: 'render' });
    const expected = [1000, 2000, 4000, 8000, 15000, 15000];
    for (let i = 0; i < expected.length; i++) {
      const before = sockets.length;
      last().fireClose();
      vi.advanceTimersByTime(expected[i] - 1);
      expect(sockets.length, `retry ${i} fired early`).toBe(before);
      vi.advanceTimersByTime(1);
      expect(sockets.length, `retry ${i} did not fire at ${expected[i]}ms`).toBe(before + 1);
    }
  });

  it('resets the delay to 1s after a successful open', () => {
    vi.useFakeTimers();
    const PConAir = loadRuntime();
    PConAir.connect('hoops', { role: 'render' });
    last().fireClose();
    vi.advanceTimersByTime(1000);
    last().fireClose();
    vi.advanceTimersByTime(2000);
    // third socket opens successfully -> next delay is back to 1s
    last().fireOpen();
    const before = sockets.length;
    last().fireClose();
    vi.advanceTimersByTime(1000);
    expect(sockets.length).toBe(before + 1);
  });

  it('close() stops the page reconnecting', () => {
    vi.useFakeTimers();
    const PConAir = loadRuntime();
    const c = PConAir.connect('hoops', { role: 'render' });
    c.close();
    last().fireClose();
    const before = sockets.length;
    vi.advanceTimersByTime(60000);
    expect(sockets.length).toBe(before);
  });
});

describe('PConAir.connect — connection state', () => {
  it('tracks connected across the open/close edges', () => {
    const PConAir = loadRuntime();
    const c = PConAir.connect('hoops', { role: 'render' });
    expect(c.connected).toBe(false);
    last().fireOpen();
    expect(c.connected).toBe(true);
    last().fireClose();
    expect(c.connected).toBe(false);
  });

  it('notifies onConnection on each edge and honours unsubscribe', () => {
    vi.useFakeTimers();
    const PConAir = loadRuntime();
    const c = PConAir.connect('hoops', { role: 'render' });
    const edges: boolean[] = [];
    const off = c.onConnection((v: boolean) => edges.push(v));
    last().fireOpen();
    last().fireClose();
    expect(edges).toEqual([true, false]);
    off();
    vi.advanceTimersByTime(1000);
    last().fireOpen();
    expect(edges).toEqual([true, false]);
  });
});

describe('PConAir client.patch', () => {
  it('resolves to the parsed response body', async () => {
    const PConAir = loadRuntime();
    (window as unknown as { fetch: unknown }).fetch = vi.fn().mockResolvedValue({
      ok: true, status: 200, text: () => Promise.resolve(JSON.stringify({ state: { a: 1 }, delivered: 2 })),
    });
    const c = PConAir.connect('hoops', { role: 'control' });
    await expect(c.patch({ a: 1 })).resolves.toEqual({ state: { a: 1 }, delivered: 2 });
  });

  it('POSTs JSON to the package state route', async () => {
    const PConAir = loadRuntime();
    const spy = vi.fn().mockResolvedValue({ ok: true, status: 200, text: () => Promise.resolve('{}') });
    (window as unknown as { fetch: unknown }).fetch = spy;
    const c = PConAir.connect('hoops', { role: 'control' });
    await c.patch({ scoreA: 5 });
    expect(spy).toHaveBeenCalledWith('/api/packages/hoops/state', expect.objectContaining({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scoreA: 5 }),
    }));
  });

  it('rejects on a non-2xx, surfacing the envelope message', async () => {
    const PConAir = loadRuntime();
    (window as unknown as { fetch: unknown }).fetch = vi.fn().mockResolvedValue({
      ok: false, status: 404,
      text: () => Promise.resolve(JSON.stringify({ error: { code: 'ITEM_NOT_FOUND', message: "Package 'nope' not found" } })),
    });
    const c = PConAir.connect('nope', { role: 'control' });
    await expect(c.patch({ a: 1 })).rejects.toThrow("Package 'nope' not found");
  });

  it('rejects with the status when the body is not JSON', async () => {
    const PConAir = loadRuntime();
    (window as unknown as { fetch: unknown }).fetch = vi.fn().mockResolvedValue({
      ok: false, status: 500, text: () => Promise.resolve('Internal Server Error'),
    });
    const c = PConAir.connect('hoops', { role: 'control' });
    await expect(c.patch({ a: 1 })).rejects.toThrow(/500/);
  });
});

describe('PConAir helpers', () => {
  it('param reads the page query with a fallback', () => {
    window.history.replaceState({}, '', '/x?theme=dark');
    const PConAir = loadRuntime();
    expect(PConAir.param('theme', 'light')).toBe('dark');
    expect(PConAir.param('missing', 'light')).toBe('light');
  });

  it('isDebug follows ?debug=1', () => {
    window.history.replaceState({}, '', '/x?debug=1');
    expect(loadRuntime().isDebug()).toBe(true);
    window.history.replaceState({}, '', '/x');
    expect(loadRuntime().isDebug()).toBe(false);
  });

  it('exposes _diagSource for spec 21 to sample', () => {
    const PConAir = loadRuntime();
    PConAir._diagSource('transport', () => 'holding');
    expect(PConAir._diagSources.transport()).toBe('holding');
  });

  it('keeps a PConAirPackage shim for third-party pages', () => {
    loadRuntime();
    const shim = (window as unknown as { PConAirPackage: any }).PConAirPackage;
    const seen: unknown[] = [];
    const c = shim.connect('hoops', (s: unknown) => seen.push(s));
    last().fireOpen();
    last().fireMessage({ type: 'state', namespace: 'package:hoops', state: { a: 1 } });
    expect(seen).toEqual([{ a: 1 }]);
    expect(typeof c.patch).toBe('function');
    expect(typeof c.close).toBe('function');
  });
});
