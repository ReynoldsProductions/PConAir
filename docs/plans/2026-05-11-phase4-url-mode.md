# PC On Air — Phase 4: URL Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement URL Mode — the HTTP API endpoints to load and reload arbitrary URLs, a CRUD preset library, the displays endpoint, and the Electron URL window manager that drives two A/B BrowserWindows.

**Architecture:** Mirrors the Slides Mode implementation. New routes (`/api/url`, `/api/presets`) are mounted alongside existing routes. An in-memory `PresetsStore` holds `UrlPreset` objects. A `UrlWindowManager` subscribes to state and drives two Electron BrowserWindows (A and B). No session/disk persistence yet (spec 05 scope).

**Tech Stack:** Express 4, Electron 32, TypeScript 5, Vitest, supertest

**Spec refs:** `specs/02-api-state-contract.md` §2.3 (URL Mode), §2.7 (Displays), §2.8 (Presets); `specs/06-url-mode-multi-display.md`

---

## File Map

```
PConAir/
├── src/
│   ├── shared/
│   │   └── types.ts                     MODIFY: add UrlPreset interface
│   └── main/
│       ├── presets.ts                   CREATE: in-memory UrlPreset CRUD store
│       ├── routes/
│       │   ├── index.ts                 MODIFY: mount /api/url and /api/presets
│       │   ├── api.ts                   MODIFY: add GET /api/displays
│       │   └── url.ts                   CREATE: POST /api/url, POST /api/url/reload
│       │   └── presets.ts               CREATE: GET/POST/DELETE /api/presets
│       ├── server.ts                    MODIFY: accept PresetsStore in config
│       ├── index.ts                     MODIFY: wire UrlWindowManager + PresetsStore
│       └── url/
│           └── window-manager.ts        CREATE: A/B URL BrowserWindow manager
├── tests/
│   ├── url.test.ts                      CREATE: URL endpoint tests
│   └── presets.test.ts                  CREATE: Preset CRUD tests
```

---

## Task 1: UrlPreset type + in-memory preset store

**Files:**
- Modify: `src/shared/types.ts`
- Create: `src/main/presets.ts`
- Test: `tests/presets.test.ts` (partial — used by Task 3)

- [ ] **Step 1: Add UrlPreset to shared types**

In `src/shared/types.ts`, add after the `Session` interface:

```typescript
export interface UrlPreset {
  id: string;
  name: string;
  url: string;
  displayTarget: string | null;
  sessionMode: SessionMode;
  description: string | null;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
}
```

- [ ] **Step 2: Write failing tests for PresetsStore**

Create `tests/presets.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { createPresetsStore } from '../src/main/presets';

describe('PresetsStore', () => {
  let store: ReturnType<typeof createPresetsStore>;

  beforeEach(() => {
    store = createPresetsStore();
  });

  it('starts empty', () => {
    expect(store.list()).toEqual([]);
  });

  it('create: adds a preset and returns it with id/timestamps', () => {
    const p = store.create({ name: 'Slido', url: 'https://slido.com', sessionMode: 'persistent', displayTarget: null, description: null });
    expect(p.id).toBeTruthy();
    expect(p.name).toBe('Slido');
    expect(p.url).toBe('https://slido.com');
    expect(p.createdAt).toBeTruthy();
    expect(p.updatedAt).toBeTruthy();
    expect(store.list()).toHaveLength(1);
  });

  it('findById: returns preset or null', () => {
    const p = store.create({ name: 'X', url: 'https://x.com', sessionMode: 'ephemeral', displayTarget: null, description: null });
    expect(store.findById(p.id)).toMatchObject({ name: 'X' });
    expect(store.findById('missing')).toBeNull();
  });

  it('update: replaces fields and bumps updatedAt', () => {
    const p = store.create({ name: 'A', url: 'https://a.com', sessionMode: 'persistent', displayTarget: null, description: null });
    const updated = store.update(p.id, { name: 'B', url: 'https://b.com' });
    expect(updated).not.toBeNull();
    expect(updated!.name).toBe('B');
    expect(updated!.url).toBe('https://b.com');
    expect(updated!.createdAt).toBe(p.createdAt);
  });

  it('update: returns null for unknown id', () => {
    expect(store.update('nope', { name: 'X' })).toBeNull();
  });

  it('remove: deletes preset and returns true', () => {
    const p = store.create({ name: 'Y', url: 'https://y.com', sessionMode: 'persistent', displayTarget: null, description: null });
    expect(store.remove(p.id)).toBe(true);
    expect(store.list()).toHaveLength(0);
  });

  it('remove: returns false for unknown id', () => {
    expect(store.remove('nope')).toBe(false);
  });
});
```

