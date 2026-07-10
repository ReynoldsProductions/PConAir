import { describe, it, expect } from 'vitest';
import request from 'supertest';
import path from 'path';
import { createStateStore } from '../src/main/state';
import { createFullServer } from './_test-server';

const GRAPHICS_ROOT = path.join(process.cwd(), 'graphics');

function makeServer(withGraphics: boolean) {
  const store = createStateStore();
  return createFullServer({
    store,
    operatorPin: 'test1234',
    adminPin: 'adminpass8',
    port: 0,
    graphicsRoot: withGraphics ? GRAPHICS_ROOT : undefined,
  });
}

describe('GET /graphics (built-in templates)', () => {
  it('serves the template manifest', async () => {
    const srv = makeServer(true);
    const res = await request(srv.app).get('/graphics/manifest.json');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.templates)).toBe(true);
    const ids = res.body.templates.map((t: { id: string }) => t.id);
    expect(ids).toContain('scoreboard-basketball');
    expect(ids).toContain('news');
    expect(ids).toContain('lower-third-live');
  });

  it('serves a template index.html', async () => {
    const srv = makeServer(true);
    const res = await request(srv.app).get('/graphics/scoreboard-basketball/index.html');
    expect(res.status).toBe(200);
    expect(res.text).toContain('COURTVISION');
  });

  it('serves the lower-third-live template index.html', async () => {
    const srv = makeServer(true);
    const res = await request(srv.app).get('/graphics/lower-third-live/index.html');
    expect(res.status).toBe(200);
    expect(res.text).toContain('lower_third_apply');
    expect(res.text).toContain('data-theme');
  });

  it('does not expose /graphics when graphicsRoot is unset', async () => {
    const srv = makeServer(false);
    const res = await request(srv.app).get('/graphics/manifest.json');
    expect(res.status).toBe(404);
  });
});
