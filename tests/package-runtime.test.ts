import { describe, it, expect } from 'vitest';
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
