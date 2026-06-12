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

  it('scans multiple roots in order; duplicate ids are skipped with an error', () => {
    const root2 = fs.mkdtempSync(path.join(os.tmpdir(), 'pconair-pkg2-'));
    try {
      writeFixturePackage(root2); // same 'hoops' id as root
      const dir = path.join(root2, 'extra');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, 'package.json'),
        JSON.stringify({ id: 'extra', name: 'Extra', version: '1.0.0', renders: [{ id: 'main', label: 'Main', file: 'r.html' }] })
      );
      fs.writeFileSync(path.join(dir, 'r.html'), '<html></html>');

      const hub = createPackageHub([root, root2]);
      expect(hub.list().map((p) => p.manifest.id).sort()).toEqual(['extra', 'hoops']);
      // hoops loaded from the first root, not shadowed by the second
      expect(hub.find('hoops')!.dir.startsWith(root)).toBe(true);
      expect(hub.errors().some((e) => e.error.includes('duplicate package id'))).toBe(true);
    } finally {
      fs.rmSync(root2, { recursive: true, force: true });
    }
  });
});

describe('bundled packages (phase 8)', () => {
  const bundledRoot = path.join(__dirname, '..', 'bundled-packages');

  it('all three bundled packages load without errors', () => {
    const result = scanPackagesDir(bundledRoot);
    expect(result.errors).toEqual([]);
    expect(result.packages.map((p) => p.manifest.id).sort()).toEqual(['ffg', 'hoops', 'news']);
    for (const p of result.packages) expect(p.controlFile).toBe('control.html');
  });

  it('ffg declares the five plan renders; hoops and news declare one each', () => {
    const hub = createPackageHub(bundledRoot);
    expect(hub.find('ffg')!.manifest.renders.map((r) => r.id)).toEqual([
      'single-pip',
      'four-portrait',
      'four-up',
      'head-to-head',
      'champion',
    ]);
    expect(hub.find('hoops')!.manifest.renders.map((r) => r.id)).toEqual(['scorebug']);
    expect(hub.find('news')!.manifest.renders.map((r) => r.id)).toEqual(['overlay']);
  });

  it('seeds initial state from the manifests', () => {
    const hub = createPackageHub(bundledRoot);
    expect(hub.getState('ffg')).toMatchObject({
      scores: [0, 0, 0, 0],
      maxScore: 10,
      winner: null,
      h2h: { slotA: [0, 1], slotB: [2, 3] },
    });
    expect((hub.getState('ffg')!.teams as Array<{ handle: string }>).length).toBe(4);
    expect(hub.getState('hoops')).toMatchObject({ teamA: 'BOS', clockEndsAt: 0, quarter: 3 });
    expect(hub.getState('news')).toMatchObject({ bugVisible: true, l3: { visible: false } });
  });

  it('serves bundled render, control, and asset files over HTTP', async () => {
    const store = createStateStore();
    const server = createFullServer({ store, ...PINS, port: 0, packagesRoot: bundledRoot });
    await server.listen();
    try {
      const list = await request(server.app).get('/api/packages');
      expect(list.body.packages.map((p: { id: string }) => p.id).sort()).toEqual(['ffg', 'hoops', 'news']);

      expect((await request(server.app).get('/packages/hoops/render/scorebug')).text).toContain('COURTVISION');
      expect((await request(server.app).get('/packages/news/render/overlay')).text).toContain('Nightly News');
      for (const r of ['single-pip', 'four-portrait', 'four-up', 'head-to-head', 'champion']) {
        const res = await request(server.app).get(`/packages/ffg/render/${r}`);
        expect(res.status).toBe(200);
        // every FFG render hydrates from package state, never query-param state
        expect(res.text).toContain('ffg-common.js');
      }
      expect((await request(server.app).get('/packages/ffg/control')).text).toContain('SET WINNER');
      expect((await request(server.app).get('/packages/ffg/assets/cardboard.css')).status).toBe(200);
      expect((await request(server.app).get('/packages/ffg/assets/icons/one-faire.gif')).status).toBe(200);
      expect((await request(server.app).get('/packages/hoops/assets/state.js')).text).toContain('PConAirPackage');
    } finally {
      await server.close();
    }
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
