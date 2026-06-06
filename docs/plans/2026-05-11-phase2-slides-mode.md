# PC On Air — Phase 2: Slides Mode Implementation Plan

> **Status: ✅ COMPLETE** — All 5 tasks implemented and committed. 19 slides tests + 3 A/B tests passing. TypeScript clean.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Implement the Slides mode API — `/api/slides/*` and `/api/ab/switch` endpoints with full state management — and wire BrowserWindow instances into Electron for actual display output.

**Architecture:** Routes operate on `StateStore` only (no Electron deps), making them fully unit-testable with supertest. A separate `SlidesWindowManager` handles the actual BrowserWindow side (Electron-only, not unit-tested). Routes call the manager via an injected interface so the two layers are decoupled.

**Tech Stack:** Express 4, Electron 32+, TypeScript 5, Vitest + supertest (tests)

**Spec refs:** `specs/02-api-state-contract.md` §2.4, §2.2 (A/B switch), `specs/03-slides-parity-inventory.md`

---

## File Map

```
PConAir/
└── src/
    └── main/
        ├── slides/
        │   └── window-manager.ts     # BrowserWindow A/B instances (Electron-only)
        ├── routes/
        │   ├── slides.ts             # All /api/slides/* endpoints
        │   ├── api.ts                # Updated: add POST /api/ab/switch
        │   └── index.ts              # Updated: mount slides router
        └── server.ts                 # Updated: accept optional SlidesWindowManager
└── tests/
    └── slides.test.ts                # Route integration tests (supertest)
```

---

## Task 1: Slides routes — load, next, prev, goto, reload

**Files:**
- Create: `src/main/routes/slides.ts`
- Create: `tests/slides.test.ts`

- [x] **Step 1: Write the failing tests**

