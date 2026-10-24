// @vitest-environment jsdom
//
// Regression test for the class of bug the task-2 reviewer found only by
// manually reading compiled output: esbuild's `external` vs `alias` option
// (see tests/setup/build-operator-renderer.ts and
// .superpowers/sdd/task-2-report.md, "A real bug I found and fixed in my
// own change" section) — a browser-incompatible `require("react")` call
// that would throw the instant the compiled bundle actually executed in a
// browser-like environment. Unit-testing the `.tsx` source in isolation
// (as the rest of this app's component-level tests do) would never catch
// that class of bug, because it's specific to what the *compiled, bundled*
// output does when it runs. This test's only job is to actually execute
// the real compiled `src/renderer/operator/index.js` bundle (the same file
// `tests/setup/build-operator-renderer.ts`'s esbuild step produces, and the
// same file `tests/operator-routes.test.ts` serves over HTTP) inside a real
// DOM and assert it does not throw, and that the two Slate-based mount
// points it renders into end up with real content.
//
// Approach chosen: load the *real* `operator/index.html` markup into the
// jsdom document (so every id the bundle's module-level `bindEvents()`/
// `document.getElementById(...)!` calls expect already exists — far less
// brittle than hand-authoring a "minimal" DOM that would silently drift
// from the real markup over time), then load the *real* vendored React /
// ReactDOM / Slate UMD bundles into `window` via `fs.readFileSync` +
// indirect `eval` (rather than stubbing `window.React`/`window.Slate`) so
// this test exercises the actual vendored library code the app ships, not
// a hand-rolled substitute. `WebSocket` and `fetch` are stubbed, since
// exercising real network/WS behavior isn't this test's job — only that
// the bundle boots without throwing.
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '..');
const INDEX_HTML_PATH = path.join(ROOT, 'src/renderer/operator/index.html');
const BUNDLE_PATH = path.join(ROOT, 'src/renderer/operator/index.js');
const REACT_PATH = path.join(ROOT, 'src/renderer/vendor/react/react.development.js');
const REACT_DOM_PATH = path.join(ROOT, 'src/renderer/vendor/react/react-dom.development.js');
const SLATE_JS_PATH = path.join(ROOT, 'src/renderer/vendor/slate/_ds_bundle.js');

/** Indirect eval — runs in global scope, matching how a real `<script>` tag executes. */
function loadGlobalScript(filePath: string): void {
  const code = fs.readFileSync(filePath, 'utf8');
  (0, eval)(code);
}

/** Minimal `WebSocket` stand-in — never connects, so no real network I/O or
 * dangling reconnect timers outlive the test. `connectWs()` only reads
 * `.addEventListener`, so that's all this needs to support. */
class FakeWebSocket extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  readyState = FakeWebSocket.CLOSED;
  constructor(_url: string | URL) {
    super();
  }
  close(): void {}
  send(): void {}
}

/** In-memory `localStorage` stand-in. In this sandbox, Node's own
 * experimental global `localStorage` (unconfigured, no `--localstorage-file`)
 * shadows jsdom's working implementation and throws
 * `TypeError: localStorage.getItem is not a function` — `index.tsx` reads/
 * writes a theme preference from `localStorage` at module-load time, so
 * this needs a real working stand-in regardless of environment quirks. */
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

