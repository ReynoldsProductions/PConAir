// @vitest-environment jsdom
//
// Render-side half of spec 15 (T10/T11). Split from tests/graphics-transport.test.ts
// for the same reason tests/package-runtime-client.test.ts was split from
// tests/package-runtime.test.ts in spec 14: that file is node-environment
// (supertest + real ws + vitest fake timers over a real engine) and vitest
// picks one environment per file.
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
  window.history.replaceState({}, '', '/packages/p/render/card');
  document.documentElement.removeAttribute('data-phase');
  document.documentElement.removeAttribute('data-step');
  document.documentElement.removeAttribute('data-phase-jump');
  document.documentElement.style.removeProperty('--pc-phase-ms');
});

afterEach(() => { vi.useRealTimers(); });

describe('T10 — runtime drives data-phase/data-step/--pc-phase-ms', () => {
  it('sets the attributes from a transport frame for this renderId', () => {
    const PConAir = loadRuntime();
    const c = PConAir.connect('txp', { role: 'render', renderId: 'card' });
    last().fireOpen();
    last().fireMessage({
      type: 'state',
      namespace: 'package:txp',
      state: { _transport: { card: { phase: 'holding', step: 1, stops: 2, phaseStartedAt: Date.now(), phaseMs: 350 } } },
    });

    expect(document.documentElement.getAttribute('data-phase')).toBe('holding');
    expect(document.documentElement.getAttribute('data-step')).toBe('1');
    expect(document.documentElement.style.getPropertyValue('--pc-phase-ms')).toBe('350');
    expect(c.transport).toMatchObject({ phase: 'holding', step: 1 });
  });

  it('clears the attributes when the render is not transport-managed (no _transport entry)', () => {
    const PConAir = loadRuntime();
    const c = PConAir.connect('hoops', { role: 'render', renderId: 'scorebug' });
    last().fireOpen();
    last().fireMessage({ type: 'state', namespace: 'package:hoops', state: { scoreA: 3 } });

    expect(document.documentElement.hasAttribute('data-phase')).toBe(false);
    expect(c.transport).toBeNull();
  });

  it('onTransport subscribes and fires on each transport frame', () => {
    const PConAir = loadRuntime();
    const c = PConAir.connect('txp', { role: 'render', renderId: 'card' });
    const seen: unknown[] = [];
    c.onTransport((t: unknown) => seen.push(t));
    last().fireOpen();
    last().fireMessage({
      type: 'state',
      namespace: 'package:txp',
      state: { _transport: { card: { phase: 'playing-in', step: 0, stops: 2, phaseStartedAt: Date.now(), phaseMs: 500 } } },
    });
    expect(seen).toHaveLength(1);
    expect((seen[0] as { phase: string }).phase).toBe('playing-in');
  });
});
