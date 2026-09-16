// @vitest-environment jsdom
//
// Client-side half of spec 17 (Control-Page Preview): T2 (runtime forwards
// preview=1 onto the WS URL), T3 (PConAir.preview markup/scale), T4 (backdrop
// switching + persistence), T5 (setRender/reload), T6 (destroy). Split into
// its own file for the same reason tests/output-presence-client.test.ts is
// split from tests/output-presence.test.ts: this needs jsdom (a real `el` to
// mount into, `window.localStorage`) while T1 in tests/control-preview.test.ts
// is node-environment (supertest + real ws).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

/** In-memory `localStorage` stand-in. In this sandbox, Node's own
 * experimental global `localStorage` (unconfigured, no `--localstorage-file`)
 * shadows jsdom's working implementation and throws
 * `TypeError: localStorage.getItem is not a function` — see the identical
 * helper + comment in tests/operator-renderer-boot.test.ts. A real browser's
 * localStorage works normally; pconair.js's preview() also wraps every access
 * in try/catch regardless (T4's "throwing localStorage" case below), so this
 * stand-in is purely to exercise the persistence path itself. */
function createMemoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => (data.has(key) ? data.get(key)! : null),
    setItem: (key: string, value: string) => { data.set(key, String(value)); },
    removeItem: (key: string) => { data.delete(key); },
    clear: () => { data.clear(); },
    key: (index: number) => Array.from(data.keys())[index] ?? null,
    get length() { return data.size; },
  } as Storage;
}

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

describe('T3 — PConAir.preview component: markup and scale', () => {
  it('produces an iframe whose src carries scale=contain, bg=checker and preview=1, scaled and sized to width', () => {
    const PConAir = loadRuntime();
    const el = document.createElement('div');
    document.body.appendChild(el);

    PConAir.preview(el, { packageId: 'p', renderId: 'r', width: 480 });

    const root = el.querySelector('.pc-preview') as HTMLElement;
    expect(root).toBeTruthy();
    expect(root.getAttribute('data-backdrop')).toBe('checker');

    const iframe = el.querySelector('.pc-preview-frame') as HTMLIFrameElement;
    expect(iframe).toBeTruthy();
    expect(iframe.getAttribute('src')).toContain('scale=contain');
    expect(iframe.getAttribute('src')).toContain('bg=checker');
    expect(iframe.getAttribute('src')).toContain('preview=1');
    expect(iframe.getAttribute('src')).toContain('/packages/p/render/r');
    expect(iframe.style.transform).toBe('scale(0.25)');

    const viewport = el.querySelector('.pc-preview-viewport') as HTMLElement;
    expect(viewport).toBeTruthy();
    expect(viewport.style.width).toBe('480px');
    expect(viewport.style.height).toBe('270px');
  });

  it('defaults to width 480 when not given', () => {
    const PConAir = loadRuntime();
    const el = document.createElement('div');
    PConAir.preview(el, { packageId: 'p', renderId: 'r' });
    const iframe = el.querySelector('.pc-preview-frame') as HTMLIFrameElement;
    expect(iframe.style.transform).toBe('scale(0.25)');
  });
});

