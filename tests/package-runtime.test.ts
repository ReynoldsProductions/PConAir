import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import request from 'supertest';
import { WebSocket } from 'ws';
import { createStateStore } from '../src/main/state';
import { validateManifest } from '../src/main/packages/loader';
import { createFullServer } from './_test-server';

async function listen() {
  const store = createStateStore();
  const srv = createFullServer({
    store,
    operatorPin: 'test1234',
    adminPin: 'adminpass8',
    operatorSessionMs: 60000,
    adminSessionMs: 60000,
    port: 0,
  });
  await new Promise<void>((resolve) => srv.httpServer.listen(0, resolve));
  const port = (srv.httpServer.address() as { port: number }).port;
  return { srv, port, close: () => new Promise<void>((r) => srv.httpServer.close(() => r())) };
}

/** Resolves true if the socket opens, false if the upgrade is refused. */
function tryConnect(url: string, headers?: Record<string, string>): Promise<boolean> {
  return new Promise((resolve) => {
    const ws = new WebSocket(url, { headers });
    ws.on('open', () => { ws.close(); resolve(true); });
    ws.on('error', () => resolve(false));
  });
}

function makeServer() {
  const store = createStateStore();
  return createFullServer({
    store,
    operatorPin: 'test1234',
    adminPin: 'adminpass8',
    port: 0,
  });
}

describe('GET /packages/_runtime (shared package runtime)', () => {
  it('serves pconair.js as JavaScript', async () => {
    const srv = makeServer();
    const res = await request(srv.app).get('/packages/_runtime/pconair.js');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/javascript/);
    expect(res.text).toContain('window.PConAir');
  });

  it('serves pconair.css with the tokens specs 16-23 style against', async () => {
    const srv = makeServer();
    const res = await request(srv.app).get('/packages/_runtime/pconair.css');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/css/);
    for (const token of ['--pc-bg', '--pc-fg', '--pc-accent', '--pc-danger', '--pc-ok', '--pc-gap']) {
      expect(res.text).toContain(token);
    }
  });

  it('404s an unknown file under the mount instead of falling through', async () => {
    const srv = makeServer();
    const res = await request(srv.app).get('/packages/_runtime/nope.js');
    expect(res.status).toBe(404);
  });

  it('does not escape the mount via an encoded traversal', async () => {
    const srv = makeServer();
    const res = await request(srv.app).get('/packages/_runtime/%2e%2e%2f%2e%2e%2fpackage.json');
    expect(res.status).not.toBe(200);
    expect(res.text ?? '').not.toContain('"pc-on-air"');
  });
});

describe('reserved package ids', () => {
  const base = { name: 'X', version: '1.0.0', renders: [{ id: 'main', label: 'Main', file: 'r.html' }] };

  it('rejects _runtime so it can never shadow the runtime mount', () => {
    const r = validateManifest({ ...base, id: '_runtime' });
    expect(r.ok).toBe(false);
  });

  it('rejects any leading-underscore id', () => {
    expect(validateManifest({ ...base, id: '_data' }).ok).toBe(false);
  });

  it('still accepts an ordinary id', () => {
    expect(validateManifest({ ...base, id: 'hoops' }).ok).toBe(true);
  });
});

describe('WebSocket ?control=1 role', () => {
  it('accepts a cookie-less control page from an allowlisted IP', async () => {
    const { port, close } = await listen();
    expect(await tryConnect(`ws://localhost:${port}/ws?control=1`)).toBe(true);
    await close();
  });

  it('refuses a control page arriving through the Cloudflare tunnel', async () => {
    const { port, close } = await listen();
    expect(
      await tryConnect(`ws://localhost:${port}/ws?control=1`, { 'cf-ray': 'abc123-SJC' })
    ).toBe(false);
    await close();
  });

  it('still refuses an unflagged cookie-less connection', async () => {
    const { port, close } = await listen();
    expect(await tryConnect(`ws://localhost:${port}/ws`)).toBe(false);
    await close();
  });
});

