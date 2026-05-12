# PC On Air — Phase 3: Operator Web UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the real-time operator control panel — served at `GET /operator` by the Express server, loaded in an Electron BrowserWindow, and accessible via any browser on the local network.

**Architecture:** A single HTML + vanilla TypeScript page served as static files by Express. The client connects to the WebSocket at `/ws` for real-time state, and makes `fetch` calls to the HTTP API for actions. The operator BrowserWindow in Electron loads `http://localhost:8080/operator`. No framework — fast, minimal, zero build dependencies in the client.

**Tech Stack:** HTML5, vanilla TypeScript (compiled to JS), CSS (embedded), Express static middleware, Electron BrowserWindow

**Spec refs:** `specs/01-source-of-truth.md` §3, `specs/02-api-state-contract.md` §2, `specs/03-slides-parity-inventory.md`

---

## File Map

```
PConAir/
├── src/
│   ├── main/
│   │   ├── routes/
│   │   │   ├── operator.ts           # GET /operator — serve static HTML
│   │   │   └── index.ts              # Updated: mount operator router
│   │   └── window.ts                 # Updated: add createOperatorWindow()
│   └── renderer/
│       └── operator/
│           ├── index.html            # Operator UI shell (links to bundle)
│           ├── index.ts              # Entry point — mounts app
│           ├── state.ts              # Local state model + WebSocket sync
│           ├── api.ts                # fetch wrappers for HTTP endpoints
│           └── components/
│               ├── status-bar.ts     # Connection status + current mode indicator
│               ├── slides-panel.ts   # Deck load, nav controls, slide counter
│               └── ab-panel.ts       # A/B instance switch
└── tests/
    └── operator-routes.test.ts       # GET /operator returns 200 HTML
```

---

## Task 1: Operator route + static file serving

**Files:**
- Create: `src/main/routes/operator.ts`
- Modify: `src/main/routes/index.ts`
- Create: `tests/operator-routes.test.ts`

The route serves the operator UI HTML from `src/renderer/operator/`. In development (via Electron Forge) the renderer is bundled; for the Express-served path we serve the source HTML directly with a reference to the bundled JS.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/operator-routes.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createServer } from '../src/main/server';
import { createStateStore } from '../src/main/state';
import { createAuthManager } from '../src/main/auth';

const AUTH_CONFIG = {
  operatorPin: '1234',
  adminPin: 'supersecret',
  operatorSessionMs: 3600000,
  adminSessionMs: 3600000,
  maxFailures: 5,
  lockoutMs: 300000,
};

