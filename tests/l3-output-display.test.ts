import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createStateStore } from '../src/main/state';
import { createFullServer } from './_test-server';

// The Cue Library page had no say in where its output landed: the L3 program
// window always used the profile-wide display preference from Admin → Monitors,
// while the Lower Thirds page picked a display per-take. L3State now carries an
// operator-set output display that overrides the profile default.

const AUTH = {
  operatorPin: 'op1234',
  adminPin: 'adminpass8',
  operatorSessionMs: 60000,
  adminSessionMs: 60000,
};

describe('POST /api/l3/output-display', () => {
  let app: Express;
  let srv: ReturnType<typeof createFullServer>;
  let cookie: string;

  beforeEach(async () => {
    srv = createFullServer({
      store: createStateStore(),
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
  });

  afterEach(() => srv.close());

  it('requires an operator session', async () => {
    const res = await request(app).post('/api/l3/output-display').send({ displayId: '1' });
    expect(res.status).toBe(401);
  });

  it('sets the output display', async () => {
    const res = await request(app)
      .post('/api/l3/output-display')
      .set('Cookie', cookie)
      .send({ displayId: '12345' });
    expect(res.status).toBe(200);
    expect(res.body.l3.outputDisplayId).toBe('12345');
  });

  it('clears back to the profile default with null', async () => {
    await request(app).post('/api/l3/output-display').set('Cookie', cookie).send({ displayId: '9' });
    const res = await request(app)
      .post('/api/l3/output-display')
      .set('Cookie', cookie)
      .send({ displayId: null });
    expect(res.status).toBe(200);
    expect(res.body.l3.outputDisplayId).toBeNull();
  });

  it('rejects a non-string, non-null displayId', async () => {
    const res = await request(app)
      .post('/api/l3/output-display')
      .set('Cookie', cookie)
      .send({ displayId: 42 });
    expect(res.status).toBe(400);
  });

  it('survives a take — taking a cue must not reset the chosen display', async () => {
    await request(app).post('/api/l3/output-display').set('Cookie', cookie).send({ displayId: '7' });
    await request(app)
      .post('/api/l3/take')
      .set('Cookie', cookie)
      .send({ name: 'Jane', title: 'Host' })
      .expect(200);

    const status = await request(app).get('/api/status').set('Cookie', cookie);
    expect(status.body.l3.outputDisplayId).toBe('7');
    expect(status.body.l3.activeCueName).toBe('Jane');
  });

  it('survives a clear', async () => {
    await request(app).post('/api/l3/output-display').set('Cookie', cookie).send({ displayId: '7' });
    await request(app).post('/api/l3/take').set('Cookie', cookie).send({ name: 'A', title: 'B' });
    await request(app).post('/api/l3/clear').set('Cookie', cookie).send({});

    const status = await request(app).get('/api/status').set('Cookie', cookie);
    expect(status.body.l3.outputDisplayId).toBe('7');
  });
});