```typescript
// tests/slides.test.ts
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

async function makeApp() {
  const store = createStateStore();
  const auth = createAuthManager(AUTH_CONFIG);
  const { app } = createServer({ store, auth });
  const loginRes = await request(app).post('/auth/operator').send({ pin: '1234' });
  const cookie = loginRes.headers['set-cookie'][0].split(';')[0];
  return { app, store, cookie };
}

describe('POST /api/slides/load', () => {
  it('loads a deck and transitions to slides mode', async () => {
    const { app, cookie } = await makeApp();
    const res = await request(app)
      .post('/api/slides/load')
      .set('Cookie', cookie)
      .send({ deckUrl: 'https://docs.google.com/presentation/d/abc123/edit' });
    expect(res.status).toBe(200);
    expect(res.body.currentMode).toBe('slides');
    expect(res.body.slides.deckId).toBe('abc123');
    expect(res.body.slides.slideIndex).toBe(0);
    expect(res.body.slides.isLoading).toBe(true);
  });

  it('returns 400 INVALID_URL for malformed deckUrl', async () => {
    const { app, cookie } = await makeApp();
    const res = await request(app)
      .post('/api/slides/load')
      .set('Cookie', cookie)
      .send({ deckUrl: 'not-a-url' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_URL');
  });

  it('returns 400 INVALID_URL if deckUrl is not a Google Slides URL', async () => {
    const { app, cookie } = await makeApp();
    const res = await request(app)
      .post('/api/slides/load')
      .set('Cookie', cookie)
      .send({ deckUrl: 'https://example.com/not-slides' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_URL');
  });

  it('returns 401 without auth', async () => {
    const { app } = await makeApp();
    const res = await request(app)
      .post('/api/slides/load')
      .send({ deckUrl: 'https://docs.google.com/presentation/d/abc/edit' });
    expect(res.status).toBe(401);
  });
});

describe('POST /api/slides/next', () => {
  it('increments slideIndex', async () => {
    const { app, store, cookie } = await makeApp();
    store.setState({
      currentMode: 'slides',
      slides: { deckId: 'abc', deckTitle: 'Test', slideIndex: 0, slideCount: 5, isLoading: false },
    });
    const res = await request(app)
      .post('/api/slides/next')
      .set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.slides.slideIndex).toBe(1);
  });

  it('returns 400 SLIDE_OUT_OF_RANGE at last slide', async () => {
    const { app, store, cookie } = await makeApp();
    store.setState({
      currentMode: 'slides',
      slides: { deckId: 'abc', deckTitle: 'Test', slideIndex: 4, slideCount: 5, isLoading: false },
    });
    const res = await request(app)
      .post('/api/slides/next')
      .set('Cookie', cookie);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('SLIDE_OUT_OF_RANGE');
  });

  it('returns 400 NO_ACTIVE_DECK when not in slides mode', async () => {
    const { app, cookie } = await makeApp();
    const res = await request(app)
      .post('/api/slides/next')
      .set('Cookie', cookie);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('NO_ACTIVE_DECK');
  });
});

describe('POST /api/slides/prev', () => {
  it('decrements slideIndex', async () => {
    const { app, store, cookie } = await makeApp();
    store.setState({
      currentMode: 'slides',
      slides: { deckId: 'abc', deckTitle: 'Test', slideIndex: 3, slideCount: 5, isLoading: false },
    });
    const res = await request(app)
      .post('/api/slides/prev')
      .set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.slides.slideIndex).toBe(2);
  });

  it('returns 400 SLIDE_OUT_OF_RANGE at first slide', async () => {
    const { app, store, cookie } = await makeApp();
    store.setState({
      currentMode: 'slides',
      slides: { deckId: 'abc', deckTitle: 'Test', slideIndex: 0, slideCount: 5, isLoading: false },
    });
    const res = await request(app)
      .post('/api/slides/prev')
      .set('Cookie', cookie);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('SLIDE_OUT_OF_RANGE');
  });
});

describe('POST /api/slides/goto', () => {
  it('jumps to specified slide index', async () => {
    const { app, store, cookie } = await makeApp();
    store.setState({
      currentMode: 'slides',
      slides: { deckId: 'abc', deckTitle: 'Test', slideIndex: 0, slideCount: 10, isLoading: false },
    });
    const res = await request(app)
      .post('/api/slides/goto')
      .set('Cookie', cookie)
      .send({ slideIndex: 7 });
    expect(res.status).toBe(200);
    expect(res.body.slides.slideIndex).toBe(7);
  });

  it('returns 400 SLIDE_OUT_OF_RANGE for index >= slideCount', async () => {
    const { app, store, cookie } = await makeApp();
    store.setState({
      currentMode: 'slides',
      slides: { deckId: 'abc', deckTitle: 'Test', slideIndex: 0, slideCount: 5, isLoading: false },
    });
    const res = await request(app)
      .post('/api/slides/goto')
      .set('Cookie', cookie)
      .send({ slideIndex: 5 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('SLIDE_OUT_OF_RANGE');
  });

  it('returns 400 SLIDE_OUT_OF_RANGE for negative index', async () => {
    const { app, store, cookie } = await makeApp();
    store.setState({
      currentMode: 'slides',
      slides: { deckId: 'abc', deckTitle: 'Test', slideIndex: 0, slideCount: 5, isLoading: false },
    });
    const res = await request(app)
      .post('/api/slides/goto')
      .set('Cookie', cookie)
      .send({ slideIndex: -1 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('SLIDE_OUT_OF_RANGE');
  });
});

describe('POST /api/slides/reload', () => {
  it('sets isLoading: true on active instance', async () => {
    const { app, store, cookie } = await makeApp();
    store.setState({
      currentMode: 'slides',
      slides: { deckId: 'abc', deckTitle: 'Test', slideIndex: 2, slideCount: 5, isLoading: false },
    });
    const res = await request(app)
      .post('/api/slides/reload')
      .set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.slides.isLoading).toBe(true);
  });

  it('returns 400 NO_ACTIVE_DECK when not in slides mode', async () => {
    const { app, cookie } = await makeApp();
    const res = await request(app)
      .post('/api/slides/reload')
      .set('Cookie', cookie);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('NO_ACTIVE_DECK');
  });
});
```

- [x] **Step 2: Run tests to verify they fail**

```bash
cd /Users/tom/Documents/Claude/PConAir && npx vitest run tests/slides.test.ts
```