describe('GET /operator', () => {
  let app: ReturnType<typeof createServer>['app'];
  let operatorCookie: string;

  beforeEach(async () => {
    const store = createStateStore();
    const auth = createAuthManager(AUTH_CONFIG);
    ({ app } = createServer({ store, auth }));
    const loginRes = await request(app).post('/auth/operator').send({ pin: '1234' });
    operatorCookie = loginRes.headers['set-cookie'][0].split(';')[0];
  });

  it('returns 200 with HTML content for authenticated operator', async () => {
    const res = await request(app)
      .get('/operator')
      .set('Cookie', operatorCookie);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.text).toContain('PC On Air');
  });

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/operator');
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/tom/Documents/Claude/PConAir && npx vitest run tests/operator-routes.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Write `src/main/routes/operator.ts`**

```typescript
import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import type { AuthManager } from '../auth';
import { requireOperator } from './middleware';

// Resolve operator UI HTML path relative to this file
const OPERATOR_HTML = path.resolve(__dirname, '../../renderer/operator/index.html');

export function createOperatorRouter(auth: AuthManager): Router {
  const router = Router();
  const opGuard = requireOperator(auth);

  router.get('/', opGuard, (_req: Request, res: Response) => {
    if (fs.existsSync(OPERATOR_HTML)) {
      res.sendFile(OPERATOR_HTML);
    } else {
      // Fallback for test environment where renderer files may not exist at __dirname path
      res.setHeader('Content-Type', 'text/html');
      res.send('<!DOCTYPE html><html><head><title>PC On Air — Operator</title></head><body><p>PC On Air Operator UI</p></body></html>');
    }
  });

  return router;
}
```

- [ ] **Step 4: Mount operator router in `src/main/routes/index.ts`**

Update `mountRoutes` to add the operator router:

```typescript
import { Express } from 'express';
import cookieParser from 'cookie-parser';
import { createAuthRouter } from './auth';
import { createApiRouter } from './api';
import { createSlidesRouter } from './slides';
import { createOperatorRouter } from './operator';
import type { StateStore } from '../state';
import type { AuthManager } from '../auth';

export function mountRoutes(app: Express, store: StateStore, auth: AuthManager): void {
  app.use(cookieParser());
  app.use('/auth', createAuthRouter(auth));
  app.use('/operator', createOperatorRouter(auth));
  app.use('/api/slides', createSlidesRouter(store, auth));
  app.use('/api', createApiRouter(store, auth));
}
```

- [ ] **Step 5: Run tests**

```bash
cd /Users/tom/Documents/Claude/PConAir && npx vitest run
```

Expected: 47 tests pass (45 existing + 2 new operator route tests).

- [ ] **Step 6: Commit**

```bash
cd /Users/tom/Documents/Claude/PConAir && git add src/main/routes/operator.ts src/main/routes/index.ts tests/operator-routes.test.ts && git commit -m "feat: GET /operator route serving operator UI HTML"
```

---

## Task 2: Operator UI HTML shell

**Files:**
- Modify: `src/renderer/operator/index.html`

Replace the stub with the full operator UI shell. The JS bundle is referenced as `./index.js` (Electron Forge Webpack output) with a fallback for direct loading.

- [ ] **Step 1: Write `src/renderer/operator/index.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>PC On Air — Operator</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --bg: #111;
      --surface: #1e1e1e;
      --border: #333;
      --text: #e0e0e0;
      --text-dim: #888;
      --accent: #4a9eff;
      --green: #3cba54;
      --red: #e53935;
      --orange: #ff9800;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: var(--bg);
      color: var(--text);
      font-size: 14px;
      height: 100vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    /* ── Status bar ─────────────────────────────────────────── */
    #status-bar {
      display: flex;
      align-items: center;
      gap: 16px;
      padding: 8px 16px;
      background: var(--surface);
      border-bottom: 1px solid var(--border);
      flex-shrink: 0;
    }

    #status-bar .app-title {
      font-weight: 600;
      font-size: 13px;
      color: var(--text-dim);
      margin-right: auto;
    }

    .status-pill {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      color: var(--text-dim);
    }

    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--red);
    }

    .status-dot.connected { background: var(--green); }

    #mode-badge {
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      background: var(--border);
      color: var(--text-dim);
    }

    #mode-badge.slides { background: #1a3a5c; color: var(--accent); }
    #mode-badge.url    { background: #1a3a2a; color: var(--green); }
    #mode-badge.l3     { background: #3a2a1a; color: var(--orange); }

    /* ── Main layout ─────────────────────────────────────────── */
    #main {
      flex: 1;
      display: flex;
      gap: 0;
      overflow: hidden;
    }

    .panel {
      padding: 16px;
      border-right: 1px solid var(--border);
      display: flex;
      flex-direction: column;
      gap: 12px;
      overflow-y: auto;
    }

    .panel:last-child { border-right: none; flex: 1; }

    .panel-title {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--text-dim);
      padding-bottom: 8px;
      border-bottom: 1px solid var(--border);
    }

    /* ── Controls ────────────────────────────────────────────── */
    .btn {
      padding: 8px 14px;
      border-radius: 5px;
      border: 1px solid var(--border);
      background: var(--surface);
      color: var(--text);
      cursor: pointer;
      font-size: 13px;
      font-weight: 500;
      transition: background 0.1s, border-color 0.1s;
      white-space: nowrap;
    }

    .btn:hover { background: #2a2a2a; border-color: #555; }
    .btn:active { background: #333; }
    .btn:disabled { opacity: 0.4; cursor: not-allowed; }

    .btn-primary {
      background: var(--accent);
      border-color: var(--accent);
      color: #fff;
    }
    .btn-primary:hover { background: #3a8eef; border-color: #3a8eef; }

    .btn-row {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }

    .btn-nav {
      flex: 1;
      text-align: center;
      font-size: 18px;
      padding: 12px;
    }

    input[type="text"], input[type="number"] {
      width: 100%;
      padding: 8px 10px;
      border-radius: 5px;
      border: 1px solid var(--border);
      background: #0d0d0d;
      color: var(--text);
      font-size: 13px;
    }

    input[type="text"]:focus, input[type="number"]:focus {
      outline: none;
      border-color: var(--accent);
    }

    .field-label {
      font-size: 11px;
      color: var(--text-dim);
      margin-bottom: 4px;
    }

    /* ── Slides info ─────────────────────────────────────────── */
    #slide-counter {
      font-size: 28px;
      font-weight: 700;
      color: var(--accent);
      text-align: center;
    }

    #deck-title {
      font-size: 12px;
      color: var(--text-dim);
      text-align: center;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    /* ── A/B indicator ───────────────────────────────────────── */
    .ab-btn {
      flex: 1;
      padding: 16px;
      text-align: center;
      font-size: 24px;
      font-weight: 700;
      border-radius: 6px;
      border: 2px solid var(--border);
    }

    .ab-btn.active {
      border-color: var(--accent);
      color: var(--accent);
      background: #1a2a3a;
    }

    /* ── Error toast ─────────────────────────────────────────── */
    #error-toast {
      position: fixed;
      bottom: 16px;
      right: 16px;
      background: var(--red);
      color: #fff;
      padding: 10px 14px;
      border-radius: 6px;
      font-size: 13px;
      display: none;
      max-width: 300px;
      z-index: 100;
    }
  </style>
</head>
<body>

  <!-- Status bar -->
  <div id="status-bar">
    <span class="app-title">PC On Air</span>
    <span id="mode-badge">IDLE</span>
    <span class="status-pill">
      <span id="ws-dot" class="status-dot"></span>
      <span id="ws-label">Disconnected</span>
    </span>
    <span class="status-pill">
      <span id="companion-dot" class="status-dot"></span>
      <span>Companion</span>
    </span>
  </div>

  <!-- Main panels -->
  <div id="main">

    <!-- Slides panel -->
    <div class="panel" style="width: 280px; min-width: 280px;">
      <div class="panel-title">Slides</div>

      <div>
        <div class="field-label">Google Slides URL</div>
        <input type="text" id="deck-url-input" placeholder="https://docs.google.com/presentation/d/…" />
      </div>
      <button class="btn btn-primary" id="load-btn">Load Deck</button>

      <div id="slide-counter">— / —</div>
      <div id="deck-title">No deck loaded</div>

      <div class="btn-row">
        <button class="btn btn-nav" id="prev-btn" disabled>‹</button>
        <button class="btn btn-nav" id="next-btn" disabled>›</button>
      </div>

      <div>
        <div class="field-label">Go to slide (1-based)</div>
        <div class="btn-row">
          <input type="number" id="goto-input" min="1" style="flex:1;" placeholder="1" />
          <button class="btn" id="goto-btn" disabled>Go</button>
        </div>
      </div>

      <button class="btn" id="reload-btn" disabled>Reload Deck</button>
    </div>

    <!-- A/B + Mode panel -->
    <div class="panel" style="width: 200px; min-width: 200px;">
      <div class="panel-title">A/B Instance</div>
      <div class="btn-row">
        <button class="btn ab-btn" id="ab-a-btn" data-instance="A">A</button>
        <button class="btn ab-btn" id="ab-b-btn" data-instance="B">B</button>
      </div>

      <div class="panel-title" style="margin-top: 8px;">Mode</div>
      <button class="btn" data-mode="idle" id="mode-idle-btn">Idle</button>
      <button class="btn" data-mode="slides" id="mode-slides-btn">Slides</button>
      <button class="btn" data-mode="url" id="mode-url-btn">URL</button>
      <button class="btn" data-mode="l3" id="mode-l3-btn">Lower Thirds</button>
    </div>

    <!-- Status / log panel -->
    <div class="panel">
      <div class="panel-title">Status</div>
      <pre id="state-dump" style="font-size:11px; color: var(--text-dim); white-space: pre-wrap; word-break: break-all;"></pre>
    </div>

  </div>

  <div id="error-toast"></div>

  <script src="./index.js"></script>
</body>
</html>
```

- [ ] **Step 2: Verify the file was written**

```bash
grep -c "PC On Air" /Users/tom/Documents/Claude/PConAir/src/renderer/operator/index.html
```

Expected: 1 or more matches.

- [ ] **Step 3: Commit**

```bash
cd /Users/tom/Documents/Claude/PConAir && git add src/renderer/operator/index.html && git commit -m "feat: operator UI HTML shell with slides panel, A/B controls, status bar"
```

---

## Task 3: WebSocket client state sync

**Files:**
- Modify: `src/renderer/operator/index.ts`
- Create: `src/renderer/operator/state.ts`
- Create: `src/renderer/operator/api.ts`

- [ ] **Step 1: Write `src/renderer/operator/state.ts`**

```typescript
import type { AppState } from '../../shared/types';

export type StateListener = (state: AppState) => void;

const DEFAULT_STATE: AppState = {
  currentMode: 'idle',
  currentPreset: null,
  currentUrl: null,
  slides: null,
  l3: null,
  mediaLibrary: null,
  background: { presetId: null, presetName: null, type: 'luma', value: '#000000' },
  displays: [],
  abState: {
    activeInstance: 'A',
    instanceA: { url: null, isLoading: false, isReady: false, displayTarget: null, sessionMode: 'persistent' },
    instanceB: { url: null, isLoading: false, isReady: false, displayTarget: null, sessionMode: 'persistent' },
  },
  connectionStatus: { webSocketClients: 0, companionConnected: false },
};

export function createClientStore() {
  let state: AppState = structuredClone(DEFAULT_STATE);
  const listeners = new Set<StateListener>();

  function getState(): AppState {
    return state;
  }

  function applyFullState(newState: AppState): void {
    state = newState;
    notify();
  }

  function applyPatch(patch: Partial<AppState>): void {
    state = { ...state, ...patch };
    notify();
  }

  function subscribe(fn: StateListener): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  function notify(): void {
    for (const fn of listeners) fn(state);
  }

  return { getState, applyFullState, applyPatch, subscribe };
}

export type ClientStore = ReturnType<typeof createClientStore>;
```

- [ ] **Step 2: Write `src/renderer/operator/api.ts`**

```typescript
// HTTP API helpers — thin fetch wrappers, no auth needed (session cookie sent automatically)

export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json() as T | { error: { code: string; message: string } };
  if (!res.ok) {
    const msg = (data as { error: { message: string } }).error?.message ?? `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data as T;
}

