// @vitest-environment jsdom
//
// Spec 18 — the generated operator panel (src/runtime/pconair-controls.js).
// Split from tests/declarative-controls.test.ts for the same reason
// tests/package-runtime-client.test.ts is split from tests/package-runtime.test.ts:
// this needs a real DOM to render into, while the server half needs node +
// supertest, and vitest picks one environment per file.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

const RUNTIME_SRC = fs.readFileSync(path.join(process.cwd(), 'src', 'runtime', 'pconair.js'), 'utf8');
const CONTROLS_SRC = fs.readFileSync(path.join(process.cwd(), 'src', 'runtime', 'pconair-controls.js'), 'utf8');

// ── WebSocket stub (same shape the other runtime tests use) ───────────────

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

function installStubWebSocket(): void {
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

function last(): StubSocket { return sockets[sockets.length - 1]; }

// ── fetch stub ────────────────────────────────────────────────────────────

interface FetchCall { url: string; init: Record<string, unknown> | undefined }

let fetchCalls: FetchCall[] = [];
/** Overridable per test. Default: 200 with `delivered: 1`. */
let fetchHandler: (url: string, init?: Record<string, unknown>) => Promise<unknown>;

function jsonResponse(body: unknown, status = 200): unknown {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(JSON.stringify(body)),
  };
}

function installStubFetch(): void {
  fetchCalls = [];
  fetchHandler = () => Promise.resolve(jsonResponse({ state: {}, delivered: 1 }));
  (window as unknown as { fetch: unknown }).fetch = ((url: unknown, init?: Record<string, unknown>) => {
    fetchCalls.push({ url: String(url), init });
    return fetchHandler(String(url), init);
  }) as unknown;
}

/** Patch bodies sent to POST /api/packages/:id/state, parsed, in order. */
function patchBodies(): Array<Record<string, unknown>> {
  return fetchCalls
    .filter((c) => c.url.indexOf('/state') !== -1 && c.init && c.init.method === 'POST')
    .map((c) => JSON.parse(String((c.init as Record<string, unknown>).body)));
}

// ── runtime loading ───────────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */
function loadRuntime(): any {
  delete (window as unknown as Record<string, unknown>).PConAir;
  new Function(RUNTIME_SRC)();
  new Function(CONTROLS_SRC)();
  return (window as unknown as { PConAir: any }).PConAir;
}

interface MountResult {
  PConAir: any;
  el: HTMLElement;
  handle: any;
}

const SCHEMA_CONTROLS = {
  groups: [
    {
      id: 'scores',
      label: 'Scores',
      fields: [
        { type: 'text', field: 'home.name', label: 'Home name', placeholder: 'Home' },
        { type: 'number', field: 'home.score', label: 'Home score', min: 0, max: 199, step: 1 },
        { type: 'toggle', field: 'live', label: 'On air' },
        { type: 'select', field: 'style.font', label: 'Font', choices: [{ id: 'serif', label: 'Serif' }, { id: 'sans', label: 'Sans' }] },
      ],
    },
  ],
};

/** Mount a panel, open its socket and (optionally) push a first state frame. */
function mount(controls: unknown, opts: Record<string, unknown> = {}, state?: unknown): MountResult {
  const PConAir = loadRuntime();
  const el = document.createElement('div');
  document.body.appendChild(el);
  const handle = PConAir.controlPanel(el, {
    packageId: 'widget',
    name: 'Widget',
    controls,
    renders: [{ id: 'main', label: 'Main', transport: null }],
    ...opts,
  });
  last().fireOpen();
  if (state !== undefined) pushState(state);
  return { PConAir, el, handle };
}

function pushState(state: unknown): void {
  last().fireMessage({ type: 'state', namespace: 'package:widget', state });
}

function field(el: HTMLElement, dottedPath: string): HTMLElement {
  const found = el.querySelector(`[data-field-path="${dottedPath}"]`);
  if (!found) throw new Error(`no rendered field for path '${dottedPath}'`);
  return found as HTMLElement;
}

function inputFor(el: HTMLElement, dottedPath: string): HTMLInputElement {
  const wrapper = field(el, dottedPath);
  const input = wrapper.querySelector('input, select, textarea');
  if (!input) throw new Error(`field '${dottedPath}' has no input`);
  return input as HTMLInputElement;
}

function fire(el: Element, type: string): void {
  el.dispatchEvent(new window.Event(type, { bubbles: true }));
}

beforeEach(() => {
  installStubWebSocket();
  installStubFetch();
  window.history.replaceState({}, '', '/packages/widget/control');
  document.body.innerHTML = '';
  document.documentElement.removeAttribute('style');
});

afterEach(() => {
  vi.useRealTimers();
});