Expected: FAIL — routes not found.

- [x] **Step 3: Write `src/main/routes/slides.ts`**

```typescript
import { Router, Request, Response } from 'express';
import type { StateStore } from '../state';
import type { AuthManager } from '../auth';

const GOOGLE_SLIDES_PATTERN = /^https:\/\/docs\.google\.com\/presentation\/d\/([^/]+)/;

function extractDeckId(deckUrl: string): string | null {
  const match = GOOGLE_SLIDES_PATTERN.exec(deckUrl);
  return match ? match[1] : null;
}

function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function requireOperator(auth: AuthManager) {
  return (req: Request, res: Response, next: () => void): void => {
    const sessionId =
      (req.cookies?.pconair_operator_session as string | undefined) ??
      (req.cookies?.pconair_admin_session as string | undefined);
    if (!sessionId || !auth.getSession(sessionId)) {
      res.status(401).json({ error: { code: 'AUTH_REQUIRED', message: 'Authentication required' } });
      return;
    }
    next();
  };
}

export function createSlidesRouter(store: StateStore, auth: AuthManager): Router {
  const router = Router();
  const opGuard = requireOperator(auth);

  // POST /api/slides/load
  router.post('/load', opGuard, (req: Request, res: Response) => {
    const { deckUrl, instance } = req.body as { deckUrl?: string; instance?: string };

    if (!deckUrl || !isValidUrl(deckUrl)) {
      res.status(400).json({ error: { code: 'INVALID_URL', message: 'deckUrl must be a valid URL' } });
      return;
    }

    const deckId = extractDeckId(deckUrl);
    if (!deckId) {
      res.status(400).json({ error: { code: 'INVALID_URL', message: 'deckUrl must be a Google Slides presentation URL' } });
      return;
    }

    store.setState({
      currentMode: 'slides',
      slides: {
        deckId,
        deckTitle: deckId, // Title populated later when deck loads
        slideIndex: 0,
        slideCount: 1,     // Count populated later when deck loads
        isLoading: true,
      },
    });

    const state = store.getState();
    res.json({
      currentMode: state.currentMode,
      slides: state.slides,
      abState: state.abState,
    });
  });

  // POST /api/slides/next
  router.post('/next', opGuard, (req: Request, res: Response) => {
    const state = store.getState();
    if (!state.slides) {
      res.status(400).json({ error: { code: 'NO_ACTIVE_DECK', message: 'No deck is currently loaded' } });
      return;
    }
    if (state.slides.slideIndex >= state.slides.slideCount - 1) {
      res.status(400).json({ error: { code: 'SLIDE_OUT_OF_RANGE', message: 'Already at the last slide' } });
      return;
    }
    store.setState({
      slides: { ...state.slides, slideIndex: state.slides.slideIndex + 1 },
    });
    res.json({ slides: { slideIndex: state.slides.slideIndex + 1 } });
  });

  // POST /api/slides/prev
  router.post('/prev', opGuard, (req: Request, res: Response) => {
    const state = store.getState();
    if (!state.slides) {
      res.status(400).json({ error: { code: 'NO_ACTIVE_DECK', message: 'No deck is currently loaded' } });
      return;
    }
    if (state.slides.slideIndex <= 0) {
      res.status(400).json({ error: { code: 'SLIDE_OUT_OF_RANGE', message: 'Already at the first slide' } });
      return;
    }
    store.setState({
      slides: { ...state.slides, slideIndex: state.slides.slideIndex - 1 },
    });
    res.json({ slides: { slideIndex: state.slides.slideIndex - 1 } });
  });

  // POST /api/slides/goto
  router.post('/goto', opGuard, (req: Request, res: Response) => {
    const { slideIndex } = req.body as { slideIndex?: number };
    const state = store.getState();
    if (!state.slides) {
      res.status(400).json({ error: { code: 'NO_ACTIVE_DECK', message: 'No deck is currently loaded' } });
      return;
    }
    if (
      typeof slideIndex !== 'number' ||
      !Number.isInteger(slideIndex) ||
      slideIndex < 0 ||
      slideIndex >= state.slides.slideCount
    ) {
      res.status(400).json({
        error: { code: 'SLIDE_OUT_OF_RANGE', message: `slideIndex must be in range [0, ${state.slides.slideCount - 1}]` },
      });
      return;
    }
    store.setState({
      slides: { ...state.slides, slideIndex },
    });
    res.json({ slides: { slideIndex } });
  });

  // POST /api/slides/reload
  router.post('/reload', opGuard, (req: Request, res: Response) => {
    const state = store.getState();
    if (!state.slides) {
      res.status(400).json({ error: { code: 'NO_ACTIVE_DECK', message: 'No deck is currently loaded' } });
      return;
    }
    store.setState({
      slides: { ...state.slides, isLoading: true },
    });
    res.json({ slides: { isLoading: true } });
  });

  return router;
}
```

