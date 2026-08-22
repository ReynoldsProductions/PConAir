import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createStateStore } from '../src/main/state';
import { createFullServer } from './_test-server';

// Recall-then-edit: taking a cue from the library used to discard any name/title
// typed alongside it, so an operator could never tweak a preset's wording on the
// fly. Per-take name/title now override the stored cue the same way autoOutMs
// already did — and, critically, without writing back to the cue store.

const AUTH = {
  operatorPin: 'op1234',
  adminPin: 'adminpass8',
  operatorSessionMs: 60000,
  adminSessionMs: 60000,
};

describe('POST /api/l3/take — per-take cue overrides', () => {
  let app: Express;
  let srv: ReturnType<typeof createFullServer>;
  let cookie: string;
  let adminCookie: string;
  let cueId: string;

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
    cookie = ((await request(app).post('/auth/operator').send({ pin: 'op1234' }))
      .headers['set-cookie'] as unknown as string[])[0];
    adminCookie = ((await request(app).post('/auth/admin').send({ pin: 'adminpass8' }))
      .headers['set-cookie'] as unknown as string[])[0];

    const created = await request(app)
      .post('/api/l3/cues')
      .set('Cookie', adminCookie)
      .send({ name: 'Jane Doe', title: 'Host', theme: 'default' });
    cueId = created.body.id;
  });

  afterEach(() => srv.close());

  it('takes the stored cue verbatim when no overrides are sent', async () => {
    const res = await request(app)
      .post('/api/l3/take')
      .set('Cookie', cookie)
      .send({ cueId });
    expect(res.status).toBe(200);
    expect(res.body.l3.activeCueName).toBe('Jane Doe');
    expect(res.body.l3.activeTitle).toBe('Host');
  });

  it('overrides the cue title while keeping its name', async () => {
    const res = await request(app)
      .post('/api/l3/take')
      .set('Cookie', cookie)
      .send({ cueId, title: 'Guest Panelist' });
    expect(res.status).toBe(200);
    expect(res.body.l3.activeCueName).toBe('Jane Doe');
    expect(res.body.l3.activeTitle).toBe('Guest Panelist');
  });

  it('overrides the cue name while keeping its title', async () => {
    const res = await request(app)
      .post('/api/l3/take')
      .set('Cookie', cookie)
      .send({ cueId, name: 'Jane D.' });
    expect(res.status).toBe(200);
    expect(res.body.l3.activeCueName).toBe('Jane D.');
    expect(res.body.l3.activeTitle).toBe('Host');
  });

  it('overrides both, and trims surrounding whitespace', async () => {
    const res = await request(app)
      .post('/api/l3/take')
      .set('Cookie', cookie)
      .send({ cueId, name: '  Ada Lovelace  ', title: '  Keynote  ' });
    expect(res.status).toBe(200);
    expect(res.body.l3.activeCueName).toBe('Ada Lovelace');
    expect(res.body.l3.activeTitle).toBe('Keynote');
  });

  it('treats blank/whitespace-only overrides as absent', async () => {
    const res = await request(app)
      .post('/api/l3/take')
      .set('Cookie', cookie)
      .send({ cueId, name: '   ', title: '' });
    expect(res.status).toBe(200);
    expect(res.body.l3.activeCueName).toBe('Jane Doe');
    expect(res.body.l3.activeTitle).toBe('Host');
  });

  it('leaves the stored cue untouched after an overridden take', async () => {
    await request(app)
      .post('/api/l3/take')
      .set('Cookie', cookie)
      .send({ cueId, name: 'Temporary', title: 'Just This Once' });

    const list = await request(app).get('/api/l3/cues').set('Cookie', cookie);
    const stored = list.body.cues.find((c: { id: string }) => c.id === cueId);
    expect(stored.name).toBe('Jane Doe');
    expect(stored.title).toBe('Host');
  });
});
