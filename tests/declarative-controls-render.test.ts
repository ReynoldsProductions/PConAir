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

/* The panel's OWN client always connects first, synchronously, inside
   controlPanel() -- before build() runs buildPreview(), which (when
   P.preview exists) opens its own separate diagnostic connection for the
   previewed render (spec 17 s3.3's "lightweight control-role connection").
   `last()` used to grab sockets[sockets.length - 1], which was harmlessly
   correct back when this file's own branch had no P.preview at all (every
   test created exactly one socket) but silently grabbed preview's throwaway
   socket instead of the panel's real client once specs 17+18 were merged
   together -- every fireOpen()/fireMessage() in this file was then driving
   the wrong connection, so client.state never updated and every field
   rendered empty. Anchoring on the first socket is correct regardless of
   whether preview's second connection exists. */
function last(): StubSocket { return sockets[0]; }

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

/** Let the microtask queue drain — patch() is two chained promises deep. */
async function flush(): Promise<void> {
  for (let i = 0; i < 6; i++) await Promise.resolve();
}

/**
 * This jsdom build ships a `localStorage` object whose methods are not
 * functions, so a real one has to be supplied to test persistence at all.
 * Fresh per test: group collapse state persists per viewer, so one test's
 * click would otherwise decide the next test's starting state.
 */
function installStubLocalStorage(): void {
  const store = new Map<string, string>();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => { store.set(k, String(v)); },
      removeItem: (k: string) => { store.delete(k); },
      clear: () => { store.clear(); },
    },
  });
}

