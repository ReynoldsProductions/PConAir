# Electron 32 → 44 Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move PConAir from Electron 32.3.3 (Chromium 128, end-of-life, no security backports) to Electron 44.x (Chromium 152) without regressing the window, display and session behaviour that no test currently covers.

**Architecture:** Three phases, and the order is the whole point. **Phase 0 builds a test net around the 16 Electron-touching files while still on Electron 32**, so the tests pin *current, known-good* behaviour. **Phase 1** bumps the toolchain, then Electron, using that net to catch regressions. **Phase 2** covers what tests structurally cannot: real windows on real displays, driven by a human. Do not reorder. Bumping first and testing after yields a pile of failures with no baseline to separate "Electron changed this" from "this was always broken."

**Tech Stack:** Electron 32.3.3 → 44.x · Node 20.18.1 → 24.x · Electron Forge 7.4 → 7.11.x · TypeScript 5.3 · Vitest 2.1.9 + jsdom · esbuild (test globalSetup) · webpack (Forge renderer build)

**Spec:** No separate spec document. The **Audit Findings** section below *is* the spec — produced by reading the codebase on 2026-09-28 at `main` = `4c07bfb`. Every number in it is measured, not estimated. Executors read that section first.

---

## Global Constraints

- **Target Electron 44.x**, not 42 or 43. Electron supports only its latest three majors; 44 buys the longest runway for the same effort.
- **Do not touch `graphics/**`, `bundled-packages/**`, `demo-packages/**`, or `src/runtime/**`.** Render and control pages are deliberately vanilla ES5-safe with no build step (`plan_approved.md:42`) so they run in OBS's older CEF and vMix. They are unaffected by the Electron version and must stay that way.
- **Keep `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`** on every `BrowserWindow`. The current posture is already correct — never loosen it to make something work.
- **Session partition names are load-bearing and must not change:** `persist:google-slides`, `persist:pconair-url-A`, `persist:pconair-url-B`. Renaming one silently signs the operator out of Google and loses the prompter's Drive connection.
- **Do not bundle unrelated upgrades.** Vitest 2.1.9 → 5.0.2, React/Slate, and code signing are out of scope. One variable at a time.
- **No new runtime dependencies.** Test-only dev dependencies are acceptable if genuinely needed.
- Commit after every task. Every task ends with `npx vitest run` and `npx tsc --noEmit` both clean.

---

## Audit Findings

### Versions

| | Electron | Chromium | Node |
|---|---|---|---|
| Installed (locked in `package-lock.json`) | 32.3.3 | 128.0.6613.186 | 20.18.1 |
| Target | 44.4.5 | 152.0.7977.130 | 24.21.0 |

Electron 32 is twelve majors past its support window (supported line: 42/43/44), so it receives **no security backports**. Chromium 128 shipped around August 2024.

### Why this matters more here than for a typical desktop app

Three paths put that unpatched engine in front of untrusted or credentialed content:

1. **`persist:google-slides` holds a live signed-in Google session** — used by Slides mode (`src/main/slides/window-manager.ts:86`) and the prompter's Drive fetch (`src/main/prompter/doc-transport.ts:20`).
2. **URL mode loads arbitrary operator-supplied URLs** into `BrowserWindow`s (`src/main/url/window-manager.ts:47`).
3. **The embedded server is LAN-reachable**, and internet-reachable when the Cloudflare tunnel is on.

### Electron API surface

Only ten Electron modules are imported across the entire main process:

`BrowserWindow`, `Menu`, `Tray`, `app`, `dialog`, `ipcMain`, `nativeImage`, `screen`, `session`, `shell`

Plus `contextBridge` and `ipcRenderer` in the two preloads.

Reference counts across `src/`: `app` 158 · `session` 95 · `BrowserWindow` 72 · `screen` 48 · `webContents` 31 · `ipcMain` 15 · `ipcRenderer` 12 · `shell` 7 · `dialog` 6 · `contextBridge` 5 · `Tray` 5 · `net` 4 · `nativeImage` 2 · `Menu` 2

**Verified good news:** there is **no** `protocol.registerFileProtocol` or custom protocol handler anywhere — the 12 "protocol" greps are all `URL.protocol` string parsing. Custom protocol migration, historically the nastiest part of an Electron upgrade, does not apply here.

### The actual risk: 16 Electron-touching files, zero test coverage

**No test in the suite imports `electron`.** All 1218 passing tests exercise the Express/WS/state layer, which the upgrade will not touch. The code the upgrade *will* touch has no coverage at all:

| File | Electron refs | Real entry points | Covered? | Task |
|---|---|---|---|---|
| `src/main/index.ts` | 43 | app bootstrap | partial (routes only) | — (covered indirectly) |
| `src/main/slides/window-manager.ts` | 34 | `createSlidesWindowManager` | **none** | 3 |
| `src/main/settings-window.ts` | 15 | `openSettingsWindow`, `registerSettingsIpc` | **none** | 2 |
| `src/main/watchdog-electron.ts` | 13 | `startWatchdog`, `PING_CHANNEL`, `PONG_CHANNEL` | **none** | 7 |
| `src/main/url/window-manager.ts` | 12 | `createUrlWindowManager` | **none** | 3 |
| `src/main/prompter/doc-transport.ts` | 12 | `createElectronDocTransport` | **none** | 8 |
| `src/main/director-window.ts` | 10 | `openDirectorWindow`, `registerDirectorIpc` | **none** | 5 |
| `src/main/tray.ts` | 7 | `createAppTray`, `updateTrayMenu` | **none** | 5 |
| `src/main/prompter/window-manager.ts` | 7 | `createPrompterWindowManager` | **none** | 4 |
| `src/main/media-library/window-manager.ts` | 7 | `createMediaLibraryWindowManager` | **none** | 4 |
| `src/main/stagetimer/overlay.ts` | 5 | `createStageTimerOverlay` | **none** | 6 |
| `src/main/tunnel/qr-overlay.ts` | 4 | `showQrOverlay`, `hideQrOverlay` | **none** | 6 |
| `src/main/output-cursor.ts` | 4 | `hideCursorOnLoad` | **none** | 6 |
| `src/main/fullscreen-chrome.ts` | — | `applyFullscreenChrome`, `scheduleFullscreenChrome` | **none** | 6 |
| `src/renderer/settings-preload.ts` | — | `contextBridge` surface | **none** | 9 |
| `src/renderer/director-preload.ts` | — | `contextBridge` surface | **none** | 9 |

That table is the migration. Everything else is bookkeeping.

### Build toolchain