describe('T7 — text, number, toggle and select render and patch', () => {
  const STATE = {
    home: { name: 'Lions', score: 12, bonus: true },
    live: false,
    style: { font: 'serif', accent: '#c8a24a', panelOpacity: 0.9 },
  };

  it('renders a labelled input per field, in manifest order', () => {
    const { el } = mount(SCHEMA_CONTROLS, {}, STATE);
    const paths = Array.from(el.querySelectorAll('[data-field-path]')).map((n) =>
      n.getAttribute('data-field-path')
    );
    expect(paths).toEqual(['home.name', 'home.score', 'live', 'style.font']);
    for (const p of paths) {
      const input = inputFor(el, p!);
      const label = el.querySelector(`label[for="${input.id}"]`);
      expect(input.id).not.toBe('');
      expect(label).not.toBeNull();
      expect(label!.textContent).not.toBe('');
    }
  });

  it('reflects incoming state in each input', () => {
    const { el } = mount(SCHEMA_CONTROLS, {}, STATE);
    expect(inputFor(el, 'home.name').value).toBe('Lions');
    expect(inputFor(el, 'home.score').value).toBe('12');
    expect(inputFor(el, 'live').checked).toBe(false);
    expect(inputFor(el, 'style.font').value).toBe('serif');
  });

  it('a text edit emits a nested patch whose sibling keys survive the shallow merge', async () => {
    const { el } = mount(SCHEMA_CONTROLS, {}, STATE);
    const input = inputFor(el, 'home.name');
    input.value = 'Tigers';
    fire(input, 'change');
    await Promise.resolve();
    // §3.5: POST /api/packages/:id/state shallow-merges, so the patch has to
    // carry `home`'s other keys or they would be dropped.
    expect(patchBodies()).toEqual([{ home: { name: 'Tigers', score: 12, bonus: true } }]);
  });

  it('a number edit coerces to a number, not a string', async () => {
    const { el } = mount(SCHEMA_CONTROLS, {}, STATE);
    const input = inputFor(el, 'home.score');
    input.value = '31';
    fire(input, 'change');
    await Promise.resolve();
    expect(patchBodies()[0]).toEqual({ home: { name: 'Lions', score: 31, bonus: true } });
    expect(typeof (patchBodies()[0].home as Record<string, unknown>).score).toBe('number');
  });

  it('a toggle emits a boolean at a top-level path', async () => {
    const { el } = mount(SCHEMA_CONTROLS, {}, STATE);
    const input = inputFor(el, 'live');
    input.checked = true;
    fire(input, 'change');
    await Promise.resolve();
    expect(patchBodies()).toEqual([{ live: true }]);
  });

  it('a select emits the declared choice id', async () => {
    const { el } = mount(SCHEMA_CONTROLS, {}, STATE);
    const input = inputFor(el, 'style.font');
    input.value = 'sans';
    fire(input, 'change');
    await Promise.resolve();
    expect(patchBodies()[0]).toEqual({ style: { font: 'sans', accent: '#c8a24a', panelOpacity: 0.9 } });
  });

  it('a select over a number leaf emits a number', async () => {
    const controls = {
      groups: [
        {
          id: 'g',
          label: 'G',
          fields: [
            { type: 'select', field: 'home.score', label: 'Score', choices: [{ id: 0, label: 'Zero' }, { id: 7, label: 'Seven' }] },
          ],
        },
      ],
    };
    const { el } = mount(controls, {}, STATE);
    const input = inputFor(el, 'home.score');
    input.value = '7';
    fire(input, 'change');
    await Promise.resolve();
    expect((patchBodies()[0].home as Record<string, unknown>).score).toBe(7);
  });

  it('supports an array index in the path', async () => {
    const controls = {
      groups: [{ id: 'g', label: 'G', fields: [{ type: 'text', field: 'scores.1', label: 'Second' }] }],
    };
    const { el } = mount(controls, {}, { scores: ['a', 'b', 'c'] });
    const input = inputFor(el, 'scores.1');
    expect(input.value).toBe('b');
    input.value = 'z';
    fire(input, 'change');
    await Promise.resolve();
    expect(patchBodies()).toEqual([{ scores: ['a', 'z', 'c'] }]);
  });

  it('groups render as fieldset/legend in manifest order', () => {
    const { el } = mount(
      {
        groups: [
          { id: 'one', label: 'First', fields: [{ type: 'toggle', field: 'live', label: 'A' }] },
          { id: 'two', label: 'Second', fields: [{ type: 'text', field: 'home.name', label: 'B' }] },
        ],
      },
      {},
      STATE
    );
    const groups = Array.from(el.querySelectorAll('fieldset[data-group-id]'));
    expect(groups.map((g) => g.getAttribute('data-group-id'))).toEqual(['one', 'two']);
    expect(groups.map((g) => g.querySelector('legend')!.textContent)).toEqual(
      expect.arrayContaining(['First', 'Second'].map((s) => expect.stringContaining(s)))
    );
  });
});
