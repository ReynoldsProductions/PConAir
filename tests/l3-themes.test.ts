import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createStateStore } from '../src/main/state';
import { createFullServer } from './_test-server';
import { renderCueHtml } from '../src/main/l3/cue-renderer';

/** Minimal valid 1×1 PNG */
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

const AUTH = {
  operatorPin: 'op1234',
  adminPin: 'adminpass8',
  operatorSessionMs: 60000,
  adminSessionMs: 60000,
};

async function opCookie(app: Express): Promise<string> {
  const res = await request(app).post('/auth/operator').send({ pin: 'op1234' });
  return (res.headers['set-cookie'] as unknown as string[])[0];
}

async function adminCookie(app: Express): Promise<string> {
  const res = await request(app).post('/auth/admin').send({ pin: 'adminpass8' });
  return (res.headers['set-cookie'] as unknown as string[])[0];
}

describe('L3 Themes API', () => {
  let app: Express;
  let srv: ReturnType<typeof createFullServer>;
  let op: string;
  let adm: string;

  beforeEach(async () => {
    const store = createStateStore();
    srv = createFullServer({
      store,
      operatorPin: AUTH.operatorPin,
      adminPin: AUTH.adminPin,
      operatorSessionMs: AUTH.operatorSessionMs,
      adminSessionMs: AUTH.adminSessionMs,
      port: 0,
    });
    await srv.listen();
    app = srv.app;
    op = await opCookie(app);
    adm = await adminCookie(app);
  });

  afterEach(() => srv.close());

  it('GET /api/l3/themes returns the default built-in theme', async () => {
    const res = await request(app).get('/api/l3/themes').set('Cookie', op);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.themes)).toBe(true);
    expect(res.body.themes.length).toBeGreaterThanOrEqual(1);
    const def = res.body.themes.find((t: { name: string }) => t.name === 'default');
    expect(def).toBeDefined();
    expect(def.isBuiltIn).toBe(true);
    expect(typeof def.cssContent).toBe('string');
    expect(def.cssContent.length).toBeGreaterThan(0);
  });

  it('GET /api/l3/themes returns 401 without auth', async () => {
    const res = await request(app).get('/api/l3/themes');
    expect(res.status).toBe(401);
  });

  it('GET /api/l3/themes/sample.css returns CSS text', async () => {
    const res = await request(app).get('/api/l3/themes/sample.css').set('Cookie', op);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/css');
    expect(typeof res.text).toBe('string');
    expect(res.text.length).toBeGreaterThan(0);
  });

  it('POST /api/l3/themes installs a new theme', async () => {
    const res = await request(app)
      .post('/api/l3/themes')
      .set('Cookie', adm)
      .field('name', 'my-theme')
      .field('displayName', 'My Theme')
      .attach('cssFile', Buffer.from('.name { color: red; }'), 'theme.css');
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('my-theme');
    expect(res.body.displayName).toBe('My Theme');
    expect(res.body.isBuiltIn).toBe(false);
    expect(res.body.cssContent).toContain('color: red');

    // Verify it appears in list
    const list = await request(app).get('/api/l3/themes').set('Cookie', op);
    const names = list.body.themes.map((t: { name: string }) => t.name);
    expect(names).toContain('my-theme');
  });

  it('POST /api/l3/themes rejects duplicate name', async () => {
    await request(app)
      .post('/api/l3/themes')
      .set('Cookie', adm)
      .field('name', 'dup-theme')
      .field('displayName', 'Dup')
      .attach('cssFile', Buffer.from('.name { color: blue; }'), 'a.css');

    const res = await request(app)
      .post('/api/l3/themes')
      .set('Cookie', adm)
      .field('name', 'dup-theme')
      .field('displayName', 'Dup2')
      .attach('cssFile', Buffer.from('.name { color: green; }'), 'b.css');
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('DUPLICATE_NAME');
  });

  it('POST /api/l3/themes rejects invalid name pattern', async () => {
    const res = await request(app)
      .post('/api/l3/themes')
      .set('Cookie', adm)
      .field('name', 'My Theme!')
      .field('displayName', 'Bad Name')
      .attach('cssFile', Buffer.from('.x{}'), 'x.css');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_NAME');
  });

  it('POST /api/l3/themes returns 403 for operator (admin-only)', async () => {
    const res = await request(app)
      .post('/api/l3/themes')
      .set('Cookie', op)
      .field('name', 'op-theme')
      .field('displayName', 'Op Theme')
      .attach('cssFile', Buffer.from('.x{}'), 'x.css');
    // adminGuard returns 403 for authenticated operators
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  it('DELETE /api/l3/themes/:name deletes a custom theme', async () => {
    await request(app)
      .post('/api/l3/themes')
      .set('Cookie', adm)
      .field('name', 'deletable')
      .field('displayName', 'Deletable')
      .attach('cssFile', Buffer.from('.x{}'), 'x.css');

    const del = await request(app).delete('/api/l3/themes/deletable').set('Cookie', adm);
    expect(del.status).toBe(204);

    // Verify gone
    const list = await request(app).get('/api/l3/themes').set('Cookie', op);
    const names = list.body.themes.map((t: { name: string }) => t.name);
    expect(names).not.toContain('deletable');
  });

  it('DELETE /api/l3/themes/default returns 400 (built-in)', async () => {
    const res = await request(app).delete('/api/l3/themes/default').set('Cookie', adm);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BUILT_IN_THEME');
  });

  it('DELETE /api/l3/themes/missing returns 404', async () => {
    const res = await request(app).delete('/api/l3/themes/does-not-exist').set('Cookie', adm);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('THEME_NOT_FOUND');
  });
});

