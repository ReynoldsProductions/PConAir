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

/** Let the microtask queue drain — patch() is two chained promises deep. */
async function flush(): Promise<void> {
  for (let i = 0; i < 6; i++) await Promise.resolve();
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

  it('marks every input aria-disabled and shows the banner while disconnected', () => {
    const { el } = mountDisconnected();
    expect(banner(el).hidden).toBe(false);
    expect(banner(el).textContent).toMatch(/not connected/i);
    const inputs = Array.from(el.querySelectorAll('input, select, textarea, button'));
    expect(inputs.length).toBeGreaterThan(0);
    for (const i of inputs) expect(i.getAttribute('aria-disabled')).toBe('true');
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
