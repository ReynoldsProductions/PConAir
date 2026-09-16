// @vitest-environment jsdom
//
// window.PConAir.warningsPanel (spec 22 T11). Loads pconair.js raw and
// drives it through a fake Client object -- the same shape connect()
// returns -- rather than a real WebSocket, since the panel only ever reads
// client.warnings / client.onWarnings.
import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

const RUNTIME = fs.readFileSync(path.join(process.cwd(), 'src', 'runtime', 'pconair.js'), 'utf8');

function loadPConAir() {
  delete (window as unknown as Record<string, unknown>).PConAir;
  new Function(RUNTIME)();
  return (window as unknown as { PConAir: any }).PConAir;
}

/** A minimal fake Client: just enough state + subscription for the panel. */
function fakeClient(initial: Record<string, unknown[]> = {}) {
  const subs: Array<(w: Record<string, unknown[]>) => void> = [];
  const client = {
    warnings: initial,
    onWarnings(fn: (w: Record<string, unknown[]>) => void) {
      subs.push(fn);
      fn(client.warnings);
      return () => {
        const i = subs.indexOf(fn);
        if (i >= 0) subs.splice(i, 1);
      };
    },
    push(next: Record<string, unknown[]>) {
      client.warnings = next;
      for (const fn of subs) fn(next);
    },
  };
  return client;
}

describe('warningsPanel', () => {
  it('renders nothing and hides the element when there are no warnings', () => {
    const PConAir = loadPConAir();
    const el = document.createElement('div');
    const client = fakeClient({});
    PConAir.warningsPanel(el, client);
    expect(el.hidden).toBe(true);
    expect(el.innerHTML).toBe('');
  });

  it('renders the spec §3.3 sentence for one warning', () => {
    const PConAir = loadPConAir();
    const el = document.createElement('div');
    const client = fakeClient({
      l3: [{ field: 'name', text: 'Bartholomew Featherstonehaugh', naturalWidth: 738, maxWidth: 620, min: 0.62 }],
    });
    PConAir.warningsPanel(el, client);
    expect(el.hidden).toBe(false);
    expect(el.textContent).toContain(
      'name — "Bartholomew Featherstonehaugh" is 738px in a 620px box (min scale 0.62)'
    );
  });

  it('escapes text content so a warning cannot inject markup', () => {
    const PConAir = loadPConAir();
    const el = document.createElement('div');
    const client = fakeClient({
      l3: [{ field: 'name', text: '<img src=x onerror=alert(1)>', naturalWidth: 900, maxWidth: 620, min: 0.5 }],
    });
    PConAir.warningsPanel(el, client);
    expect(el.querySelector('img')).toBeNull();
    expect(el.innerHTML).toContain('&lt;img');
  });

  it('opts.renderId filters to just that render', () => {
    const PConAir = loadPConAir();
    const el = document.createElement('div');
    const client = fakeClient({
      l3: [{ field: 'name', text: 'A', naturalWidth: 900, maxWidth: 620, min: 0.5 }],
      ticker: [{ field: 'headline', text: 'B', naturalWidth: 900, maxWidth: 620, min: 0.5 }],
    });
    PConAir.warningsPanel(el, client, { renderId: 'ticker' });
    expect(el.textContent).toContain('headline');
    expect(el.textContent).not.toContain('name —');
  });

  it('updates live when the client pushes a new warning set', () => {
    const PConAir = loadPConAir();
    const el = document.createElement('div');
    const client = fakeClient({});
    PConAir.warningsPanel(el, client);
    expect(el.hidden).toBe(true);

    client.push({ l3: [{ field: 'name', text: 'A', naturalWidth: 900, maxWidth: 620, min: 0.5 }] });
    expect(el.hidden).toBe(false);

    client.push({});
    expect(el.hidden).toBe(true);
  });

  it('destroy() unsubscribes -- further pushes do not touch the element', () => {
    const PConAir = loadPConAir();
    const el = document.createElement('div');
    const client = fakeClient({});
    const handle = PConAir.warningsPanel(el, client);
    handle.destroy();
    client.push({ l3: [{ field: 'name', text: 'A', naturalWidth: 900, maxWidth: 620, min: 0.5 }] });
    expect(el.hidden).toBe(true);
    expect(el.innerHTML).toBe('');
  });
});

interface StubSocket {
  onopen: (() => void) | null;
  onmessage: ((e: { data: string }) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  readyState: number;
  send(data: string): void;
  close(): void;
  fireOpen(): void;
  fireMessage(msg: unknown): void;
}

function installStubWebSocket(): StubSocket[] {
  const sockets: StubSocket[] = [];
  function Stub(this: StubSocket) {
    this.onopen = this.onmessage = this.onclose = this.onerror = null;
    this.readyState = 0;
    this.send = () => {};
    this.close = () => { this.readyState = 3; };
    this.fireOpen = () => { this.readyState = 1; this.onopen?.(); };
    this.fireMessage = (m: unknown) => { this.onmessage?.({ data: JSON.stringify(m) }); };
    sockets.push(this);
  }
  (window as unknown as { WebSocket: unknown }).WebSocket = Stub as unknown;
  return sockets;
}

describe('client.onWarnings / client.warnings (via connect())', () => {
  it('a warnings frame updates client.warnings and notifies subscribers', () => {
    const PConAir = loadPConAir();
    const sockets = installStubWebSocket();

    const client = PConAir.connect('news', { role: 'control' });
    const seen: Array<Record<string, unknown[]>> = [];
    client.onWarnings((w: Record<string, unknown[]>) => seen.push(w));
    expect(seen).toEqual([{}]); // fired immediately with the empty starting state

    const sock = sockets[sockets.length - 1];
    sock.fireOpen();
    sock.fireMessage({
      type: 'warnings',
      namespace: 'package:news',
      renderId: 'l3',
      warnings: [{ field: 'name', text: 'X', naturalWidth: 900, maxWidth: 620, min: 0.5 }],
    });

    expect(client.warnings).toEqual({
      l3: [{ field: 'name', text: 'X', naturalWidth: 900, maxWidth: 620, min: 0.5 }],
    });
    expect(seen).toHaveLength(2);
    expect(seen[1]).toEqual(client.warnings);
  });

  it('ignores a warnings frame for a different namespace', () => {
    const PConAir = loadPConAir();
    const sockets = installStubWebSocket();

    const client = PConAir.connect('news', { role: 'control' });
    const sock = sockets[sockets.length - 1];
    sock.fireOpen();
    sock.fireMessage({ type: 'warnings', namespace: 'package:hoops', renderId: 'scorebug', warnings: [{ field: 'clock', text: 'X', naturalWidth: 1, maxWidth: 1, min: 0.5 }] });

    expect(client.warnings).toEqual({});
  });

  it('an empty warnings array clears that renderId from client.warnings', () => {
    const PConAir = loadPConAir();
    const sockets = installStubWebSocket();

    const client = PConAir.connect('news', { role: 'control' });
    const sock = sockets[sockets.length - 1];
    sock.fireOpen();
    sock.fireMessage({
      type: 'warnings', namespace: 'package:news', renderId: 'l3',
      warnings: [{ field: 'name', text: 'X', naturalWidth: 900, maxWidth: 620, min: 0.5 }],
    });
    sock.fireMessage({ type: 'warnings', namespace: 'package:news', renderId: 'l3', warnings: [] });

    expect(client.warnings).toEqual({});
  });
});
