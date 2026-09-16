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
