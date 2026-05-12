import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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
    // updatedAt must be >= createdAt (same-ms collision is allowed but order must not regress)
    expect(new Date(updated!.updatedAt).getTime()).toBeGreaterThanOrEqual(new Date(p.createdAt).getTime());
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

// ── HTTP endpoint tests ──────────────────────────────────────────────

import request from 'supertest';
import type { Express } from 'express';
import { createStateStore } from '../src/main/state';
import { createFullServer } from './_test-server';

function makeHttpServer() {
  const store = createStateStore();
  const server = createFullServer({
    store,
    operatorPin: 'test1234',
    adminPin: 'adminpass8',
    port: 0,
  });
  return { server, store, presets: server.presets };
}

async function getCookies(app: Express) {
  const op = await request(app).post('/auth/operator').send({ pin: 'test1234' });
  const adm = await request(app).post('/auth/admin').send({ pin: 'adminpass8' });
  return {
    operator: ((op.headers['set-cookie'] as unknown) as string[])[0],
    admin: ((adm.headers['set-cookie'] as unknown) as string[])[0],
  };
}

describe('GET /api/presets', () => {
  let app: Express;
  let cookies: { operator: string; admin: string };
  let srv: ReturnType<typeof makeHttpServer>['server'];
  let ps: ReturnType<typeof createPresetsStore>;

  beforeEach(async () => {
    const made = makeHttpServer();
    srv = made.server;
    ps = made.presets;
    await srv.listen();
    app = srv.app;
    cookies = await getCookies(app);
  });

  afterEach(() => srv.close());

  it('returns empty list when no presets', async () => {
    const res = await request(app).get('/api/presets').set('Cookie', cookies.operator);
    expect(res.status).toBe(200);
    expect(res.body.presets).toEqual([]);
  });

  it('returns all presets', async () => {
    ps.create({ name: 'Slido', url: 'https://slido.com', sessionMode: 'persistent', displayTarget: null, description: null });
    const res = await request(app).get('/api/presets').set('Cookie', cookies.operator);
    expect(res.status).toBe(200);
    expect(res.body.presets).toHaveLength(1);
    expect(res.body.presets[0].name).toBe('Slido');
  });

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/presets');
    expect(res.status).toBe(401);
  });
});

describe('POST /api/presets', () => {
  let app: Express;
  let cookies: { operator: string; admin: string };
  let srv: ReturnType<typeof makeHttpServer>['server'];
  let ps: ReturnType<typeof createPresetsStore>;

  beforeEach(async () => {
    const made = makeHttpServer();
    srv = made.server;
    ps = made.presets;
    await srv.listen();
    app = srv.app;
    cookies = await getCookies(app);
  });

  afterEach(() => srv.close());

  it('creates a preset as admin (returns 201)', async () => {
    const res = await request(app)
      .post('/api/presets')
      .set('Cookie', cookies.admin)
      .send({ name: 'Sponsor', url: 'https://sponsor.com', sessionMode: 'ephemeral', displayTarget: null });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeTruthy();
    expect(res.body.name).toBe('Sponsor');
    expect(res.body.url).toBe('https://sponsor.com');
    expect(res.body.sessionMode).toBe('ephemeral');
  });

  it('updates an existing preset when id matches (returns 200)', async () => {
    const p = ps.create({ name: 'Old', url: 'https://old.com', sessionMode: 'persistent', displayTarget: null, description: null });
    const res = await request(app)
      .post('/api/presets')
      .set('Cookie', cookies.admin)
      .send({ id: p.id, name: 'New', url: 'https://new.com', sessionMode: 'persistent', displayTarget: null });
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(p.id);
    expect(res.body.name).toBe('New');
  });

  it('rejects invalid URL (400 INVALID_URL)', async () => {
    const res = await request(app)
      .post('/api/presets')
      .set('Cookie', cookies.admin)
      .send({ name: 'Bad', url: 'not-a-url', sessionMode: 'persistent' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_URL');
  });

  it('returns 401 for operator (admin-only)', async () => {
    const res = await request(app)
      .post('/api/presets')
      .set('Cookie', cookies.operator)
      .send({ name: 'X', url: 'https://x.com', sessionMode: 'persistent' });
    expect(res.status).toBe(401);
  });

  it('returns 401 without auth', async () => {
    const res = await request(app)
      .post('/api/presets')
      .send({ name: 'X', url: 'https://x.com', sessionMode: 'persistent' });
    expect(res.status).toBe(401);
  });
});

describe('DELETE /api/presets/:id', () => {
  let app: Express;
  let cookies: { operator: string; admin: string };
  let srv: ReturnType<typeof makeHttpServer>['server'];
  let ps: ReturnType<typeof createPresetsStore>;
  let store: ReturnType<typeof createStateStore>;

  beforeEach(async () => {
    const made = makeHttpServer();
    srv = made.server;
    ps = made.presets;
    store = made.store;
    await srv.listen();
    app = srv.app;
    cookies = await getCookies(app);
  });

  afterEach(() => srv.close());

  it('deletes an existing preset (returns 204)', async () => {
    const p = ps.create({ name: 'ToDelete', url: 'https://delete.me', sessionMode: 'persistent', displayTarget: null, description: null });
    const res = await request(app).delete(`/api/presets/${p.id}`).set('Cookie', cookies.admin);
    expect(res.status).toBe(204);
    expect(ps.list()).toHaveLength(0);
  });

  it('returns 404 PRESET_NOT_FOUND for unknown id', async () => {
    const res = await request(app).delete('/api/presets/nope').set('Cookie', cookies.admin);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('PRESET_NOT_FOUND');
  });

  it('nullifies currentPreset when deleted preset is active', async () => {
    const p = ps.create({ name: 'Active', url: 'https://active.com', sessionMode: 'persistent', displayTarget: null, description: null });
    store.setState({ currentPreset: { id: p.id, name: p.name } });
    await request(app).delete(`/api/presets/${p.id}`).set('Cookie', cookies.admin);
    expect(store.getState().currentPreset).toBeNull();
  });

  it('returns 401 for operator (admin-only)', async () => {
    const p = ps.create({ name: 'Y', url: 'https://y.com', sessionMode: 'persistent', displayTarget: null, description: null });
    const res = await request(app).delete(`/api/presets/${p.id}`).set('Cookie', cookies.operator);
    expect(res.status).toBe(401);
  });
});

describe('GET /api/displays', () => {
  let app: Express;
  let cookies: { operator: string; admin: string };
  let srv: ReturnType<typeof makeHttpServer>['server'];
  let store: ReturnType<typeof createStateStore>;

  beforeEach(async () => {
    const made = makeHttpServer();
    srv = made.server;
    store = made.store;
    await srv.listen();
    app = srv.app;
    cookies = await getCookies(app);
  });

  afterEach(() => srv.close());

  it('returns displays from state', async () => {
    store.setState({ displays: [{ id: 'HDMI-1', name: 'HDMI-1', isPrimary: true }] });
    const res = await request(app).get('/api/displays').set('Cookie', cookies.operator);
    expect(res.status).toBe(200);
    expect(res.body.displays).toHaveLength(1);
    expect(res.body.displays[0].id).toBe('HDMI-1');
    expect(res.body.displays[0].isPrimary).toBe(true);
  });

  it('returns empty array when no displays connected', async () => {
    const res = await request(app).get('/api/displays').set('Cookie', cookies.operator);
    expect(res.status).toBe(200);
    expect(res.body.displays).toEqual([]);
  });

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/displays');
    expect(res.status).toBe(401);
  });
});