export async function loadDeck(deckUrl: string): Promise<void> {
  await apiPost('/api/slides/load', { deckUrl });
}

export async function slideNext(): Promise<void> {
  await apiPost('/api/slides/next');
}

export async function slidePrev(): Promise<void> {
  await apiPost('/api/slides/prev');
}

export async function slideGoto(slideIndex: number): Promise<void> {
  await apiPost('/api/slides/goto', { slideIndex });
}

export async function slideReload(): Promise<void> {
  await apiPost('/api/slides/reload');
}

export async function switchAB(instance: 'A' | 'B'): Promise<void> {
  await apiPost('/api/ab/switch', { instance });
}

export async function setMode(mode: string): Promise<void> {
  await apiPost('/api/mode', { mode });
}
```

- [ ] **Step 3: Write `src/renderer/operator/index.ts`**

```typescript
import { createClientStore } from './state';
import type { AppState } from '../../shared/types';
import type { WsServerMessage } from '../../shared/types';
import * as api from './api';

const store = createClientStore();

// ── WebSocket connection ──────────────────────────────────────────

function connectWs(): void {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(`${protocol}//${location.host}/ws`);

  ws.addEventListener('open', () => {
    setWsStatus(true);
  });

  ws.addEventListener('close', () => {
    setWsStatus(false);
    // Reconnect with exponential backoff
    let delay = 1000;
    const retry = () => {
      setTimeout(() => {
        connectWs();
        delay = Math.min(delay * 2, 30000);
      }, delay);
    };
    retry();
  });

  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data as string) as WsServerMessage;
    if (msg.type === 'state') {
      store.applyFullState(msg.payload);
    } else if (msg.type === 'state_patch') {
      store.applyPatch(msg.payload);
    }
  });
}