- [x] **Step 4: Run tests to verify they pass**

```bash
cd /Users/tom/Documents/Claude/PConAir && npx vitest run tests/slides.test.ts
```

Expected: All 12 tests pass.

- [x] **Step 5: Run all tests**

```bash
cd /Users/tom/Documents/Claude/PConAir && npx vitest run
```

Expected: All 38 tests pass (26 existing + 12 new slides tests).

- [x] **Step 6: Commit**

```bash
cd /Users/tom/Documents/Claude/PConAir && git add src/main/routes/slides.ts tests/slides.test.ts && git commit -m "feat: slides API routes (load, next, prev, goto, reload)"
```

---

## Task 2: A/B switch route

**Files:**
- Modify: `src/main/routes/api.ts`
- Modify: `tests/slides.test.ts` (add A/B tests)

- [x] **Step 1: Add A/B switch tests to `tests/slides.test.ts`**

Append to `tests/slides.test.ts`:

```typescript
describe('POST /api/ab/switch', () => {
  it('switches active instance to B', async () => {
    const { app, cookie } = await makeApp();
    const res = await request(app)
      .post('/api/ab/switch')
      .set('Cookie', cookie)
      .send({ instance: 'B' });
    expect(res.status).toBe(200);
    expect(res.body.abState.activeInstance).toBe('B');
  });

  it('switches active instance back to A', async () => {
    const { app, store, cookie } = await makeApp();
    store.setState({ abState: { ...store.getState().abState, activeInstance: 'B' } });
    const res = await request(app)
      .post('/api/ab/switch')
      .set('Cookie', cookie)
      .send({ instance: 'A' });
    expect(res.status).toBe(200);
    expect(res.body.abState.activeInstance).toBe('A');
  });

  it('returns 400 for invalid instance value', async () => {
    const { app, cookie } = await makeApp();
    const res = await request(app)
      .post('/api/ab/switch')
      .set('Cookie', cookie)
      .send({ instance: 'C' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_MODE');
  });
});
```

- [x] **Step 2: Run A/B tests to verify they fail**

```bash
cd /Users/tom/Documents/Claude/PConAir && npx vitest run tests/slides.test.ts -t "ab/switch"
```

Expected: FAIL — route not found.

- [x] **Step 3: Add `POST /api/ab/switch` to `src/main/routes/api.ts`**

Add to the bottom of `createApiRouter`, before `return router`:

```typescript
router.post('/ab/switch', opGuard, (req: Request, res: Response) => {
  const { instance } = req.body as { instance?: string };
  if (instance !== 'A' && instance !== 'B') {
    res.status(400).json({ error: { code: 'INVALID_MODE', message: 'instance must be "A" or "B"' } });
    return;
  }
  const state = store.getState();
  store.setState({
    abState: { ...state.abState, activeInstance: instance as 'A' | 'B' },
  });
  res.json({ abState: { activeInstance: instance as 'A' | 'B' } });
});
```

- [x] **Step 4: Run all tests**

```bash
cd /Users/tom/Documents/Claude/PConAir && npx vitest run
```

Expected: All 41 tests pass (38 + 3 new A/B tests).

- [x] **Step 5: Commit**