- `@electron-forge/{cli,maker-dmg,maker-zip,plugin-webpack}` all `^7.4.0`; latest is **7.11.2**. Forge must be bumped **before** Electron — older Forge cannot package newer Electron.
- `.github/workflows/build-release.yml` pins `node-version: '20'` in **two** places (lines 19 and 96). Both become 24.
- `package.json` has **no `engines` field**. Add one so a stale local Node fails loudly rather than producing a strange build.
- `tests/setup/build-operator-renderer.ts` uses **esbuild**, independent of Forge's webpack — unaffected by the bump, and the reason the suite runs with no Electron at all.

### Known unknown — read before starting

**This plan deliberately does not enumerate the Electron 33→44 breaking changes.** Electron 44 postdates the authoring assistant's reliable knowledge, and a fabricated list would be worse than none — it would send an executor chasing changes that do not exist while missing ones that do. **Task 1 harvests the real list from Electron's own docs.** Everything downstream is checked against that harvested document, never against recollection.

---

## File Structure

**New files:**

| File | Responsibility |
|---|---|
| `tests/setup/electron-mock.ts` | The fake `electron` module (`electronModule`) plus the `electronMock` recorder. Every Phase 0 test imports both. One file, because the fakes must stay consistent across tests. |
| `tests/window-managers.test.ts` | Characterization tests for the four `create*WindowManager` factories (slides, url, prompter, media-library). They share fakes and change together. |
| `tests/electron-chrome-windows.test.ts` | Characterization tests for `settings-window`, `director-window`, `tray`, and the overlays (`output-cursor`, `fullscreen-chrome`, `qr-overlay`, `stagetimer/overlay`). |
| `tests/watchdog-electron.test.ts` | Watchdog `webContents` ping/pong, unresponsive and crash handling. Separate file: it drives timers and events, and mixing that with window tests makes both harder to read. |
| `tests/prompter-doc-transport.test.ts` | `createElectronDocTransport` fetching through the Google partition. |
| `tests/preload-surface.test.ts` | The `contextBridge.exposeInMainWorld` API shape for both preloads. |
| `docs/plans/electron-44-breaking-changes.md` | Harvested, dated breaking-change notes for majors 33–44, each with a PConAir applicability verdict. Produced by Task 1, consumed by Tasks 13–16. |
| `docs/electron-upgrade-smoke-checklist.md` | The human smoke test. Outlives this migration — reuse on every future Electron bump. |

**Modified files:**

| File | Change |
|---|---|
| `package.json` | `electron` `^32.0.0` → `^44.0.0`; four Forge packages → `^7.11.0`; add `engines.node` |
| `package-lock.json` | regenerated |
| `.github/workflows/build-release.yml:19,96` | `node-version: '20'` → `'24'` |
| Whatever Task 15 triage identifies | fixes driven by the harvested breaking-change list |

---

## Agent Roster

Dispatch with the `Agent` tool. **Tasks 3–9 are independent files with no shared mutable state — dispatch all seven in a single message so they run concurrently.** Everything else is sequential.

| Agent type | Tasks | Why this agent |
|---|---|---|
| `general-purpose` | 1 | Needs `WebFetch`/`WebSearch` to harvest Electron's docs plus `Write` to save them. `Explore` cannot write files. |
| `Explore` | pre-flight for 3–9 | Optional read-only confirmation that the entry-point table above is still accurate before tests are written against it. Cheap, zero write risk. |
| `claude` | 2–9, 11–16 | Full tool access; needs `Edit`/`Write`/`Bash` to write and run tests. |
| `Plan` | 15 (triage only) | If Task 14's bump produces more than ~10 distinct failures, hand triage to `Plan` to sequence fixes before any code changes. Skip if failures are few. |
| **Human — not an agent** | 17 | Requires a physical Mac, a second display, a real Google login, and eyes on the output. Not automatable. |

**Agent briefing rule:** every dispatched agent must be told to read this file **and** `docs/plans/electron-44-breaking-changes.md` (once Task 1 exists) before starting, because each agent sees only its own task.

**Hard rule for Phase 0 agents:** if a characterization test cannot be made to pass on **Electron 32**, the *test* is wrong — fix the test, never the source. Phase 0 must not change production behaviour. A Phase 0 task whose diff touches anything under `src/` beyond a comment has failed and must be rejected at review.

---

## Test Strategy

**The core idea: characterization tests, written first, on the old version.**

These do not assert *correct* behaviour — they assert *current* behaviour: "this is the `BrowserWindow` options object we pass today," "this is the partition string we ask for today," "this is the display we pick today." Their value is that when Electron 44 changes something underneath, a test goes red and names the file, instead of an operator discovering it mid-show.

**Three layers:**

1. **Unit, mocked Electron (Phase 0).** A fake `electron` module whose doubles record calls. Fast, CI-friendly, no display required. Covers window options, partition names, display selection, IPC channel names, crash/unresponsive handling, tray wiring, preload surface. This is where the net gets built.
2. **The existing suite, unchanged.** 1218 tests over routes/state/actions. Must stay green throughout. It will not catch Electron regressions — that is layer 1's job.
3. **Human smoke (Phase 2).** Real windows, real displays, real Google login, real DMG. Covers what mocks cannot: whether a window actually appears on the right monitor and whether the Google session actually survives a restart.

**Why not Playwright/end-to-end GUI automation?** It needs a display in CI, a signed build and a Google test account, and would take longer to stabilise than the migration itself. The mock layer plus a written human checklist is the right cost/benefit. Revisit only if Electron upgrades become routine.

**Phase 0 coverage target:** every file in the Audit Findings table has at least one test asserting its Electron interaction. Call-shape coverage, not line coverage.

---

## Phase 0 — Build the net (still on Electron 32)

### Task 1: Harvest the real breaking-change list

**Agent:** `general-purpose` (needs WebFetch + Write)

**Files:**
- Create: `docs/plans/electron-44-breaking-changes.md`

**Interfaces:**
- Produces: a dated markdown document, one section per major 33→44. Each entry records the API, what changed, and a verdict line `applies: yes — <file>:<line>` or `applies: no`, checked against the Audit Findings API surface.

- [ ] **Step 1: Fetch the official docs**

Fetch `https://www.electronjs.org/docs/latest/breaking-changes` plus the per-major release notes for 33 through 44. Prefer official docs over blog summaries.

- [ ] **Step 2: Filter to our surface**

Keep only changes touching: `app`, `BrowserWindow`, `session`, `screen`, `webContents`, `ipcMain`, `ipcRenderer`, `contextBridge`, `Tray`, `Menu`, `dialog`, `shell`, `nativeImage`, `net`. Discard the rest — the audit verified we use no custom protocols, `desktopCapturer`, `globalShortcut`, `utilityProcess`, `safeStorage` or `powerSaveBlocker`.