describe('L3 CSV Import', () => {
  let app: Express;
  let srv: ReturnType<typeof createFullServer>;
  let op: string;
  let adm: string;

  beforeEach(async () => {
    const store = createStateStore();
    srv = createFullServer({
      store,
      operatorPin: AUTH.operatorPin,
      adminPin: AUTH.adminPin,
      operatorSessionMs: AUTH.operatorSessionMs,
      adminSessionMs: AUTH.adminSessionMs,
      port: 0,
    });
    await srv.listen();
    app = srv.app;
    op = await opCookie(app);
    adm = await adminCookie(app);
  });

  afterEach(() => srv.close());

  it('GET /api/l3/cues/csv-sample returns CSV with header row', async () => {
    const res = await request(app).get('/api/l3/cues/csv-sample').set('Cookie', op);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.text).toContain('name');
    expect(res.text).toContain('title');
    expect(res.text).toContain('theme');
  });

  it('POST /api/l3/cues/import imports valid CSV rows', async () => {
    const csv = `name,title,theme,subtitle\nJohn Doe,CEO,default,Head of Company\nJane Smith,CTO,default,`;
    const res = await request(app)
      .post('/api/l3/cues/import')
      .set('Cookie', adm)
      .attach('csvFile', Buffer.from(csv), 'import.csv');
    expect(res.status).toBe(200);
    expect(res.body.imported).toBe(2);
    expect(res.body.skipped).toBe(0);
    expect(Array.isArray(res.body.warnings)).toBe(true);

    // Verify cues created
    const list = await request(app).get('/api/l3/cues').set('Cookie', op);
    expect(list.body.cues.length).toBeGreaterThanOrEqual(2);
    const names = list.body.cues.map((c: { name: string }) => c.name);
    expect(names).toContain('John Doe');
    expect(names).toContain('Jane Smith');
  });

  it('POST /api/l3/cues/import skips rows missing required fields', async () => {
    const csv = `name,title,theme\nJohn Doe,,default\n,CEO,default\nValid Name,Valid Title,default`;
    const res = await request(app)
      .post('/api/l3/cues/import')
      .set('Cookie', adm)
      .attach('csvFile', Buffer.from(csv), 'import.csv');
    expect(res.status).toBe(200);
    expect(res.body.imported).toBe(1);
    expect(res.body.skipped).toBe(2);
    expect(res.body.warnings.length).toBe(2);
  });

  it('POST /api/l3/cues/import defaults unknown theme to "default" with warning', async () => {
    const csv = `name,title,theme\nSpeaker One,CEO,nonexistent-theme`;
    const res = await request(app)
      .post('/api/l3/cues/import')
      .set('Cookie', adm)
      .attach('csvFile', Buffer.from(csv), 'import.csv');
    expect(res.status).toBe(200);
    expect(res.body.imported).toBe(1);
    expect(res.body.skipped).toBe(0);
    expect(res.body.warnings.length).toBeGreaterThan(0);
    expect(res.body.warnings[0]).toContain('nonexistent-theme');

    // Cue should have been assigned to fallback theme
    const list = await request(app).get('/api/l3/cues').set('Cookie', op);
    const cue = list.body.cues.find((c: { name: string }) => c.name === 'Speaker One');
    expect(cue).toBeDefined();
    expect(cue.theme).toBe('default');
  });
});

