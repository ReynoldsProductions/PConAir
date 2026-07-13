import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createStateStore } from '../src/main/state';
import { createFullServer } from './_test-server';

// Regression test for the `/vendor` Express static route added in
// `src/main/routes/index.ts::mountRoutes` (see .superpowers/sdd/task-2-report.md,
// "Webpack asset pipeline" section). This route serves the vendored React +
// Slate design-system bundle (public, no auth — same trust level as
// `/graphics`, see tests/graphics-static.test.ts for that precedent) so that
// `operator/index.html`'s relative `<script>`/`<link>` tags
// (`../vendor/react/react.development.js` etc.) resolve at runtime, whether
// the Operator window is loaded inside Electron or over the LAN/tunnel
// remote-access path.
function makeServer() {
  const store = createStateStore();
  return createFullServer({
    store,
    operatorPin: 'test1234',
    adminPin: 'adminpass8',
    port: 0,
  });
}

describe('GET /vendor (vendored React + Slate bundle)', () => {
  it('serves the vendored React UMD build', async () => {
    const srv = makeServer();
    const res = await request(srv.app).get('/vendor/react/react.development.js');
    expect(res.status).toBe(200);
    expect(res.text.length).toBeGreaterThan(0);
  });

  it('serves the vendored ReactDOM UMD build', async () => {
    const srv = makeServer();
    // Actual path referenced from operator/index.html — both React UMD
    // builds live under `vendor/react/`, not a separate `vendor/react-dom/`
    // directory (confirmed against `src/renderer/vendor/react/`).
    const res = await request(srv.app).get('/vendor/react/react-dom.development.js');
    expect(res.status).toBe(200);
    expect(res.text.length).toBeGreaterThan(0);
  });

  it('serves the Slate design-system bundle', async () => {
    const srv = makeServer();
    const res = await request(srv.app).get('/vendor/slate/_ds_bundle.js');
    expect(res.status).toBe(200);
    expect(res.text.length).toBeGreaterThan(0);
  });

  it('serves the Slate stylesheet', async () => {
    const srv = makeServer();
    const res = await request(srv.app).get('/vendor/slate/styles.css');
    expect(res.status).toBe(200);
    expect(res.text.length).toBeGreaterThan(0);
  });

  // `supertest`/`superagent` normalize a literal `../` (and a fully-encoded
  // `%2e%2e%2f`) client-side before the request ever reaches Express, so a
  // naive traversal payload never actually exercises `express.static`'s
  // traversal guard — it just 404s because no route matches the normalized
  // path. Encoding only the `/` separator (not the dots) survives client-side
  // normalization and reaches the server as a literal `..%2F`, which is the
  // pattern already proven to work in tests/packages.test.ts:216. The vendor
  // root is `<repo root>/src/renderer/vendor`, so three levels up reaches the
  // repo root — request its package.json (a real file with known content) to
  // prove escape is actually blocked, not just that some URL 404s.
  it('does not allow path traversal outside the vendor directory', async () => {
    const srv = makeServer();
    const res = await request(srv.app).get(
      '/vendor/..%2F..%2F..%2Fpackage.json'
    );
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.text).not.toContain('"name": "pc-on-air"');
  });

  it('does not allow a deeper traversal payload to escape the vendor directory', async () => {
    const srv = makeServer();
    const res = await request(srv.app).get(
      '/vendor/react/..%2F..%2F..%2F..%2Fpackage.json'
    );
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.text).not.toContain('"name": "pc-on-air"');
  });
});