- [ ] **Step 3: Grep each surviving change against the codebase and record a verdict**

```bash
grep -rn "session.fromPartition" --include="*.ts" src/
grep -rn "screen.getAllDisplays\|screen.getPrimaryDisplay" --include="*.ts" src/
grep -rn "setWindowOpenHandler\|webContents.on(" --include="*.ts" src/
```

- [ ] **Step 4: Flag Node 20 → 24 removals separately**

```bash
grep -rnE "\bnew Buffer\(|url\.parse\(|fs\.rmdir\(|process\.binding|require\('sys'\)" --include="*.ts" src/
```

- [ ] **Step 5: Commit**

```bash
git add docs/plans/electron-44-breaking-changes.md
git commit -m "docs: harvest Electron 33-44 breaking changes with PConAir applicability"
```

**Gate:** a human reads this document before Task 14. If it concludes "no breaking changes apply," treat that as a red flag and re-check — twelve majors always carry something.

---

### Task 2: Electron mock harness + first characterization test

**Agent:** `claude`

**Files:**
- Create: `tests/setup/electron-mock.ts`
- Create: `tests/electron-chrome-windows.test.ts`

**Interfaces:**
- Produces: `electronModule` (the fake `electron` module object) and `electronMock` (the recorder: `{ windows, trays, displays, partitionsRequested, ipcChannels, exposed, reset() }`). **Tasks 3–9 all consume these exact names and this exact shape** — changing it later means updating all of them.

- [ ] **Step 1: Write the mock harness**

`require('electron')` outside an Electron runtime returns *the path to the binary as a string*, not the API — which is exactly why no existing test imports it. The module must be faked wholesale.

Note the structure: the fake module is a plain **export**, not something installed by a function. `vi.mock` is hoisted only within the file it appears in, so calling it inside a helper would not work; each test file declares its own hoisted `vi.mock` that pulls this export.

```ts
// tests/setup/electron-mock.ts
import { vi } from 'vitest';

export interface RecordedWindow {
  options: Record<string, unknown>;
  loadedUrl: string | null;
  calls: string[];
  destroyed: boolean;
  webContents: FakeWebContents;
}

export const electronMock = {
  windows: [] as RecordedWindow[],
  trays: [] as Array<{ tooltip: string | null; menuLabels: string[] }>,
  partitionsRequested: [] as string[],
  ipcChannels: [] as string[],
  exposed: {} as Record<string, unknown>,
  displays: [
    { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1055 }, label: 'primary', scaleFactor: 2 },
    { id: 2, bounds: { x: 1920, y: 0, width: 1920, height: 1080 }, workArea: { x: 1920, y: 0, width: 1920, height: 1080 }, label: 'NV-32-H-3', scaleFactor: 1 },
  ],
  reset() {
    this.windows.length = 0;
    this.trays.length = 0;
    this.partitionsRequested.length = 0;
    this.ipcChannels.length = 0;
    this.exposed = {};
  },
};

export class FakeWebContents {
  private handlers = new Map<string, Array<(...a: unknown[]) => void>>();
  constructor(private rec: RecordedWindow) {}
  on(event: string, fn: (...a: unknown[]) => void) {
    this.rec.calls.push(`webContents.on:${event}`);
    const list = this.handlers.get(event) ?? [];
    list.push(fn);
    this.handlers.set(event, list);
    return this;
  }
  once(event: string, fn: (...a: unknown[]) => void) { return this.on(event, fn); }
  /** Test-only: drive an event the source subscribed to. */
  emit(event: string, ...args: unknown[]) {
    for (const fn of this.handlers.get(event) ?? []) fn({ preventDefault() {} }, ...args);
  }
  hasHandler(event: string) { return (this.handlers.get(event) ?? []).length > 0; }
  send(channel: string) { this.rec.calls.push(`webContents.send:${channel}`); }
  executeJavaScript(code: string) { this.rec.calls.push('executeJavaScript'); void code; return Promise.resolve(); }
  insertCSS() { this.rec.calls.push('insertCSS'); return Promise.resolve(''); }
  setAudioMuted() { this.rec.calls.push('setAudioMuted'); }
  setWindowOpenHandler() { this.rec.calls.push('setWindowOpenHandler'); }
  openDevTools() { this.rec.calls.push('openDevTools'); }
  isLoading() { return false; }
  getURL() { return this.rec.loadedUrl ?? ''; }
}

export class FakeBrowserWindow {
  webContents: FakeWebContents;
  private rec: RecordedWindow;
  constructor(options: Record<string, unknown> = {}) {
    this.rec = { options, loadedUrl: null, calls: [], destroyed: false, webContents: null as unknown as FakeWebContents };
    this.webContents = new FakeWebContents(this.rec);
    this.rec.webContents = this.webContents;
    electronMock.windows.push(this.rec);
  }
  static getAllWindows() { return []; }
  loadURL(url: string) { this.rec.loadedUrl = url; return Promise.resolve(); }
  loadFile(p: string) { this.rec.loadedUrl = `file://${p}`; return Promise.resolve(); }
  on(event: string) { this.rec.calls.push(`on:${event}`); return this; }
  once(event: string) { this.rec.calls.push(`once:${event}`); return this; }
  show() { this.rec.calls.push('show'); }
  showInactive() { this.rec.calls.push('showInactive'); }
  hide() { this.rec.calls.push('hide'); }
  focus() { this.rec.calls.push('focus'); }
  close() { this.rec.calls.push('close'); }
  destroy() { this.rec.destroyed = true; }
  isDestroyed() { return this.rec.destroyed; }
  isVisible() { return true; }
  setBounds(b: unknown) { this.rec.calls.push(`setBounds:${JSON.stringify(b)}`); }
  getBounds() { return { x: 0, y: 0, width: 1920, height: 1080 }; }
  setFullScreen(v: boolean) { this.rec.calls.push(`setFullScreen:${v}`); }
  setAlwaysOnTop(v: boolean) { this.rec.calls.push(`setAlwaysOnTop:${v}`); }
  setIgnoreMouseEvents(v: boolean) { this.rec.calls.push(`setIgnoreMouseEvents:${v}`); }
  setMenuBarVisibility() { this.rec.calls.push('setMenuBarVisibility'); }
  setVisibleOnAllWorkspaces() { this.rec.calls.push('setVisibleOnAllWorkspaces'); }
  /** Test-only accessor. */
  get recorded() { return this.rec; }
}