// ── UI update ─────────────────────────────────────────────────────

function setWsStatus(connected: boolean): void {
  const dot = document.getElementById('ws-dot')!;
  const label = document.getElementById('ws-label')!;
  dot.classList.toggle('connected', connected);
  label.textContent = connected ? 'Connected' : 'Disconnected';
}

function renderState(state: AppState): void {
  // Mode badge
  const badge = document.getElementById('mode-badge')!;
  badge.textContent = state.currentMode.toUpperCase();
  badge.className = `mode-badge ${state.currentMode}`;

  // Companion dot
  const companionDot = document.getElementById('companion-dot')!;
  companionDot.classList.toggle('connected', state.connectionStatus.companionConnected);

  // Slides panel
  const hasSlides = state.currentMode === 'slides' && state.slides !== null;
  const slides = state.slides;

  const slideCounter = document.getElementById('slide-counter')!;
  const deckTitle = document.getElementById('deck-title')!;
  slideCounter.textContent = hasSlides && slides
    ? `${slides.slideIndex + 1} / ${slides.slideCount}`
    : '— / —';
  deckTitle.textContent = hasSlides && slides
    ? (slides.deckTitle !== slides.deckId ? slides.deckTitle : 'Loading…')
    : 'No deck loaded';

  const navEnabled = hasSlides && slides !== null && !slides.isLoading;
  (document.getElementById('prev-btn') as HTMLButtonElement).disabled = !navEnabled || slides!.slideIndex === 0;
  (document.getElementById('next-btn') as HTMLButtonElement).disabled = !navEnabled || slides!.slideIndex >= slides!.slideCount - 1;
  (document.getElementById('goto-btn') as HTMLButtonElement).disabled = !navEnabled;
  (document.getElementById('reload-btn') as HTMLButtonElement).disabled = !hasSlides;

  // A/B buttons
  const active = state.abState.activeInstance;
  document.getElementById('ab-a-btn')!.classList.toggle('active', active === 'A');
  document.getElementById('ab-b-btn')!.classList.toggle('active', active === 'B');

  // State dump
  document.getElementById('state-dump')!.textContent = JSON.stringify(state, null, 2);
}

