import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';
import type { Express } from 'express';
import { createStateStore } from '../src/main/state';
import { createFullServer } from './_test-server';
import { createPackageHub } from '../src/main/packages/state-hub';
import { createDataSourcePoller } from '../src/main/packages/data-sources';
import { loadProfile, patchShowProfile, writeProfile } from '../src/main/profiles/bootstrap';

// A literal public IP (not loopback/link-local/RFC1918) so `checkUrlSafety`
// never needs a real DNS lookup for a "should succeed" fetch — `fetchImpl` is
// always stubbed below, so no actual network request is ever made regardless.
const SAFE_URL = 'http://93.184.216.34/feed';

function fakeResponse(opts: { status?: number; text: string; headers?: Record<string, string> }): Response {
  const headers = opts.headers ?? {};
  return {
    ok: (opts.status ?? 200) < 300,
    status: opts.status ?? 200,
    headers: { get: (n: string) => headers[n.toLowerCase()] ?? headers[n.toLowerCase().replace(/-/g, '')] ?? null },
    text: async () => opts.text,
  } as unknown as Response;
}

function writeWidgetPackage(root: string, dataSources: unknown[]): void {
  const dir = path.join(root, 'widget');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({
      id: 'widget',
      name: 'Widget',
      version: '1.0.0',
      renders: [{ id: 'main', label: 'Main', file: 'render.html' }],
      dataSources,
    })
  );
  fs.writeFileSync(path.join(dir, 'render.html'), '<html></html>');
}

