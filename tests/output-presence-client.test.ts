// @vitest-environment jsdom
//
// Client-side half of spec 16 (T8): presence on window.PConAir.connect's
// Client, and the drop-in window.PConAir.presenceIndicator(el, client, opts)
// helper. Split into its own file for the same reason
// tests/package-runtime-client.test.ts is split from tests/package-runtime.test.ts:
// this needs the jsdom environment (a real `el` to render into) while the rest
// of tests/output-presence.test.ts is node-environment (supertest + real ws).
import { describe, it, expect, beforeEach, vi } from 'vitest';
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
  window.history.replaceState({}, '', '/packages/p/render/main');
});

describe('PConAir.connect — presence (T8)', () => {
  it('client.presence starts null and updates when a presence frame for this namespace arrives', () => {
    const PConAir = loadRuntime();
    const c = PConAir.connect('hoops', { role: 'control' });
    expect(c.presence).toBeNull();
    last().fireOpen();
    last().fireMessage({ type: 'presence', namespace: 'package:hoops', presence: { renders: 2, byRender: { main: 2 }, controls: 1 } });
    expect(c.presence).toEqual({ renders: 2, byRender: { main: 2 }, controls: 1 });
  });

  it('ignores presence frames for another package namespace', () => {
    const PConAir = loadRuntime();
    const c = PConAir.connect('hoops', { role: 'control' });
    last().fireOpen();
    last().fireMessage({ type: 'presence', namespace: 'package:news', presence: { renders: 5, byRender: {}, controls: 0 } });
    expect(c.presence).toBeNull();
  });

  it('client.onPresence fires on each frame and immediately when presence is already known', () => {
    const PConAir = loadRuntime();
    const c = PConAir.connect('hoops', { role: 'control' });
    last().fireOpen();
    last().fireMessage({ type: 'presence', namespace: 'package:hoops', presence: { renders: 1, byRender: { main: 1 }, controls: 0 } });

    const seen: unknown[] = [];
    const off = c.onPresence((p: unknown) => seen.push(p));
    expect(seen).toEqual([{ renders: 1, byRender: { main: 1 }, controls: 0 }]);

    last().fireMessage({ type: 'presence', namespace: 'package:hoops', presence: { renders: 0, byRender: {}, controls: 0 } });
    expect(seen).toEqual([
      { renders: 1, byRender: { main: 1 }, controls: 0 },
      { renders: 0, byRender: {}, controls: 0 },
    ]);

    off();
    last().fireMessage({ type: 'presence', namespace: 'package:hoops', presence: { renders: 3, byRender: {}, controls: 0 } });
    expect(seen).toHaveLength(2); // unsubscribed — no third entry
  });
});

describe('PConAir.presenceIndicator (T8)', () => {
  it('renders "no output connected" with data-presence="none" before any frame arrives', () => {
    const PConAir = loadRuntime();
    const c = PConAir.connect('hoops', { role: 'control' });
    const el = document.createElement('div');
    PConAir.presenceIndicator(el, c);
    expect(el.getAttribute('data-presence')).toBe('none');
    expect(el.textContent).toBe('no output connected');
  });

  it('renders "1 output" / data-presence="ok" at one, and "N outputs" at N', () => {
    const PConAir = loadRuntime();
    const c = PConAir.connect('hoops', { role: 'control' });
    const el = document.createElement('div');
    PConAir.presenceIndicator(el, c);
    last().fireOpen();

    last().fireMessage({ type: 'presence', namespace: 'package:hoops', presence: { renders: 1, byRender: { main: 1 }, controls: 0 } });
    expect(el.getAttribute('data-presence')).toBe('ok');
    expect(el.textContent).toBe('1 output');

    last().fireMessage({ type: 'presence', namespace: 'package:hoops', presence: { renders: 3, byRender: { main: 2, alt: 1 }, controls: 0 } });
    expect(el.getAttribute('data-presence')).toBe('ok');
    expect(el.textContent).toBe('3 outputs');

    last().fireMessage({ type: 'presence', namespace: 'package:hoops', presence: { renders: 0, byRender: {}, controls: 0 } });
    expect(el.getAttribute('data-presence')).toBe('none');
    expect(el.textContent).toBe('no output connected');
  });

  it('opts.renderId narrows the count to that render only', () => {
    const PConAir = loadRuntime();
    const c = PConAir.connect('hoops', { role: 'control' });
    const el = document.createElement('div');
    PConAir.presenceIndicator(el, c, { renderId: 'main' });
    last().fireOpen();

    // two total outputs, but only one is 'main' — the other is 'alt'
    last().fireMessage({ type: 'presence', namespace: 'package:hoops', presence: { renders: 2, byRender: { main: 1, alt: 1 }, controls: 0 } });
    expect(el.textContent).toBe('1 output');
    expect(el.getAttribute('data-presence')).toBe('ok');

    last().fireMessage({ type: 'presence', namespace: 'package:hoops', presence: { renders: 1, byRender: { alt: 1 }, controls: 0 } });
    expect(el.textContent).toBe('no output connected');
    expect(el.getAttribute('data-presence')).toBe('none');
  });

  it('destroy() unsubscribes so further frames do not update the element', () => {
    const PConAir = loadRuntime();
    const c = PConAir.connect('hoops', { role: 'control' });
    const el = document.createElement('div');
    const handle = PConAir.presenceIndicator(el, c);
    last().fireOpen();
    last().fireMessage({ type: 'presence', namespace: 'package:hoops', presence: { renders: 1, byRender: { main: 1 }, controls: 0 } });
    expect(el.textContent).toBe('1 output');

    handle.destroy();
    last().fireMessage({ type: 'presence', namespace: 'package:hoops', presence: { renders: 5, byRender: {}, controls: 0 } });
    expect(el.textContent).toBe('1 output'); // unchanged
  });
});
