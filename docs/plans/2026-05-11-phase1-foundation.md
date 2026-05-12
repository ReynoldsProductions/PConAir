# PC On Air — Phase 1: Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bootstrap a working Electron + TypeScript project with a local HTTP/WebSocket server, PIN-based auth, and in-memory AppState — the foundation every subsequent feature builds on.

**Architecture:** Electron main process owns a single Express HTTP server (one port) serving `/operator`, `/admin`, and `/api/*` routes. AppState is an in-memory singleton with a pub/sub event emitter; all state mutations go through it and broadcast diffs via WebSocket. Auth is session-cookie-based PIN validation handled by middleware.

**Tech Stack:** Electron 32+, TypeScript 5, Electron Forge (build), Express 4, `ws` (WebSocket), `bcryptjs`, `uuid`, Vitest (tests), `supertest` (HTTP tests)

**Spec refs:** `specs/01-source-of-truth.md`, `specs/02-api-state-contract.md`, `specs/08-security-hardening.md`

---

## File Map

```
PConAir/
├── package.json
├── tsconfig.json
├── tsconfig.main.json
├── forge.config.ts
├── vitest.config.ts
├── src/
│   ├── main/
│   │   ├── index.ts          # Electron entry — app lifecycle, creates window + server
│   │   ├── window.ts         # BrowserWindow factory
│   │   ├── server.ts         # Express app + WebSocket server factory
│   │   ├── routes/
│   │   │   ├── auth.ts       # POST /auth/operator, /auth/admin, /auth/logout
│   │   │   ├── api.ts        # GET /api/status, /api/health, POST /api/mode
│   │   │   └── index.ts      # Mounts all routers with auth middleware
│   │   ├── state.ts          # AppState singleton + getState/setState/subscribe
│   │   └── auth.ts           # Session middleware, PIN verification, rate limiter
│   └── shared/
│       └── types.ts          # AppState interface + all shared TS types
└── tests/
    ├── state.test.ts
    ├── auth.test.ts
    └── api.test.ts
```

---

## Task 1: Project scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `tsconfig.main.json`
- Create: `forge.config.ts`
- Create: `vitest.config.ts`
- Create: `src/main/index.ts`

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "pc-on-air",
  "version": "0.1.0",
  "description": "Controlled browser for live event playout",
  "main": ".webpack/main",
  "scripts": {
    "start": "electron-forge start",
    "build": "electron-forge make",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "@electron-forge/cli": "^7.4.0",
    "@electron-forge/maker-dmg": "^7.4.0",
    "@electron-forge/maker-zip": "^7.4.0",
    "@electron-forge/plugin-webpack": "^7.4.0",
    "@types/bcryptjs": "^2.4.6",
    "@types/express": "^4.17.21",
    "@types/node": "^20.0.0",
    "@types/supertest": "^6.0.2",
    "@types/uuid": "^9.0.7",
    "@types/ws": "^8.5.10",
    "electron": "^32.0.0",
    "supertest": "^7.0.0",
    "ts-loader": "^9.5.0",
    "typescript": "^5.3.0",
    "vitest": "^2.0.0"
  },
  "dependencies": {
    "bcryptjs": "^2.4.3",
    "express": "^4.18.2",
    "uuid": "^9.0.1",
    "ws": "^8.17.1"
  }
}
```

- [ ] **Step 2: Write `tsconfig.json`** (base, used by vitest)

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "CommonJS",
    "lib": ["ES2022"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*", "tests/**/*"],
  "exclude": ["node_modules", "dist", ".webpack"]
}
```

- [ ] **Step 3: Write `tsconfig.main.json`** (Electron main process)

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "outDir": "./dist/main",
    "rootDir": "./src/main"
  },
  "include": ["src/main/**/*", "src/shared/**/*"]
}
```

- [ ] **Step 4: Write `forge.config.ts`**

```typescript
import type { ForgeConfig } from '@electron-forge/shared-types';
import { WebpackPlugin } from '@electron-forge/plugin-webpack';
import path from 'path';

const config: ForgeConfig = {
  packagerConfig: { asar: true },
  rebuildConfig: {},
  makers: [
    { name: '@electron-forge/maker-zip', platforms: ['darwin', 'linux'] },
    { name: '@electron-forge/maker-dmg', config: {}, platforms: ['darwin'] },
  ],
  plugins: [
    new WebpackPlugin({
      mainConfig: {
        entry: './src/main/index.ts',
        module: {
          rules: [{ test: /\.tsx?$/, use: 'ts-loader', exclude: /node_modules/ }],
        },
        resolve: { extensions: ['.ts', '.js'] },
        output: { filename: 'index.js' },
      },
      renderer: {
        config: {},
        entryPoints: [
          {
            name: 'operator',
            html: './src/renderer/operator/index.html',
            js: './src/renderer/operator/index.ts',
            preload: { js: './src/renderer/preload.ts' },
          },
        ],
      },
    }),
  ],
};

