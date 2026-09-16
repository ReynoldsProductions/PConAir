// @vitest-environment jsdom
//
// Client-side debug overlay from spec 21. Tests the overlay behavior,
// keyboard verbs, warnings channel, and FPS measurement.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

const RUNTIME = fs.readFileSync(path.join(process.cwd(), 'src', 'runtime', 'pconair.js'), 'utf8');
const DEBUG_CODE = fs.readFileSync(path.join(process.cwd(), 'src', 'runtime', 'pconair-debug.js'), 'utf8');

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
  new Function(RUNTIME)();
  return (window as unknown as { PConAir: any }).PConAir;
}

function last(): StubSocket { return sockets[sockets.length - 1]; }

beforeEach(() => {
  installStubWebSocket();
  window.history.replaceState({}, '', '/packages/p/render/main');
  document.head.innerHTML = '';
  document.body.innerHTML = '';
});

afterEach(() => { vi.useRealTimers(); });

describe('T1 — Conditional load', () => {
  it('with no debug params, no pconair-debug.js script tag is injected', () => {
    window.history.replaceState({}, '', '/packages/p/render/main');
    const PConAir = loadRuntime();
    PConAir.connect('hoops', { role: 'render', renderId: 'main' });
    const scripts = Array.from(document.querySelectorAll('script[src*="pconair-debug"]'));
    expect(scripts).toHaveLength(0);
  });

  it('with ?debug=1, a pconair-debug.js script tag is injected', () => {
    window.history.replaceState({}, '', '/packages/p/render/main?debug=1');
    const PConAir = loadRuntime();
    PConAir.connect('hoops', { role: 'render', renderId: 'main' });
    const scripts = Array.from(document.querySelectorAll('script[src*="pconair-debug"]'));
    expect(scripts).toHaveLength(1);
    expect((scripts[0] as HTMLScriptElement).src).toContain('pconair-debug.js');
  });

  it('with ?scale=contain, a pconair-debug.js script tag is injected', () => {
    window.history.replaceState({}, '', '/packages/p/render/main?scale=contain');
    const PConAir = loadRuntime();
    PConAir.connect('hoops', { role: 'render', renderId: 'main' });
    const scripts = Array.from(document.querySelectorAll('script[src*="pconair-debug"]'));
    expect(scripts).toHaveLength(1);
  });

  it('with ?bg=checker, a pconair-debug.js script tag is injected', () => {
    window.history.replaceState({}, '', '/packages/p/render/main?bg=checker');
    const PConAir = loadRuntime();
    PConAir.connect('hoops', { role: 'render', renderId: 'main' });
    const scripts = Array.from(document.querySelectorAll('script[src*="pconair-debug"]'));
    expect(scripts).toHaveLength(1);
  });

  it('with ?bg=%23008000, a pconair-debug.js script tag is injected', () => {
    window.history.replaceState({}, '', '/packages/p/render/main?bg=%23008000');
    const PConAir = loadRuntime();
    PConAir.connect('hoops', { role: 'render', renderId: 'main' });
    const scripts = Array.from(document.querySelectorAll('script[src*="pconair-debug"]'));
    expect(scripts).toHaveLength(1);
  });
});