- [ ] **Step 3: Run tests to confirm they fail**

```bash
npx vitest run tests/presets.test.ts
```
Expected: FAIL (createPresetsStore not found)

- [ ] **Step 4: Implement PresetsStore**

Create `src/main/presets.ts`:

```typescript
import { randomUUID } from 'crypto';
import type { UrlPreset, SessionMode } from '../shared/types';

export interface CreatePresetInput {
  name: string;
  url: string;
  sessionMode: SessionMode;
  displayTarget: string | null;
  description: string | null;
}

export type UpdatePresetInput = Partial<Omit<UrlPreset, 'id' | 'createdAt' | 'updatedAt'>>;

export function createPresetsStore() {
  const presets = new Map<string, UrlPreset>();

  function list(): UrlPreset[] {
    return Array.from(presets.values());
  }

  function findById(id: string): UrlPreset | null {
    return presets.get(id) ?? null;
  }

  function create(input: CreatePresetInput): UrlPreset {
    const now = new Date().toISOString();
    const preset: UrlPreset = {
      id: randomUUID(),
      name: input.name,
      url: input.url,
      sessionMode: input.sessionMode,
      displayTarget: input.displayTarget,
      description: input.description,
      createdAt: now,
      updatedAt: now,
    };
    presets.set(preset.id, preset);
    return { ...preset };
  }

  function update(id: string, input: UpdatePresetInput): UrlPreset | null {
    const existing = presets.get(id);
    if (!existing) return null;
    const updated: UrlPreset = { ...existing, ...input, id, createdAt: existing.createdAt, updatedAt: new Date().toISOString() };
    presets.set(id, updated);
    return { ...updated };
  }

  function remove(id: string): boolean {
    return presets.delete(id);
  }

  return { list, findById, create, update, remove };
}

export type PresetsStore = ReturnType<typeof createPresetsStore>;
```

- [ ] **Step 5: Run tests to confirm they pass**

```bash
npx vitest run tests/presets.test.ts
```
Expected: all 7 pass

- [ ] **Step 6: Commit**

```bash
git add src/shared/types.ts src/main/presets.ts tests/presets.test.ts
git commit -m "feat: add UrlPreset type and in-memory presets store"
```

---

## Task 2: URL routes — POST /api/url and POST /api/url/reload

**Files:**
- Create: `src/main/routes/url.ts`
- Modify: `src/main/routes/index.ts`
- Modify: `src/main/server.ts`
- Create: `tests/url.test.ts`

**URL validation rule:** must start with `http://` or `https://`. Regex: `/^https?:\/\/.+/`

- [ ] **Step 1: Write failing tests for URL endpoints**