export default config;
```

- [ ] **Step 5: Write `vitest.config.ts`**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: { provider: 'v8', reporter: ['text', 'lcov'] },
  },
  resolve: {
    alias: {
      '@shared': '/Users/tom/Documents/Claude/PConAir/src/shared',
      '@main': '/Users/tom/Documents/Claude/PConAir/src/main',
    },
  },
});
```

- [ ] **Step 6: Create minimal `src/main/index.ts`** (empty Electron stub for now)

```typescript
import { app, BrowserWindow } from 'electron';
import path from 'path';

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadURL('about:blank');
  return win;
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
```

- [ ] **Step 7: Create renderer stub files** (so Electron Forge doesn't fail on `npm run start`)

```bash
mkdir -p src/renderer/operator
```

Create `src/renderer/operator/index.html`:
```html
<!DOCTYPE html>
<html><head><title>PC On Air — Operator</title></head>
<body><p>Operator UI — coming in Phase 3</p></body></html>
```

Create `src/renderer/operator/index.ts`:
```typescript
// Operator UI entry point — Phase 3
console.log('PC On Air operator UI loaded');
```

Create `src/renderer/preload.ts`:
```typescript
// Preload script — exposes safe APIs to renderer
// Phase 3 will add contextBridge calls here
```

- [ ] **Step 8: Install dependencies**

```bash
npm install
```

Expected: `node_modules/` created, no errors.

- [ ] **Step 9: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 10: Commit**

```bash
git add package.json tsconfig.json tsconfig.main.json forge.config.ts vitest.config.ts src/main/index.ts src/renderer/
git commit -m "feat: electron + typescript project scaffold"
```

---

## Task 2: Shared types

**Files:**
- Create: `src/shared/types.ts`

- [ ] **Step 1: Write `src/shared/types.ts`**

Transcribe the AppState interface from `specs/02-api-state-contract.md`. This is the canonical type definition for the entire app.

```typescript
// AppState — the single source of truth for all runtime state.
// Matches specs/02-api-state-contract.md §1.1

export type Mode = 'slides' | 'url' | 'l3' | 'media-library' | 'idle';
export type ABInstance = 'A' | 'B';
export type BackgroundType = 'luma' | 'solid';
export type SessionMode = 'persistent' | 'ephemeral';

export interface Preset {
  id: string;
  name: string;
}

export interface SlidesState {
  deckId: string;
  deckTitle: string;
  slideIndex: number; // 0-based
  slideCount: number;
  isLoading: boolean;
}

export interface L3State {
  activeCueId: string | null;
  activeCueName: string | null;
  isStacking: boolean;
  currentPlaylistId: string | null;
}

export interface MediaLibraryState {
  activeItemId: string | null;
  activeItemName: string | null;
}

export interface BackgroundState {
  presetId: string | null;
  presetName: string | null;
  type: BackgroundType;
  value: string; // hex color e.g. "#000000" or luma key value
}

export interface Display {
  id: string;
  name: string;
  isPrimary: boolean;
}

export interface InstanceState {
  url: string | null;
  isLoading: boolean;
  isReady: boolean;
  displayTarget: string | null; // display ID or null for default
  sessionMode: SessionMode;
}

export interface ABState {
  activeInstance: ABInstance;
  instanceA: InstanceState;
  instanceB: InstanceState;
}

export interface ConnectionStatus {
  webSocketClients: number;
  companionConnected: boolean;
}

export interface AppState {
  currentMode: Mode;
  currentPreset: Preset | null;
  currentUrl: string | null;
  slides: SlidesState | null;
  l3: L3State | null;
  mediaLibrary: MediaLibraryState | null;
  background: BackgroundState;
  displays: Display[];
  abState: ABState;
  connectionStatus: ConnectionStatus;
}

// ---- HTTP API types ----

export interface ApiError {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

export type ErrorCode =
  | 'INVALID_MODE'
  | 'NO_ACTIVE_DECK'
  | 'SLIDE_OUT_OF_RANGE'
  | 'INVALID_URL'
  | 'DISPLAY_NOT_FOUND'
  | 'CUE_NOT_FOUND'
  | 'PRESET_NOT_FOUND'
  | 'AUTH_REQUIRED'
  | 'RATE_LIMITED';

// ---- WebSocket message types ----

export type WsServerMessage =
  | { type: 'state'; payload: AppState }
  | { type: 'state_patch'; payload: Partial<AppState> }
  | { type: 'error'; payload: { code: string; message: string } };

export type WsClientMessage =
  | { type: 'action'; action: string; payload: Record<string, unknown> };

// ---- Auth types ----

export interface Session {
  id: string;
  role: 'operator' | 'admin';
  createdAt: number;
  expiresAt: number;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat: shared AppState and API type definitions"
```

---

## Task 3: AppState store

**Files:**
- Create: `src/main/state.ts`
- Create: `tests/state.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/state.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createStateStore } from '../src/main/state';
import type { AppState, Mode } from '../src/shared/types';

describe('StateStore', () => {
  let store: ReturnType<typeof createStateStore>;

  beforeEach(() => {
    store = createStateStore();
  });

  it('initialises with idle mode', () => {
    expect(store.getState().currentMode).toBe('idle');
  });

  it('setState merges partial updates', () => {
    store.setState({ currentMode: 'slides' as Mode });
    expect(store.getState().currentMode).toBe('slides');
    // other fields unchanged
    expect(store.getState().currentUrl).toBeNull();
  });

  it('notifies subscribers on state change', () => {
    const patches: Partial<AppState>[] = [];
    store.subscribe((patch) => patches.push(patch));
    store.setState({ currentMode: 'url' as Mode });
    expect(patches).toHaveLength(1);
    expect(patches[0].currentMode).toBe('url');
  });

  it('unsubscribe stops notifications', () => {
    const patches: Partial<AppState>[] = [];
    const unsub = store.subscribe((patch) => patches.push(patch));
    unsub();
    store.setState({ currentMode: 'slides' as Mode });
    expect(patches).toHaveLength(0);
  });

  it('getState returns a copy, not the internal reference', () => {
    const s1 = store.getState();
    const s2 = store.getState();
    expect(s1).not.toBe(s2); // different objects
    expect(s1).toEqual(s2);  // same values
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/state.test.ts
```

Expected: FAIL — `createStateStore` not found.

- [ ] **Step 3: Write `src/main/state.ts`**

```typescript
import type { AppState, Mode, Session } from '../shared/types';

const INITIAL_STATE: AppState = {
  currentMode: 'idle',
  currentPreset: null,
  currentUrl: null,
  slides: null,
  l3: null,
  mediaLibrary: null,
  background: {
    presetId: null,
    presetName: null,
    type: 'luma',
    value: '#000000',
  },
  displays: [],
  abState: {
    activeInstance: 'A',
    instanceA: { url: null, isLoading: false, isReady: false, displayTarget: null, sessionMode: 'persistent' },
    instanceB: { url: null, isLoading: false, isReady: false, displayTarget: null, sessionMode: 'persistent' },
  },
  connectionStatus: {
    webSocketClients: 0,
    companionConnected: false,
  },
};

type Subscriber = (patch: Partial<AppState>) => void;

export function createStateStore() {
  let state: AppState = structuredClone(INITIAL_STATE);
  const subscribers = new Set<Subscriber>();

  function getState(): AppState {
    return structuredClone(state);
  }

  function setState(patch: Partial<AppState>): void {
    state = { ...state, ...patch };
    for (const sub of subscribers) {
      sub(structuredClone(patch));
    }
  }

  function subscribe(fn: Subscriber): () => void {
    subscribers.add(fn);
    return () => subscribers.delete(fn);
  }

  return { getState, setState, subscribe };
}

export type StateStore = ReturnType<typeof createStateStore>;

// Module-level singleton for use by server and Electron main
let _store: StateStore | null = null;

export function getStore(): StateStore {
  if (!_store) _store = createStateStore();
  return _store;
}

// Only call this in tests to reset between cases
export function _resetStore(): void {
  _store = null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/state.test.ts
```

Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/main/state.ts tests/state.test.ts
git commit -m "feat: in-memory AppState store with pub/sub"
```

---

## Task 4: Auth — PIN sessions and rate limiter

**Files:**
- Create: `src/main/auth.ts`
- Create: `tests/auth.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/auth.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  createAuthManager,
  type AuthConfig,
} from '../src/main/auth';