describe('package migration to the shared runtime', () => {
  const ROOTS = ['bundled-packages', 'demo-packages'];

  function walk(dir: string, out: string[] = []): string[] {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const f = path.join(dir, e.name);
      if (e.isDirectory()) walk(f, out);
      else out.push(f);
    }
    return out;
  }

  const files = ROOTS.flatMap((r) => walk(path.join(process.cwd(), r)));

  it('has packages to check', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it('no package references the retired per-package state.js path', () => {
    const offenders = files.filter(
      (f) => /\.(html|js)$/.test(f) && fs.readFileSync(f, 'utf8').includes('assets/state.js')
    );
    expect(offenders).toEqual([]);
  });

  it('no package calls the legacy PConAirPackage.connect API', () => {
    const offenders = files.filter(
      (f) => /\.(html|js)$/.test(f) && fs.readFileSync(f, 'utf8').includes('PConAirPackage.connect')
    );
    expect(offenders).toEqual([]);
  });

  it('no duplicate state.js survives anywhere under the package trees', () => {
    expect(files.filter((f) => path.basename(f) === 'state.js')).toEqual([]);
  });

  it('every page that connects loads the shared runtime', () => {
    const connecting = files.filter(
      (f) => f.endsWith('.html') && fs.readFileSync(f, 'utf8').includes('PConAir.connect')
    );
    expect(connecting.length).toBeGreaterThan(0);
    for (const f of connecting) {
      const src = fs.readFileSync(f, 'utf8');
      // either the page loads the runtime itself, or a helper it loads does
      const loadsRuntime =
        src.includes('/packages/_runtime/pconair.js') ||
        src.includes('ffg-common.js') ||
        src.includes('pconair-kit.js');
      expect(loadsRuntime, `${f} connects without loading the runtime`).toBe(true);
    }
  });

  it('every render page declares its manifest render id', () => {
    for (const root of ROOTS) {
      for (const dir of fs.readdirSync(path.join(process.cwd(), root))) {
        const manifestPath = path.join(process.cwd(), root, dir, 'package.json');
        if (!fs.existsSync(manifestPath)) continue;
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as {
          renders: Array<{ id: string; file: string }>;
        };
        for (const r of manifest.renders) {
          const file = path.join(process.cwd(), root, dir, r.file);
          if (!fs.existsSync(file)) continue;
          const src = fs.readFileSync(file, 'utf8');
          // render-all.html frames sibling renders and holds no state client
          if (!src.includes('PConAir.connect') && !src.includes('Kit.init') && !src.includes('FFG.start')) continue;
          expect(src, `${r.file} is missing data-render-id="${r.id}"`).toContain(
            `data-render-id="${r.id}"`
          );
        }
      }
    }
  });
});

/**
 * Acceptance A4: a control page still drives its render. Proven end to end over
 * the real socket against the real bundled packages, rather than by reading the
 * HTML — the migration changed both the transport role and the callback shape,
 * and only a round trip shows the pipeline still closes.
 */
describe('control -> server -> render round trip (spec 14 A4)', () => {
  const BUNDLED = path.join(process.cwd(), 'bundled-packages');

  async function bundledServer() {
    const store = createStateStore();
    const srv = createFullServer({
      store,
      operatorPin: 'test1234',
      adminPin: 'adminpass8',
      operatorSessionMs: 60000,
      adminSessionMs: 60000,
      port: 0,
      packagesRoot: BUNDLED,
    });
    await new Promise<void>((resolve) => srv.httpServer.listen(0, resolve));
    const port = (srv.httpServer.address() as { port: number }).port;
    return { srv, port, close: () => new Promise<void>((r) => srv.httpServer.close(() => r())) };
  }

  it.each([
    ['hoops', 'scorebug', 'render.html'],
    ['news', 'ticker', 'render-ticker.html'],
    ['ffg', 'champion', 'render-champion.html'],
  ])('%s: a patch reaches a subscribed render socket', async (pkg, renderId) => {
    const { port, srv, close } = await bundledServer();
    try {
      const ws = new WebSocket(`ws://localhost:${port}/ws?render=1&renderId=${renderId}`);
      const frames: Array<Record<string, unknown>> = [];
      await new Promise<void>((resolve, reject) => {
        ws.on('open', () => {
          ws.send(JSON.stringify({ type: 'subscribe', namespace: `package:${pkg}` }));
          resolve();
        });
        ws.on('error', reject);
      });
      ws.on('message', (d) => frames.push(JSON.parse(d.toString())));

      // first frame is the subscribe snapshot
      await new Promise((r) => setTimeout(r, 120));
      expect(frames.length, 'no snapshot on subscribe').toBeGreaterThan(0);

      const before = frames.length;
      const cookie = (
        await request(srv.app).post('/auth/operator').send({ pin: 'test1234' })
      ).headers['set-cookie'] as unknown as string[];
      const key = Object.keys((await request(srv.app).get(`/api/packages/${pkg}/state`).set('Cookie', cookie[0])).body.state)[0];
      const res = await request(srv.app)
        .post(`/api/packages/${pkg}/state`)
        .set('Cookie', cookie[0])
        .send({ [key]: 'spec14-probe' });
      expect(res.status).toBe(200);

      await new Promise((r) => setTimeout(r, 150));
      expect(frames.length, 'render socket never saw the patch').toBeGreaterThan(before);
      const latest = frames[frames.length - 1] as { namespace: string; state: Record<string, unknown> };
      expect(latest.namespace).toBe(`package:${pkg}`);
      expect(latest.state[key]).toBe('spec14-probe');

      ws.close();
    } finally {
      await close();
    }
  });

  it.each(['hoops', 'news', 'ffg'])('%s control page loads the runtime and connects as a control', async (pkg) => {
    const { srv, close } = await bundledServer();
    try {
      const res = await request(srv.app).get(`/packages/${pkg}/control`);
      expect(res.status).toBe(200);
      expect(res.text).toContain('/packages/_runtime/pconair.js');
      expect(res.text).toContain("role: 'control'");
      expect(res.text).not.toContain('PConAirPackage.connect');
    } finally {
      await close();
    }
  });
});
