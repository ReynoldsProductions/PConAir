import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createStateStore } from '../src/main/state';
import { createFullServer } from './_test-server';
import { loadProfile, patchShowProfile, writeProfile } from '../src/main/profiles/bootstrap';

function makeHttpServer() {
  const store = createStateStore();
  const server = createFullServer({
    store,
    operatorPin: 'test1234',
    adminPin: 'adminpass8',
    operatorSessionMs: 60000,
    adminSessionMs: 60000,
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

describe('GET /api/background', () => {
  let app: Express;
  let cookies: { operator: string; admin: string };
  let srv: ReturnType<typeof makeHttpServer>['server'];

  beforeEach(async () => {
    const made = makeHttpServer();
    srv = made.server;
    await srv.listen();
    app = srv.app;
    cookies = await getCookies(app);
  });

  afterEach(() => srv.close());

  it('returns current background state (200)', async () => {
    const res = await request(app).get('/api/background').set('Cookie', cookies.operator);
    expect(res.status).toBe(200);
    expect(res.body.background).toEqual({
      presetId: null,
      presetName: null,
      type: 'luma',
      value: '#000000',
    });
  });

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/background');
    expect(res.status).toBe(401);
  });
});

describe('POST /api/background', () => {
  let app: Express;
  let cookies: { operator: string; admin: string };
  let srv: ReturnType<typeof makeHttpServer>['server'];
  let store: ReturnType<typeof makeHttpServer>['store'];

  function seedBackgroundPreset(
    preset: { id: string; name: string; type: 'luma' | 'solid'; value: string; createdAt: string; updatedAt: string }
  ) {
    const prof = loadProfile(srv.profilePaths, srv.activeProfileId);
    if (!prof) throw new Error('missing profile');
    const next = patchShowProfile(prof, { backgroundPresets: [...prof.backgroundPresets, preset] });
    writeProfile(srv.profilePaths, next, 'automatic');
  }

  beforeEach(async () => {
    const made = makeHttpServer();
    srv = made.server;
    store = made.store;
    await srv.listen();
    app = srv.app;
    cookies = await getCookies(app);
  });

  afterEach(() => srv.close());

  it('sets type and value (200, admin)', async () => {
    const res = await request(app)
      .post('/api/background')
      .set('Cookie', cookies.admin)
      .send({ type: 'solid', value: '#FF0000' });
    expect(res.status).toBe(200);
    expect(res.body.background).toEqual({
      presetId: null,
      presetName: null,
      type: 'solid',
      value: '#FF0000',
    });
    expect(store.getState().background.type).toBe('solid');
    expect(store.getState().background.value).toBe('#FF0000');
  });

  it('sets only type (value unchanged)', async () => {
    const res = await request(app)
      .post('/api/background')
      .set('Cookie', cookies.admin)
      .send({ type: 'solid' });
    expect(res.status).toBe(200);
    expect(res.body.background.type).toBe('solid');
    expect(res.body.background.value).toBe('#000000'); // default unchanged
  });

  it('sets only value (type unchanged)', async () => {
    const res = await request(app)
      .post('/api/background')
      .set('Cookie', cookies.admin)
      .send({ value: '#AABBCC' });
    expect(res.status).toBe(200);
    expect(res.body.background.type).toBe('luma'); // default unchanged
    expect(res.body.background.value).toBe('#AABBCC');
  });

  it('returns 400 INVALID_URL for invalid hex value', async () => {
    const res = await request(app)
      .post('/api/background')
      .set('Cookie', cookies.admin)
      .send({ value: 'notahex' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_URL');
  });

  it('returns 400 INVALID_URL for malformed hex (5 digits)', async () => {
    const res = await request(app)
      .post('/api/background')
      .set('Cookie', cookies.admin)
      .send({ value: '#AABBC' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_URL');
  });

  it('returns 400 INVALID_MODE for invalid type', async () => {
    const res = await request(app)
      .post('/api/background')
      .set('Cookie', cookies.admin)
      .send({ type: 'chroma' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_MODE');
  });

  it('returns 404 PRESET_NOT_FOUND when presetId is unknown', async () => {
    const res = await request(app)
      .post('/api/background')
      .set('Cookie', cookies.admin)
      .send({ presetId: 'some-id' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('PRESET_NOT_FOUND');
  });

  it('returns 404 PRESET_NOT_FOUND when presetId is empty string', async () => {
    const res = await request(app)
      .post('/api/background')
      .set('Cookie', cookies.admin)
      .send({ presetId: '' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('PRESET_NOT_FOUND');
  });

  it('applies background preset from active profile (200)', async () => {
    const ts = new Date().toISOString();
    seedBackgroundPreset({
      id: 'bg-preset-1',
      name: 'Green Key',
      type: 'luma',
      value: '#00FF00',
      createdAt: ts,
      updatedAt: ts,
    });
    const res = await request(app)
      .post('/api/background')
      .set('Cookie', cookies.admin)
      .send({ presetId: 'bg-preset-1' });
    expect(res.status).toBe(200);
    expect(res.body.background).toEqual({
      presetId: 'bg-preset-1',
      presetName: 'Green Key',
      type: 'luma',
      value: '#00FF00',
    });
    expect(store.getState().background.presetId).toBe('bg-preset-1');
  });

  it('treats presetId null as direct update (still sets type/value)', async () => {
    const res = await request(app)
      .post('/api/background')
      .set('Cookie', cookies.admin)
      .send({ presetId: null, type: 'solid', value: '#ABCDEF' });
    expect(res.status).toBe(200);
    expect(res.body.background).toEqual({
      presetId: null,
      presetName: null,
      type: 'solid',
      value: '#ABCDEF',
    });
  });

  it('returns 403 for operator (admin-only)', async () => {
    const res = await request(app)
      .post('/api/background')
      .set('Cookie', cookies.operator)
      .send({ type: 'solid', value: '#FF0000' });
    expect(res.status).toBe(403);
  });

  it('returns 401 without auth', async () => {
    const res = await request(app)
      .post('/api/background')
      .send({ type: 'solid', value: '#FF0000' });
    expect(res.status).toBe(401);
  });
});

describe('Background Preset CRUD', () => {
  let app: Express;
  let cookies: { operator: string; admin: string };
  let srv: ReturnType<typeof makeHttpServer>['server'];

  beforeEach(async () => {
    const made = makeHttpServer();
    srv = made.server;
    await srv.listen();
    app = srv.app;
    cookies = await getCookies(app);
  });

  afterEach(() => srv.close());

  it('GET /api/background/presets returns empty list initially', async () => {
    const res = await request(app).get('/api/background/presets').set('Cookie', cookies.admin);
    expect(res.status).toBe(200);
    expect(res.body.presets).toEqual([]);
  });

  it('POST /api/background/presets creates a preset', async () => {
    const res = await request(app)
      .post('/api/background/presets')
      .set('Cookie', cookies.admin)
      .send({ name: 'Luma Green', type: 'luma', value: '#00FF00' });
    expect(res.status).toBe(201);
    expect(res.body.preset.id).toBeTruthy();
    expect(res.body.preset.name).toBe('Luma Green');
    expect(res.body.preset.type).toBe('luma');
    expect(res.body.preset.value).toBe('#00FF00');
  });

  it('POST /api/background/presets returns 400 for missing name', async () => {
    const res = await request(app)
      .post('/api/background/presets')
      .set('Cookie', cookies.admin)
      .send({ type: 'luma', value: '#00FF00' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_MODE');
  });

  it('DELETE /api/background/presets/:id removes the preset', async () => {
    const created = await request(app)
      .post('/api/background/presets')
      .set('Cookie', cookies.admin)
      .send({ name: 'X', type: 'solid', value: '#FF0000' });
    const id = created.body.preset.id as string;

    const del = await request(app)
      .delete(`/api/background/presets/${id}`)
      .set('Cookie', cookies.admin);
    expect(del.status).toBe(204);

    const list = await request(app).get('/api/background/presets').set('Cookie', cookies.admin);
    expect(list.body.presets).toEqual([]);
  });

  it('POST /api/background with valid presetId applies preset to state', async () => {
    const created = await request(app)
      .post('/api/background/presets')
      .set('Cookie', cookies.admin)
      .send({ name: 'Black BG', type: 'solid', value: '#111111' });
    const id = created.body.preset.id as string;

    const res = await request(app)
      .post('/api/background')
      .set('Cookie', cookies.admin)
      .send({ presetId: id });
    expect(res.status).toBe(200);
    expect(res.body.background.presetId).toBe(id);
    expect(res.body.background.presetName).toBe('Black BG');
    expect(res.body.background.value).toBe('#111111');
    expect(res.body.background.type).toBe('solid');
  });

  it('POST /api/background with unknown presetId returns 404', async () => {
    const res = await request(app)
      .post('/api/background')
      .set('Cookie', cookies.admin)
      .send({ presetId: 'nonexistent-id' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('PRESET_NOT_FOUND');
  });

  it('GET /api/background/presets returns 401 without auth', async () => {
    const res = await request(app).get('/api/background/presets');
    expect(res.status).toBe(401);
  });

  it('GET /api/background/presets returns 403 for operator', async () => {
    const res = await request(app).get('/api/background/presets').set('Cookie', cookies.operator);
    expect(res.status).toBe(403);
  });

  it('POST /api/background/presets returns 403 for operator', async () => {
    const res = await request(app)
      .post('/api/background/presets')
      .set('Cookie', cookies.operator)
      .send({ name: 'X', type: 'solid', value: '#FF0000' });
    expect(res.status).toBe(403);
  });

  it('DELETE /api/background/presets/:id returns 403 for operator', async () => {
    const res = await request(app)
      .delete('/api/background/presets/some-id')
      .set('Cookie', cookies.operator);
    expect(res.status).toBe(403);
  });
});