export function fakeSessionFor(partition: string) {
  return {
    partition,
    cookies: { set: vi.fn().mockResolvedValue(undefined), get: vi.fn().mockResolvedValue([]) },
    fetch: vi.fn().mockResolvedValue({
      ok: true, status: 200,
      text: () => Promise.resolve(''),
      json: () => Promise.resolve({}),
    }),
    clearStorageData: vi.fn().mockResolvedValue(undefined),
    setPermissionRequestHandler: vi.fn(),
    webRequest: { onBeforeSendHeaders: vi.fn(), onHeadersReceived: vi.fn() },
  };
}

export const electronModule = {
  app: {
    getPath: vi.fn(() => '/tmp/pconair-test'),
    getVersion: vi.fn(() => '0.0.0-test'),
    getName: vi.fn(() => 'PConAir'),
    on: vi.fn(),
    once: vi.fn(),
    whenReady: vi.fn().mockResolvedValue(undefined),
    quit: vi.fn(),
    exit: vi.fn(),
    relaunch: vi.fn(),
    dock: { hide: vi.fn(), show: vi.fn() },
    setLoginItemSettings: vi.fn(),
    getLoginItemSettings: vi.fn(() => ({ openAtLogin: false })),
  },
  BrowserWindow: FakeBrowserWindow,
  session: {
    defaultSession: fakeSessionFor('default'),
    fromPartition: vi.fn((p: string) => {
      electronMock.partitionsRequested.push(p);
      return fakeSessionFor(p);
    }),
  },
  screen: {
    getAllDisplays: vi.fn(() => electronMock.displays),
    getPrimaryDisplay: vi.fn(() => electronMock.displays[0]),
    getCursorScreenPoint: vi.fn(() => ({ x: 0, y: 0 })),
    getDisplayNearestPoint: vi.fn(() => electronMock.displays[0]),
    on: vi.fn(),
  },
  ipcMain: {
    handle: vi.fn((channel: string) => { electronMock.ipcChannels.push(`handle:${channel}`); }),
    on: vi.fn((channel: string) => { electronMock.ipcChannels.push(`on:${channel}`); }),
    removeHandler: vi.fn(),
  },
  ipcRenderer: {
    invoke: vi.fn().mockResolvedValue(undefined),
    send: vi.fn(),
    on: vi.fn(),
  },
  contextBridge: {
    exposeInMainWorld: vi.fn((key: string, api: unknown) => { electronMock.exposed[key] = api; }),
  },
  Tray: class {
    constructor() { electronMock.trays.push({ tooltip: null, menuLabels: [] }); }
    setToolTip(t: string) { electronMock.trays[electronMock.trays.length - 1].tooltip = t; }
    setContextMenu(menu: { items?: Array<{ label: string }> } | null) {
      electronMock.trays[electronMock.trays.length - 1].menuLabels = (menu?.items ?? []).map((i) => i.label);
    }
    setImage() {}
    on() { return this; }
    destroy() {}
  },
  Menu: { buildFromTemplate: vi.fn((t: Array<{ label: string }>) => ({ items: t })) },
  dialog: { showOpenDialog: vi.fn().mockResolvedValue({ canceled: true, filePaths: [] }) },
  shell: { openExternal: vi.fn().mockResolvedValue(undefined), showItemInFolder: vi.fn() },
  nativeImage: { createFromPath: vi.fn(() => ({ isEmpty: () => false, resize: vi.fn(() => ({})) })) },
};
```

- [ ] **Step 2: Write the first failing test**

`settings-window.ts` first: small, and its `webPreferences` are a security invariant worth pinning.

```ts
// tests/electron-chrome-windows.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Hoisted by vitest within THIS file. The factory pulls the shared fake.
vi.mock('electron', async () => (await import('./setup/electron-mock')).electronModule);

import { electronMock } from './setup/electron-mock';

describe('settings window', () => {
  beforeEach(() => {
    electronMock.reset();
    vi.resetModules();
  });

  it('opens with context isolation on, node integration off, sandbox on', async () => {
    const { openSettingsWindow } = await import('../src/main/settings-window');
    openSettingsWindow();

    expect(electronMock.windows).toHaveLength(1);
    const wp = electronMock.windows[0].options.webPreferences as Record<string, unknown>;
    expect(wp.contextIsolation).toBe(true);
    expect(wp.nodeIntegration).toBe(false);
    expect(wp.sandbox).toBe(true);
    expect(wp.preload).toBeTruthy();
  });
});
```

- [ ] **Step 3: Run it and check it fails for the right reason**

```bash
npx vitest run tests/electron-chrome-windows.test.ts
```

A failure about a missing mock method is fine — add it to `electron-mock.ts`. A failure claiming `openSettingsWindow` is not a function means the real signature differs: **read `src/main/settings-window.ts` and correct the test**, never the source.

- [ ] **Step 4: Make it pass**

```bash
npx vitest run tests/electron-chrome-windows.test.ts
```

- [ ] **Step 5: Confirm the mock does not leak into the other 1218 tests**

```bash
npx vitest run && npx tsc --noEmit
```

The `vi.mock` is file-scoped by design. If anything else breaks, do **not** promote it to a global `setupFiles` entry — that is what would cause the leak.

- [ ] **Step 6: Commit**

```bash
git add tests/setup/electron-mock.ts tests/electron-chrome-windows.test.ts
git commit -m "test: add Electron mock harness and settings-window characterization test"
```

---

### Tasks 3–9: Characterization tests (dispatch all seven in parallel)

Each task below carries its own full step list. They are repeated rather than cross-referenced because an executor may read tasks out of order.

Every task opens its test file with the same two lines — these are **required** and file-scoped:

```ts
vi.mock('electron', async () => (await import('./setup/electron-mock')).electronModule);
import { electronMock } from './setup/electron-mock';
```

#### Task 3: Slides + URL window managers

**Agent:** `claude` · **Files:** Create `tests/window-managers.test.ts` · Read only: `src/main/slides/window-manager.ts`, `src/main/url/window-manager.ts`

`createUrlWindowManager(config)` takes `{ store, getDisplayPreference }` and returns `{ initialize, loadUrl, showInstance, getActiveWindow, destroy }` (`src/main/url/window-manager.ts:145`). `createSlidesWindowManager` is the parallel factory.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
vi.mock('electron', async () => (await import('./setup/electron-mock')).electronModule);
import { electronMock } from './setup/electron-mock';
import { createStateStore } from '../src/main/state';

describe('url window manager', () => {
  beforeEach(() => { electronMock.reset(); vi.resetModules(); });

  it('gives each A/B instance its own persistent partition', async () => {
    const { createUrlWindowManager } = await import('../src/main/url/window-manager');
    const mgr = createUrlWindowManager({ store: createStateStore(), getDisplayPreference: () => null });
    await mgr.loadUrl('A', 'http://localhost/graphics/news/index.html');
    expect(electronMock.partitionsRequested).toContain('persist:pconair-url-A');
  });

  it('honours an explicit display target over the profile preference', async () => {
    const { createUrlWindowManager } = await import('../src/main/url/window-manager');
    const mgr = createUrlWindowManager({ store: createStateStore(), getDisplayPreference: () => '1' });
    await mgr.loadUrl('A', 'http://localhost/', '2');
    const setBounds = electronMock.windows[0].calls.find((c) => c.startsWith('setBounds'));
    expect(setBounds).toContain('1920'); // display 2 origin x
  });
});

describe('slides window manager', () => {
  beforeEach(() => { electronMock.reset(); vi.resetModules(); });

  it('requests the persistent Google Slides partition', async () => {
    const { createSlidesWindowManager } = await import('../src/main/slides/window-manager');
    const mgr = createSlidesWindowManager({ store: createStateStore() });
    await mgr.initialize?.();
    expect(electronMock.partitionsRequested).toContain('persist:google-slides');
  });
});
```