Create `tests/url.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createServer } from '../src/main/server';
import { createStateStore } from '../src/main/state';
import { createAuthManager } from '../src/main/auth';
import { createPresetsStore } from '../src/main/presets';

function makeServer() {
  const store = createStateStore();
  const auth = createAuthManager({
    operatorPin: 'test1234', adminPin: 'testadmin', operatorSessionMs: 60000, adminSessionMs: 60000,
    maxFailures: 5, lockoutMs: 60000,
  });
  const presets = createPresetsStore();
  const server = createServer({ store, auth, presets, port: 0 });
  return { server, store, auth };
}

async function login(app: Express.Application, pin: string, route: string) {
  const res = await request(app).post(route).send({ pin });
  const cookie = res.headers['set-cookie'] as string | string[];
  return Array.isArray(cookie) ? cookie[0] : cookie;
}

// -- need to import Express type
import type { Express } from 'express';

describe('POST /api/url', () => {
  let app: Express.Application;
  let cookie: string;

  beforeEach(async () => {
    const { server } = makeServer();
    await server.listen();
    app = server.app;
    cookie = await login(app, 'test1234', '/auth/operator');
  });

  it('loads a valid URL and sets mode to url', async () => {
    const res = await request(app)
      .post('/api/url')
      .set('Cookie', cookie)
      .send({ url: 'https://slido.com/event/123' });

    expect(res.status).toBe(200);
    expect(res.body.currentMode).toBe('url');
    expect(res.body.currentUrl).toBe('https://slido.com/event/123');
    expect(res.body.abState.instanceA.url).toBe('https://slido.com/event/123');
    expect(res.body.abState.instanceA.isLoading).toBe(true);
    expect(res.body.abState.instanceA.isReady).toBe(false);
  });

  it('rejects a URL missing http/https scheme', async () => {
    const res = await request(app)
      .post('/api/url')
      .set('Cookie', cookie)
      .send({ url: 'ftp://bad.url' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_URL');
  });

  it('rejects empty url', async () => {
    const res = await request(app)
      .post('/api/url')
      .set('Cookie', cookie)
      .send({ url: '' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_URL');
  });

  it('rejects missing url field', async () => {
    const res = await request(app)
      .post('/api/url')
      .set('Cookie', cookie)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_URL');
  });

  it('returns 401 without auth', async () => {
    const res = await request(app).post('/api/url').send({ url: 'https://example.com' });
    expect(res.status).toBe(401);
  });

  it('loads into active instance (A by default)', async () => {
    const res = await request(app)
      .post('/api/url')
      .set('Cookie', cookie)
      .send({ url: 'https://example.com' });

    expect(res.body.abState.activeInstance).toBe('A');
    expect(res.body.abState.instanceA.url).toBe('https://example.com');
    expect(res.body.abState.instanceB.url).toBeNull();
  });

  it('accepts http:// URLs', async () => {
    const res = await request(app)
      .post('/api/url')
      .set('Cookie', cookie)
      .send({ url: 'http://example.com' });
    expect(res.status).toBe(200);
    expect(res.body.currentUrl).toBe('http://example.com');
  });
});

describe('POST /api/url/reload', () => {
  let app: Express.Application;
  let cookie: string;
  let store: ReturnType<typeof createStateStore>;

  beforeEach(async () => {
    const made = makeServer();
    store = made.store;
    await made.server.listen();
    app = made.server.app;
    cookie = await login(app, 'test1234', '/auth/operator');
    // Pre-load a URL so reload has something to work with
    store.setState({
      currentMode: 'url',
      currentUrl: 'https://example.com',
      abState: {
        activeInstance: 'A',
        instanceA: { url: 'https://example.com', isLoading: false, isReady: true, displayTarget: null, sessionMode: 'persistent' },
        instanceB: { url: null, isLoading: false, isReady: false, displayTarget: null, sessionMode: 'persistent' },
      },
    });
  });

  it('reloads the active instance (sets isLoading: true)', async () => {
    const res = await request(app)
      .post('/api/url/reload')
      .set('Cookie', cookie)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.abState.instanceA.isLoading).toBe(true);
    expect(res.body.abState.instanceA.isReady).toBe(false);
    expect(res.body.abState.instanceA.url).toBe('https://example.com');
  });

  it('reloads the specified instance', async () => {
    store.setState({
      abState: {
        activeInstance: 'A',
        instanceA: { url: 'https://example.com', isLoading: false, isReady: true, displayTarget: null, sessionMode: 'persistent' },
        instanceB: { url: 'https://other.com', isLoading: false, isReady: true, displayTarget: null, sessionMode: 'persistent' },
      },
    });

    const res = await request(app)
      .post('/api/url/reload')
      .set('Cookie', cookie)
      .send({ instance: 'B' });

    expect(res.status).toBe(200);
    expect(res.body.abState.instanceB.isLoading).toBe(true);
    expect(res.body.abState.instanceB.isReady).toBe(false);
    expect(res.body.abState.instanceA.isLoading).toBe(false); // untouched
  });

  it('returns 400 when the target instance has no URL', async () => {
    const res = await request(app)
      .post('/api/url/reload')
      .set('Cookie', cookie)
      .send({ instance: 'B' }); // B has no URL in default beforeEach state

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_URL');
  });

  it('returns 401 without auth', async () => {
    const res = await request(app).post('/api/url/reload').send({});
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run to confirm tests fail**

```bash
npx vitest run tests/url.test.ts
```
Expected: FAIL

- [ ] **Step 3: Expose `app` from server**

In `src/main/server.ts`, add `app` to the returned object so tests can access it. The current server returns `{ listen, close }`. Add `app: Express` to the return type and object. Also add `presets` to the `ServerConfig` interface.

Read the current `src/main/server.ts` first, then add:
```typescript
// In ServerConfig interface:
presets: PresetsStore;