const CONFIG: AuthConfig = {
  operatorPin: '1234',
  adminPin: 'supersecret',
  operatorSessionMs: 8 * 60 * 60 * 1000,
  adminSessionMs: 4 * 60 * 60 * 1000,
  maxFailures: 5,
  lockoutMs: 5 * 60 * 1000,
};

describe('AuthManager', () => {
  let auth: ReturnType<typeof createAuthManager>;

  beforeEach(() => {
    auth = createAuthManager(CONFIG);
  });

  it('creates an operator session with correct PIN', async () => {
    const session = await auth.createSession('operator', '1234', '127.0.0.1');
    expect(session).not.toBeNull();
    expect(session!.role).toBe('operator');
  });

  it('returns null with wrong operator PIN', async () => {
    const session = await auth.createSession('operator', 'wrong', '127.0.0.1');
    expect(session).toBeNull();
  });

  it('creates an admin session with correct PIN', async () => {
    const session = await auth.createSession('admin', 'supersecret', '127.0.0.1');
    expect(session).not.toBeNull();
    expect(session!.role).toBe('admin');
  });

  it('validates a live session', async () => {
    const session = await auth.createSession('operator', '1234', '127.0.0.1');
    const found = auth.getSession(session!.id);
    expect(found).not.toBeNull();
    expect(found!.role).toBe('operator');
  });

  it('invalidates a deleted session', async () => {
    const session = await auth.createSession('operator', '1234', '127.0.0.1');
    auth.deleteSession(session!.id);
    expect(auth.getSession(session!.id)).toBeNull();
  });

  it('rate-limits after maxFailures', async () => {
    const ip = '10.0.0.1';
    for (let i = 0; i < 5; i++) {
      await auth.createSession('operator', 'wrong', ip);
    }
    expect(auth.isLockedOut(ip)).toBe(true);
  });

  it('allows login from a different IP during lockout', async () => {
    const ip = '10.0.0.1';
    for (let i = 0; i < 5; i++) {
      await auth.createSession('operator', 'wrong', ip);
    }
    // different IP is not locked out
    const session = await auth.createSession('operator', '1234', '10.0.0.2');
    expect(session).not.toBeNull();
  });

  it('rejects login from locked-out IP even with correct PIN', async () => {
    const ip = '10.0.0.1';
    for (let i = 0; i < 5; i++) {
      await auth.createSession('operator', 'wrong', ip);
    }
    const session = await auth.createSession('operator', '1234', ip);
    expect(session).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/auth.test.ts
```

Expected: FAIL — `createAuthManager` not found.

- [ ] **Step 3: Write `src/main/auth.ts`**

```typescript
import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import type { Session } from '../shared/types';

export interface AuthConfig {
  operatorPin: string;
  adminPin: string;
  operatorSessionMs: number;
  adminSessionMs: number;
  maxFailures: number;
  lockoutMs: number;
}

interface FailureRecord {
  count: number;
  lockedUntil: number | null;
}

export function createAuthManager(config: AuthConfig) {
  // bcrypt hashes (generated once at startup)
  let operatorHash = bcrypt.hashSync(config.operatorPin, 12);
  let adminHash = bcrypt.hashSync(config.adminPin, 12);

  const sessions = new Map<string, Session>();
  const failures = new Map<string, FailureRecord>();

  function isLockedOut(ip: string): boolean {
    const rec = failures.get(ip);
    if (!rec || rec.lockedUntil === null) return false;
    if (Date.now() < rec.lockedUntil) return true;
    // lockout expired — reset
    failures.delete(ip);
    return false;
  }

  function recordFailure(ip: string): void {
    const rec = failures.get(ip) ?? { count: 0, lockedUntil: null };
    rec.count += 1;
    if (rec.count >= config.maxFailures) {
      rec.lockedUntil = Date.now() + config.lockoutMs;
    }
    failures.set(ip, rec);
  }

  function recordSuccess(ip: string): void {
    failures.delete(ip);
  }

  async function createSession(
    role: 'operator' | 'admin',
    pin: string,
    ip: string
  ): Promise<Session | null> {
    if (isLockedOut(ip)) return null;

    const hash = role === 'operator' ? operatorHash : adminHash;
    const valid = await bcrypt.compare(pin, hash);

    if (!valid) {
      recordFailure(ip);
      return null;
    }

    recordSuccess(ip);
    const id = randomBytes(16).toString('base64url');
    const now = Date.now();
    const durationMs =
      role === 'operator' ? config.operatorSessionMs : config.adminSessionMs;
    const session: Session = {
      id,
      role,
      createdAt: now,
      expiresAt: now + durationMs,
    };
    sessions.set(id, session);
    return session;
  }

  function getSession(id: string): Session | null {
    const session = sessions.get(id);
    if (!session) return null;
    if (Date.now() > session.expiresAt) {
      sessions.delete(id);
      return null;
    }
    return session;
  }

  function deleteSession(id: string): void {
    sessions.delete(id);
  }

  function getRemainingAttempts(ip: string): number {
    const rec = failures.get(ip);
    if (!rec) return config.maxFailures;
    return Math.max(0, config.maxFailures - rec.count);
  }

  function getRetryAfterSeconds(ip: string): number | null {
    const rec = failures.get(ip);
    if (!rec?.lockedUntil) return null;
    return Math.ceil((rec.lockedUntil - Date.now()) / 1000);
  }

  return {
    createSession,
    getSession,
    deleteSession,
    isLockedOut,
    getRemainingAttempts,
    getRetryAfterSeconds,
  };
}

export type AuthManager = ReturnType<typeof createAuthManager>;
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/auth.test.ts
```

Expected: 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/main/auth.ts tests/auth.test.ts
git commit -m "feat: PIN auth manager with session tracking and rate limiting"
```

---

## Task 5: Express server + auth routes

**Files:**
- Create: `src/main/routes/auth.ts`
- Create: `src/main/routes/api.ts`
- Create: `src/main/routes/index.ts`
- Create: `src/main/server.ts`
- Create: `tests/api.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/api.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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

describe('Auth routes', () => {
  let app: ReturnType<typeof createServer>['app'];

  beforeEach(() => {
    const store = createStateStore();
    const auth = createAuthManager(AUTH_CONFIG);
    ({ app } = createServer({ store, auth }));
  });

  it('POST /auth/operator with correct PIN sets session cookie', async () => {
    const res = await request(app)
      .post('/auth/operator')
      .send({ pin: '1234' });
    expect(res.status).toBe(200);
    expect(res.headers['set-cookie']).toBeDefined();
    expect(res.headers['set-cookie'][0]).toContain('pconair_operator_session');
  });

  it('POST /auth/operator with wrong PIN returns 401', async () => {
    const res = await request(app)
      .post('/auth/operator')
      .send({ pin: 'wrong' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTH_REQUIRED');
  });

  it('POST /auth/admin with correct PIN sets admin cookie', async () => {
    const res = await request(app)
      .post('/auth/admin')
      .send({ pin: 'supersecret' });
    expect(res.status).toBe(200);
    expect(res.headers['set-cookie'][0]).toContain('pconair_admin_session');
  });
});

describe('API routes', () => {
  let app: ReturnType<typeof createServer>['app'];
  let operatorCookie: string;

  beforeEach(async () => {
    const store = createStateStore();
    const auth = createAuthManager(AUTH_CONFIG);
    ({ app } = createServer({ store, auth }));
    const res = await request(app)
      .post('/auth/operator')
      .send({ pin: '1234' });
    operatorCookie = res.headers['set-cookie'][0].split(';')[0];
  });

  it('GET /api/status returns full AppState for authenticated operator', async () => {
    const res = await request(app)
      .get('/api/status')
      .set('Cookie', operatorCookie);
    expect(res.status).toBe(200);
    expect(res.body.currentMode).toBe('idle');
  });

  it('GET /api/status returns 401 without auth', async () => {
    const res = await request(app).get('/api/status');
    expect(res.status).toBe(401);
  });

  it('POST /api/mode switches mode', async () => {
    const res = await request(app)
      .post('/api/mode')
      .set('Cookie', operatorCookie)
      .send({ mode: 'url' });
    expect(res.status).toBe(200);
    expect(res.body.currentMode).toBe('url');
  });

  it('POST /api/mode rejects invalid mode', async () => {
    const res = await request(app)
      .post('/api/mode')
      .set('Cookie', operatorCookie)
      .send({ mode: 'banana' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_MODE');
  });

  it('GET /api/health returns uptime and version', async () => {
    const res = await request(app)
      .get('/api/health')
      .set('Cookie', operatorCookie);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('uptime');
    expect(res.body).toHaveProperty('version');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/api.test.ts
```

Expected: FAIL — `createServer` not found.

- [ ] **Step 3: Write `src/main/routes/auth.ts`**

```typescript
import { Router, Request, Response } from 'express';
import type { AuthManager } from '../auth';

export function createAuthRouter(auth: AuthManager): Router {
  const router = Router();

  router.post('/operator', async (req: Request, res: Response) => {
    const { pin } = req.body as { pin?: string };
    const ip = req.ip ?? '0.0.0.0';

    if (!pin) {
      res.status(400).json({ error: { code: 'AUTH_REQUIRED', message: 'PIN required' } });
      return;
    }

    if (auth.isLockedOut(ip)) {
      const retryAfter = auth.getRetryAfterSeconds(ip) ?? 300;
      res
        .status(429)
        .set('X-Retry-After', String(retryAfter))
        .set('X-RateLimit-Remaining', '0')
        .json({ error: { code: 'RATE_LIMITED', message: 'Too many failed attempts' } });
      return;
    }

    const session = await auth.createSession('operator', pin, ip);
    if (!session) {
      const remaining = auth.getRemainingAttempts(ip);
      res
        .status(401)
        .set('X-RateLimit-Remaining', String(remaining))
        .json({ error: { code: 'AUTH_REQUIRED', message: 'Invalid PIN' } });
      return;
    }

    res
      .cookie('pconair_operator_session', session.id, {
        httpOnly: true,
        sameSite: 'strict',
        maxAge: session.expiresAt - session.createdAt,
      })
      .json({ ok: true });
  });

  router.post('/admin', async (req: Request, res: Response) => {
    const { pin } = req.body as { pin?: string };
    const ip = req.ip ?? '0.0.0.0';

    if (!pin) {
      res.status(400).json({ error: { code: 'AUTH_REQUIRED', message: 'PIN required' } });
      return;
    }

    if (auth.isLockedOut(ip)) {
      const retryAfter = auth.getRetryAfterSeconds(ip) ?? 300;
      res
        .status(429)
        .set('X-Retry-After', String(retryAfter))
        .set('X-RateLimit-Remaining', '0')
        .json({ error: { code: 'RATE_LIMITED', message: 'Too many failed attempts' } });
      return;
    }

    const session = await auth.createSession('admin', pin, ip);
    if (!session) {
      const remaining = auth.getRemainingAttempts(ip);
      res
        .status(401)
        .set('X-RateLimit-Remaining', String(remaining))
        .json({ error: { code: 'AUTH_REQUIRED', message: 'Invalid PIN' } });
      return;
    }

    res
      .cookie('pconair_admin_session', session.id, {
        httpOnly: true,
        sameSite: 'strict',
        maxAge: session.expiresAt - session.createdAt,
      })
      .json({ ok: true });
  });

  router.post('/logout', (req: Request, res: Response) => {
    const opSessionId = req.cookies?.pconair_operator_session as string | undefined;
    const adminSessionId = req.cookies?.pconair_admin_session as string | undefined;
    if (opSessionId) auth.deleteSession(opSessionId);
    if (adminSessionId) auth.deleteSession(adminSessionId);
    res
      .clearCookie('pconair_operator_session')
      .clearCookie('pconair_admin_session')
      .json({ ok: true });
  });

  return router;
}
```

- [ ] **Step 4: Write `src/main/routes/api.ts`**

```typescript
import { Router, Request, Response, NextFunction } from 'express';
import type { StateStore } from '../state';
import type { AuthManager } from '../auth';
import type { Mode } from '../../shared/types';

const VALID_MODES: Mode[] = ['slides', 'url', 'l3', 'media-library', 'idle'];
const START_TIME = Date.now();

function requireOperator(auth: AuthManager) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const sessionId =
      (req.cookies?.pconair_operator_session as string | undefined) ??
      (req.cookies?.pconair_admin_session as string | undefined); // admin can do anything operator can
    if (!sessionId || !auth.getSession(sessionId)) {
      res.status(401).json({ error: { code: 'AUTH_REQUIRED', message: 'Authentication required' } });
      return;
    }
    next();
  };
}

export function createApiRouter(store: StateStore, auth: AuthManager): Router {
  const router = Router();
  const opGuard = requireOperator(auth);

  router.get('/status', opGuard, (_req: Request, res: Response) => {
    res.json(store.getState());
  });

  router.get('/health', opGuard, (_req: Request, res: Response) => {
    const state = store.getState();
    res.json({
      version: process.env.npm_package_version ?? '0.1.0',
      uptime: Math.floor((Date.now() - START_TIME) / 1000),
      currentMode: state.currentMode,
      wsClients: state.connectionStatus.webSocketClients,
      companionConnected: state.connectionStatus.companionConnected,
      lastError: null,
    });
  });

  router.post('/mode', opGuard, (req: Request, res: Response) => {
    const { mode } = req.body as { mode?: string };
    if (!mode || !VALID_MODES.includes(mode as Mode)) {
      res.status(400).json({
        error: { code: 'INVALID_MODE', message: `mode must be one of: ${VALID_MODES.join(', ')}` },
      });
      return;
    }
    store.setState({ currentMode: mode as Mode });
    res.json(store.getState());
  });

  return router;
}
```

- [ ] **Step 5: Write `src/main/routes/index.ts`**

```typescript
import { Express } from 'express';
import cookieParser from 'cookie-parser';
import { createAuthRouter } from './auth';
import { createApiRouter } from './api';
import type { StateStore } from '../state';
import type { AuthManager } from '../auth';

export function mountRoutes(app: Express, store: StateStore, auth: AuthManager): void {
  app.use(cookieParser());
  app.use('/auth', createAuthRouter(auth));
  app.use('/api', createApiRouter(store, auth));
}
```

- [ ] **Step 6: Install `cookie-parser`**

```bash
npm install cookie-parser
npm install --save-dev @types/cookie-parser
```

- [ ] **Step 7: Write `src/main/server.ts`**

```typescript
import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';
import { mountRoutes } from './routes/index';
import type { StateStore } from './state';
import type { AuthManager } from './auth';
import type { WsServerMessage, AppState } from '../shared/types';

export interface ServerDeps {
  store: StateStore;
  auth: AuthManager;
  port?: number;
}

export function createServer(deps: ServerDeps) {
  const { store, auth, port = 8080 } = deps;

  const app = express();
  app.use(express.json());

  // Security headers on all responses
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  mountRoutes(app, store, auth);

  const httpServer = http.createServer(app);
  const wss = new WebSocketServer({ server: httpServer });

  function broadcast(msg: WsServerMessage): void {
    const data = JSON.stringify(msg);
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    });
  }

  // Broadcast state patches to all WebSocket clients
  store.subscribe((patch) => {
    broadcast({ type: 'state_patch', payload: patch });
  });

  wss.on('connection', (ws) => {
    // Send full state on connect
    ws.send(JSON.stringify({ type: 'state', payload: store.getState() } satisfies WsServerMessage));

    // Update client count
    store.setState({
      connectionStatus: {
        ...store.getState().connectionStatus,
        webSocketClients: wss.clients.size,
      },
    });

    ws.on('close', () => {
      store.setState({
        connectionStatus: {
          ...store.getState().connectionStatus,
          webSocketClients: wss.clients.size,
        },
      });
    });
  });

  function listen(): Promise<void> {
    return new Promise((resolve) => {
      httpServer.listen(port, resolve);
    });
  }

  function close(): Promise<void> {
    return new Promise((resolve, reject) => {
      httpServer.close((err) => (err ? reject(err) : resolve()));
    });
  }

  return { app, httpServer, wss, listen, close };
}
```

- [ ] **Step 8: Run tests to verify they pass**

```bash
npx vitest run tests/api.test.ts
```

Expected: All tests pass.

- [ ] **Step 9: Run all tests**

```bash
npx vitest run
```

Expected: All tests (state + auth + api) pass.

- [ ] **Step 10: Commit**

```bash
git add src/main/routes/ src/main/server.ts tests/api.test.ts
git commit -m "feat: express server with auth routes, /api/status, /api/mode, /api/health"
```

---

## Task 6: Wire server into Electron main process

**Files:**
- Modify: `src/main/index.ts`
- Create: `src/main/window.ts`

- [ ] **Step 1: Write `src/main/window.ts`**

```typescript
import { BrowserWindow, screen } from 'electron';
import path from 'path';

export interface WindowConfig {
  fullscreen?: boolean;
  displayId?: string; // Electron display id
}

export function createProgramWindow(config: WindowConfig = {}): BrowserWindow {
  const targetDisplay = config.displayId
    ? screen.getAllDisplays().find((d) => String(d.id) === config.displayId)
    : screen.getPrimaryDisplay();
  const display = targetDisplay ?? screen.getPrimaryDisplay();
  const { x, y } = display.bounds;

  const win = new BrowserWindow({
    x,
    y,
    width: display.bounds.width,
    height: display.bounds.height,
    fullscreen: config.fullscreen ?? false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    backgroundColor: '#000000',
    frame: false,
    show: false,
  });

  win.loadURL('about:blank');
  win.once('ready-to-show', () => win.show());
  return win;
}
```

- [ ] **Step 2: Update `src/main/index.ts`** to start the server and create window

```typescript
import { app, BrowserWindow } from 'electron';
import { createProgramWindow } from './window';
import { createServer } from './server';
import { getStore } from './state';
import { createAuthManager } from './auth';

const DEFAULT_PORT = parseInt(process.env.PCONAIR_PORT ?? '8080', 10);
const OPERATOR_PIN = process.env.PCONAIR_OPERATOR_PIN ?? '0000';
const ADMIN_PIN = process.env.PCONAIR_ADMIN_PIN ?? '00000000';

let programWindow: BrowserWindow | null = null;

async function main() {
  const store = getStore();
  const auth = createAuthManager({
    operatorPin: OPERATOR_PIN,
    adminPin: ADMIN_PIN,
    operatorSessionMs: 8 * 60 * 60 * 1000,
    adminSessionMs: 4 * 60 * 60 * 1000,
    maxFailures: 5,
    lockoutMs: 5 * 60 * 1000,
  });

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

app.whenReady().then(main);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
```

- [ ] **Step 3: Run all tests to confirm nothing broke**

```bash
npx vitest run
```

Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/main/index.ts src/main/window.ts
git commit -m "feat: wire HTTP server and program window into electron main process"
```

---

## Task 7: WebSocket — send state on connect, broadcast patches

**Files:**
- Create: `tests/websocket.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/websocket.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WebSocket } from 'ws';
import { createServer } from '../src/main/server';
import { createStateStore } from '../src/main/state';
import { createAuthManager } from '../src/main/auth';
import type { WsServerMessage } from '../src/shared/types';

const AUTH_CONFIG = {
  operatorPin: '1234',
  adminPin: 'secret99',
  operatorSessionMs: 3600000,
  adminSessionMs: 3600000,
  maxFailures: 5,
  lockoutMs: 300000,
};

async function waitForMessage(ws: WebSocket): Promise<WsServerMessage> {
  return new Promise((resolve) => {
    ws.once('message', (data) => resolve(JSON.parse(data.toString())));
  });
}

describe('WebSocket', () => {
  let server: ReturnType<typeof createServer>;
  let store: ReturnType<typeof createStateStore>;
  let port: number;

  beforeEach(async () => {
    store = createStateStore();
    const auth = createAuthManager(AUTH_CONFIG);
    server = createServer({ store, auth, port: 0 }); // port 0 = OS assigns
    await server.listen();
    // Get the assigned port
    const addr = server.httpServer.address();
    port = typeof addr === 'object' && addr ? addr.port : 8080;
  });

  afterEach(async () => {
    await server.close();
  });

  it('sends full state immediately on connect', async () => {
    const ws = new WebSocket(`ws://localhost:${port}/ws`);
    await new Promise<void>((resolve) => ws.once('open', resolve));
    const msg = await waitForMessage(ws);
    expect(msg.type).toBe('state');
    expect((msg as { type: 'state'; payload: { currentMode: string } }).payload.currentMode).toBe('idle');
    ws.close();
  });

  it('broadcasts a state_patch when state changes', async () => {
    const ws = new WebSocket(`ws://localhost:${port}/ws`);
    await new Promise<void>((resolve) => ws.once('open', resolve));
    await waitForMessage(ws); // consume initial state

    store.setState({ currentMode: 'slides' });

    const patch = await waitForMessage(ws);
    expect(patch.type).toBe('state_patch');
    expect((patch as { type: 'state_patch'; payload: { currentMode: string } }).payload.currentMode).toBe('slides');
    ws.close();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail (or pass — server.ts already has WS logic)**

```bash
npx vitest run tests/websocket.test.ts
```

If they fail because `/ws` path isn't handled, update `server.ts` to mount the WSS on `/ws`:

In `src/main/server.ts`, change the `WebSocketServer` constructor to:
```typescript
const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
```

- [ ] **Step 3: Run tests again**

```bash
npx vitest run tests/websocket.test.ts
```

Expected: Both tests pass.

- [ ] **Step 4: Run all tests**

```bash
npx vitest run
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add tests/websocket.test.ts src/main/server.ts
git commit -m "test: websocket connect and broadcast; fix ws path to /ws"
```

---

## Task 8: Security headers verification + final integration check

**Files:**
- Modify: `tests/api.test.ts` (add header assertions)

- [ ] **Step 1: Add security header assertions to existing api test**

Add this `describe` block to `tests/api.test.ts`:

```typescript
describe('Security headers', () => {
  let app: ReturnType<typeof createServer>['app'];

  beforeEach(() => {
    const store = createStateStore();
    const auth = createAuthManager(AUTH_CONFIG);
    ({ app } = createServer({ store, auth }));
  });

  it('sets X-Content-Type-Options: nosniff', async () => {
    const res = await request(app).get('/api/status');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('sets X-Frame-Options: DENY', async () => {
    const res = await request(app).get('/api/status');
    expect(res.headers['x-frame-options']).toBe('DENY');
  });

  it('sets Cache-Control: no-store on API responses', async () => {
    const res = await request(app).get('/api/status');
    expect(res.headers['cache-control']).toBe('no-store');
  });
});
```

- [ ] **Step 2: Run all tests**

```bash
npx vitest run
```

Expected: All tests pass.

- [ ] **Step 3: Run typecheck**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 4: Final commit**

```bash
git add tests/api.test.ts
git commit -m "test: security header assertions on all API responses"
```

---

## Verification

After all tasks complete, verify the foundation is solid:

```bash
# All tests green
npx vitest run

# TypeScript clean
npx tsc --noEmit

# Git log shows all tasks committed
git log --oneline

# Check test count
npx vitest run --reporter=verbose | grep "Tests"
```

Expected: ≥ 20 tests passing, 0 TypeScript errors, 8 commits.

---

## Phase 2 Preview

This foundation enables Phase 2: **Slides Mode** — loading Google Slides into an Electron BrowserWindow instance, A/B dual-window management, slide navigation API endpoints, and the Slides-specific state transitions. See `specs/02-api-state-contract.md` §2.4 for the endpoint signatures.