```bash
cd /Users/tom/Documents/Claude/PConAir && git add src/main/routes/api.ts tests/slides.test.ts && git commit -m "feat: POST /api/ab/switch endpoint"
```

---

## Task 3: Mount slides router in server

**Files:**
- Modify: `src/main/routes/index.ts`

- [x] **Step 1: Update `src/main/routes/index.ts`**

```typescript
import { Express } from 'express';
import cookieParser from 'cookie-parser';
import { createAuthRouter } from './auth';
import { createApiRouter } from './api';
import { createSlidesRouter } from './slides';
import type { StateStore } from '../state';
import type { AuthManager } from '../auth';

export function mountRoutes(app: Express, store: StateStore, auth: AuthManager): void {
  app.use(cookieParser());
  app.use('/auth', createAuthRouter(auth));
  app.use('/api/slides', createSlidesRouter(store, auth));
  app.use('/api', createApiRouter(store, auth));
}
```

**Important:** Mount `/api/slides` BEFORE `/api` so the more-specific path matches first.

- [x] **Step 2: Run all tests to confirm nothing broke**

```bash
cd /Users/tom/Documents/Claude/PConAir && npx vitest run
```

Expected: All 41 tests pass.

- [x] **Step 3: Commit**

```bash
cd /Users/tom/Documents/Claude/PConAir && git add src/main/routes/index.ts && git commit -m "feat: mount slides router at /api/slides"
```

---

## Task 4: SlidesWindowManager — BrowserWindow A/B instances

**Files:**
- Create: `src/main/slides/window-manager.ts`

This module manages actual Electron BrowserWindow instances for A and B. It is Electron-only and cannot be unit-tested; it is integrated via `src/main/index.ts`.

- [x] **Step 1: Create `src/main/slides/window-manager.ts`**

```typescript
import { BrowserWindow, screen } from 'electron';
import type { StateStore } from '../state';
import type { ABInstance } from '../../shared/types';

interface SlidesWindowConfig {
  store: StateStore;
}

export function createSlidesWindowManager(config: SlidesWindowConfig) {
  const { store } = config;
  let windowA: BrowserWindow | null = null;
  let windowB: BrowserWindow | null = null;

  function createSlidesWindow(): BrowserWindow {
    const display = screen.getPrimaryDisplay();
    const win = new BrowserWindow({
      x: display.bounds.x,
      y: display.bounds.y,
      width: display.bounds.width,
      height: display.bounds.height,
      fullscreen: false,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false, // Needed for Google Slides interactions
      },
      backgroundColor: '#000000',
      frame: false,
      show: false,
    });
    win.once('ready-to-show', () => win.show());
    return win;
  }

  function getSlidesUrl(deckId: string, slideIndex: number): string {
    // Google Slides presenter URL — loads into full-screen presentation mode
    // slideIndex is 0-based; Google Slides presentation URL has no slide parameter in embed mode
    return `https://docs.google.com/presentation/d/${deckId}/present`;
  }

  async function loadDeck(deckId: string, instance: ABInstance): Promise<void> {
    const win = instance === 'A' ? windowA : windowB;
    if (!win || win.isDestroyed()) return;

    const url = getSlidesUrl(deckId, 0);
    await win.loadURL(url);

    // Once loaded, update state: isLoading -> false
    const state = store.getState();
    if (state.slides && state.slides.deckId === deckId) {
      store.setState({
        slides: { ...state.slides, isLoading: false },
      });
    }
  }

  async function navigateToSlide(slideIndex: number): Promise<void> {
    const state = store.getState();
    const activeInstance = state.abState.activeInstance;
    const win = activeInstance === 'A' ? windowA : windowB;
    if (!win || win.isDestroyed() || !state.slides) return;

    // Navigate to the specified slide via JavaScript injection
    await win.webContents.executeJavaScript(
      `document.querySelector('[aria-label="Slide ${slideIndex + 1} of ${state.slides.slideCount}"]')?.click()`
    );
  }

  function showInstance(instance: ABInstance): void {
    const toShow = instance === 'A' ? windowA : windowB;
    const toHide = instance === 'A' ? windowB : windowA;
    if (toHide && !toHide.isDestroyed()) toHide.hide();
    if (toShow && !toShow.isDestroyed()) toShow.show();
  }

  function initialize(): void {
    windowA = createSlidesWindow();
    windowB = createSlidesWindow();

    // Subscribe to state changes to drive the windows
    store.subscribe((patch) => {
      if (patch.currentMode === 'slides' && patch.slides) {
        void loadDeck(patch.slides.deckId, store.getState().abState.activeInstance);
      }
      if (patch.abState?.activeInstance) {
        showInstance(patch.abState.activeInstance);
      }
    });
  }

  function destroy(): void {
    windowA?.destroy();
    windowB?.destroy();
    windowA = null;
    windowB = null;
  }

  return { initialize, loadDeck, navigateToSlide, showInstance, destroy };
}