describe('operator renderer boot (real DOM smoke test)', () => {
  const originalFetch = globalThis.fetch;
  const originalWebSocket = globalThis.WebSocket;
  const originalLocalStorage = globalThis.localStorage;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    (globalThis as unknown as { WebSocket: unknown }).WebSocket = originalWebSocket;
    Object.defineProperty(globalThis, 'localStorage', {
      value: originalLocalStorage,
      configurable: true,
    });
  });

  it('executes the compiled bundle without throwing and renders both mount points', async () => {
    // ── Stub network + WS + localStorage (see file header) ────────────
    (globalThis as unknown as { WebSocket: unknown }).WebSocket = FakeWebSocket;
    globalThis.fetch = (async () => ({
      ok: true,
      status: 200,
      json: async () => ({}),
    })) as unknown as typeof fetch;
    Object.defineProperty(globalThis, 'localStorage', {
      value: createMemoryStorage(),
      configurable: true,
    });

    // ── Load the real page markup ─────────────────────────────────────
    const html = fs.readFileSync(INDEX_HTML_PATH, 'utf8');
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
    if (!bodyMatch) throw new Error('Could not find <body>...</body> in operator/index.html');
    document.documentElement.setAttribute('lang', 'en');
    document.documentElement.setAttribute('data-theme', 'light');
    document.body.innerHTML = bodyMatch[1];

    // Sanity check: the two React mount points this task's bundle targets
    // (see src/renderer/operator/index.tsx, LiveControl.tsx) are present
    // in the real markup before we even load the bundle.
    expect(document.getElementById('status-header-root')).not.toBeNull();
    expect(document.getElementById('live-control-panels-root')).not.toBeNull();

    // ── Load the real vendored libraries as classic global scripts ────
    loadGlobalScript(REACT_PATH);
    loadGlobalScript(REACT_DOM_PATH);
    loadGlobalScript(SLATE_JS_PATH);
    expect(typeof (globalThis as unknown as { React?: unknown }).React).toBe('object');
    expect(typeof (globalThis as unknown as { ReactDOM?: unknown }).ReactDOM).toBe('object');
    expect(typeof (globalThis as unknown as { Slate?: unknown }).Slate).toBe('object');

    // ── Load the compiled operator bundle ──────────────────────────────
    // This is the file whose *compiled* form previously threw
    // `Error('Dynamic require of "react" is not supported')` at the top of
    // the script before the esbuild `external` -> `alias` fix (task 2).
    // `globalSetup` in vitest.config.ts (tests/setup/build-operator-renderer.ts)
    // regenerates this file from the current `.tsx` source before any test
    // file runs, so it reflects the current source, not a stale artifact.
    expect(fs.existsSync(BUNDLE_PATH)).toBe(true);
    // Catches an uncaught render/effect error React can't always get back
    // to the top-level `loadGlobalScript` call for (its own async recovery
    // path dispatches a `window` `error` event, or rejects a promise,
    // rather than rethrowing synchronously) — a real regression check, not
    // just a debugging aid.
    const caughtErrors: unknown[] = [];
    window.addEventListener('error', (e) => { caughtErrors.push((e as ErrorEvent).error ?? e); });
    process.on('unhandledRejection', (err) => { caughtErrors.push(err); });
    expect(() => loadGlobalScript(BUNDLE_PATH)).not.toThrow();

    // React 18's `createRoot` schedules each root's initial commit through
    // its own scheduler work rather than flushing synchronously within the
    // script that called `.render()`. With three roots now rendered
    // together (status header, Live Control, Camera panel — see
    // `renderReactRoots()` in index.tsx), two bare `setTimeout(0)` turns
    // reliably flush the first two but not reliably the third; wait across
    // several turns so every root's commit has actually landed before any
    // content assertion below.
    for (let i = 0; i < 10; i++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    // ── Assert the two Slate-based regions actually rendered content ───
    const statusHeaderRoot = document.getElementById('status-header-root')!;
    const liveControlPanelsRoot = document.getElementById('live-control-panels-root')!;
    expect(statusHeaderRoot.innerHTML.length).toBeGreaterThan(0);
    expect(liveControlPanelsRoot.innerHTML.length).toBeGreaterThan(0);

    // Mode Tag (Slate.Tag) renders the default "IDLE" mode label, and the
    // PANIC button (Slate.Button) renders its default label — both prove
    // the Slate components actually mounted and rendered real DOM, not
    // just an empty root.
    expect(statusHeaderRoot.textContent).toContain('IDLE');
    expect(statusHeaderRoot.textContent).toContain('PANIC');
    expect(liveControlPanelsRoot.textContent).toContain('Idle');

    // ── Camera panel (spec 24 Phase 1 Track 1C) ────────────────────────
    // camera-panel-root is a third permanent React root, always rendered
    // (like the two above) regardless of which nav tab is visible — assert
    // it has real content even before the Camera tab is ever opened.
    const cameraPanelRoot = document.getElementById('camera-panel-root')!;
    expect(cameraPanelRoot).not.toBeNull();
    expect(cameraPanelRoot.textContent).toContain('Camera device');

    // Clicking the Camera nav tab must not throw even though this stubbed
    // `fetch` returns `{}` for every request (no `devices`/`displays`
    // array) and jsdom has no `navigator.mediaDevices` at all — the panel
    // must tolerate both without crashing, since no device is selected by
    // default (makeCameraState()) so the live-preview effect never calls
    // into `navigator.mediaDevices` in this boot path.
    const cameraNavItem = document.querySelector<HTMLElement>('.nav-item[data-target="camera"]')!;
    expect(cameraNavItem).not.toBeNull();
    expect(() => cameraNavItem.click()).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const cameraSection = document.querySelector<HTMLElement>('section[data-tab="camera"]')!;
    expect(cameraSection.hidden).toBe(false);
    expect(cameraPanelRoot.textContent).toContain('No cameras found');
    expect(cameraPanelRoot.textContent).toContain('Unknown (not probed yet)');
    expect(cameraPanelRoot.textContent).toContain('Disconnected');

    expect(caughtErrors).toEqual([]);
  });
});
