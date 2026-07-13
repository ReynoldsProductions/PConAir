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

  it('does not allow path traversal outside the vendor directory', async () => {
    const srv = makeServer();
    const res = await request(srv.app).get(
      '/vendor/%2e%2e/%2e%2e/%2e%2e/%2e%2e/etc/passwd'
    );
    // express.static rejects encoded traversal segments outright (403) or,
    // failing that, must not resolve to anything outside the vendor root
    // (404) — either way it must never leak host filesystem content.
    expect([403, 404]).toContain(res.status);
    expect(res.text).not.toContain('root:');
  });

  it('does not allow literal ../ path traversal outside the vendor directory', async () => {
    const srv = makeServer();
    const res = await request(srv.app).get('/vendor/../../../../../etc/passwd');
    // Most HTTP clients/servers normalize `..` in the URL path before this
    // ever reaches Express, but assert the observable contract either way:
    // no 200 with filesystem content leaking through this route.
    expect(res.status).not.toBe(200);
  });
});
