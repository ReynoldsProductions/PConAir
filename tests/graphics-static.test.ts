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
    expect(ids).toContain('lower-third-left');
    expect(ids).toContain('lower-third-right');
    expect(ids).toContain('lower-third-duo');
  });

  it('serves the ticker headline file the news template reads', async () => {
    const srv = makeServer(true);
    const res = await request(srv.app).get('/graphics/news/ticker.json');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.items)).toBe(true);
    expect(res.body.items.length).toBeGreaterThan(0);
  });

  it.each([
    ['lower-third-left', ['left']],
    ['lower-third-right', ['right']],
    ['lower-third-duo', ['left', 'right']],
  ] as const)('serves the %s template index.html', async (dir, sides) => {
    const srv = makeServer(true);
    const res = await request(srv.app).get(`/graphics/${dir}/index.html`);
    expect(res.status).toBe(200);
    // data-side must sit on the .l3 card, not body — that is what lets the duo
    // page hold a left and a right card in one document
    for (const side of sides) {
      expect(res.text).toContain(`data-side="${side}"`);
    }
    expect(res.text).not.toContain('<body data-side');
    expect(res.text).toContain('../_shared/lower-third.css');
    expect(res.text).toContain('../_shared/lower-third.js');
  });

  it('gives the duo cards L/R param suffixes so each is addressable', async () => {
    const srv = makeServer(true);
    const res = await request(srv.app).get('/graphics/lower-third-duo/index.html');
    expect(res.status).toBe(200);
    expect(res.text).toContain('data-params="L"');
    expect(res.text).toContain('data-params="R"');
  });

  it('collapses empty text rows rather than leaving a gap', async () => {
    const srv = makeServer(true);
    const res = await request(srv.app).get('/graphics/_shared/lower-third.css');
    expect(res.status).toBe(200);
    // `?title=` must remove the row; see the :empty rule
    expect(res.text).toContain('.l3 .title:empty');
    expect(res.text).toContain('.l3 .subtitle:empty');
  });

  it('does not force a reflow inside exit() — that cut the out animation', async () => {
    const srv = makeServer(true);
    const res = await request(srv.app).get('/graphics/_shared/lower-third.js');
    expect(res.status).toBe(200);
    const exitBody = /function exit\(\) \{([\s\S]*?)\n {4}\}/.exec(res.text)?.[1];
    expect(exitBody).toBeTruthy();
    expect(exitBody).toContain("classList.remove('in')");
    expect(exitBody).toContain("classList.add('out')");
    // A reflow between those two commits the base .l3 rule (already off-screen,
    // opacity 0, no transition declared), so .out has nothing left to animate
    // and the card cuts instead of sliding off.
    expect(exitBody).not.toContain('offsetWidth');
  });

  it('reads params with has() so an empty value clears instead of falling back', async () => {
    const srv = makeServer(true);
    const res = await request(srv.app).get('/graphics/_shared/lower-third.js');
    expect(res.status).toBe(200);
    expect(res.text).toContain('q.has(');
    // the old `q.get(x) || undefined` form silently restored the markup
    // placeholder when a param was present but empty
    expect(res.text).not.toMatch(/q\.get\('(name|title|subtitle)'\)\s*\|\|/);
  });

  // the L3 pages are thin shells — an unserved _shared/ would render nothing at all
  it.each(['lower-third.css', 'lower-third.js'])('serves _shared/%s', async (file) => {
    const srv = makeServer(true);
    const res = await request(srv.app).get(`/graphics/_shared/${file}`);
    expect(res.status).toBe(200);
    expect(res.text.length).toBeGreaterThan(0);
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