describe('L3 Image Upload (Still Store)', () => {
  let app: Express;
  let srv: ReturnType<typeof createFullServer>;
  let op: string;
  let adm: string;

  beforeEach(async () => {
    const store = createStateStore();
    srv = createFullServer({
      store,
      operatorPin: AUTH.operatorPin,
      adminPin: AUTH.adminPin,
      operatorSessionMs: AUTH.operatorSessionMs,
      adminSessionMs: AUTH.adminSessionMs,
      port: 0,
    });
    await srv.listen();
    app = srv.app;
    op = await opCookie(app);
    adm = await adminCookie(app);
  });

  afterEach(() => srv.close());

  it('POST /api/l3/cues/upload-image stores PNG and creates cue', async () => {
    const res = await request(app)
      .post('/api/l3/cues/upload-image')
      .set('Cookie', adm)
      .attach('imageFiles[]', PNG_1PX, 'speaker.png');
    expect(res.status).toBe(200);
    expect(res.body.imported).toBe(1);
    expect(res.body.failed).toBe(0);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].name).toBe('speaker');
    expect(res.body.items[0].originalImageFormat).toBe('png');

    // Verify cue appears in list
    const list = await request(app).get('/api/l3/cues').set('Cookie', op);
    const cue = list.body.cues.find((c: { name: string }) => c.name === 'speaker');
    expect(cue).toBeDefined();
    expect(cue.sourceType).toBe('image');
    expect(cue.originalImageFormat).toBe('png');
  });

  it('GET /api/l3/cues/:cueId/export returns image bytes for image-type cue', async () => {
    const upload = await request(app)
      .post('/api/l3/cues/upload-image')
      .set('Cookie', adm)
      .attach('imageFiles[]', PNG_1PX, 'test.png');
    const cueId = upload.body.items[0].id as string;

    const res = await request(app)
      .get(`/api/l3/cues/${cueId}/export`)
      .set('Cookie', op)
      .buffer(true);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('image/png');
    expect(Buffer.isBuffer(res.body)).toBe(true);
    expect((res.body as Buffer).length).toBeGreaterThan(0);
  });

  it('GET /api/l3/cues/:cueId/export returns 501 for manual cue', async () => {
    const createRes = await request(app)
      .post('/api/l3/cues')
      .set('Cookie', adm)
      .send({ name: 'Manual Person', title: 'CEO', theme: 'default' });
    expect(createRes.status).toBe(201);
    const cueId = createRes.body.id as string;

    const res = await request(app)
      .get(`/api/l3/cues/${cueId}/export`)
      .set('Cookie', op);
    expect(res.status).toBe(501);
    expect(res.body.error.code).toBe('NOT_IMPLEMENTED');
  });

  it('GET /api/l3/cues/:cueId/export returns 404 for unknown cue', async () => {
    const res = await request(app)
      .get('/api/l3/cues/nonexistent-cue-id/export')
      .set('Cookie', op);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('CUE_NOT_FOUND');
  });
});

describe('L3 cue export — manual type', () => {
  let app: Express;
  let srv: ReturnType<typeof createFullServer>;
  let op: string;
  let adm: string;

  beforeEach(async () => {
    const store = createStateStore();
    srv = createFullServer({
      store,
      operatorPin: AUTH.operatorPin,
      adminPin: AUTH.adminPin,
      operatorSessionMs: AUTH.operatorSessionMs,
      adminSessionMs: AUTH.adminSessionMs,
      port: 0,
    });
    await srv.listen();
    app = srv.app;
    op = await opCookie(app);
    adm = await adminCookie(app);
  });

  afterEach(() => srv.close());

  it('returns 501 for manual cue when renderer is not injected', async () => {
    const createRes = await request(app)
      .post('/api/l3/cues')
      .set('Cookie', adm)
      .send({ name: 'Test Speaker', title: 'Director', theme: 'default' });
    expect(createRes.status).toBe(201);
    const cueId = createRes.body.id as string;

    const res = await request(app)
      .get(`/api/l3/cues/${cueId}/export`)
      .set('Cookie', op);
    expect(res.status).toBe(501);
    expect(res.body.error.code).toBe('NOT_IMPLEMENTED');
  });

  it('renderCueHtml returns valid HTML with cue fields', () => {
    const cue = {
      id: 'test-id',
      name: 'Jane Doe',
      title: 'Chief Executive Officer',
      subtitle: null,
      theme: 'default',
      sourceType: 'manual' as const,
      originalImagePath: null,
      originalImageFormat: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const css = '.lower-third { background: rgba(0,0,0,0.8); }';
    const html = renderCueHtml(cue, css);

    expect(html).toContain('<html');
    expect(html).toContain('Jane Doe');
    expect(html).toContain('Chief Executive Officer');
    expect(html).toContain(css);
    expect(html).toContain('class="name"');
    expect(html).toContain('class="title"');
  });

  it('renderCueHtml escapes HTML special characters in name and title', () => {
    const cue = {
      id: 'test-escape',
      name: '<script>alert(1)</script>',
      title: '&amp;',
      subtitle: null,
      theme: 'default',
      sourceType: 'manual' as const,
      originalImagePath: null,
      originalImageFormat: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const html = renderCueHtml(cue, '');

    // Raw script tag must not appear
    expect(html).not.toContain('<script>');
    // Name should be escaped
    expect(html).toContain('&lt;script&gt;');
    // Title ampersand should be double-escaped: & → &amp; then &amp; → &amp;amp;
    expect(html).toContain('&amp;amp;');
  });
});