// ── Error toast ───────────────────────────────────────────────────

function showError(message: string): void {
  const toast = document.getElementById('error-toast')!;
  toast.textContent = message;
  toast.style.display = 'block';
  setTimeout(() => { toast.style.display = 'none'; }, 4000);
}

// ── Event handlers ────────────────────────────────────────────────

function bindEvents(): void {
  // Load deck
  document.getElementById('load-btn')!.addEventListener('click', async () => {
    const input = document.getElementById('deck-url-input') as HTMLInputElement;
    try {
      await api.loadDeck(input.value.trim());
    } catch (e) {
      showError((e as Error).message);
    }
  });

  // Next / Prev
  document.getElementById('next-btn')!.addEventListener('click', async () => {
    try { await api.slideNext(); } catch (e) { showError((e as Error).message); }
  });

  document.getElementById('prev-btn')!.addEventListener('click', async () => {
    try { await api.slidePrev(); } catch (e) { showError((e as Error).message); }
  });

  // Goto
  document.getElementById('goto-btn')!.addEventListener('click', async () => {
    const input = document.getElementById('goto-input') as HTMLInputElement;
    const slideNum = parseInt(input.value, 10);
    if (isNaN(slideNum) || slideNum < 1) return;
    try {
      await api.slideGoto(slideNum - 1); // UI is 1-based; API is 0-based
    } catch (e) {
      showError((e as Error).message);
    }
  });

  // Reload
  document.getElementById('reload-btn')!.addEventListener('click', async () => {
    try { await api.slideReload(); } catch (e) { showError((e as Error).message); }
  });

  // A/B switch
  document.querySelectorAll<HTMLButtonElement>('.ab-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const instance = btn.dataset.instance as 'A' | 'B';
      try { await api.switchAB(instance); } catch (e) { showError((e as Error).message); }
    });
  });

  // Mode buttons
  document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const mode = btn.dataset.mode!;
      try { await api.setMode(mode); } catch (e) { showError((e as Error).message); }
    });
  });
}