- [ ] **Step 2: Run and confirm failure** — `npx vitest run tests/window-managers.test.ts`
- [ ] **Step 3: Correct the test against the real signatures.** Read both sources; fix argument shapes and factory config objects. Extend `electron-mock.ts` if a method is genuinely missing. **Do not modify `src/`.**
- [ ] **Step 4: Green, then whole suite** — `npx vitest run && npx tsc --noEmit`
- [ ] **Step 5: Commit**

```bash
git add tests/window-managers.test.ts tests/setup/electron-mock.ts
git commit -m "test: characterize slides and URL window managers"
```

#### Task 4: Prompter + media-library window managers

**Agent:** `claude` · **Files:** Modify `tests/window-managers.test.ts` · Read only: `src/main/prompter/window-manager.ts`, `src/main/media-library/window-manager.ts`

Display targeting matters most here — the prompter is pinned to a display via `load_url`, and display selection is exactly what a `screen` API change would break.

- [ ] **Step 1: Write the failing tests**

```ts
describe('prompter window manager', () => {
  beforeEach(() => { electronMock.reset(); vi.resetModules(); });

  it('places the prompter window on the requested display', async () => {
    const { createPrompterWindowManager } = await import('../src/main/prompter/window-manager');
    const mgr = createPrompterWindowManager({ store: createStateStore() });
    await mgr.open?.('2');
    const setBounds = electronMock.windows[0].calls.find((c) => c.startsWith('setBounds'));
    expect(setBounds).toContain('1920');
  });

  it('opens with context isolation on and node integration off', async () => {
    const { createPrompterWindowManager } = await import('../src/main/prompter/window-manager');
    const mgr = createPrompterWindowManager({ store: createStateStore() });
    await mgr.open?.(null);
    const wp = electronMock.windows[0].options.webPreferences as Record<string, unknown>;
    expect(wp.contextIsolation).toBe(true);
    expect(wp.nodeIntegration).toBe(false);
  });
});

describe('media library window manager', () => {
  beforeEach(() => { electronMock.reset(); vi.resetModules(); });

  it('creates exactly one window and reuses it on a second open', async () => {
    const { createMediaLibraryWindowManager } = await import('../src/main/media-library/window-manager');
    const mgr = createMediaLibraryWindowManager({ store: createStateStore() });
    await mgr.open?.();
    await mgr.open?.();
    expect(electronMock.windows).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run and confirm failure** — `npx vitest run tests/window-managers.test.ts`
- [ ] **Step 3: Correct against real signatures.** Read both sources; fix method names on the returned managers. **Do not modify `src/`.**
- [ ] **Step 4: Green, then whole suite** — `npx vitest run && npx tsc --noEmit`
- [ ] **Step 5: Commit**

```bash
git add tests/window-managers.test.ts tests/setup/electron-mock.ts
git commit -m "test: characterize prompter and media-library window managers"
```

#### Task 5: Tray + director window

**Agent:** `claude` · **Files:** Modify `tests/electron-chrome-windows.test.ts` · Read only: `src/main/tray.ts`, `src/main/director-window.ts`

- [ ] **Step 1: Write the failing tests**

```ts
describe('app tray', () => {
  beforeEach(() => { electronMock.reset(); vi.resetModules(); });

  it('builds a tray with a tooltip and a non-empty context menu', async () => {
    const { createAppTray } = await import('../src/main/tray');
    createAppTray({ store: createStateStore() } as never);
    expect(electronMock.trays).toHaveLength(1);
    expect(electronMock.trays[0].menuLabels.length).toBeGreaterThan(0);
  });
});