describe('T4 — backdrop switching + persistence', () => {
  const originalLocalStorage = window.localStorage;

  beforeEach(() => {
    Object.defineProperty(window, 'localStorage', {
      value: createMemoryStorage(),
      configurable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(window, 'localStorage', {
      value: originalLocalStorage,
      configurable: true,
    });
  });

  it('setBackdrop updates data-backdrop, the iframe src bg param, and localStorage', () => {
    const PConAir = loadRuntime();
    const el = document.createElement('div');
    const handle = PConAir.preview(el, { packageId: 'p', renderId: 'r', width: 480 });

    handle.setBackdrop('green');

    const root = el.querySelector('.pc-preview') as HTMLElement;
    expect(root.getAttribute('data-backdrop')).toBe('green');
    const iframe = el.querySelector('.pc-preview-frame') as HTMLIFrameElement;
    expect(iframe.getAttribute('src')).toContain('bg=green');
    expect(window.localStorage.getItem('pconair.preview.backdrop')).toBe('green');
  });

  it('a fresh mount (no explicit backdrop opt) reads the persisted choice back', () => {
    const PConAir = loadRuntime();
    const el1 = document.createElement('div');
    const handle1 = PConAir.preview(el1, { packageId: 'p', renderId: 'r', width: 480 });
    handle1.setBackdrop('black');

    const el2 = document.createElement('div');
    PConAir.preview(el2, { packageId: 'p', renderId: 'r', width: 480 });
    const root2 = el2.querySelector('.pc-preview') as HTMLElement;
    expect(root2.getAttribute('data-backdrop')).toBe('black');
    const iframe2 = el2.querySelector('.pc-preview-frame') as HTMLIFrameElement;
    expect(iframe2.getAttribute('src')).toContain('bg=black');
  });

  it('a throwing localStorage still mounts, defaulting to checker', () => {
    const original = window.localStorage;
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() { throw new Error('storage disabled'); },
    });
    try {
      const PConAir = loadRuntime();
      const el = document.createElement('div');
      const handle = PConAir.preview(el, { packageId: 'p', renderId: 'r', width: 480 });
      const root = el.querySelector('.pc-preview') as HTMLElement;
      expect(root.getAttribute('data-backdrop')).toBe('checker');
      // setBackdrop must not throw even though storage is unusable
      expect(() => handle.setBackdrop('white')).not.toThrow();
      expect(root.getAttribute('data-backdrop')).toBe('white');
    } finally {
      Object.defineProperty(window, 'localStorage', { configurable: true, value: original });
    }
  });
});

describe('T5 — setRender and reload', () => {
  it('setRender swaps only the render segment and preserves the backdrop', () => {
    const PConAir = loadRuntime();
    const el = document.createElement('div');
    const handle = PConAir.preview(el, { packageId: 'p', renderId: 'r', width: 480 });
    handle.setBackdrop('green');

    handle.setRender('other');

    const iframe = el.querySelector('.pc-preview-frame') as HTMLIFrameElement;
    expect(iframe.getAttribute('src')).toContain('/packages/p/render/other');
    expect(iframe.getAttribute('src')).toContain('bg=green');
  });

  it('reload() changes only a cache-busting param', () => {
    const PConAir = loadRuntime();
    const el = document.createElement('div');
    const handle = PConAir.preview(el, { packageId: 'p', renderId: 'r', width: 480 });
    const iframe = el.querySelector('.pc-preview-frame') as HTMLIFrameElement;
    const before = iframe.getAttribute('src') || '';

    handle.reload();
    const after = iframe.getAttribute('src') || '';

    expect(after).not.toBe(before);
    const stripBust = (s: string) => s.replace(/[&?]_=[^&]*/, '');
    expect(stripBust(after)).toBe(stripBust(before));
  });
});

describe('T6 — destroy', () => {
  it('removes the DOM, unsubscribes the presence indicator, and leaves no pending timers', () => {
    vi.useFakeTimers();
    try {
      const PConAir = loadRuntime();
      const el = document.createElement('div');
      document.body.appendChild(el);
      const handle = PConAir.preview(el, { packageId: 'p', renderId: 'r', width: 480 });

      last().fireOpen();
      last().fireMessage({ type: 'presence', namespace: 'package:p', presence: { renders: 1, byRender: { r: 1 }, controls: 0 } });

      expect(el.querySelector('.pc-preview')).toBeTruthy();
      const presenceEl = el.querySelector('.pc-preview-presence') as HTMLElement;
      expect(presenceEl.textContent).toBe('1 output');

      handle.destroy();

      expect(el.querySelector('.pc-preview')).toBeNull();

      // Further presence frames must not touch anything — there is nothing
      // left mounted to update, and the socket itself is closed.
      expect(last().readyState).toBe(3);

      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
