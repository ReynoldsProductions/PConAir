import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createStateStore } from '../src/main/state';
import { createFullServer } from './_test-server';
import { buildProfileExportZip } from '../src/main/profiles/bundle-zip';
import { loadProfile } from '../src/main/profiles/bootstrap';

function makeServer() {
  const store = createStateStore();
  const srv = createFullServer({
    store,
    operatorPin: 'test1234',
    adminPin: 'adminpass8',
    port: 0,
  });
  return { srv, store };
}

async function adminCookie(app: Express): Promise<string> {
  const res = await request(app).post('/auth/admin').send({ pin: 'adminpass8' });
  return ((res.headers['set-cookie'] as unknown) as string[])[0].split(';')[0];
}

describe('Profiles API', () => {
  let app: Express;
  let srv: ReturnType<typeof makeServer>['srv'];
  let adm: string;

  beforeEach(async () => {
    const made = makeServer();
    srv = made.srv;
    await srv.listen();
    app = srv.app;
    adm = await adminCookie(app);
  });

  afterEach(() => srv.close());

  it('GET /api/profiles lists default profile', async () => {
    const res = await request(app).get('/api/profiles');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.profiles)).toBe(true);
    expect(res.body.profiles.length).toBeGreaterThanOrEqual(1);
    expect(res.body.profiles[0]).toHaveProperty('name', 'Default');
  });

  it('GET /api/profiles/active returns metadata', async () => {
    const res = await request(app).get('/api/profiles/active');
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Default');
    expect(res.body.id).toBeTruthy();
  });

  it('GET /api/profiles/:id omits PIN hashes and includes hasPins', async () => {
    const list = await request(app).get('/api/profiles');
    const id = list.body.profiles[0].id as string;
    const res = await request(app).get(`/api/profiles/${id}`).set('Cookie', adm);
    expect(res.status).toBe(200);
    expect(res.body.operatorPinHash).toBeUndefined();
    expect(res.body.adminPinHash).toBeUndefined();
    expect(res.body.hasPins).toEqual({ operator: true, admin: true });
    expect(res.body.schemaVersion).toBe('1.0');
  });

  it('POST /api/profiles creates a second profile', async () => {
    const res = await request(app).post('/api/profiles').set('Cookie', adm).send({ name: 'Evening' });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Evening');
    const list = await request(app).get('/api/profiles');
    expect(list.body.profiles.length).toBeGreaterThanOrEqual(2);
  });

  it('POST /api/profiles/:id/backups creates manual backup', async () => {
    const list = await request(app).get('/api/profiles');
    const id = list.body.profiles[0].id as string;
    const res = await request(app).post(`/api/profiles/${id}/backups`).set('Cookie', adm).send({ note: 'test note' });
    expect(res.status).toBe(201);
    expect(res.body.type).toBe('manual');
    expect(res.body.note).toBe('test note');
  });

  it('GET /api/profiles/:id/backups lists backups', async () => {
    const list = await request(app).get('/api/profiles');
    const id = list.body.profiles[0].id as string;
    await request(app).post(`/api/profiles/${id}/backups`).set('Cookie', adm).send({});
    const res = await request(app).get(`/api/profiles/${id}/backups`).set('Cookie', adm);
    expect(res.status).toBe(200);
    expect(res.body.backups.length).toBeGreaterThanOrEqual(1);
  });

  it('POST /api/profiles/:id/export returns zip content-type', async () => {
    const list = await request(app).get('/api/profiles');
    const id = list.body.profiles[0].id as string;
    const res = await request(app).post(`/api/profiles/${id}/export`).set('Cookie', adm).send({});
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/zip/);
  });
});

describe('Profile export bundle', () => {
  it('buildProfileExportZip includes profile.json', async () => {
    const made = makeServer();
    const p = loadProfile(made.srv.profilePaths, made.srv.activeProfileId);
    expect(p).not.toBeNull();
    const buf = await buildProfileExportZip({
      profile: p!,
      cues: [],
      mediaLibrary: made.srv.mediaLibrary,
      appVersion: '0.0.0-test',
      includeStillStore: false,
      includeMediaLibrary: false,
    });
    expect(buf.subarray(0, 2).toString('ascii')).toBe('PK');
  });
});

// `/display-preference` is a literal path, but it was registered *after*
// `/:profileId`, so Express matched it as a profile id first and the admin
// Monitors page got 404 "Profile not found" instead of its display list.
describe('Profiles display preference', () => {
  let app: Express;
  let srv: ReturnType<typeof makeServer>['srv'];
  let store: ReturnType<typeof makeServer>['store'];
  let adm: string;

  beforeEach(async () => {
    const made = makeServer();
    srv = made.srv;
    store = made.store;
    await srv.listen();
    app = srv.app;
    adm = await adminCookie(app);
  });

  afterEach(() => srv.close());

  it('GET /api/profiles/display-preference returns displays, not a profile lookup', async () => {
    store.setState({ displays: [{ id: '1', name: 'Display 1', isPrimary: true }] });
    const res = await request(app).get('/api/profiles/display-preference').set('Cookie', adm);
    expect(res.status).toBe(200);
    expect(res.body.displays).toHaveLength(1);
    expect(res.body).toHaveProperty('displayPreference');
  });

  it('PATCH /api/profiles/display-preference persists the preference', async () => {
    const res = await request(app)
      .patch('/api/profiles/display-preference')
      .set('Cookie', adm)
      .send({ displayPreference: '2' });
    expect(res.status).toBe(200);
    expect(res.body.displayPreference).toBe('2');

    const after = await request(app).get('/api/profiles/display-preference').set('Cookie', adm);
    expect(after.body.displayPreference).toBe('2');
  });
});