// In return value:
return { listen, close, app };
```

- [ ] **Step 4: Create URL router**

Create `src/main/routes/url.ts`:

```typescript
import { Router, Request, Response } from 'express';
import type { StateStore } from '../state';
import type { AuthManager } from '../auth';
import type { ABInstance, InstanceState } from '../../shared/types';
import { requireOperator } from './middleware';

const URL_PATTERN = /^https?:\/\/.+/;

export function createUrlRouter(store: StateStore, auth: AuthManager): Router {
  const router = Router();
  const opGuard = requireOperator(auth);

  router.post('/', opGuard, (req: Request, res: Response) => {
    const { url, display } = req.body as { url?: string; display?: string };

    if (!url || !URL_PATTERN.test(url)) {
      res.status(400).json({ error: { code: 'INVALID_URL', message: 'url must be a valid http or https URL' } });
      return;
    }

    const state = store.getState();

    if (display) {
      const found = state.displays.find((d) => d.id === display);
      if (!found) {
        res.status(404).json({ error: { code: 'DISPLAY_NOT_FOUND', message: `Display '${display}' not found` } });
        return;
      }
    }

    const active = state.abState.activeInstance;
    const updatedInstance: InstanceState = {
      ...state.abState[active === 'A' ? 'instanceA' : 'instanceB'],
      url,
      displayTarget: display ?? null,
      isLoading: true,
      isReady: false,
    };

    const newAbState = {
      ...state.abState,
      [active === 'A' ? 'instanceA' : 'instanceB']: updatedInstance,
    };

    store.setState({
      currentMode: 'url',
      currentUrl: url,
      abState: newAbState,
    });

    const next = store.getState();
    res.json({
      currentMode: next.currentMode,
      currentUrl: next.currentUrl,
      abState: next.abState,
    });
  });

  router.post('/reload', opGuard, (req: Request, res: Response) => {
    const state = store.getState();
    const { instance } = req.body as { instance?: string };
    const target: ABInstance = (instance === 'A' || instance === 'B') ? instance : state.abState.activeInstance;

    const instanceKey = target === 'A' ? 'instanceA' : 'instanceB';
    const inst = state.abState[instanceKey];

    if (!inst.url) {
      res.status(400).json({ error: { code: 'INVALID_URL', message: `Instance ${target} has no URL loaded` } });
      return;
    }

    const updatedInstance: InstanceState = { ...inst, isLoading: true, isReady: false };
    const newAbState = { ...state.abState, [instanceKey]: updatedInstance };

    store.setState({ abState: newAbState });

    const next = store.getState();
    res.json({ abState: next.abState });
  });

  return router;
}
```

- [ ] **Step 5: Mount URL router in routes/index.ts**

Add to `src/main/routes/index.ts`:
```typescript
import { createUrlRouter } from './url';
// In mountRoutes():
app.use('/api/url', createUrlRouter(store, auth));
```
Mount BEFORE `/api` (same pattern as slides).

- [ ] **Step 6: Update server.ts to accept presets and expose app**

In `src/main/server.ts`:
1. Add `presets: PresetsStore` to the `ServerConfig` interface
2. Add `app` to the return value: `return { listen, close, app }`

- [ ] **Step 7: Run tests to confirm they pass**

```bash
npx vitest run tests/url.test.ts
```
Expected: all tests pass

- [ ] **Step 8: Run full suite to confirm no regressions**

```bash
npx vitest run
```
Expected: all tests pass

- [ ] **Step 9: Commit**

```bash
git add src/main/routes/url.ts src/main/routes/index.ts src/main/server.ts tests/url.test.ts
git commit -m "feat: add POST /api/url and POST /api/url/reload endpoints"
```

---

## Task 3: Presets routes + GET /api/displays

**Files:**
- Create: `src/main/routes/presets.ts`
- Modify: `src/main/routes/api.ts` (add GET /api/displays)
- Modify: `src/main/routes/index.ts` (mount presets router)
- Modify: `tests/presets.test.ts` (add HTTP endpoint tests)

- [ ] **Step 1: Add HTTP endpoint tests to presets.test.ts**

Append to `tests/presets.test.ts`:

```typescript
import request from 'supertest';
import { createServer } from '../src/main/server';
import { createStateStore } from '../src/main/state';
import { createAuthManager } from '../src/main/auth';
import type { Express } from 'express';

