// @vitest-environment jsdom
//
// Client-side half of spec 17 (Control-Page Preview): T2 (runtime forwards
// preview=1 onto the WS URL). Split into its own file for the same reason
// tests/output-presence-client.test.ts is split from tests/output-presence.test.ts:
// this needs jsdom (a real `el` to mount into) while T1 in
// tests/control-preview.test.ts is node-environment (supertest + real ws).
// T3-T6's tests for PConAir.preview() itself are appended in a later commit.
import { describe, it, expect, beforeEach } from 'vitest';
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

describe('T2 — runtime forwards preview=1 onto the WS URL', () => {
  it('a page loaded with ?preview=1 opens a WS whose URL contains preview=1', () => {
    window.history.replaceState({}, '', '/packages/p/render/main?preview=1');
    const PConAir = loadRuntime();
    PConAir.connect('hoops', { renderId: 'main' });
    expect(last().url).toContain('preview=1');
  });

  it('without ?preview=1 the WS URL does not contain preview=1', () => {
    window.history.replaceState({}, '', '/packages/p/render/main');
    const PConAir = loadRuntime();
    PConAir.connect('hoops', { renderId: 'main' });
    expect(last().url).not.toContain('preview=1');
  });

  it('forwards preview=1 for a control-role connection too', () => {
    window.history.replaceState({}, '', '/packages/p/control?preview=1');
    const PConAir = loadRuntime();
    PConAir.connect('hoops', { role: 'control' });
    expect(last().url).toContain('preview=1');
  });
});
