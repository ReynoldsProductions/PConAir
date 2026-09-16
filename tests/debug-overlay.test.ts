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

function loadDebugModule() {
  new Function(DEBUG_CODE)();
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

describe('T2 — Scaling', () => {
  it('at 960×540 viewport with ?scale=contain, the wrapper has scale(0.5)', () => {
    window.history.replaceState({}, '', '/packages/p/render/main?scale=contain');
    vi.stubGlobal('innerWidth', 960);
    vi.stubGlobal('innerHeight', 540);
    const PConAir = loadRuntime();
    loadDebugModule();
    const wrapper = document.querySelector('.pc-stage-scale');
    expect(wrapper).toBeTruthy();
    const style = window.getComputedStyle(wrapper as Element);
    expect(style.transform).toContain('scale(0.5)');
    expect(style.transformOrigin).toContain('left');
  });

  it('at 1920×600 viewport with ?scale=contain, the wrapper is height-bound with scale(0.555)', () => {
    window.history.replaceState({}, '', '/packages/p/render/main?scale=contain');
    vi.stubGlobal('innerWidth', 1920);
    vi.stubGlobal('innerHeight', 600);
    const PConAir = loadRuntime();
    loadDebugModule();
    const wrapper = document.querySelector('.pc-stage-scale');
    expect(wrapper).toBeTruthy();
    const style = window.getComputedStyle(wrapper as Element);
    const match = style.transform.match(/scale\(([0-9.]+)\)/);
    expect(match).toBeTruthy();
    const scale = parseFloat(match![1]);
    expect(scale).toBeCloseTo(0.5555, 3);
  });

  it('recomputes scale on resize', async () => {
    window.history.replaceState({}, '', '/packages/p/render/main?scale=contain');
    vi.stubGlobal('innerWidth', 960);
    vi.stubGlobal('innerHeight', 540);
    const PConAir = loadRuntime();
    loadDebugModule();
    let wrapper = document.querySelector('.pc-stage-scale');
    let style = window.getComputedStyle(wrapper as Element);
    let match = style.transform.match(/scale\(([0-9.]+)\)/);
    let scale1 = parseFloat(match![1]);
    
    // Simulate resize
    vi.stubGlobal('innerWidth', 1920);
    vi.stubGlobal('innerHeight', 1080);
    window.dispatchEvent(new Event('resize'));
    
    await new Promise(resolve => setTimeout(resolve, 10));
    
    wrapper = document.querySelector('.pc-stage-scale');
    style = window.getComputedStyle(wrapper as Element);
    match = style.transform.match(/scale\(([0-9.]+)\)/);
    let scale2 = parseFloat(match![1]);
    
    expect(scale2).not.toBe(scale1);
    expect(scale2).toBeCloseTo(1, 3);
  });
});

describe('T3 — Backgrounds', () => {
  it('bg=checker adds .pc-bg-checker class', () => {
    window.history.replaceState({}, '', '/packages/p/render/main?bg=checker');
    const PConAir = loadRuntime();
    loadDebugModule();
    const wrapper = document.querySelector('.pc-bg-checker');
    expect(wrapper).toBeTruthy();
  });

  it('bg=%23008000 sets the wrapper background to #008000', () => {
    window.history.replaceState({}, '', '/packages/p/render/main?bg=%23008000');
    const PConAir = loadRuntime();
    loadDebugModule();
    const wrapper = document.querySelector('.pc-stage-wrapper');
    expect(wrapper).toBeTruthy();
    const style = window.getComputedStyle(wrapper as Element);
    // The background-color should be set to the color (might be in different format)
    expect(wrapper as HTMLElement).toHaveProperty('style');
    const elem = wrapper as HTMLElement;
    expect(elem.style.backgroundColor).toMatch(/rgb\(0, 128, 0\)|008000|green|#008000/i);
  });

  it('invalid background values are ignored', () => {
    window.history.replaceState({}, '', '/packages/p/render/main?bg=not_a_color');
    const PConAir = loadRuntime();
    loadDebugModule();
    const wrapper = document.querySelector('.pc-stage-wrapper');
    const elem = wrapper as HTMLElement;
    // Should not have any background color set
    expect(elem.style.backgroundColor).toBe('');
  });
});

describe('T4 — Overlay renders registered samplers only', () => {
  it('with no samplers, overlay shows package, render, socket, fps, viewport', () => {
    window.history.replaceState({}, '', '/packages/p/render/main?debug=1');
    const PConAir = loadRuntime();
    loadDebugModule();
    const overlay = document.querySelector('.pc-debug');
    expect(overlay).toBeTruthy();
    const text = (overlay as HTMLElement)?.textContent || '';
    expect(text).toContain('package');
    expect(text).toContain('render');
    expect(text).toContain('socket');
    expect(text).toContain('fps');
    expect(text).toContain('viewport');
  });

  it('register a fake transport sampler and assert its row appears', () => {
    window.history.replaceState({}, '', '/packages/p/render/main?debug=1');
    const PConAir = loadRuntime();
    // Register a fake sampler
    PConAir._diagSource('transport', function() {
      return { phase: 'play', step: 1, n: 10, remaining: 5000 };
    });
    loadDebugModule();
    const overlay = document.querySelector('.pc-debug');
    const text = (overlay as HTMLElement)?.textContent || '';
    expect(text).toContain('transport');
    expect(text).toContain('play');
  });

  it('without ?debug=1, no overlay is shown even if samplers are registered', () => {
    window.history.replaceState({}, '', '/packages/p/render/main');
    const PConAir = loadRuntime();
    // Register a sampler
    PConAir._diagSource('transport', function() {
      return { phase: 'play' };
    });
    loadDebugModule();
    const overlay = document.querySelector('.pc-debug');
    expect(overlay).toBeFalsy();
  });
});