beforeEach(() => {
  installStubWebSocket();
  installStubFetch();
  installStubLocalStorage();
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

const BASIC_STATE = {
  home: { name: 'Lions', score: 12, bonus: true },
  live: false,
  style: { font: 'serif', accent: '#c8a24a', panelOpacity: 0.9 },
};

describe('T8 — focus is never clobbered', () => {
  it('a state frame does not overwrite the value of a focused input', () => {
    const { el } = mount(SCHEMA_CONTROLS, {}, BASIC_STATE);
    const input = inputFor(el, 'home.name');
    input.focus();
    expect(document.activeElement).toBe(input);

    pushState({ ...BASIC_STATE, home: { ...BASIC_STATE.home, name: 'Tigers' } });
    expect(input.value).toBe('Lions');
  });

  it('but an unfocused sibling in the same frame does update', () => {
    const { el } = mount(SCHEMA_CONTROLS, {}, BASIC_STATE);
    inputFor(el, 'home.name').focus();
    pushState({ ...BASIC_STATE, home: { name: 'Tigers', score: 44, bonus: true } });
    expect(inputFor(el, 'home.name').value).toBe('Lions');
    expect(inputFor(el, 'home.score').value).toBe('44');
  });

  it('reconciles on blur when the operator had not typed anything', () => {
    const { el } = mount(SCHEMA_CONTROLS, {}, BASIC_STATE);
    const input = inputFor(el, 'home.name');
    input.focus();
    pushState({ ...BASIC_STATE, home: { ...BASIC_STATE.home, name: 'Tigers' } });
    expect(input.value).toBe('Lions');

    fire(input, 'blur');
    expect(input.value).toBe('Tigers');
  });

  it('does NOT wipe the operator\'s own typing on blur — it commits it', async () => {
    vi.useFakeTimers();
    const { el } = mount(SCHEMA_CONTROLS, {}, BASIC_STATE);
    const input = inputFor(el, 'home.name');
    input.focus();
    input.value = 'Bears';
    fire(input, 'input');
    // A frame arrives mid-typing carrying the old value.
    pushState({ ...BASIC_STATE, home: { ...BASIC_STATE.home, name: 'Lions' } });
    expect(input.value).toBe('Bears');

    fire(input, 'blur');
    await vi.advanceTimersByTimeAsync(0);
    expect(input.value).toBe('Bears');
    expect(patchBodies()[0]).toEqual({ home: { name: 'Bears', score: 12, bonus: true } });
  });

  it('a focused checkbox and select are protected too', () => {
    const { el } = mount(SCHEMA_CONTROLS, {}, BASIC_STATE);
    const toggle = inputFor(el, 'live');
    toggle.focus();
    pushState({ ...BASIC_STATE, live: true });
    expect(toggle.checked).toBe(false);
    fire(toggle, 'blur');
    expect(toggle.checked).toBe(true);
  });
});

describe('T9 — debounce', () => {
  it('five input events inside 100 ms emit one patch, 150 ms after the last', async () => {
    vi.useFakeTimers();
    const { el } = mount(SCHEMA_CONTROLS, {}, BASIC_STATE);
    const input = inputFor(el, 'home.name');
    for (let i = 0; i < 5; i++) {
      input.value = 'Tiger'.slice(0, i + 1);
      fire(input, 'input');
      await vi.advanceTimersByTimeAsync(20);
    }
    expect(patchBodies()).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(130);
    expect(patchBodies()).toHaveLength(1);
    expect(patchBodies()[0]).toEqual({ home: { name: 'Tiger', score: 12, bonus: true } });
  });

  it('a change event emits immediately, without waiting for the debounce', async () => {
    vi.useFakeTimers();
    const { el } = mount(SCHEMA_CONTROLS, {}, BASIC_STATE);
    const input = inputFor(el, 'home.name');
    input.value = 'Tigers';
    fire(input, 'change');
    await vi.advanceTimersByTimeAsync(0);
    expect(patchBodies()).toHaveLength(1);
  });

  it('a change immediately after typing does not double-send the same value', async () => {
    vi.useFakeTimers();
    const { el } = mount(SCHEMA_CONTROLS, {}, BASIC_STATE);
    const input = inputFor(el, 'home.name');
    input.value = 'Tigers';
    fire(input, 'input');
    await vi.advanceTimersByTimeAsync(200);
    expect(patchBodies()).toHaveLength(1);
    // Browsers fire `change` after typing then blurring. Same value → no
    // second patch.
    fire(input, 'change');
    await vi.advanceTimersByTimeAsync(0);
    expect(patchBodies()).toHaveLength(1);
  });

  it('a toggle does not debounce — one click, one patch', async () => {
    vi.useFakeTimers();
    const { el } = mount(SCHEMA_CONTROLS, {}, BASIC_STATE);
    const toggle = inputFor(el, 'live');
    toggle.checked = true;
    fire(toggle, 'change');
    await vi.advanceTimersByTimeAsync(0);
    expect(patchBodies()).toHaveLength(1);
  });
});

describe('T10 — optimistic then reconciled', () => {
  it('the input shows the new value before the response arrives', async () => {
    let release: (v: unknown) => void = () => {};
    fetchHandler = () => new Promise((resolve) => { release = resolve; });
    const { el } = mount(SCHEMA_CONTROLS, {}, BASIC_STATE);
    const input = inputFor(el, 'home.name');
    input.value = 'Tigers';
    fire(input, 'change');
    await Promise.resolve();
    // Response still in flight…
    expect(input.value).toBe('Tigers');
    release(jsonResponse({ state: {}, delivered: 1 }));
  });

  it('a rejected patch reverts the input to the last known state', async () => {
    fetchHandler = () => Promise.resolve(jsonResponse({ error: { message: 'nope' } }, 400));
    const { el } = mount(SCHEMA_CONTROLS, {}, BASIC_STATE);
    const input = inputFor(el, 'home.name');
    input.value = 'Tigers';
    fire(input, 'change');
    await flush();
    expect(input.value).toBe('Lions');
    const err = field(el, 'home.name').querySelector('.pc-field-error') as HTMLElement;
    expect(err.hidden).toBe(false);
    expect(err.textContent).toContain('nope');
  });

  it('a second attempt at the same value is retried after a rejection', async () => {
    fetchHandler = () => Promise.resolve(jsonResponse({ error: { message: 'nope' } }, 400));
    const { el } = mount(SCHEMA_CONTROLS, {}, BASIC_STATE);
    const input = inputFor(el, 'home.name');
    input.value = 'Tigers';
    fire(input, 'change');
    await flush();
    expect(patchBodies()).toHaveLength(1);
    // The dedupe guard must not swallow a retry of a value that failed.
    input.value = 'Tigers';
    fire(input, 'change');
    await flush();
    expect(patchBodies()).toHaveLength(2);
  });

  it('accepts the server echo as truth once the input is no longer focused', async () => {
    const { el } = mount(SCHEMA_CONTROLS, {}, BASIC_STATE);
    const input = inputFor(el, 'home.name');
    input.value = 'Tigers';
    fire(input, 'change');
    await flush();
    // Server normalised it.
    pushState({ ...BASIC_STATE, home: { ...BASIC_STATE.home, name: 'TIGERS' } });
    expect(input.value).toBe('TIGERS');
  });
});

describe('T11 — the delivered: 0 notice', () => {
  function notice(el: HTMLElement): HTMLElement {
    return el.querySelector('.pc-panel-notice') as HTMLElement;
  }

  it('is hidden before anything is sent', () => {
    const { el } = mount(SCHEMA_CONTROLS, {}, BASIC_STATE);
    expect(notice(el).hidden).toBe(true);
  });

  it('appears on delivered: 0, informational and non-blocking', async () => {
    fetchHandler = () => Promise.resolve(jsonResponse({ state: {}, delivered: 0 }));
    const { el } = mount(SCHEMA_CONTROLS, {}, BASIC_STATE);
    const input = inputFor(el, 'home.name');
    input.value = 'Tigers';
    fire(input, 'change');
    await flush();

    const n = notice(el);
    expect(n.hidden).toBe(false);
    expect(n.textContent).toMatch(/no output is connected/i);
    // Not an error: role=status, and neither the element nor the panel is
    // error-styled or modal.
    expect(n.getAttribute('role')).toBe('status');
    expect(n.className).not.toMatch(/error/);
    expect(n.getAttribute('aria-modal')).toBeNull();
    // The field itself is not marked as failed — the patch succeeded.
    expect((field(el, 'home.name').querySelector('.pc-field-error') as HTMLElement).hidden).toBe(true);
  });

  it('renders no notice when delivered is 1, and clears a stale one', async () => {
    let delivered = 0;
    fetchHandler = () => Promise.resolve(jsonResponse({ state: {}, delivered }));
    const { el } = mount(SCHEMA_CONTROLS, {}, BASIC_STATE);
    const input = inputFor(el, 'home.name');
    input.value = 'Tigers';
    fire(input, 'change');
    await flush();
    expect(notice(el).hidden).toBe(false);

    delivered = 1;
    input.value = 'Bears';
    fire(input, 'change');
    await flush();
    expect(notice(el).hidden).toBe(true);
  });
});

describe('T12 — disconnected state', () => {
  function banner(el: HTMLElement): HTMLElement {
    return el.querySelector('.pc-panel-banner') as HTMLElement;
  }

  /** Mount without firing open, so the socket is still connecting. */
  function mountDisconnected(): MountResult {
    const PConAir = loadRuntime();
    const el = document.createElement('div');
    document.body.appendChild(el);
    const handle = PConAir.controlPanel(el, {
      packageId: 'widget',
      name: 'Widget',
      controls: SCHEMA_CONTROLS,
      renders: [{ id: 'main', label: 'Main', transport: null }],
    });
    return { PConAir, el, handle };
  }

  it('marks every mutating control aria-disabled and shows the banner while disconnected', () => {
    const { el } = mountDisconnected();
    expect(banner(el).hidden).toBe(false);
    expect(banner(el).textContent).toMatch(/not connected/i);
    // Excludes .pc-panel-preview: its backdrop/reload/render-selector controls
    // are local-only (no client.patch() ever fires from them) -- disabling
    // them while the panel's own connection drops would stop an operator from
    // e.g. switching their local preview backdrop for no real reason, since
    // that action never touches the server either way.
    const controls = Array.from(el.querySelectorAll('input, select, textarea, button')).filter(
      (n) => !n.classList.contains('pc-group-toggle') && !n.closest('.pc-panel-preview')
    );
    expect(controls.length).toBeGreaterThan(0);
    for (const c of controls) expect(c.getAttribute('aria-disabled')).toBe('true');
  });

  it('but collapsing a group still works offline — it changes nothing on air', () => {
    const { el } = mountDisconnected();
    const toggle = el.querySelector('.pc-group-toggle') as HTMLButtonElement;
    expect(toggle.getAttribute('aria-disabled')).toBeNull();
    toggle.click();
    expect((el.querySelector('[data-group-id="scores"]') as HTMLElement).getAttribute('data-collapsed')).toBe('');
  });

  it('clears both on reconnect', () => {
    const { el } = mountDisconnected();
    last().fireOpen();
    expect(banner(el).hidden).toBe(true);
    for (const i of Array.from(el.querySelectorAll('input, select, textarea, button'))) {
      expect(i.getAttribute('aria-disabled')).toBeNull();
    }
  });

  it('re-marks them when the connection drops again', () => {
    const { el } = mountDisconnected();
    last().fireOpen();
    last().fireClose();
    expect(banner(el).hidden).toBe(false);
    expect(inputFor(el, 'home.name').getAttribute('aria-disabled')).toBe('true');
  });

  it('refuses an edit made while disconnected rather than swallowing it', async () => {
    const { el } = mountDisconnected();
    pushState(BASIC_STATE);
    const input = inputFor(el, 'home.name');
    input.value = 'Tigers';
    fire(input, 'change');
    await flush();
    // Nothing sent…
    expect(patchBodies()).toHaveLength(0);
    // …and the operator is told, not left thinking it worked.
    const err = field(el, 'home.name').querySelector('.pc-field-error') as HTMLElement;
    expect(err.hidden).toBe(false);
    expect(err.textContent).toMatch(/not connected/i);
    // The edit visibly reverts, so the panel never shows a value the server
    // does not have.
    expect(input.value).toBe('Lions');
  });
});

describe('T13 — colour validation, client side', () => {
  const COLOR_CONTROLS = {
    groups: [
      {
        id: 'look',
        label: 'Look',
        fields: [{ type: 'color', field: 'style.accent', label: 'Accent', swatches: ['#c8a24a', '#fff'] }],
      },
    ],
  };

  it('PConAir.isValidColorValue rejects anything with CSS syntax in it', () => {
    const { PConAir } = mount(COLOR_CONTROLS, {}, BASIC_STATE);
    for (const bad of [
      'red; background: url(x)',
      'expression(1)',
      '}',
      '#fff}',
      '#fff;',
      '#fff/*',
      'url(//evil/x.png)',
      'chartreusey',
      '',
      7,
      null,
      undefined,
      {},
    ]) {
      expect(PConAir.isValidColorValue(bad)).toBe(false);
    }
  });

  it('PConAir.isValidColorValue accepts hex and named colours', () => {
    const { PConAir } = mount(COLOR_CONTROLS, {}, BASIC_STATE);
    for (const ok of ['#c8a24a', '#fff', '#C8A24AFF', 'transparent', 'white', 'Black']) {
      expect(PConAir.isValidColorValue(ok)).toBe(true);
    }
  });

  it('the panel refuses to send an invalid colour, so the server never sees it', async () => {
    const { el } = mount(COLOR_CONTROLS, {}, BASIC_STATE);
    const input = inputFor(el, 'style.accent');
    // A colour input cannot hold this, but a scripted page or a stale
    // autofill can — the panel must not forward it either way.
    Object.defineProperty(input, 'value', {
      value: 'red; background: url(x)',
      configurable: true,
      writable: true,
    });
    fire(input, 'change');
    await flush();
    expect(patchBodies()).toHaveLength(0);
    const err = field(el, 'style.accent').querySelector('.pc-field-error') as HTMLElement;
    expect(err.hidden).toBe(false);
    expect(err.textContent).toMatch(/colour/i);
  });

  it('a valid colour is sent normally', async () => {
    const { el } = mount(COLOR_CONTROLS, {}, BASIC_STATE);
    const input = inputFor(el, 'style.accent');
    input.value = '#123456';
    fire(input, 'change');
    await flush();
    expect((patchBodies()[0].style as Record<string, unknown>).accent).toBe('#123456');
  });

  it('renders the declared swatches and commits one on click', async () => {
    const { el } = mount(COLOR_CONTROLS, {}, BASIC_STATE);
    const swatches = Array.from(field(el, 'style.accent').querySelectorAll('.pc-swatch'));
    expect(swatches).toHaveLength(2);
    (swatches[1] as HTMLButtonElement).click();
    await flush();
    expect((patchBodies()[0].style as Record<string, unknown>).accent).toBe('#fff');
  });
});

describe('T14 — applyStyle mirrors a state subtree onto :root', () => {
  function connectRender(): { PConAir: any; client: any } {
    const PConAir = loadRuntime();
    const client = PConAir.connect('widget', { role: 'render', renderId: 'main' });
    last().fireOpen();
    return { PConAir, client };
  }

  it('sets a custom property per scalar key, camelCase becoming kebab-case', () => {
    const { client } = connectRender();
    client.applyStyle();
    pushState({ style: { accent: '#c8a24a', panelOpacity: 0.9, cornerRadius: 12 } });
    const root = document.documentElement;
    expect(root.style.getPropertyValue('--pc-accent')).toBe('#c8a24a');
    expect(root.style.getPropertyValue('--pc-panel-opacity')).toBe('0.9');
    expect(root.style.getPropertyValue('--pc-corner-radius')).toBe('12');
  });

  it('numbers pass through unitless so a render can calc() them', () => {
    const { client } = connectRender();
    client.applyStyle();
    pushState({ style: { corner: 4 } });
    expect(document.documentElement.style.getPropertyValue('--pc-corner')).toBe('4');
  });

  it('drops a value containing CSS syntax instead of writing it', () => {
    const { client } = connectRender();
    client.applyStyle();
    pushState({ style: { accent: 'red; background: url(//evil/x.png)' } });
    expect(document.documentElement.style.getPropertyValue('--pc-accent')).toBe('');
    // …and the whole subtree is not abandoned: safe siblings still land.
    pushState({ style: { accent: '}', panelOpacity: 0.5 } });
    expect(document.documentElement.style.getPropertyValue('--pc-accent')).toBe('');
    expect(document.documentElement.style.getPropertyValue('--pc-panel-opacity')).toBe('0.5');
  });

  it('keeps the last good value when a later frame carries an unsafe one', () => {
    const { client } = connectRender();
    client.applyStyle();
    pushState({ style: { accent: '#c8a24a' } });
    expect(document.documentElement.style.getPropertyValue('--pc-accent')).toBe('#c8a24a');
    pushState({ style: { accent: 'x;y' } });
    // A stale graphic beats a broken one.
    expect(document.documentElement.style.getPropertyValue('--pc-accent')).toBe('#c8a24a');
  });

  it('honours a custom subtree and prefix, and skips nested objects', () => {
    const { client } = connectRender();
    client.applyStyle('look', '--x-');
    pushState({ look: { tone: 'warm', nested: { no: 1 } } });
    expect(document.documentElement.style.getPropertyValue('--x-tone')).toBe('warm');
    expect(document.documentElement.style.getPropertyValue('--x-nested')).toBe('');
  });

  it('is a no-op when the subtree is absent or not an object', () => {
    const { client } = connectRender();
    client.applyStyle();
    pushState({ other: 1 });
    expect(document.documentElement.getAttribute('style') || '').toBe('');
    pushState({ style: 'nope' });
    expect(document.documentElement.getAttribute('style') || '').toBe('');
  });

  it('stops applying after destroy()', () => {
    const { client } = connectRender();
    const handle = client.applyStyle();
    pushState({ style: { accent: '#c8a24a' } });
    handle.destroy();
    pushState({ style: { accent: '#000000' } });
    expect(document.documentElement.style.getPropertyValue('--pc-accent')).toBe('#c8a24a');
  });
});

describe('T15 — showIf', () => {
  const CONTROLS = {
    groups: [
      {
        id: 'logo',
        label: 'Logo',
        fields: [
          { type: 'toggle', field: 'live', label: 'Show logo' },
          { type: 'text', field: 'home.name', label: 'Logo position', showIf: { field: 'live', equals: true } },
          { type: 'number', field: 'home.score', label: 'Always here' },
        ],
      },
    ],
  };

  it('is absent from the DOM when unmatched', () => {
    const { el } = mount(CONTROLS, {}, { ...BASIC_STATE, live: false });
    expect(el.querySelector('[data-field-path="home.name"]')).toBeNull();
    // Its siblings are unaffected.
    expect(el.querySelector('[data-field-path="live"]')).not.toBeNull();
    expect(el.querySelector('[data-field-path="home.score"]')).not.toBeNull();
  });

  it('is present when matched', () => {
    const { el } = mount(CONTROLS, {}, { ...BASIC_STATE, live: true });
    expect(el.querySelector('[data-field-path="home.name"]')).not.toBeNull();
    expect(inputFor(el, 'home.name').value).toBe('Lions');
  });

  it('appears and disappears live as the watched value changes', () => {
    const { el } = mount(CONTROLS, {}, { ...BASIC_STATE, live: false });
    expect(el.querySelector('[data-field-path="home.name"]')).toBeNull();
    pushState({ ...BASIC_STATE, live: true });
    expect(el.querySelector('[data-field-path="home.name"]')).not.toBeNull();
    pushState({ ...BASIC_STATE, live: false });
    expect(el.querySelector('[data-field-path="home.name"]')).toBeNull();
  });

  it('reappears in its manifest position, not at the end of the group', () => {
    const { el } = mount(CONTROLS, {}, { ...BASIC_STATE, live: false });
    pushState({ ...BASIC_STATE, live: true });
    const paths = Array.from(el.querySelectorAll('[data-field-path]')).map((n) =>
      n.getAttribute('data-field-path')
    );
    expect(paths).toEqual(['live', 'home.name', 'home.score']);
  });

  it('does not steal focus from a sibling when it appears', () => {
    const { el } = mount(CONTROLS, {}, { ...BASIC_STATE, live: false });
    const score = inputFor(el, 'home.score');
    score.focus();
    pushState({ ...BASIC_STATE, live: true });
    expect(document.activeElement).toBe(score);
  });

  it('matches on a string and a number too, strictly', () => {
    const controls = {
      groups: [
        {
          id: 'g',
          label: 'G',
          fields: [
            { type: 'text', field: 'home.name', label: 'On serif', showIf: { field: 'style.font', equals: 'serif' } },
            { type: 'toggle', field: 'live', label: 'On twelve', showIf: { field: 'home.score', equals: 12 } },
          ],
        },
      ],
    };
    const { el } = mount(controls, {}, BASIC_STATE);
    expect(el.querySelector('[data-field-path="home.name"]')).not.toBeNull();
    expect(el.querySelector('[data-field-path="live"]')).not.toBeNull();
    // "12" is not 12.
    pushState({ ...BASIC_STATE, home: { ...BASIC_STATE.home, score: '12' }, style: { font: 'sans' } });
    expect(el.querySelector('[data-field-path="home.name"]')).toBeNull();
    expect(el.querySelector('[data-field-path="live"]')).toBeNull();
  });

  it('a hidden field sends no patch, even if its debounce was already armed', async () => {
    vi.useFakeTimers();
    const { el } = mount(CONTROLS, {}, { ...BASIC_STATE, live: true });
    const input = inputFor(el, 'home.name');
    input.value = 'Tigers';
    fire(input, 'input');
    pushState({ ...BASIC_STATE, live: false });
    await vi.advanceTimersByTimeAsync(300);
    expect(patchBodies()).toHaveLength(0);
  });
});

describe('T16 — transport, action, asset, data, slider and static', () => {
  function verbCalls(): string[] {
    return fetchCalls.filter((c) => c.url.indexOf('/transport/') !== -1).map((c) => c.url);
  }

  it('transport renders four buttons that call client.verb for the DECLARED render', async () => {
    const { el } = mount(
      { groups: [{ id: 'g', label: 'G', fields: [{ type: 'transport', label: 'Stat card', renderId: 'card' }] }] },
      { renders: [{ id: 'card', label: 'Card', transport: { stops: 2 } }] },
      BASIC_STATE
    );
    const wrapper = el.querySelector('[data-field-type="transport"]') as HTMLElement;
    const buttons = Array.from(wrapper.querySelectorAll('button[data-verb]'));
    expect(buttons.map((b) => b.getAttribute('data-verb'))).toEqual(['play', 'next', 'stop', 'clear']);

    (buttons[0] as HTMLButtonElement).click();
    (buttons[2] as HTMLButtonElement).click();
    await flush();
    // A control page's own client has NO renderId — the field's renderId is
    // what must reach the URL.
    expect(verbCalls()).toEqual([
      '/api/packages/widget/transport/card/play',
      '/api/packages/widget/transport/card/stop',
    ]);
  });

  it('transport shows the current phase and step from _transport', () => {
    const { el } = mount(
      { groups: [{ id: 'g', label: 'G', fields: [{ type: 'transport', label: 'Stat card', renderId: 'card' }] }] },
      { renders: [{ id: 'card', label: 'Card', transport: { stops: 2 } }] },
      { ...BASIC_STATE, _transport: { card: { phase: 'holding', step: 1, stops: 2, phaseStartedAt: 0, phaseMs: 0 } } }
    );
    const readout = el.querySelector('[data-field-type="transport"] .pc-transport-phase') as HTMLElement;
    expect(readout.textContent).toMatch(/holding/);
    expect(readout.textContent).toMatch(/2 of 2/);
  });

  it('action merges its declared patch, preserving siblings at every level', async () => {
    const { el } = mount(
      {
        groups: [
          {
            id: 'g',
            label: 'G',
            fields: [{ type: 'action', label: 'Clear name', patch: { home: { name: '' } } }],
          },
        ],
      },
      {},
      BASIC_STATE
    );
    const btn = el.querySelector('[data-field-type="action"] button') as HTMLButtonElement;
    btn.click();
    await flush();
    // §3.5's sibling rule applies to an action's patch too — a declared
    // { home: { name: '' } } must not drop home.score.
    expect(patchBodies()).toEqual([{ home: { name: '', score: 12, bonus: true } }]);
  });

  it('action honours confirm, sending nothing when the operator cancels', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { el } = mount(
      {
        groups: [
          {
            id: 'g',
            label: 'G',
            fields: [{ type: 'action', label: 'Wipe', patch: { live: false }, confirm: 'Really wipe?', variant: 'danger' }],
          },
        ],
      },
      {},
      BASIC_STATE
    );
    const btn = el.querySelector('[data-field-type="action"] button') as HTMLButtonElement;
    btn.click();
    await flush();
    expect(confirmSpy).toHaveBeenCalledWith('Really wipe?');
    expect(patchBodies()).toHaveLength(0);

    confirmSpy.mockReturnValue(true);
    btn.click();
    await flush();
    expect(patchBodies()).toEqual([{ live: false }]);
    expect(btn.className).toMatch(/danger/);
    confirmSpy.mockRestore();
  });

  it('asset uploads through the existing POST /api/packages/:id/assets flow', async () => {
    fetchHandler = (url) => {
      if (url.indexOf('/assets') !== -1) {
        return Promise.resolve(jsonResponse({ path: '/packages/widget/assets/logo.png', filename: 'logo.png' }));
      }
      return Promise.resolve(jsonResponse({ state: {}, delivered: 1 }));
    };
    const { el } = mount(
      { groups: [{ id: 'g', label: 'G', fields: [{ type: 'asset', field: 'logo', label: 'Logo', accept: 'image' }] }] },
      {},
      { ...BASIC_STATE, logo: '' }
    );
    const wrapper = field(el, 'logo');
    const file = wrapper.querySelector('input[type="file"]') as HTMLInputElement;
    expect(file).not.toBeNull();
    // Every input still needs a label, even the hidden file picker.
    expect(el.querySelector(`label[for="${file.id}"]`)).not.toBeNull();
    expect(file.getAttribute('accept')).toBe('image/*');

    Object.defineProperty(file, 'files', {
      value: [new window.File(['x'], 'logo.png', { type: 'image/png' })],
      configurable: true,
    });
    fire(file, 'change');
    await flush();

    const upload = fetchCalls.find((c) => c.url === '/api/packages/widget/assets');
    expect(upload).toBeDefined();
    expect((upload!.init as Record<string, unknown>).method).toBe('POST');
    // …and the returned path is then written to the field.
    expect(patchBodies()).toEqual([{ logo: '/packages/widget/assets/logo.png' }]);
  });

  it('data shows row count, age and a refresh button hitting spec 20\'s route', async () => {
    const { el } = mount(
      { groups: [{ id: 'g', label: 'G', fields: [{ type: 'data', label: 'Headlines', sourceId: 'feed' }] }] },
      {},
      {
        ...BASIC_STATE,
        _data: {
          feed: {
            rows: [{ a: '1' }, { a: '2' }],
            columns: ['a'],
            fetchedAt: Date.now() - 65_000,
            error: null,
            rawCount: 40,
            enabled: true,
          },
        },
      }
    );
    const wrapper = el.querySelector('[data-field-type="data"]') as HTMLElement;
    expect(wrapper.textContent).toMatch(/2 rows/);
    expect(wrapper.textContent).toMatch(/of 40/);
    expect(wrapper.textContent).toMatch(/1 min/);

    const refresh = wrapper.querySelector('button[data-refresh]') as HTMLButtonElement;
    refresh.click();
    await flush();
    expect(fetchCalls.map((c) => c.url)).toContain('/api/packages/widget/data/feed/refresh');
  });

  it('data surfaces a source error, and says so when nothing has fetched', () => {
    const { el } = mount(
      { groups: [{ id: 'g', label: 'G', fields: [{ type: 'data', label: 'Headlines', sourceId: 'feed' }] }] },
      {},
      { ...BASIC_STATE, _data: { feed: { rows: [], columns: [], fetchedAt: 0, error: 'HTTP 503', rawCount: 0, enabled: true } } }
    );
    const wrapper = el.querySelector('[data-field-type="data"]') as HTMLElement;
    expect(wrapper.textContent).toMatch(/HTTP 503/);

    const bare = mount(
      { groups: [{ id: 'g', label: 'G', fields: [{ type: 'data', label: 'Headlines', sourceId: 'feed' }] }] },
      {},
      BASIC_STATE
    );
    expect((bare.el.querySelector('[data-field-type="data"]') as HTMLElement).textContent).toMatch(
      /never fetched|not fetched/i
    );
  });

  it('slider renders a range with a readout and commits on change', async () => {
    const { el } = mount(
      {
        groups: [
          {
            id: 'g',
            label: 'G',
            fields: [
              { type: 'slider', field: 'style.panelOpacity', label: 'Opacity', min: 0, max: 1, step: 0.05, unit: '' },
            ],
          },
        ],
      },
      {},
      BASIC_STATE
    );
    const input = inputFor(el, 'style.panelOpacity');
    expect(input.getAttribute('type')).toBe('range');
    expect(input.value).toBe('0.9');
    const readout = field(el, 'style.panelOpacity').querySelector('.pc-slider-value') as HTMLElement;
    expect(readout.textContent).toContain('0.9');

    input.value = '0.5';
    fire(input, 'change');
    await flush();
    expect((patchBodies()[0].style as Record<string, unknown>).panelOpacity).toBe(0.5);
  });

  it('slider debounces its drag, then commits once', async () => {
    vi.useFakeTimers();
    const { el } = mount(
      {
        groups: [
          {
            id: 'g',
            label: 'G',
            fields: [{ type: 'slider', field: 'style.panelOpacity', label: 'Opacity', min: 0, max: 1, step: 0.1 }],
          },
        ],
      },
      {},
      BASIC_STATE
    );
    const input = inputFor(el, 'style.panelOpacity');
    for (const v of ['0.1', '0.2', '0.3']) {
      input.value = v;
      fire(input, 'input');
      await vi.advanceTimersByTimeAsync(30);
    }
    expect(patchBodies()).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(200);
    expect(patchBodies()).toHaveLength(1);
    expect((patchBodies()[0].style as Record<string, unknown>).panelOpacity).toBe(0.3);
  });

  it('slider shows its unit in the readout', () => {
    const { el } = mount(
      {
        groups: [
          {
            id: 'g',
            label: 'G',
            fields: [{ type: 'slider', field: 'home.score', label: 'Corner', min: 0, max: 40, unit: 'px' }],
          },
        ],
      },
      {},
      BASIC_STATE
    );
    expect((field(el, 'home.score').querySelector('.pc-slider-value') as HTMLElement).textContent).toBe('12px');
  });

  it('static renders its text and no input at all', () => {
    const { el } = mount(
      { groups: [{ id: 'g', label: 'G', fields: [{ type: 'static', label: 'Note', text: 'Restyles live.' }] }] },
      {},
      BASIC_STATE
    );
    const wrapper = el.querySelector('[data-field-type="static"]') as HTMLElement;
    expect(wrapper.textContent).toContain('Restyles live.');
    expect(wrapper.querySelector('input, select, textarea')).toBeNull();
    // No <label for> pointing at a control that does not exist.
    expect(wrapper.querySelector('label')).toBeNull();
  });

  it('a list text field joins an array for display and splits it on commit', async () => {
    const { el } = mount(
      {
        groups: [
          { id: 'g', label: 'G', fields: [{ type: 'text', field: 'scores', label: 'Messages', list: true }] },
        ],
      },
      {},
      { scores: ['one', 'two'] }
    );
    const input = inputFor(el, 'scores');
    expect(input.tagName).toBe('TEXTAREA');
    expect(input.value).toBe('one\ntwo');
    input.value = 'alpha\n\n  beta  \n';
    fire(input, 'change');
    await flush();
    // Blank lines dropped, each line trimmed.
    expect(patchBodies()).toEqual([{ scores: ['alpha', 'beta'] }]);
  });
});

describe('T17 — accessibility', () => {
  /* One manifest exercising every field type, so the checks below cover the
     whole surface rather than the easy half. Operators work these panels in
     the dark with one hand. */
  const EVERY_TYPE = {
    groups: [
      {
        id: 'content',
        label: 'Content',
        fields: [
          { type: 'text', field: 'home.name', label: 'Home name', help: 'Shown on the lower third.' },
          { type: 'text', field: 'scores', label: 'Messages', list: true },
          { type: 'number', field: 'home.score', label: 'Home score', bump: [1, 10] },
          { type: 'toggle', field: 'live', label: 'On air' },
          { type: 'select', field: 'style.font', label: 'Font', choices: [{ id: 'serif', label: 'Serif' }] },
          { type: 'asset', field: 'logo', label: 'Logo' },
        ],
      },
      {
        id: 'look',
        label: 'Look',
        fields: [
          { type: 'color', field: 'style.accent', label: 'Accent', swatches: ['#c8a24a'] },
          { type: 'slider', field: 'style.panelOpacity', label: 'Panel opacity', min: 0, max: 1, step: 0.05 },
          { type: 'static', label: 'Note', text: 'Restyles live.' },
        ],
      },
      {
        id: 'playback',
        label: 'Playback',
        fields: [
          { type: 'transport', label: 'Stat card', renderId: 'card' },
          { type: 'data', label: 'Headlines', sourceId: 'feed' },
          { type: 'action', label: 'Reset', patch: { live: false } },
        ],
      },
    ],
  };

  const FULL_STATE = {
    home: { name: 'Lions', score: 12, bonus: true },
    live: false,
    logo: '',
    scores: ['one'],
    style: { font: 'serif', accent: '#c8a24a', panelOpacity: 0.9 },
  };

  function mountEvery(): MountResult {
    return mount(
      EVERY_TYPE,
      { renders: [{ id: 'card', label: 'Card', transport: { stops: 2 } }] },
      FULL_STATE
    );
  }

  it('every input, select and textarea has an associated <label for>', () => {
    const { el } = mountEvery();
    const inputs = Array.from(el.querySelectorAll('input, select, textarea'));
    expect(inputs.length).toBeGreaterThanOrEqual(9);
    const missing: string[] = [];
    for (const input of inputs) {
      const id = input.getAttribute('id');
      if (!id || !el.querySelector(`label[for="${id}"]`)) {
        missing.push(input.outerHTML.slice(0, 80));
      }
    }
    expect(missing).toEqual([]);
  });

  it('ids are unique across the whole panel', () => {
    const { el } = mountEvery();
    const ids = Array.from(el.querySelectorAll('[id]')).map((n) => n.getAttribute('id'));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('groups are fieldset/legend', () => {
    const { el } = mountEvery();
    const groups = Array.from(el.querySelectorAll('[data-group-id]'));
    expect(groups).toHaveLength(3);
    for (const g of groups) {
      expect(g.tagName).toBe('FIELDSET');
      const legend = g.firstElementChild;
      expect(legend!.tagName).toBe('LEGEND');
      expect(legend!.textContent).not.toBe('');
    }
  });

  it('tab order follows manifest order', () => {
    const { el } = mountEvery();
    // No explicit tabindex anywhere — DOM order IS tab order, and DOM order
    // is manifest order. A positive tabindex would silently reorder the panel.
    for (const n of Array.from(el.querySelectorAll('[tabindex]'))) {
      expect(Number(n.getAttribute('tabindex'))).toBeLessThanOrEqual(0);
    }
    const paths = Array.from(el.querySelectorAll('[data-field-path], [data-field-type]'))
      .filter((n) => n.classList.contains('pc-field'))
      .map((n) => n.getAttribute('data-field-path') || n.getAttribute('data-field-type'));
    expect(paths).toEqual([
      'home.name',
      'scores',
      'home.score',
      'live',
      'style.font',
      'logo',
      'style.accent',
      'style.panelOpacity',
      'static',
      'transport',
      'data',
      'action',
    ]);
  });

  it('every button has a non-empty accessible name', () => {
    const { el } = mountEvery();
    const nameless: string[] = [];
    for (const b of Array.from(el.querySelectorAll('button'))) {
      const name = (b.getAttribute('aria-label') || b.textContent || '').replace(/\s+/g, '');
      if (!name) nameless.push(b.outerHTML.slice(0, 80));
    }
    expect(nameless).toEqual([]);
  });

  it('help text is wired to its input through aria-describedby', () => {
    const { el } = mountEvery();
    const input = inputFor(el, 'home.name');
    const describedBy = input.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    const help = el.querySelector(`#${describedBy}`);
    expect(help!.textContent).toBe('Shown on the lower third.');
  });

  it('the notice and banner are polite status regions, and errors are alerts', () => {
    const { el } = mountEvery();
    expect((el.querySelector('.pc-panel-notice') as HTMLElement).getAttribute('role')).toBe('status');
    expect((el.querySelector('.pc-panel-banner') as HTMLElement).getAttribute('role')).toBe('status');
    expect((el.querySelector('.pc-panel-error') as HTMLElement).getAttribute('role')).toBe('alert');
  });

  it('renders every declared field type without throwing', () => {
    const { el } = mountEvery();
    expect(el.querySelectorAll('.pc-field')).toHaveLength(12);
    expect(el.textContent).not.toContain('Unsupported field type');
  });
});

describe('§3.4 panel composition — preview, warnings, collapse, render narrowing', () => {
  const TWO_RENDERS = [
    { id: 'main', label: 'Main', transport: null },
    { id: 'card', label: 'Card', transport: { stops: 2 } },
  ];

  it('composes no preview and no warnings when the hooks are absent (feature-detection)', () => {
    // Specs 17 and 22 are merged on this branch, so P.preview/P.warningsPanel
    // are real functions in the runtime under test -- the only way left to
    // exercise buildPreview/buildWarnings' typeof-guarded absent-hook path is
    // to remove them ourselves, same as if a package's control page loaded a
    // stripped-down pconair.js that never got these specs. The panel must
    // still be complete and usable either way.
    const PConAir = loadRuntime();
    delete PConAir.preview;
    delete PConAir.warningsPanel;
    const el = document.createElement('div');
    document.body.appendChild(el);
    PConAir.controlPanel(el, {
      packageId: 'widget', name: 'Widget', controls: SCHEMA_CONTROLS,
      renders: [{ id: 'main', label: 'Main', transport: null }],
    });
    last().fireOpen();
    pushState(BASIC_STATE);
    expect(el.querySelector('.pc-panel-preview')).toBeNull();
    expect(el.querySelector('.pc-panel-warnings')).toBeNull();
    // …and the rest of the panel is there.
    expect(el.querySelectorAll('.pc-field')).toHaveLength(4);
  });

  it('composes spec 17\'s preview when it exists, between header and groups', () => {
    const PConAir = loadRuntime();
    const calls: Array<Record<string, unknown>> = [];
    // Real signature is preview(el, opts) -- two arguments. Matching it here
    // is what T7-era 'wrong argument count silently drops the real options
    // object' regression was: buildPreview used to call P.preview(host,
    // client, opts), and JS quietly discarded the third argument instead of
    // erroring, which is exactly the kind of mismatch this test exists to
    // pin down.
    PConAir.preview = (host: HTMLElement, o: Record<string, unknown>) => {
      calls.push(o);
      host.appendChild(document.createElement('iframe'));
      return { destroy: () => {} };
    };
    const el = document.createElement('div');
    document.body.appendChild(el);
    PConAir.controlPanel(el, {
      packageId: 'widget',
      name: 'Widget',
      controls: SCHEMA_CONTROLS,
      renders: TWO_RENDERS,
    });
    last().fireOpen();

    const preview = el.querySelector('.pc-panel-preview');
    expect(preview).not.toBeNull();
    expect(preview!.querySelector('iframe')).not.toBeNull();
    expect(calls[0]).toMatchObject({ packageId: 'widget', renderId: 'main' });
    // Order: header, then preview, then the groups.
    const kids = Array.from(el.firstElementChild!.children).map((n) => n.className);
    expect(kids.indexOf('pc-panel-preview')).toBeGreaterThan(kids.indexOf('pc-panel-header'));
    expect(kids.indexOf('pc-panel-preview')).toBeLessThan(kids.indexOf('pc-panel-groups'));
  });

  it('offers a render selector only when the package has more than one render', () => {
    const PConAir = loadRuntime();
    PConAir.preview = () => ({ destroy: () => {} });
    function mountWith(renders: unknown[]): HTMLElement {
      const el = document.createElement('div');
      document.body.appendChild(el);
      PConAir.controlPanel(el, { packageId: 'widget', name: 'W', controls: SCHEMA_CONTROLS, renders });
      last().fireOpen();
      return el;
    }
    expect(mountWith([TWO_RENDERS[0]]).querySelector('.pc-render-select')).toBeNull();
    const two = mountWith(TWO_RENDERS);
    const sel = two.querySelector('.pc-render-select') as HTMLSelectElement;
    expect(sel).not.toBeNull();
    expect(Array.from(sel.options).map((o) => o.value)).toEqual(['main', 'card']);
    expect(two.querySelector(`label[for="${sel.id}"]`)).not.toBeNull();
  });

  it('a preview that throws degrades to no preview rather than no panel', () => {
    // Spec 17 had not merged when this was written, so its exact signature is
    // unverified — a mismatch must not take the panel down with it.
    const PConAir = loadRuntime();
    PConAir.preview = () => { throw new Error('signature mismatch'); };
    const el = document.createElement('div');
    document.body.appendChild(el);
    PConAir.controlPanel(el, { packageId: 'widget', name: 'W', controls: SCHEMA_CONTROLS, renders: TWO_RENDERS });
    last().fireOpen();
    expect(el.querySelector('.pc-panel-preview')).toBeNull();
    expect(el.querySelectorAll('.pc-field')).toHaveLength(4);
  });

  it('composes spec 22\'s warnings panel when it exists, after the preview', () => {
    const PConAir = loadRuntime();
    PConAir.warningsPanel = (host: HTMLElement) => {
      host.appendChild(h('p', 'warn', 'too long'));
      return { destroy: () => {} };
    };
    function h(tag: string, cls: string, text: string): HTMLElement {
      const n = document.createElement(tag);
      n.className = cls;
      n.textContent = text;
      return n;
    }
    const el = document.createElement('div');
    document.body.appendChild(el);
    PConAir.controlPanel(el, { packageId: 'widget', name: 'W', controls: SCHEMA_CONTROLS, renders: TWO_RENDERS });
    last().fireOpen();
    const warnings = el.querySelector('.pc-panel-warnings');
    expect(warnings).not.toBeNull();
    expect(warnings!.textContent).toContain('too long');
  });

  it('groups collapse on click, and a declared collapsed:true starts closed', () => {
    const controls = {
      groups: [
        { id: 'open', label: 'Open', fields: [{ type: 'toggle', field: 'live', label: 'A' }] },
        { id: 'shut', label: 'Shut', collapsed: true, fields: [{ type: 'text', field: 'home.name', label: 'B' }] },
      ],
    };
    const { el } = mount(controls, {}, BASIC_STATE);
    const open = el.querySelector('[data-group-id="open"]') as HTMLElement;
    const shut = el.querySelector('[data-group-id="shut"]') as HTMLElement;
    expect(open.getAttribute('data-collapsed')).toBeNull();
    expect(shut.getAttribute('data-collapsed')).toBe('');

    const toggle = open.querySelector('.pc-group-toggle') as HTMLButtonElement;
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    toggle.click();
    expect(open.getAttribute('data-collapsed')).toBe('');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    toggle.click();
    expect(open.getAttribute('data-collapsed')).toBeNull();
  });

  it('remembers the operator\'s collapse choice per viewer', () => {
    const controls = {
      groups: [{ id: 'open', label: 'Open', fields: [{ type: 'toggle', field: 'live', label: 'A' }] }],
    };
    const first = mount(controls, {}, BASIC_STATE);
    (first.el.querySelector('.pc-group-toggle') as HTMLButtonElement).click();
    // A fresh panel for the same package and group picks the choice back up.
    const second = mount(controls, {}, BASIC_STATE);
    expect((second.el.querySelector('[data-group-id="open"]') as HTMLElement).getAttribute('data-collapsed')).toBe('');
  });

  it('survives localStorage being unavailable', () => {
    const original = window.localStorage;
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() { throw new Error('blocked'); },
    });
    try {
      const { el } = mount(SCHEMA_CONTROLS, {}, BASIC_STATE);
      expect(el.querySelectorAll('.pc-field')).toHaveLength(4);
      (el.querySelector('.pc-group-toggle') as HTMLButtonElement).click();
      expect((el.querySelector('[data-group-id="scores"]') as HTMLElement).getAttribute('data-collapsed')).toBe('');
    } finally {
      Object.defineProperty(window, 'localStorage', { configurable: true, value: original });
    }
  });

  it('a group with renderId shows only for the selected render', () => {
    const PConAir = loadRuntime();
    PConAir.preview = () => ({ destroy: () => {} });
    const controls = {
      groups: [
        { id: 'shared', label: 'Shared', fields: [{ type: 'toggle', field: 'live', label: 'A' }] },
        { id: 'cardonly', label: 'Card only', renderId: 'card', fields: [{ type: 'text', field: 'home.name', label: 'B' }] },
      ],
    };
    const el = document.createElement('div');
    document.body.appendChild(el);
    PConAir.controlPanel(el, { packageId: 'widget', name: 'W', controls, renders: TWO_RENDERS });
    last().fireOpen();

    expect((el.querySelector('[data-group-id="shared"]') as HTMLElement).hidden).toBe(false);
    expect((el.querySelector('[data-group-id="cardonly"]') as HTMLElement).hidden).toBe(true);

    const sel = el.querySelector('.pc-render-select') as HTMLSelectElement;
    sel.value = 'card';
    fire(sel, 'change');
    expect((el.querySelector('[data-group-id="cardonly"]') as HTMLElement).hidden).toBe(false);
    expect((el.querySelector('[data-group-id="shared"]') as HTMLElement).hidden).toBe(false);
  });

  it('destroy() tears down subscriptions, timers and the DOM', () => {
    vi.useFakeTimers();
    const { el, handle } = mount(SCHEMA_CONTROLS, {}, BASIC_STATE);
    const input = inputFor(el, 'home.name');
    input.value = 'Tigers';
    fire(input, 'input');
    handle.destroy();
    expect(el.innerHTML).toBe('');
    vi.advanceTimersByTime(500);
    expect(patchBodies()).toHaveLength(0);
  });
});

describe('T18 — action.countdown in the panel', () => {
  const CLOCK_CONTROLS = {
    groups: [
      {
        id: 'clock',
        label: 'Clock',
        fields: [
          { type: 'number', field: 'clock.duration', label: 'Duration', min: 0, max: 3600 },
          {
            type: 'action',
            label: 'Start',
            countdown: {
              verb: 'start',
              deadlineField: 'clock.deadline',
              valueField: 'clock.value',
              runningField: 'clock.running',
              secondsField: 'clock.duration',
            },
          },
          {
            type: 'action',
            label: 'Stop',
            countdown: {
              verb: 'stop',
              deadlineField: 'clock.deadline',
              valueField: 'clock.value',
              runningField: 'clock.running',
            },
          },
          {
            type: 'action',
            label: 'Reset',
            countdown: {
              verb: 'reset',
              deadlineField: 'clock.deadline',
              valueField: 'clock.value',
              runningField: 'clock.running',
              secondsField: 'clock.duration',
            },
          },
        ],
      },
    ],
  };

  const NOW = 1_700_000_000_000;

  function clockButton(el: HTMLElement, label: string): HTMLButtonElement {
    const found = Array.from(el.querySelectorAll('.pc-action')).find((b) => b.textContent === label);
    if (!found) throw new Error(`no button labelled '${label}'`);
    return found as HTMLButtonElement;
  }

  function clockPatch(): Record<string, unknown> {
    return patchBodies()[0].clock as Record<string, unknown>;
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  it('start sets a deadline of now + the declared duration', async () => {
    const { el } = mount(CLOCK_CONTROLS, {}, {
      clock: { deadline: 0, value: 0, running: false, duration: 300, format: 'mm:ss' },
    });
    clockButton(el, 'Start').click();
    await vi.advanceTimersByTimeAsync(0);
    expect(clockPatch()).toMatchObject({
      deadline: NOW + 300_000,
      value: 300,
      running: true,
      // The operator-set duration is untouched.
      duration: 300,
    });
  });

  it('start resumes from the remaining time when a clock is already running', async () => {
    const { el } = mount(CLOCK_CONTROLS, {}, {
      clock: { deadline: NOW + 42_000, value: 300, running: true, duration: 300, format: 'mm:ss' },
    });
    clockButton(el, 'Start').click();
    await vi.advanceTimersByTimeAsync(0);
    // 42s left, not a fresh 300 — restarting a running clock must not add time.
    expect(clockPatch()).toMatchObject({ deadline: NOW + 42_000, value: 42, running: true });
  });

  it('stop banks the remaining time and clears the deadline', async () => {
    const { el } = mount(CLOCK_CONTROLS, {}, {
      clock: { deadline: NOW + 42_500, value: 300, running: true, duration: 300, format: 'mm:ss' },
    });
    clockButton(el, 'Stop').click();
    await vi.advanceTimersByTimeAsync(0);
    // Rounded up, so stopping at 42.5s left does not silently lose a second.
    expect(clockPatch()).toMatchObject({ deadline: 0, value: 43, running: false });
  });

  it('reset restores the declared duration and stops', async () => {
    const { el } = mount(CLOCK_CONTROLS, {}, {
      clock: { deadline: NOW + 10_000, value: 10, running: true, duration: 300, format: 'mm:ss' },
    });
    clockButton(el, 'Reset').click();
    await vi.advanceTimersByTimeAsync(0);
    expect(clockPatch()).toMatchObject({ deadline: 0, value: 300, running: false });
  });

  it('a past deadline banks zero, never a negative', async () => {
    const { el } = mount(CLOCK_CONTROLS, {}, {
      clock: { deadline: NOW - 9_000, value: 300, running: true, duration: 300, format: 'mm:ss' },
    });
    clockButton(el, 'Stop').click();
    await vi.advanceTimersByTimeAsync(0);
    expect(clockPatch()).toMatchObject({ deadline: 0, value: 0, running: false });
  });

  it('honours a literal seconds when no secondsField is declared', async () => {
    const controls = {
      groups: [
        {
          id: 'clock',
          label: 'Clock',
          fields: [
            {
              type: 'action',
              label: 'Reset',
              countdown: {
                verb: 'reset',
                deadlineField: 'clock.deadline',
                valueField: 'clock.value',
                seconds: 90,
              },
            },
          ],
        },
      ],
    };
    const { el } = mount(controls, {}, { clock: { deadline: 0, value: 7, running: false, duration: 0, format: '' } });
    clockButton(el, 'Reset').click();
    await vi.advanceTimersByTimeAsync(0);
    expect(clockPatch()).toMatchObject({ deadline: 0, value: 90 });
  });

  it('omits runningField from the patch when the manifest omits it', async () => {
    const controls = {
      groups: [
        {
          id: 'clock',
          label: 'Clock',
          fields: [
            {
              type: 'action',
              label: 'Stop',
              countdown: { verb: 'stop', deadlineField: 'clock.deadline', valueField: 'clock.value' },
            },
          ],
        },
      ],
    };
    const { el } = mount(controls, {}, { clock: { deadline: NOW + 5000, value: 9, running: true, duration: 0, format: '' } });
    clockButton(el, 'Stop').click();
    await vi.advanceTimersByTimeAsync(0);
    // `running` survives untouched rather than being guessed at.
    expect(clockPatch()).toMatchObject({ deadline: 0, value: 5, running: true });
  });

  it('refuses a countdown verb while disconnected', async () => {
    const PConAir = loadRuntime();
    const el = document.createElement('div');
    document.body.appendChild(el);
    PConAir.controlPanel(el, { packageId: 'widget', name: 'W', controls: CLOCK_CONTROLS, renders: [] });
    pushState({ clock: { deadline: 0, value: 0, running: false, duration: 300, format: 'mm:ss' } });
    clockButton(el, 'Start').click();
    await vi.advanceTimersByTimeAsync(0);
    expect(patchBodies()).toHaveLength(0);
  });
});

describe('Acceptance — an operator restyles a live render from the panel, no reload', () => {
  /* The real template-overlay Look group, read off disk rather than
     re-declared, so this breaks if the shipped manifest drifts. */
  const OVERLAY_MANIFEST = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), 'demo-packages', 'template-overlay', 'package.json'), 'utf8')
  );
  const OVERLAY_RENDER_HTML = fs.readFileSync(
    path.join(process.cwd(), 'demo-packages', 'template-overlay', 'renders', 'overlay.html'),
    'utf8'
  );

  it('panel edit -> patch -> state frame -> CSS custom property on the render', async () => {
    const PConAir = loadRuntime();

    // 1. The operator's panel, built from the shipped manifest.
    const panelEl = document.createElement('div');
    document.body.appendChild(panelEl);
    PConAir.controlPanel(panelEl, {
      packageId: 'template-overlay',
      name: OVERLAY_MANIFEST.name,
      controls: OVERLAY_MANIFEST.controls,
      renders: OVERLAY_MANIFEST.renders.map((r: { id: string; label: string }) => ({ id: r.id, label: r.label })),
    });
    // NOT the shared last() helper (sockets[0], correct for every mount()-
    // based test in this file since their one panel client is always the
    // first socket created) -- this test creates TWO independent clients of
    // its own and needs each one's OWN socket, captured at the moment of its
    // own connect(). template-overlay declares renders, so the panel's own
    // construction above already opened a second, auxiliary socket via
    // buildPreview()'s P.preview() call (spec 17 s3.3) before we ever get
    // here -- sockets[0] is the panel, sockets[1] is preview's own.
    const panelSocket = sockets[0];
    panelSocket.fireOpen();
    panelSocket.fireMessage({
      type: 'state',
      namespace: 'package:template-overlay',
      state: OVERLAY_MANIFEST.initialState,
    });

    // 2. A render page, elsewhere, already on air.
    const renderClient = PConAir.connect('template-overlay', { role: 'render', renderId: 'overlay' });
    const renderSocket = sockets[sockets.length - 1];
    renderSocket.fireOpen();
    renderClient.applyStyle();
    renderSocket.fireMessage({
      type: 'state',
      namespace: 'package:template-overlay',
      state: OVERLAY_MANIFEST.initialState,
    });
    const root = document.documentElement;
    expect(root.style.getPropertyValue('--pc-accent')).toBe('#b5a998');

    // 3. The operator picks a new accent swatch and drags two sliders.
    const accentWrapper = panelEl.querySelector('[data-field-path="style.accent"]') as HTMLElement;
    const greenSwatch = accentWrapper.querySelector('[data-swatch="#3dd68c"]') as HTMLButtonElement;
    expect(greenSwatch).not.toBeNull();
    greenSwatch.click();

    const opacity = panelEl.querySelector('[data-field-path="style.panelOpacity"] input') as HTMLInputElement;
    opacity.value = '0.5';
    fire(opacity, 'change');

    const corner = panelEl.querySelector('[data-field-path="style.corner"] input') as HTMLInputElement;
    corner.value = '18';
    fire(corner, 'change');
    await flush();

    // Each edit went out as a patch carrying `style`'s other keys.
    const patches = patchBodies();
    expect(patches).toHaveLength(3);
    expect(patches[0].style).toEqual({ accent: '#3dd68c', panelOpacity: 0.94, corner: 4, tickerHeight: 80 });
    expect(patches[2].style).toMatchObject({ corner: 18 });

    // 4. The server echoes the merged state to every subscriber, including
    //    the render — which restyles itself with no reload and no file edit.
    const merged = {
      ...OVERLAY_MANIFEST.initialState,
      style: { accent: '#3dd68c', panelOpacity: 0.5, corner: 18, tickerHeight: 80 },
    };
    renderSocket.fireMessage({ type: 'state', namespace: 'package:template-overlay', state: merged });

    expect(root.style.getPropertyValue('--pc-accent')).toBe('#3dd68c');
    expect(root.style.getPropertyValue('--pc-panel-opacity')).toBe('0.5');
    expect(root.style.getPropertyValue('--pc-corner')).toBe('18');
    expect(root.style.getPropertyValue('--pc-ticker-height')).toBe('80');

    // 5. …and the render's own stylesheet really does consume those exact
    //    property names, so the values above are not landing in a vacuum.
    for (const prop of ['--pc-accent', '--pc-panel-opacity', '--pc-corner', '--pc-ticker-height']) {
      expect(OVERLAY_RENDER_HTML).toContain('var(' + prop);
    }
  });

  it('the panel reflects the echoed values back, so two operators agree', () => {
    const PConAir = loadRuntime();
    const panelEl = document.createElement('div');
    document.body.appendChild(panelEl);
    PConAir.controlPanel(panelEl, {
      packageId: 'template-overlay',
      name: OVERLAY_MANIFEST.name,
      controls: OVERLAY_MANIFEST.controls,
      renders: OVERLAY_MANIFEST.renders.map((r: { id: string }) => ({ id: r.id, label: r.id })),
    });
    last().fireOpen();
    pushOverlay(OVERLAY_MANIFEST.initialState);

    // Another operator (or Companion) changes the accent.
    pushOverlay({
      ...OVERLAY_MANIFEST.initialState,
      style: { ...OVERLAY_MANIFEST.initialState.style, accent: '#e5484d', corner: 22 },
    });
    const accent = panelEl.querySelector('[data-field-path="style.accent"] input') as HTMLInputElement;
    expect(accent.getAttribute('data-pc-raw')).toBe('#e5484d');
    const corner = panelEl.querySelector('[data-field-path="style.corner"] input') as HTMLInputElement;
    expect(corner.value).toBe('22');
  });

  function pushOverlay(state: unknown): void {
    last().fireMessage({ type: 'state', namespace: 'package:template-overlay', state });
  }

  it('an unsafe colour arriving in a state frame never reaches the render\'s style attribute', () => {
    // Belt and braces: the server rejects this at POST /state, but if one
    // ever got into persisted state, applyStyle still refuses to write it.
    const PConAir = loadRuntime();
    const renderClient = PConAir.connect('template-overlay', { role: 'render', renderId: 'overlay' });
    last().fireOpen();
    renderClient.applyStyle();
    pushOverlay({ style: { accent: '#fff; background: url(//evil/x.png)', corner: 4 } });
    const styleAttr = document.documentElement.getAttribute('style') || '';
    expect(styleAttr).not.toContain('evil');
    expect(styleAttr).not.toContain('url(');
    expect(document.documentElement.style.getPropertyValue('--pc-accent')).toBe('');
    // The safe sibling in the same frame still landed.
    expect(document.documentElement.style.getPropertyValue('--pc-corner')).toBe('4');
  });
});

