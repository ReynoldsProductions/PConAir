import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createStateStore } from '../src/main/state';
import { createFullServer } from './_test-server';

// Admin → Background wrote AppState.background — this covers the config
// endpoint itself. Consumption (graphics/lower-third-live's own backdrop
// handling) is exercised in tests/websocket.test.ts and is browser-side, not
// server-renderable, so it isn't unit-tested here.

describe('POST /api/background — transparent type', () => {
  let app: Express;
  let srv: ReturnType<typeof createFullServer>;
  let adm: string;

  beforeEach(async () => {
    srv = createFullServer({
      store: createStateStore(),
      operatorPin: 'test1234',
      adminPin: 'adminpass8',
      port: 0,
    });
    await srv.listen();
    app = srv.app;
    adm = ((await request(app).post('/auth/admin').send({ pin: 'adminpass8' }))
      .headers['set-cookie'] as unknown as string[])[0].split(';')[0];
  });

  afterEach(() => srv.close());

  it('accepts type transparent', async () => {
    const res = await request(app)
      .post('/api/background')
      .set('Cookie', adm)
      .send({ type: 'transparent', value: '#000000' });
    expect(res.status).toBe(200);
    expect(res.body.background.type).toBe('transparent');
  });

  it('accepts a transparent preset', async () => {
    const created = await request(app)
      .post('/api/background/presets')
      .set('Cookie', adm)
      .send({ name: 'Keyed', type: 'transparent', value: '#000000' });
    expect(created.status).toBe(201);

    const applied = await request(app)
      .post('/api/background')
      .set('Cookie', adm)
      .send({ presetId: created.body.id ?? created.body.preset?.id });
    expect(applied.status).toBe(200);
    expect(applied.body.background.type).toBe('transparent');
  });

  it('still rejects a bogus type', async () => {
    const res = await request(app)
      .post('/api/background')
      .set('Cookie', adm)
      .send({ type: 'plaid', value: '#000000' });
    expect(res.status).toBe(400);
  });

  it('still rejects a bad colour', async () => {
    const res = await request(app)
      .post('/api/background')
      .set('Cookie', adm)
      .send({ type: 'solid', value: 'blue' });
    expect(res.status).toBe(400);
  });
});