export type SlidesWindowManager = ReturnType<typeof createSlidesWindowManager>;
```

- [x] **Step 2: Run all tests to confirm no compile errors**

```bash
cd /Users/tom/Documents/Claude/PConAir && npx tsc --noEmit && npx vitest run
```

Expected: 0 TypeScript errors, all 41 tests pass.

- [x] **Step 3: Commit**

```bash
cd /Users/tom/Documents/Claude/PConAir && git add src/main/slides/window-manager.ts && git commit -m "feat: slides window manager for A/B BrowserWindow instances"
```

---

## Task 5: Wire SlidesWindowManager into Electron main process

**Files:**
- Modify: `src/main/index.ts`

- [x] **Step 1: Update `src/main/index.ts`** to initialize the SlidesWindowManager

```typescript
import { app, BrowserWindow } from 'electron';
import { createProgramWindow } from './window';
import { createServer } from './server';
import { getStore } from './state';
import { createAuthManager } from './auth';
import { createSlidesWindowManager } from './slides/window-manager';

const DEFAULT_PORT = parseInt(process.env.PCONAIR_PORT ?? '8080', 10);
const OPERATOR_PIN = process.env.PCONAIR_OPERATOR_PIN ?? '0000';
const ADMIN_PIN = process.env.PCONAIR_ADMIN_PIN ?? '00000000';

function validatePins(operator: string, admin: string): void {
  if (operator.length < 4) {
    console.error('PCONAIR_OPERATOR_PIN must be at least 4 characters.');
    app.exit(1);
  }
  if (admin.length < 8) {
    console.error('PCONAIR_ADMIN_PIN must be at least 8 characters.');
    app.exit(1);
  }
  if (operator === admin) {
    console.error('PCONAIR_ADMIN_PIN must be different from PCONAIR_OPERATOR_PIN.');
    app.exit(1);
  }
}

let programWindow: BrowserWindow | null = null;

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

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      programWindow = createProgramWindow({ fullscreen: false });
    }
  });
}

app.whenReady().then(main).catch((err: unknown) => {
  console.error('Failed to start PC On Air:', err);
  app.exit(1);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
```

- [x] **Step 2: Run all tests to confirm nothing broke**

```bash
cd /Users/tom/Documents/Claude/PConAir && npx vitest run
```

Expected: All 41 tests pass.

- [x] **Step 3: Run typecheck**

```bash
cd /Users/tom/Documents/Claude/PConAir && npx tsc --noEmit
```

Expected: No errors.

- [x] **Step 4: Commit**

```bash
cd /Users/tom/Documents/Claude/PConAir && git add src/main/index.ts && git commit -m "feat: initialize slides window manager in electron main process"
```

---

## Verification

After all tasks complete:

```bash
# All tests green
npx vitest run

# TypeScript clean
npx tsc --noEmit

# Git log shows all Phase 2 tasks
git log --oneline feat/phase1-foundation

# Test count
npx vitest run 2>&1 | grep "Tests"
```

Expected: ≥ 41 tests passing, 0 TypeScript errors, 5 new commits for Phase 2.

---

## Phase 3 Preview

Phase 3: **Web UI** — The operator HTML interface served at `/operator`. Real-time state display via WebSocket, slide navigation controls, mode switching, status indicators. Built as a vanilla TypeScript single-page app served by the Electron process.
