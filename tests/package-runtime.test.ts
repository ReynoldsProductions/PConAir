import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createStateStore } from '../src/main/state';
import { createFullServer } from './_test-server';

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
