import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';
import { WebSocket } from 'ws';
import { createStateStore } from '../src/main/state';
import { createFullServer } from './_test-server';
import { validateManifest, defaultStateFromSchema, scanPackagesDir } from '../src/main/packages/loader';
import { createPackageHub } from '../src/main/packages/state-hub';

const PINS = { operatorPin: '1234', adminPin: 'supersecret' };

function writeFixturePackage(root: string): void {
  const dir = path.join(root, 'hoops');
  fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({
      id: 'hoops',
      name: 'COURTVISION Basketball',
      version: '1.0.0',
      description: 'Test scorebug',
      renders: [{ id: 'scorebug', label: 'Scorebug', file: 'render.html' }],
      stateSchema: {
        scoreA: 'number',
        scoreB: 'number',
        teamA: 'string',
        bonus: 'boolean',
        playerCard: { visible: 'boolean', name: 'string' },
      },
    })
  );
  fs.writeFileSync(path.join(dir, 'render.html'), '<!DOCTYPE html><html><body>SCOREBUG</body></html>');
  fs.writeFileSync(path.join(dir, 'control.html'), '<!DOCTYPE html><html><body>CONTROL</body></html>');
  fs.writeFileSync(path.join(dir, 'assets', 'logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg"></svg>');
}

describe('package loader', () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'pconair-pkg-'));
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('validates manifests', () => {
    expect(validateManifest({ id: 'ok', name: 'X', version: '1', renders: [{ id: 'r', label: 'R', file: 'r.html' }] }).ok).toBe(true);
    expect(validateManifest({ id: 'Bad Id', name: 'X', version: '1', renders: [] }).ok).toBe(false);
    expect(validateManifest({ id: 'ok', name: 'X', version: '1', renders: [{ id: 'r', file: '../escape.html' }] }).ok).toBe(false);
  });

  it('derives default state from a schema', () => {
    const d = defaultStateFromSchema({
      score: 'number',
      team: 'string',
      live: 'boolean',
      nested: { visible: 'boolean' },
    });
    expect(d).toEqual({ score: 0, team: '', live: false, nested: { visible: false } });
  });

  it('scans a directory and skips invalid packages', () => {
    writeFixturePackage(root);
    fs.mkdirSync(path.join(root, 'broken'));
    fs.writeFileSync(path.join(root, 'broken', 'package.json'), '{not json');
    const result = scanPackagesDir(root);
    expect(result.packages.length).toBe(1);
    expect(result.packages[0].manifest.id).toBe('hoops');
    expect(result.errors.length).toBe(1);
    expect(result.errors[0].dir).toBe('broken');
  });
});

describe('package hub', () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'pconair-pkg-'));
    writeFixturePackage(root);
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('seeds state from the schema and patches with notify', () => {
    const hub = createPackageHub(root);
    expect(hub.getState('hoops')).toMatchObject({ scoreA: 0, teamA: '', bonus: false });
    const seen: Array<Record<string, unknown>> = [];
    hub.subscribe('package:hoops', (s) => seen.push(s));
    hub.patchState('hoops', { scoreA: 12 });
    expect(seen.length).toBe(1);
    expect(seen[0].scoreA).toBe(12);
    expect(hub.getState('hoops')!.scoreA).toBe(12);
  });

  it('preserves state across rescans', () => {
    const hub = createPackageHub(root);
    hub.patchState('hoops', { scoreA: 7 });
    hub.rescan();
    expect(hub.getState('hoops')!.scoreA).toBe(7);
  });
});

describe('packages HTTP + WS', () => {
  let root: string;
  let server: ReturnType<typeof createFullServer>;
  let port: number;

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'pconair-pkg-'));
    writeFixturePackage(root);
    const store = createStateStore();
    server = createFullServer({ store, ...PINS, port: 0, packagesRoot: root });
    await server.listen();
    const addr = server.httpServer.address();
    port = typeof addr === 'object' && addr ? addr.port : 0;
  });

  afterEach(async () => {
    await server.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('lists packages with renders and control availability', async () => {
    const res = await request(server.app).get('/api/packages');
    expect(res.status).toBe(200);
    expect(res.body.packages[0]).toMatchObject({ id: 'hoops', name: 'COURTVISION Basketball', hasControl: true, live: false });
  });

  it('serves render, control, and asset files; blocks traversal', async () => {
    expect((await request(server.app).get('/packages/hoops/render/scorebug')).text).toContain('SCOREBUG');
    expect((await request(server.app).get('/packages/hoops/render')).text).toContain('SCOREBUG');
    expect((await request(server.app).get('/packages/hoops/control')).text).toContain('CONTROL');
    expect((await request(server.app).get('/packages/hoops/assets/logo.svg')).status).toBe(200);
    expect((await request(server.app).get('/packages/hoops/assets/..%2Fpackage.json')).status).toBeGreaterThanOrEqual(400);
    expect((await request(server.app).get('/packages/nope/render')).status).toBe(404);
  });

  it('gets and patches package state over HTTP', async () => {
    const get = await request(server.app).get('/api/packages/hoops/state');
    expect(get.body.state.scoreA).toBe(0);
    const post = await request(server.app).post('/api/packages/hoops/state').send({ scoreA: 21, teamA: 'Lions' });
    expect(post.status).toBe(200);
    expect(post.body.state.scoreA).toBe(21);
    expect((await request(server.app).post('/api/packages/nope/state').send({ a: 1 })).status).toBe(404);
  });

  it('WS subscribe delivers namespace state and live updates; rescan finds new packages', async () => {
    const ws = new WebSocket(`ws://localhost:${port}/ws?render=1`);
    const messages: Array<{ type: string; namespace?: string; state?: Record<string, unknown> }> = [];
    ws.on('message', (d) => messages.push(JSON.parse(d.toString())));
    await new Promise<void>((resolve) => ws.on('open', () => resolve()));
    ws.send(JSON.stringify({ type: 'subscribe', namespace: 'package:hoops' }));

    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('no namespace state received')), 3000);
      const iv = setInterval(() => {
        if (messages.some((m) => m.type === 'state' && m.namespace === 'package:hoops')) {
          clearTimeout(t);
          clearInterval(iv);
          resolve();
        }
      }, 20);
    });

    await request(server.app).post('/api/packages/hoops/state').send({ scoreB: 9 });
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('no live update received')), 3000);
      const iv = setInterval(() => {
        if (messages.some((m) => m.namespace === 'package:hoops' && m.state?.scoreB === 9)) {
          clearTimeout(t);
          clearInterval(iv);
          resolve();
        }
      }, 20);
    });
    ws.close();

    // Drop a new package in and rescan — it appears without a restart.
    const dir2 = path.join(root, 'news');
    fs.mkdirSync(dir2, { recursive: true });
    fs.writeFileSync(
      path.join(dir2, 'package.json'),
      JSON.stringify({ id: 'news', name: 'News', version: '1.0.0', renders: [{ id: 'main', label: 'Main', file: 'r.html' }] })
    );
    fs.writeFileSync(path.join(dir2, 'r.html'), '<html></html>');
    await request(server.app).post('/api/packages/rescan');
    const list = await request(server.app).get('/api/packages');
    expect(list.body.packages.map((p: { id: string }) => p.id).sort()).toEqual(['hoops', 'news']);
  });
});