function makeServer() {
  const store = createStateStore();
  const auth = createAuthManager({
    operatorPin: 'test1234', adminPin: 'adminpass', operatorSessionMs: 60000, adminSessionMs: 60000,
    maxFailures: 5, lockoutMs: 60000,
  });
  const presets = createPresetsStore();
  const server = createServer({ store, auth, presets, port: 0 });
  return { server, store, auth, presets };
}

async function getCookies(app: Express.Application) {
  const op = await request(app).post('/auth/operator').send({ pin: 'test1234' });
  const admin = await request(app).post('/auth/admin').send({ pin: 'adminpass' });
  return {
    operator: (op.headers['set-cookie'] as string[])[0],
    admin: (admin.headers['set-cookie'] as string[])[0],
  };
}

describe('GET /api/presets', () => {
  it('returns empty list when no presets', async () => {
    const { server } = makeServer();
    await server.listen();
    const { operator } = await getCookies(server.app);
    const res = await request(server.app).get('/api/presets').set('Cookie', operator);
    expect(res.status).toBe(200);
    expect(res.body.presets).toEqual([]);
  });

  it('returns presets list', async () => {
    const { server, presets } = makeServer();
    await server.listen();
    presets.create({ name: 'Slido', url: 'https://slido.com', sessionMode: 'persistent', displayTarget: null, description: null });
    const { operator } = await getCookies(server.app);
    const res = await request(server.app).get('/api/presets').set('Cookie', operator);
    expect(res.status).toBe(200);
    expect(res.body.presets).toHaveLength(1);
    expect(res.body.presets[0].name).toBe('Slido');
  });

  it('returns 401 without auth', async () => {
    const { server } = makeServer();
    await server.listen();
    const res = await request(server.app).get('/api/presets');
    expect(res.status).toBe(401);
  });
});