describe('director window', () => {
  beforeEach(() => { electronMock.reset(); vi.resetModules(); });

  it('opens sandboxed with a preload', async () => {
    const { openDirectorWindow } = await import('../src/main/director-window');
    openDirectorWindow();
    const wp = electronMock.windows[0].options.webPreferences as Record<string, unknown>;
    expect(wp.contextIsolation).toBe(true);
    expect(wp.nodeIntegration).toBe(false);
    expect(wp.preload).toBeTruthy();
  });

  it('registers its IPC handlers on a known channel set', async () => {
    const { registerDirectorIpc } = await import('../src/main/director-window');
    registerDirectorIpc({ store: createStateStore() } as never);
    expect(electronMock.ipcChannels.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run and confirm failure** — `npx vitest run tests/electron-chrome-windows.test.ts`
- [ ] **Step 3: Correct against real signatures.** Replace the `as never` config stubs with the real config shapes read from each source. **Do not modify `src/`.**
- [ ] **Step 4: Green, then whole suite** — `npx vitest run && npx tsc --noEmit`
- [ ] **Step 5: Commit**

```bash
git add tests/electron-chrome-windows.test.ts tests/setup/electron-mock.ts
git commit -m "test: characterize tray and director window"
```

#### Task 6: Overlays and window chrome

**Agent:** `claude` · **Files:** Modify `tests/electron-chrome-windows.test.ts` · Read only: `src/main/output-cursor.ts`, `src/main/fullscreen-chrome.ts`, `src/main/tunnel/qr-overlay.ts`, `src/main/stagetimer/overlay.ts`

These four all manipulate window chrome and are the likeliest silent casualties of a Chromium bump.

- [ ] **Step 1: Write the failing tests**

```ts
describe('output cursor', () => {
  beforeEach(() => { electronMock.reset(); vi.resetModules(); });

  it('subscribes to a webContents load event to hide the cursor', async () => {
    const { hideCursorOnLoad } = await import('../src/main/output-cursor');
    const { FakeBrowserWindow } = await import('./setup/electron-mock');
    const win = new FakeBrowserWindow({});
    hideCursorOnLoad(win as never);
    expect(win.recorded.calls.some((c) => c.startsWith('webContents.on:'))).toBe(true);
  });
});

describe('fullscreen chrome', () => {
  beforeEach(() => { electronMock.reset(); vi.resetModules(); });

  it('applies fullscreen and always-on-top to the window', async () => {
    const { applyFullscreenChrome } = await import('../src/main/fullscreen-chrome');
    const { FakeBrowserWindow } = await import('./setup/electron-mock');
    const win = new FakeBrowserWindow({});
    applyFullscreenChrome(win as never);
    expect(win.recorded.calls.some((c) => c.startsWith('setFullScreen') || c.startsWith('setBounds'))).toBe(true);
  });
});

describe('qr overlay', () => {
  beforeEach(() => { electronMock.reset(); vi.resetModules(); });

  it('creates a frameless always-on-top overlay window', async () => {
    const { showQrOverlay } = await import('../src/main/tunnel/qr-overlay');
    await showQrOverlay('https://example.trycloudflare.com');
    expect(electronMock.windows).toHaveLength(1);
    expect(electronMock.windows[0].options.frame).toBe(false);
  });
});

describe('stagetimer overlay', () => {
  beforeEach(() => { electronMock.reset(); vi.resetModules(); });

  it('creates an overlay that ignores mouse events', async () => {
    const { createStageTimerOverlay } = await import('../src/main/stagetimer/overlay');
    const overlay = createStageTimerOverlay({ store: createStateStore() } as never);
    await overlay.show?.();
    expect(electronMock.windows[0].calls.some((c) => c.startsWith('setIgnoreMouseEvents'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run and confirm failure** — `npx vitest run tests/electron-chrome-windows.test.ts`
- [ ] **Step 3: Correct against real signatures.** Four sources to read; fix argument shapes and assertions to whatever each function genuinely does today — if `applyFullscreenChrome` does not call `setFullScreen`, assert what it *does* call. **Do not modify `src/`.**
- [ ] **Step 4: Green, then whole suite** — `npx vitest run && npx tsc --noEmit`
- [ ] **Step 5: Commit**

```bash
git add tests/electron-chrome-windows.test.ts tests/setup/electron-mock.ts
git commit -m "test: characterize overlay windows and fullscreen chrome"
```

#### Task 7: Watchdog

**Agent:** `claude` · **Files:** Create `tests/watchdog-electron.test.ts` · Read only: `src/main/watchdog-electron.ts`

The highest-value test in Phase 0: crash and unresponsive handling is precisely what shifts silently across Electron majors, and a false positive here would blank an output mid-show.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
vi.mock('electron', async () => (await import('./setup/electron-mock')).electronModule);
import { electronMock, FakeBrowserWindow } from './setup/electron-mock';
import { createStateStore } from '../src/main/state';

describe('electron watchdog', () => {
  beforeEach(() => { electronMock.reset(); vi.resetModules(); vi.useFakeTimers(); });

  it('uses matching ping and pong channel names', async () => {
    const { PING_CHANNEL, PONG_CHANNEL } = await import('../src/main/watchdog-electron');
    expect(PING_CHANNEL).toBeTruthy();
    expect(PONG_CHANNEL).toBeTruthy();
    expect(PING_CHANNEL).not.toBe(PONG_CHANNEL);
  });

  it('subscribes to unresponsive and render-process-gone', async () => {
    const { startWatchdog } = await import('../src/main/watchdog-electron');
    const store = createStateStore();
    const win = new FakeBrowserWindow({});
    startWatchdog({ store, getProgramWindow: () => win as never } as never);
    expect(win.webContents.hasHandler('unresponsive') || win.recorded.calls.some((c) => c.includes('unresponsive'))).toBe(true);
  });

  it('marks the program unresponsive in state when the event fires', async () => {
    const { startWatchdog } = await import('../src/main/watchdog-electron');
    const store = createStateStore();
    const win = new FakeBrowserWindow({});
    startWatchdog({ store, getProgramWindow: () => win as never } as never);
    win.webContents.emit('unresponsive');
    await vi.advanceTimersByTimeAsync(1000);
    expect(store.getState().watchdog.programUnresponsive).toBe(true);
  });
});
```

- [ ] **Step 2: Run and confirm failure** — `npx vitest run tests/watchdog-electron.test.ts`
- [ ] **Step 3: Correct against the real `startWatchdog` config.** Read the source for the real dependency object and event names — it may listen on the `BrowserWindow` rather than `webContents`. Assert what it actually does. **Do not modify `src/`.**
- [ ] **Step 4: Green, then whole suite** — `npx vitest run && npx tsc --noEmit`
- [ ] **Step 5: Commit**

```bash
git add tests/watchdog-electron.test.ts tests/setup/electron-mock.ts
git commit -m "test: characterize Electron watchdog crash and unresponsive handling"
```

#### Task 8: Prompter doc transport

**Agent:** `claude` · **Files:** Create `tests/prompter-doc-transport.test.ts` · Read only: `src/main/prompter/doc-transport.ts`

This is the credentialed surface named in the audit — the Google session fetch.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
vi.mock('electron', async () => (await import('./setup/electron-mock')).electronModule);
import { electronMock } from './setup/electron-mock';

describe('prompter doc transport', () => {
  beforeEach(() => { electronMock.reset(); vi.resetModules(); });

  it('fetches through the signed-in Google partition, not global fetch', async () => {
    const { createElectronDocTransport } = await import('../src/main/prompter/doc-transport');
    const transport = createElectronDocTransport();
    await transport.fetchDoc?.('https://docs.google.com/document/d/abc123/edit').catch(() => {});
    expect(electronMock.partitionsRequested).toContain('persist:google-slides');
  });

  it('rejects a non-Google-Docs URL without opening a session', async () => {
    const { createElectronDocTransport } = await import('../src/main/prompter/doc-transport');
    const transport = createElectronDocTransport();
    await expect(transport.fetchDoc?.('https://evil.example.com/doc')).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run and confirm failure** — `npx vitest run tests/prompter-doc-transport.test.ts`
- [ ] **Step 3: Correct against the real transport API.** Read the source for the returned object's real method name and the real URL validation behaviour — if it returns an error result rather than throwing, assert that instead. **Do not modify `src/`.**
- [ ] **Step 4: Green, then whole suite** — `npx vitest run && npx tsc --noEmit`
- [ ] **Step 5: Commit**

```bash
git add tests/prompter-doc-transport.test.ts tests/setup/electron-mock.ts
git commit -m "test: characterize prompter Google Docs transport partition"
```

#### Task 9: Preload bridges

**Agent:** `claude` · **Files:** Create `tests/preload-surface.test.ts` · Read only: `src/renderer/settings-preload.ts`, `src/renderer/director-preload.ts`

`contextBridge` behaviour has changed before across majors. Pinning the exposed API shape catches a renderer that silently loses its bridge — which presents as a dead settings window with no error.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
vi.mock('electron', async () => (await import('./setup/electron-mock')).electronModule);
import { electronMock } from './setup/electron-mock';

describe('settings preload', () => {
  beforeEach(() => { electronMock.reset(); vi.resetModules(); });

  it('exposes a namespaced API with the expected methods', async () => {
    await import('../src/renderer/settings-preload');
    const keys = Object.keys(electronMock.exposed);
    expect(keys).toHaveLength(1);
    const api = electronMock.exposed[keys[0]] as Record<string, unknown>;
    expect(typeof api.saveSecurity).toBe('function');
  });
});

describe('director preload', () => {
  beforeEach(() => { electronMock.reset(); vi.resetModules(); });

  it('exposes a namespaced API with a fireAction method', async () => {
    await import('../src/renderer/director-preload');
    const keys = Object.keys(electronMock.exposed);
    expect(keys).toHaveLength(1);
    const api = electronMock.exposed[keys[0]] as Record<string, unknown>;
    expect(typeof api.fireAction).toBe('function');
  });
});
```

- [ ] **Step 2: Run and confirm failure** — `npx vitest run tests/preload-surface.test.ts`
- [ ] **Step 3: Correct against the real exposed surface.** `src/renderer/settings-preload.ts:17` shows `saveSecurity`; `src/renderer/director/index.ts:80` calls `window.pconairDirector.fireAction`. Confirm the exact namespace keys and assert the full method list. **Do not modify `src/`.**
- [ ] **Step 4: Green, then whole suite** — `npx vitest run && npx tsc --noEmit`
- [ ] **Step 5: Commit**

```bash
git add tests/preload-surface.test.ts tests/setup/electron-mock.ts
git commit -m "test: characterize preload contextBridge surfaces"
```

---

### Task 10: Phase 0 gate

**Agent:** a fresh `claude` agent acting as reviewer, or a human

- [ ] **Step 1: Confirm no production code changed**

```bash
git diff --stat main..HEAD -- src/
```

Expected: **empty**, or comment-only. Anything else means a Phase 0 task overstepped — revert it.

- [ ] **Step 2: Confirm the net covers the table.** Every row in Audit Findings has at least one assertion. Tick the table.
- [ ] **Step 3: Full green**

```bash
npx vitest run && npx tsc --noEmit
```

- [ ] **Step 4: Record the baseline**

```bash
npx vitest run 2>&1 | tail -5 > docs/plans/electron32-test-baseline.txt
git add docs/plans/electron32-test-baseline.txt
git commit -m "chore: record pre-migration test baseline on Electron 32"
```

---

## Phase 1 — The bump

### Task 11: Bump Forge first, Electron not yet

**Agent:** `claude` · **Files:** Modify `package.json`, `package-lock.json`

Forge must understand the new Electron before Electron arrives.

- [ ] **Step 1: Bump the four Forge packages**

```bash
npm i -D @electron-forge/cli@^7.11.0 @electron-forge/maker-dmg@^7.11.0 \
         @electron-forge/maker-zip@^7.11.0 @electron-forge/plugin-webpack@^7.11.0
```

- [ ] **Step 2: Suite and typecheck still green on Electron 32** — `npx vitest run && npx tsc --noEmit`
- [ ] **Step 3: Packaging still works on Electron 32**

```bash
npx electron-forge package --platform darwin --arch arm64
```

If Forge 7.11 breaks packaging on Electron 32, **stop**. That is a Forge problem to solve before adding Electron 44 as a second variable.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "build: bump Electron Forge 7.4 -> 7.11 ahead of the Electron upgrade"
```

### Task 12: Node 24 in CI and an engines floor

**Agent:** `claude` · **Files:** Modify `.github/workflows/build-release.yml` (lines 19, 96), `package.json`

- [ ] **Step 1: Add the engines field to `package.json`**

```json
"engines": { "node": ">=24.0.0" }
```

- [ ] **Step 2: Update both CI pins**

```bash
sed -i '' "s/node-version: '20'/node-version: '24'/g" .github/workflows/build-release.yml
grep -n "node-version" .github/workflows/build-release.yml
```

Expected: exactly two lines, both `'24'`.

- [ ] **Step 3: Verify locally on Node 24**

```bash
node --version   # must be >= 24
npx vitest run && npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add package.json .github/workflows/build-release.yml
git commit -m "build: require Node 24 locally and in CI"
```

### Task 13: Address the Node 24 findings from Task 1 Step 4

**Agent:** `claude`

- [ ] **Step 1: Re-read the Node section of `docs/plans/electron-44-breaking-changes.md`**
- [ ] **Step 2: For each finding, write a failing test first, then the minimal fix**
- [ ] **Step 3: `npx vitest run && npx tsc --noEmit`**
- [ ] **Step 4: Commit** — `fix: address Node 24 API removals in the main process`

If Task 1 found nothing, mark this task **skipped** with a one-line note and move on. Do not invent work.

### Task 14: Bump Electron to 44

**Agent:** `claude` · **Files:** Modify `package.json`, `package-lock.json`

- [ ] **Step 1: Bump**

```bash
npm i -D electron@^44.0.0
node -e "console.log(require('./node_modules/electron/package.json').version)"
```

- [ ] **Step 2: Confirm the bundled engine versions**

```bash
ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/Electron.app/Contents/MacOS/Electron \
  -p "JSON.stringify(process.versions)"
```

Expected: `chrome` ≈ `152.x`, `node` ≈ `24.x`. Record the exact values for the commit message.

- [ ] **Step 3: Typecheck — expect failures, fix nothing yet**

`@types` ships inside Electron, so twelve majors of type changes land here.

```bash
npx tsc --noEmit 2>&1 | tee /tmp/electron44-tsc.txt | tail -40
```

- [ ] **Step 4: Run the suite — expect failures, fix nothing yet**

```bash
npx vitest run 2>&1 | tee /tmp/electron44-vitest.txt | tail -40
diff <(tail -5 docs/plans/electron32-test-baseline.txt) <(tail -5 /tmp/electron44-vitest.txt) || true
```

- [ ] **Step 5: Commit the bump with the failures documented**

```bash
git add package.json package-lock.json
git commit -m "build: bump Electron 32 -> 44 (Chromium 128 -> 152, Node 20 -> 24)

Typecheck and characterization failures are captured and fixed in the
commits that follow. See docs/plans/electron-44-breaking-changes.md."
```

### Task 15: Triage

**Agent:** `Plan` if more than ~10 distinct failures, otherwise `claude`

- [ ] **Step 1: Group failures into distinct root causes.** Produce a table: failure → suspected cause → matching entry in `electron-44-breaking-changes.md` → files affected.
- [ ] **Step 2: Flag anything with no matching breaking-change entry.** A failure with no documented cause is the dangerous kind — investigate with `superpowers:systematic-debugging` before touching code. Do not pattern-match a fix.
- [ ] **Step 3: Order the fixes** — types before behaviour, shared files before leaves.
- [ ] **Step 4: Commit the triage table** into `docs/plans/electron-44-breaking-changes.md`.

### Task 16: Fix, one root cause per commit

**Agent:** `claude`, sequentially, one dispatch per root cause

For each row in the triage table:

- [ ] **Step 1: Confirm the characterization test is red for this cause** — `npx vitest run tests/<file>.test.ts`
- [ ] **Step 2: Make the minimal fix.** One root cause. No "while I'm here."
- [ ] **Step 3: Confirm green and no regression** — `npx vitest run && npx tsc --noEmit`
- [ ] **Step 4: Commit** — `fix(electron44): <root cause>`

**Stop rule:** three failed attempts at one root cause means stop and escalate to a human. Per `superpowers:systematic-debugging` Phase 4.5, that pattern means the approach is wrong, not the fix.

**Phase gate:** `npx vitest run` matches the Task 10 baseline count (1218 + the Phase 0 additions, all passing) and `npx tsc --noEmit` is clean.

---

## Phase 2 — What tests cannot cover

### Task 17: Human smoke test on real hardware

**Agent: none. A human, on a physical Mac with a second display.** An agent may draft the checklist file; only a human may tick the boxes.

**Files:** Create `docs/electron-upgrade-smoke-checklist.md`

- [ ] Build and launch: `npx electron-forge make --platform darwin --arch arm64`, install the DMG, launch it
- [ ] Tray icon appears; menu opens; quit works
- [ ] Settings window opens, renders, saves a setting, survives a reopen
- [ ] Admin → System reports the **correct listening port** (regression guard for the v0.5.1 fix)
- [ ] `/operator` loads; the WS pill goes green
- [ ] Lower Thirds: Apply → graphic appears on the output window on the **intended display**; Hide clears it
- [ ] Open `/render/l3` as an OBS browser source on a second machine; fire a lower third; confirm transparency and live updates
- [ ] URL mode: A/B switch, two instances, each keeping its own partition
- [ ] Slides mode: **sign in to Google**, load a deck, restart the app, confirm you are **still signed in** (`persist:google-slides` survived the Chromium jump)
- [ ] Prompter: load a Google Doc via the Drive connection; confirm the signed-in fetch still works
- [ ] Multi-display: unplug and replug the second display; confirm windows recover
- [ ] Watchdog: leave running 30+ minutes; confirm no spurious unresponsive/crash reports
- [ ] Cloudflare tunnel: enable, load `/operator` through the tunnel URL, confirm the PIN gate
- [ ] Companion: connect the module, fire an action, confirm feedback

**Gate:** every box ticked by a human before Phase 3. A failure sends that behaviour back to Task 16 — with a new characterization test written first.

---

## Phase 3 — Ship

### Task 18: Release

**Agent:** `claude`, only after human sign-off on Task 17

Per the project convention, a dependency/platform change takes a **minor** bump (patch is reserved for fix-only releases).

- [ ] **Step 1: Bump `version` in `package.json` and `package-lock.json`** to the next minor
- [ ] **Step 2: Commit** — `chore: bump to X.Y.0`, body naming the Electron/Chromium/Node versions
- [ ] **Step 3: Push, open a PR, get it reviewed and merged.** A change this size does not go straight to `main`.
- [ ] **Step 4: Tag the merge commit and push**

```bash
git tag -a vX.Y.0 -m "vX.Y.0 — Electron 44 / Chromium 152"
git push origin vX.Y.0
```

Pushing the tag is what triggers `.github/workflows/build-release.yml` to build the DMG and publish the release.

- [ ] **Step 5: Download the published DMG and launch it once.** The CI artifact is not the same as your local build.

---

## Rollback

- **Phase 0** adds only test files — nothing to roll back.
- **Phase 1** is a series of small commits. `git revert` the Electron bump and its fix commits to return to a green Electron 32 tree **with the test net intact** — that net is worth keeping whether or not the upgrade lands.
- **Phase 3** — if the shipped DMG is broken in the field, re-tag the previous release commit and re-publish. Operators can reinstall the prior DMG from the GitHub releases page.

**Abort criteria:** if Task 16 exceeds ~15 distinct root causes, or any single cause survives three fix attempts, stop and reassess. A staged 32 → 38 → 44 path becomes the better option, and the Phase 0 net supports it unchanged.

---

## Out of Scope

- Vitest 2 → 5, React/Slate, or any other dependency upgrade
- Code signing / notarization (the release body still reads "Unsigned build for internal testing")
- Playwright or other end-to-end GUI automation
- Any change to `graphics/**`, `src/runtime/**`, or the packages render contract
- The pre-existing gap where `packages/companion-module-pconair` deps are not installed by root `npm ci`, so `tests/companion-defs.test.ts` fails to load in a fresh clone. **Unrelated to this migration, but it will bite CI** — worth its own ticket.

---

## Open Questions for the Handoff

1. **Is there a spare Mac for Task 17?** The smoke test needs a machine that is not mid-show, with a second display. If the only machine is production, schedule this between shows.
2. **Direct 32 → 44, or staged 32 → 38 → 44?** This plan goes direct because the effort is mostly the test net, which is version-independent. Staging halves the per-step blast radius but roughly doubles calendar time.
3. **Will the Google sign-in survive the Chromium jump?** `persist:google-slides` cookies are written by Chromium 128 and read by 152. They should migrate, but if they do not, the operator must re-sign-in once after upgrading. Worth knowing before it surprises someone at a show, and worth a line in the release notes either way.