describe('the generated shell path — controlPanel fetching its own controls', () => {
  it('fetches GET /api/packages/:id/controls and renders what comes back', async () => {
    fetchHandler = (url) => {
      if (url === '/api/packages/widget/controls') {
        return Promise.resolve(
          jsonResponse({
            id: 'widget',
            name: 'Widget From Server',
            renders: [{ id: 'main', label: 'Main', transport: null }],
            controls: SCHEMA_CONTROLS,
          })
        );
      }
      return Promise.resolve(jsonResponse({ state: {}, delivered: 1 }));
    };
    const PConAir = loadRuntime();
    const el = document.createElement('div');
    document.body.appendChild(el);
    // This is exactly the call the server-generated shell makes: id and name
    // only, no controls inline.
    const handle = PConAir.controlPanel(el, { packageId: 'widget', name: 'Widget' });
    await handle.ready;
    last().fireOpen();
    pushState(BASIC_STATE);

    expect(fetchCalls[0].url).toBe('/api/packages/widget/controls');
    expect((el.querySelector('.pc-panel-title') as HTMLElement).textContent).toBe('Widget From Server');
    expect(el.querySelectorAll('.pc-field')).toHaveLength(4);
    expect(inputFor(el, 'home.name').value).toBe('Lions');
  });

  it('explains a 401 instead of rendering an empty panel', async () => {
    fetchHandler = () => Promise.resolve(jsonResponse({ error: { message: 'nope' } }, 401));
    const PConAir = loadRuntime();
    const el = document.createElement('div');
    document.body.appendChild(el);
    const handle = PConAir.controlPanel(el, { packageId: 'widget', name: 'Widget' });
    await handle.ready.catch(() => {});
    const err = el.querySelector('.pc-panel-load-error') as HTMLElement;
    expect(err).not.toBeNull();
    expect(err.textContent).toMatch(/sign in as an operator/i);
    expect(err.getAttribute('role')).toBe('alert');
  });

  it('explains a 404 the same way', async () => {
    fetchHandler = () => Promise.resolve(jsonResponse({ error: { message: 'none' } }, 404));
    const PConAir = loadRuntime();
    const el = document.createElement('div');
    document.body.appendChild(el);
    const handle = PConAir.controlPanel(el, { packageId: 'widget', name: 'Widget' });
    await handle.ready.catch(() => {});
    expect((el.querySelector('.pc-panel-load-error') as HTMLElement).textContent).toMatch(/no controls/i);
  });

  it('throws a message naming the missing script when the renderer is absent', () => {
    // pconair.js alone, WITHOUT pconair-controls.js — what happens if someone
    // forgets the second <script> in a hand-written control.html.
    delete (window as unknown as Record<string, unknown>).PConAir;
    new Function(RUNTIME_SRC)();
    const PConAir = (window as unknown as { PConAir: any }).PConAir;
    expect(() => PConAir.controlPanel(document.createElement('div'), { packageId: 'w' })).toThrow(
      /pconair-controls\.js/
    );
  });

  it('shows the spec 16 presence indicator in its header', () => {
    const { el } = mount(SCHEMA_CONTROLS, {}, BASIC_STATE);
    const presence = el.querySelector('.pc-panel-presence') as HTMLElement;
    expect(presence).not.toBeNull();
    // Before any presence frame: no output connected.
    expect(presence.getAttribute('data-presence')).toBe('none');
    expect(presence.textContent).toMatch(/no output connected/i);

    last().fireMessage({
      type: 'presence',
      namespace: 'package:widget',
      presence: { renders: 2, byRender: { main: 2 }, controls: 1 },
    });
    expect(presence.getAttribute('data-presence')).toBe('ok');
    expect(presence.textContent).toBe('2 outputs');
  });

  it('rejects a call with no element or no packageId, rather than half-building', () => {
    const { PConAir } = mount(SCHEMA_CONTROLS, {}, BASIC_STATE);
    expect(() => PConAir.controlPanel(null, { packageId: 'w' })).toThrow(/el is required/);
    expect(() => PConAir.controlPanel(document.createElement('div'), {})).toThrow(/packageId is required/);
  });
});