describe('POST /api/presets', () => {
  it('creates a preset (admin only)', async () => {
    const { server } = makeServer();
    await server.listen();
    const { admin } = await getCookies(server.app);
    const res = await request(server.app)
      .post('/api/presets')
      .set('Cookie', admin)
      .send({ name: 'Sponsor', url: 'https://sponsor.com', sessionMode: 'ephemeral', displayTarget: null });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeTruthy();
    expect(res.body.name).toBe('Sponsor');
  });

  it('updates existing preset when id matches', async () => {
    const { server, presets } = makeServer();
    await server.listen();
    const p = presets.create({ name: 'Old', url: 'https://old.com', sessionMode: 'persistent', displayTarget: null, description: null });
    const { admin } = await getCookies(server.app);
    const res = await request(server.app)
      .post('/api/presets')
      .set('Cookie', admin)
      .send({ id: p.id, name: 'New', url: 'https://new.com', sessionMode: 'persistent', displayTarget: null });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('New');
    expect(res.body.id).toBe(p.id);
  });

  it('rejects invalid URL', async () => {
    const { server } = makeServer();
    await server.listen();
    const { admin } = await getCookies(server.app);
    const res = await request(server.app)
      .post('/api/presets')
      .set('Cookie', admin)
      .send({ name: 'Bad', url: 'not-a-url', sessionMode: 'persistent' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_URL');
  });

  it('returns 401 for operator (admin-only endpoint)', async () => {
    const { server } = makeServer();
    await server.listen();
    const { operator } = await getCookies(server.app);
    const res = await request(server.app)
      .post('/api/presets')
      .set('Cookie', operator)
      .send({ name: 'X', url: 'https://x.com', sessionMode: 'persistent' });
    expect(res.status).toBe(401);
  });
});

describe('DELETE /api/presets/:id', () => {
  it('deletes a preset (admin only)', async () => {
    const { server, presets } = makeServer();
    await server.listen();
    const p = presets.create({ name: 'ToDelete', url: 'https://delete.me', sessionMode: 'persistent', displayTarget: null, description: null });
    const { admin } = await getCookies(server.app);
    const res = await request(server.app).delete(`/api/presets/${p.id}`).set('Cookie', admin);
    expect(res.status).toBe(204);
    expect(presets.list()).toHaveLength(0);
  });

  it('returns 404 for unknown id', async () => {
    const { server } = makeServer();
    await server.listen();
    const { admin } = await getCookies(server.app);
    const res = await request(server.app).delete('/api/presets/nope').set('Cookie', admin);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('PRESET_NOT_FOUND');
  });

  it('nullifies currentPreset when deleted preset is active', async () => {
    const { server, store, presets } = makeServer();
    await server.listen();
    const p = presets.create({ name: 'Active', url: 'https://active.com', sessionMode: 'persistent', displayTarget: null, description: null });
    store.setState({ currentPreset: { id: p.id, name: p.name } });
    const { admin } = await getCookies(server.app);
    await request(server.app).delete(`/api/presets/${p.id}`).set('Cookie', admin);
    expect(store.getState().currentPreset).toBeNull();
  });

  it('returns 401 for operator (admin-only endpoint)', async () => {
    const { server, presets } = makeServer();
    await server.listen();
    const p = presets.create({ name: 'Y', url: 'https://y.com', sessionMode: 'persistent', displayTarget: null, description: null });
    const { operator } = await getCookies(server.app);
    const res = await request(server.app).delete(`/api/presets/${p.id}`).set('Cookie', operator);
    expect(res.status).toBe(401);
  });
});

describe('GET /api/displays', () => {
  it('returns displays from state', async () => {
    const { server, store } = makeServer();
    await server.listen();
    store.setState({ displays: [{ id: 'HDMI-1', name: 'HDMI-1', isPrimary: true }] });
    const { operator } = await getCookies(server.app);
    const res = await request(server.app).get('/api/displays').set('Cookie', operator);
    expect(res.status).toBe(200);
    expect(res.body.displays).toHaveLength(1);
    expect(res.body.displays[0].id).toBe('HDMI-1');
  });

  it('returns empty array when no displays', async () => {
    const { server } = makeServer();
    await server.listen();
    const { operator } = await getCookies(server.app);
    const res = await request(server.app).get('/api/displays').set('Cookie', operator);
    expect(res.status).toBe(200);
    expect(res.body.displays).toEqual([]);
  });

  it('returns 401 without auth', async () => {
    const { server } = makeServer();
    await server.listen();
    const res = await request(server.app).get('/api/displays');
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx vitest run tests/presets.test.ts
```
Expected: HTTP endpoint tests fail (routes don't exist yet)

- [ ] **Step 3: Create presets router**

Create `src/main/routes/presets.ts`:

```typescript
import { Router, Request, Response } from 'express';
import type { StateStore } from '../state';
import type { AuthManager } from '../auth';
import type { PresetsStore } from '../presets';
import { requireOperator, requireAdmin } from './middleware';

const URL_PATTERN = /^https?:\/\/.+/;

export function createPresetsRouter(store: StateStore, auth: AuthManager, presets: PresetsStore): Router {
  const router = Router();
  const opGuard = requireOperator(auth);
  const adminGuard = requireAdmin(auth);

  router.get('/', opGuard, (_req: Request, res: Response) => {
    res.json({ presets: presets.list() });
  });

  router.post('/', adminGuard, (req: Request, res: Response) => {
    const { id, name, url, sessionMode, displayTarget, description } = req.body as {
      id?: string; name?: string; url?: string; sessionMode?: string; displayTarget?: string | null; description?: string | null;
    };

    if (!url || !URL_PATTERN.test(url)) {
      res.status(400).json({ error: { code: 'INVALID_URL', message: 'url must be a valid http or https URL' } });
      return;
    }
    if (!name) {
      res.status(400).json({ error: { code: 'INVALID_MODE', message: 'name is required' } });
      return;
    }
    if (sessionMode !== 'persistent' && sessionMode !== 'ephemeral') {
      res.status(400).json({ error: { code: 'INVALID_MODE', message: 'sessionMode must be "persistent" or "ephemeral"' } });
      return;
    }

    if (id && presets.findById(id)) {
      const updated = presets.update(id, { name, url, sessionMode, displayTarget: displayTarget ?? null, description: description ?? null });
      res.json(updated);
    } else {
      const created = presets.create({ name, url, sessionMode, displayTarget: displayTarget ?? null, description: description ?? null });
      res.status(201).json(created);
    }
  });

  router.delete('/:id', adminGuard, (req: Request, res: Response) => {
    const { id } = req.params;
    const existing = presets.findById(id);
    if (!existing) {
      res.status(404).json({ error: { code: 'PRESET_NOT_FOUND', message: `Preset '${id}' not found` } });
      return;
    }

    presets.remove(id);

    // Nullify currentPreset if the deleted preset was active
    const state = store.getState();
    if (state.currentPreset?.id === id) {
      store.setState({ currentPreset: null });
    }

    res.status(204).end();
  });

  return router;
}
```

- [ ] **Step 4: Add GET /api/displays to api.ts**

In `src/main/routes/api.ts`, add after the `/health` route:

```typescript
router.get('/displays', opGuard, (_req: Request, res: Response) => {
  res.json({ displays: store.getState().displays });
});
```

- [ ] **Step 5: Mount presets router in routes/index.ts**

In `src/main/routes/index.ts`:
```typescript
import { createPresetsRouter } from './presets';
// In mountRoutes():
app.use('/api/presets', createPresetsRouter(store, auth, presets));
```
Also update `mountRoutes` signature to accept `presets: PresetsStore`.

- [ ] **Step 6: Run tests to confirm they pass**

```bash
npx vitest run tests/presets.test.ts
```
Expected: all tests pass

- [ ] **Step 7: Run full suite**

```bash
npx vitest run
```
Expected: all tests pass

- [ ] **Step 8: Commit**

```bash
git add src/main/routes/presets.ts src/main/routes/api.ts src/main/routes/index.ts tests/presets.test.ts
git commit -m "feat: add presets CRUD routes and GET /api/displays"
```

---

## Task 4: URL window manager + full wiring

**Files:**
- Create: `src/main/url/window-manager.ts`
- Modify: `src/main/server.ts` (accept PresetsStore — pass to mountRoutes)
- Modify: `src/main/index.ts` (wire URL window manager and PresetsStore)

No new tests for the Electron window manager (requires Electron environment). The state-only logic is covered by the url.test.ts and presets.test.ts tests.

- [ ] **Step 1: Create URL window manager**

Create `src/main/url/window-manager.ts`:

```typescript
import { BrowserWindow, screen, session } from 'electron';
import type { StateStore } from '../state';
import type { ABInstance } from '../../shared/types';

interface UrlWindowConfig {
  store: StateStore;
}

export function createUrlWindowManager(config: UrlWindowConfig) {
  const { store } = config;
  let windowA: BrowserWindow | null = null;
  let windowB: BrowserWindow | null = null;
  let unsubscribe: (() => void) | null = null;

  function createUrlWindow(instance: ABInstance): BrowserWindow {
    const display = screen.getPrimaryDisplay();
    const sess = session.fromPartition(`persist:pconair-url-${instance}`, { cache: true });
    const win = new BrowserWindow({
      x: display.bounds.x,
      y: display.bounds.y,
      width: display.bounds.width,
      height: display.bounds.height,
      fullscreen: false,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        session: sess,
      },
      backgroundColor: '#000000',
      frame: false,
      show: false,
    });
    return win;
  }

  async function loadUrl(url: string, instance: ABInstance): Promise<void> {
    const win = instance === 'A' ? windowA : windowB;
    if (!win || win.isDestroyed()) return;
    await win.loadURL(url);
    const state = store.getState();
    const instKey = instance === 'A' ? 'instanceA' : 'instanceB';
    if (state.abState[instKey].url === url) {
      store.setState({
        abState: {
          ...state.abState,
          [instKey]: { ...state.abState[instKey], isLoading: false, isReady: true },
        },
      });
    }
  }

  function showInstance(instance: ABInstance): void {
    const toShow = instance === 'A' ? windowA : windowB;
    const toHide = instance === 'A' ? windowB : windowA;
    if (toHide && !toHide.isDestroyed()) toHide.hide();
    if (toShow && !toShow.isDestroyed()) toShow.show();
  }

  function initialize(): void {
    windowA = createUrlWindow('A');
    windowB = createUrlWindow('B');

    unsubscribe = store.subscribe((patch) => {
      const state = store.getState();
      // Load URL on the active instance when currentUrl changes
      if (patch.currentUrl && state.currentMode === 'url') {
        const active = state.abState.activeInstance;
        void loadUrl(patch.currentUrl, active);
      }
      // Handle reload: isLoading flips to true on an instance that already has a URL
      if (patch.abState) {
        const { instanceA, instanceB } = patch.abState;
        if (instanceA?.isLoading && state.abState.instanceA.url) {
          void loadUrl(state.abState.instanceA.url, 'A');
        }
        if (instanceB?.isLoading && state.abState.instanceB.url) {
          void loadUrl(state.abState.instanceB.url, 'B');
        }
        if (patch.abState.activeInstance) {
          showInstance(patch.abState.activeInstance);
        }
      }
    });
  }

  function destroy(): void {
    unsubscribe?.();
    unsubscribe = null;
    windowA?.destroy();
    windowB?.destroy();
    windowA = null;
    windowB = null;
  }

  return { initialize, loadUrl, showInstance, destroy };
}

export type UrlWindowManager = ReturnType<typeof createUrlWindowManager>;
```

- [ ] **Step 2: Update server.ts to pass presets to mountRoutes**

In `src/main/server.ts`, update `mountRoutes` call to include presets:
```typescript
mountRoutes(app, store, auth, presets);
```

- [ ] **Step 3: Wire everything in index.ts**

In `src/main/index.ts`:

```typescript
import { createPresetsStore } from './presets';
import { createUrlWindowManager } from './url/window-manager';

// In main():
const presets = createPresetsStore();
const urlManager = createUrlWindowManager({ store });
urlManager.initialize();

const server = createServer({ store, auth, presets, port: DEFAULT_PORT });
```

- [ ] **Step 4: TypeScript check**

```bash
npx tsc --noEmit
```
Expected: 0 errors

- [ ] **Step 5: Run full test suite**

```bash
npx vitest run
```
Expected: all tests pass

- [ ] **Step 6: Commit**

```bash
git add src/main/url/window-manager.ts src/main/server.ts src/main/index.ts
git commit -m "feat: add URL window manager and wire Phase 4 in main process"
```

---

## Verification

After all 4 tasks:
- `npx tsc --noEmit` → 0 errors
- `npx vitest run` → all tests pass (target: 60+ tests)
- New files exist: `src/main/presets.ts`, `src/main/routes/url.ts`, `src/main/routes/presets.ts`, `src/main/url/window-manager.ts`
- `GET /api/presets` returns preset list (operator auth)
- `POST /api/presets` creates presets (admin auth only)
- `DELETE /api/presets/:id` removes preset and nullifies `currentPreset` if active
- `GET /api/displays` returns display list from state
- `POST /api/url` validates URL, sets mode=url, updates active instance
- `POST /api/url/reload` resets isLoading/isReady on specified instance