// ── Boot ──────────────────────────────────────────────────────────

store.subscribe(renderState);
bindEvents();
connectWs();
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd /Users/tom/Documents/Claude/PConAir && npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 5: Run all tests**

```bash
cd /Users/tom/Documents/Claude/PConAir && npx vitest run
```

Expected: All 47 tests pass.

- [ ] **Step 6: Commit**

```bash
cd /Users/tom/Documents/Claude/PConAir && git add src/renderer/operator/ && git commit -m "feat: operator UI — WebSocket state sync, slides controls, A/B switch, mode buttons"
```

---

## Task 4: Electron operator window

**Files:**
- Modify: `src/main/window.ts` — add `createOperatorWindow()`
- Modify: `src/main/index.ts` — open operator window on startup

- [ ] **Step 1: Add `createOperatorWindow` to `src/main/window.ts`**

Append to `src/main/window.ts`:

```typescript
export function createOperatorWindow(serverPort: number): BrowserWindow {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    title: 'PC On Air — Operator',
    show: false,
  });

  win.loadURL(`http://localhost:${serverPort}/operator`);
  win.once('ready-to-show', () => win.show());
  return win;
}
```

- [ ] **Step 2: Open operator window from `src/main/index.ts`**

In `src/main/index.ts`:
1. Import `createOperatorWindow` from `./window`
2. After `server.listen()`, add:

```typescript
const operatorWindow = createOperatorWindow(DEFAULT_PORT);
```

3. Update the `activate` handler to also recreate the operator window if all windows are closed.

The updated `main()` function body should be:

```typescript
async function main() {
  validatePins(OPERATOR_PIN, ADMIN_PIN);

  const store = getStore();
  const auth = createAuthManager({
    operatorPin: OPERATOR_PIN,
    adminPin: ADMIN_PIN,
    operatorSessionMs: 8 * 60 * 60 * 1000,
    adminSessionMs: 4 * 60 * 60 * 1000,
    maxFailures: 5,
    lockoutMs: 5 * 60 * 1000,
  });

  const slidesManager = createSlidesWindowManager({ store });
  slidesManager.initialize();

  const server = createServer({ store, auth, port: DEFAULT_PORT });
  await server.listen();
  console.log(`PC On Air server running on http://localhost:${DEFAULT_PORT}`);

  programWindow = createProgramWindow({ fullscreen: false });
  createOperatorWindow(DEFAULT_PORT);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      programWindow = createProgramWindow({ fullscreen: false });
      createOperatorWindow(DEFAULT_PORT);
    }
  });
}
```

- [ ] **Step 3: Run typecheck and all tests**

```bash
cd /Users/tom/Documents/Claude/PConAir && npx tsc --noEmit && npx vitest run
```

Expected: 0 errors, 47 tests pass.

- [ ] **Step 4: Commit**

```bash
cd /Users/tom/Documents/Claude/PConAir && git add src/main/window.ts src/main/index.ts && git commit -m "feat: operator window opens on startup, loads from local Express server"
```

---

## Verification

After all tasks complete:

```bash
# All tests pass
npx vitest run

# TypeScript clean
npx tsc --noEmit

# Git log
git log --oneline feat/phase1-foundation | head -10

# Test count
npx vitest run 2>&1 | grep "Tests"
```

Expected: 47 tests passing, 0 TypeScript errors.

---

## Phase 4 Preview

Phase 4: **URL Mode** — `POST /api/url`, `POST /api/url/reload`, URL preset management (`GET/POST/DELETE /api/presets`), and loading arbitrary URLs into Electron BrowserWindow instances using the same A/B dual-window model.