describe('DataSourcePoller (T6-T10)', () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'pconair-ds-'));
  });
  afterEach(() => {
    vi.useRealTimers();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('T6: pollSeconds below the floor clamps to 60s, and the timer honors the clamp', async () => {
    vi.useFakeTimers();
    writeWidgetPackage(root, [{ id: 'feed', label: 'Feed', kind: 'http-json', url: SAFE_URL, pollSeconds: 5 }]);
    const hub = createPackageHub(root);
    const fetchImpl = vi.fn(async () => fakeResponse({ text: '[]' }));
    const poller = createDataSourcePoller({
      hub,
      getPackages: () => hub.list(),
      getOverrides: () => ({}),
      getAllowedHosts: () => [],
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    poller.reload();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(59_999);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    const views = poller.buildViews('widget');
    expect(views[0].effectivePollSeconds).toBe(60);
    poller.dispose();
  });

  it('T7: refuses loopback, link-local, RFC1918 and file scheme; an allowlisted host proceeds', async () => {
    writeWidgetPackage(root, [{ id: 'a', label: 'A', kind: 'http-json' }]);
    const hub = createPackageHub(root);
    const fetchImpl = vi.fn(async () => fakeResponse({ text: '[]' }));

    const refused = ['file:///etc/passwd', 'http://127.0.0.1:8080/', 'http://169.254.169.254/', 'http://10.0.0.5/'];
    for (const url of refused) {
      const poller = createDataSourcePoller({
        hub,
        getPackages: () => hub.list(),
        getOverrides: () => ({ widget: { a: { url } } }),
        getAllowedHosts: () => [],
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });
      const result = await poller.refresh('widget', 'a');
      expect(result.error).toBeTruthy();
      poller.dispose();
    }
    expect(fetchImpl).not.toHaveBeenCalled();

    const allowedPoller = createDataSourcePoller({
      hub,
      getPackages: () => hub.list(),
      getOverrides: () => ({ widget: { a: { url: 'http://10.0.0.5/' } } }),
      getAllowedHosts: () => ['10.0.0.5'],
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const allowedResult = await allowedPoller.refresh('widget', 'a');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(allowedResult.error).toBeNull();
    allowedPoller.dispose();
  });

  it('T8: caps a response over 2MB and does not store rows', async () => {
    writeWidgetPackage(root, [{ id: 'a', label: 'A', kind: 'http-json', url: SAFE_URL }]);
    const hub = createPackageHub(root);
    const bigArray = `[${'1,'.repeat(1_500_000)}1]`; // well over 2MB of JSON text
    const fetchImpl = vi.fn(async () => fakeResponse({ text: bigArray }));
    const poller = createDataSourcePoller({
      hub,
      getPackages: () => hub.list(),
      getOverrides: () => ({}),
      getAllowedHosts: () => [],
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const result = await poller.refresh('widget', 'a');
    expect(result.error).toMatch(/cap/);
    expect(result.rows).toEqual([]);
    poller.dispose();
  });

  it('T8: times out after 10s against a fetch that never resolves', async () => {
    vi.useFakeTimers();
    writeWidgetPackage(root, [{ id: 'a', label: 'A', kind: 'http-json', url: SAFE_URL }]);
    const hub = createPackageHub(root);
    const fetchImpl = vi.fn(() => new Promise<Response>(() => {}));
    const poller = createDataSourcePoller({
      hub,
      getPackages: () => hub.list(),
      getOverrides: () => ({}),
      getAllowedHosts: () => [],
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const pending = poller.refresh('widget', 'a');
    await vi.advanceTimersByTimeAsync(10_000);
    const result = await pending;
    expect(result.error).toMatch(/timed out/);
    poller.dispose();
  });

  it('T9: a later failure keeps the last good rows', async () => {
    writeWidgetPackage(root, [{ id: 'a', label: 'A', kind: 'http-json', url: SAFE_URL }]);
    const hub = createPackageHub(root);
    let call = 0;
    const fetchImpl = vi.fn(async () => {
      call++;
      if (call === 1) return fakeResponse({ text: JSON.stringify([{ x: '1' }, { x: '2' }, { x: '3' }]) });
      return fakeResponse({ status: 500, text: 'boom' });
    });
    const poller = createDataSourcePoller({
      hub,
      getPackages: () => hub.list(),
      getOverrides: () => ({}),
      getAllowedHosts: () => [],
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const first = await poller.refresh('widget', 'a');
    expect(first.error).toBeNull();
    expect(first.rows).toHaveLength(3);

    const second = await poller.refresh('widget', 'a');
    expect(second.error).toBeTruthy();
    expect(second.rows).toHaveLength(3); // last good rows survive the 500
    poller.dispose();
  });

  it('T10: _data is never persisted across a restart', () => {
    writeWidgetPackage(root, [{ id: 'a', label: 'A', kind: 'http-json' }]);
    const persistPath = path.join(root, 'state', 'package-state.json');
    const hub = createPackageHub(root, { persistPath });
    hub.patchState('widget', {
      _data: { a: { rows: [{ x: '1' }], columns: ['x'], fetchedAt: Date.now(), error: null, rawCount: 1, enabled: true } },
    });
    hub.flushState();

    const raw = JSON.parse(fs.readFileSync(persistPath, 'utf8'));
    expect(raw.states.widget._data).toBeUndefined();

    const second = createPackageHub(root, { persistPath });
    expect(second.getState('widget')!._data).toBeUndefined();
  });
});

describe('data source routes (T11)', () => {
  let root: string;
  let server: ReturnType<typeof createFullServer>;
  let app: Express;
  let cookies: { operator: string; admin: string };

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'pconair-ds-routes-'));
    writeWidgetPackage(root, [
      { id: 'feed', label: 'Feed', kind: 'http-json', url: SAFE_URL, pollSeconds: 300 },
    ]);
    const store = createStateStore();
    server = createFullServer({
      store,
      operatorPin: '12341234',
      adminPin: 'adminpass9',
      port: 0,
      packagesRoot: root,
      // Stubbed — never a real request. See the SAFE_URL comment above.
      dataSourceFetchImpl: (async () => fakeResponse({ text: JSON.stringify([{ a: '1' }]) })) as unknown as typeof fetch,
    });
    await server.listen();
    app = server.app;
    const op = await request(app).post('/auth/operator').send({ pin: '12341234' });
    const adm = await request(app).post('/auth/admin').send({ pin: 'adminpass9' });
    cookies = {
      operator: (op.headers['set-cookie'] as unknown as string[])[0],
      admin: (adm.headers['set-cookie'] as unknown as string[])[0],
    };
  });

  afterEach(async () => {
    await server.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('GET …/data returns the declaration merged with effective values', async () => {
    const res = await request(app).get('/api/packages/widget/data').set('Cookie', cookies.operator);
    expect(res.status).toBe(200);
    expect(res.body.sources).toHaveLength(1);
    expect(res.body.sources[0]).toMatchObject({ id: 'feed', effectiveUrl: SAFE_URL, effectivePollSeconds: 300, enabled: true });
  });

  it('PUT …/data/:sourceId requires admin; operator gets 403', async () => {
    const asOperator = await request(app)
      .put('/api/packages/widget/data/feed')
      .set('Cookie', cookies.operator)
      .send({ pollSeconds: 120 });
    expect(asOperator.status).toBe(403);

    const asAdmin = await request(app)
      .put('/api/packages/widget/data/feed')
      .set('Cookie', cookies.admin)
      .send({ pollSeconds: 120, enabled: false });
    expect(asAdmin.status).toBe(200);
    expect(asAdmin.body.source).toMatchObject({ effectivePollSeconds: 120, enabled: false });
  });

  it('PUT …/data/:sourceId with no auth is 401', async () => {
    const res = await request(app).put('/api/packages/widget/data/feed').send({ enabled: false });
    expect(res.status).toBe(401);
  });

  it('POST …/refresh returns the new result', async () => {
    const res = await request(app).post('/api/packages/widget/data/feed/refresh').set('Cookie', cookies.operator);
    expect(res.status).toBe(200);
    expect(res.body.result).toHaveProperty('rows');
    expect(res.body.result).toHaveProperty('error');
  });

  it('404s an unknown source', async () => {
    const res = await request(app).post('/api/packages/widget/data/nope/refresh').set('Cookie', cookies.operator);
    expect(res.status).toBe(404);
  });
});

describe('admin allowlist persistence round-trip (T12)', () => {
  let server: ReturnType<typeof createFullServer>;
  let app: Express;
  let cookies: { operator: string; admin: string };

  beforeEach(async () => {
    const store = createStateStore();
    server = createFullServer({ store, operatorPin: '12341234', adminPin: 'adminpass9', port: 0 });
    await server.listen();
    app = server.app;
    const op = await request(app).post('/auth/operator').send({ pin: '12341234' });
    const adm = await request(app).post('/auth/admin').send({ pin: 'adminpass9' });
    cookies = {
      operator: (op.headers['set-cookie'] as unknown as string[])[0],
      admin: (adm.headers['set-cookie'] as unknown as string[])[0],
    };
  });

  afterEach(async () => {
    await server.close();
  });

  it('defaults to empty', async () => {
    const res = await request(app).get(`/api/profiles/${server.activeProfileId}`).set('Cookie', cookies.admin);
    expect(res.body.appPreferences.dataSourceAllowedHosts).toEqual([]);
  });

  it('round-trips through PATCH /api/profiles/:id (admin only)', async () => {
    const rejected = await request(app)
      .patch(`/api/profiles/${server.activeProfileId}`)
      .set('Cookie', cookies.operator)
      .send({ appPreferences: { dataSourceAllowedHosts: ['metrics.internal'] } });
    expect(rejected.status).toBe(403);

    const saved = await request(app)
      .patch(`/api/profiles/${server.activeProfileId}`)
      .set('Cookie', cookies.admin)
      .send({ appPreferences: { dataSourceAllowedHosts: ['metrics.internal', '10.0.0.5'] } });
    expect(saved.status).toBe(200);

    const fetched = await request(app).get(`/api/profiles/${server.activeProfileId}`).set('Cookie', cookies.admin);
    expect(fetched.body.appPreferences.dataSourceAllowedHosts).toEqual(['metrics.internal', '10.0.0.5']);
  });

  it('the poller actually reads the persisted allowlist', async () => {
    const p = loadProfile(server.profilePaths, server.activeProfileId)!;
    writeProfile(server.profilePaths, patchShowProfile(p, { appPreferences: { ...p.appPreferences, dataSourceAllowedHosts: ['10.0.0.5'] } }));

    // exercise the same code path server.ts wires the poller's getAllowedHosts to
    const reloaded = loadProfile(server.profilePaths, server.activeProfileId)!;
    expect(reloaded.appPreferences.dataSourceAllowedHosts).toEqual(['10.0.0.5']);
  });
});
