import { describe, it, expect } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createStateStore } from '../src/main/state';
import { createFullServer } from './_test-server';

function makeServer() {
  const store = createStateStore();
  const server = createFullServer({
    store,
    operatorPin: 'test1234',
    adminPin: 'adminpass8',
    port: 0,
  });
  return { server, store };
}

async function getOperatorCookie(app: Express) {
  const res = await request(app).post('/auth/operator').send({ pin: 'test1234' });
  return (res.headers['set-cookie'] as unknown as string[])[0];
}

async function getAdminCookie(app: Express) {
  const res = await request(app).post('/auth/admin').send({ pin: 'adminpass8' });
  return (res.headers['set-cookie'] as unknown as string[])[0];
}

describe('lower_third_apply action', () => {
  it('applies with full params', async () => {
    const { server, store } = makeServer();
    const cookie = await getOperatorCookie(server.app);

    const res = await request(server.app)
      .post('/api/action')
      .set('Cookie', cookie)
      .send({
        action_id: 'lower_third_apply',
        params: {
          name: 'Jane Smith',
          title: 'Chief Executive Officer',
          subtitle: 'Faire Wire',
          theme: 'dark',
        },
      });

    expect(res.status).toBe(200);
    const lt = store.getState().graphics.lowerThird!;
    expect(lt.visible).toBe(true);
    expect(lt.name).toBe('Jane Smith');
    expect(lt.title).toBe('Chief Executive Officer');
    expect(lt.subtitle).toBe('Faire Wire');
    expect(lt.theme).toBe('dark');
    expect(lt.sourceCueId).toBeNull();

    expect(res.body.graphics.lowerThird).toMatchObject({
      visible: true,
      name: 'Jane Smith',
      title: 'Chief Executive Officer',
      subtitle: 'Faire Wire',
      theme: 'dark',
    });
  });

  it('applies with only name, using sensible defaults for the rest', async () => {
    const { server, store } = makeServer();
    const cookie = await getOperatorCookie(server.app);

    const res = await request(server.app)
      .post('/api/action')
      .set('Cookie', cookie)
      .send({ action_id: 'lower_third_apply', params: { name: 'Solo Name' } });

    expect(res.status).toBe(200);
    const lt = store.getState().graphics.lowerThird!;
    expect(lt.visible).toBe(true);
    expect(lt.name).toBe('Solo Name');
    expect(lt.title).toBe('');
    expect(lt.subtitle).toBeNull();
    expect(lt.theme).toBe('default');
    expect(lt.fadeEnabled).toBe(true);
    expect(lt.fadeMs).toBe(550);
    expect(lt.animationStyle).toBe('fade');
  });

  it('applies explicit fadeEnabled/fadeMs/animationStyle', async () => {
    const { server, store } = makeServer();
    const cookie = await getOperatorCookie(server.app);

    const res = await request(server.app)
      .post('/api/action')
      .set('Cookie', cookie)
      .send({
        action_id: 'lower_third_apply',
        params: { name: 'Someone', fadeEnabled: false, fadeMs: 900, animationStyle: 'wipe' },
      });

    expect(res.status).toBe(200);
    const lt = store.getState().graphics.lowerThird!;
    expect(lt.fadeEnabled).toBe(false);
    expect(lt.fadeMs).toBe(900);
    expect(lt.animationStyle).toBe('wipe');
    expect(res.body.graphics.lowerThird).toMatchObject({
      fadeEnabled: false,
      fadeMs: 900,
      animationStyle: 'wipe',
    });
  });

  it('allows a custom fadeMs above the slider-suggested 5000ms', async () => {
    const { server, store } = makeServer();
    const cookie = await getOperatorCookie(server.app);

    const res = await request(server.app)
      .post('/api/action')
      .set('Cookie', cookie)
      .send({ action_id: 'lower_third_apply', params: { name: 'Someone', fadeMs: 12000 } });

    expect(res.status).toBe(200);
    expect(store.getState().graphics.lowerThird!.fadeMs).toBe(12000);
  });

  it('clamps fadeMs to the server-side 0-60000 ceiling', async () => {
    const { server, store } = makeServer();
    const cookie = await getOperatorCookie(server.app);

    const res = await request(server.app)
      .post('/api/action')
      .set('Cookie', cookie)
      .send({ action_id: 'lower_third_apply', params: { name: 'Someone', fadeMs: 999999 } });

    expect(res.status).toBe(200);
    expect(store.getState().graphics.lowerThird!.fadeMs).toBe(60000);
  });

  it('falls back to default animationStyle for an invalid style string', async () => {
    const { server, store } = makeServer();
    const cookie = await getOperatorCookie(server.app);

    const res = await request(server.app)
      .post('/api/action')
      .set('Cookie', cookie)
      .send({ action_id: 'lower_third_apply', params: { name: 'Someone', animationStyle: 'not-a-style' } });

    expect(res.status).toBe(200);
    expect(store.getState().graphics.lowerThird!.animationStyle).toBe('fade');
  });

  it.each(['slide-up', 'slide-down', 'zoom', 'flip'])('accepts the %s animation style', async (style) => {
    const { server, store } = makeServer();
    const cookie = await getOperatorCookie(server.app);

    const res = await request(server.app)
      .post('/api/action')
      .set('Cookie', cookie)
      .send({ action_id: 'lower_third_apply', params: { name: 'Someone', animationStyle: style } });

    expect(res.status).toBe(200);
    expect(store.getState().graphics.lowerThird!.animationStyle).toBe(style);
  });

  it('preserves fade settings from a previous apply when a later call omits them', async () => {
    const { server, store } = makeServer();
    const cookie = await getOperatorCookie(server.app);

    await request(server.app)
      .post('/api/action')
      .set('Cookie', cookie)
      .send({
        action_id: 'lower_third_apply',
        params: { name: 'Someone', fadeEnabled: false, fadeMs: 1200, animationStyle: 'grow' },
      });

    const res = await request(server.app)
      .post('/api/action')
      .set('Cookie', cookie)
      .send({ action_id: 'lower_third_apply', params: { name: 'Someone Else' } });

    expect(res.status).toBe(200);
    const lt = store.getState().graphics.lowerThird!;
    expect(lt.fadeEnabled).toBe(false);
    expect(lt.fadeMs).toBe(1200);
    expect(lt.animationStyle).toBe('grow');
  });

  it('prefills name/title/subtitle from a cueId without mutating state.l3 or currentMode', async () => {
    const { server, store } = makeServer();
    const opCookie = await getOperatorCookie(server.app);
    const admCookie = await getAdminCookie(server.app);

    const created = await request(server.app)
      .post('/api/l3/cues')
      .set('Cookie', admCookie)
      .send({ name: 'Cue Name', title: 'Cue Title', subtitle: 'Cue Subtitle', theme: 'default' });
    expect(created.status).toBe(201);
    const cueId = created.body.id;

    const beforeL3 = store.getState().l3;
    const beforeMode = store.getState().currentMode;

    const res = await request(server.app)
      .post('/api/action')
      .set('Cookie', opCookie)
      .send({ action_id: 'lower_third_apply', params: { cueId } });

    expect(res.status).toBe(200);
    const lt = store.getState().graphics.lowerThird!;
    expect(lt.name).toBe('Cue Name');
    expect(lt.title).toBe('Cue Title');
    expect(lt.subtitle).toBe('Cue Subtitle');
    expect(lt.sourceCueId).toBe(cueId);
    expect(lt.visible).toBe(true);

    const afterL3 = store.getState().l3;
    const afterMode = store.getState().currentMode;

    // Proves lower_third_apply's cueId prefill is fully isolated from the
    // legacy L3 pipeline: state.l3 and state.currentMode are untouched.
    expect(afterL3).toEqual(beforeL3);
    expect(afterMode).toBe(beforeMode);
  });

  it('returns 404 CUE_NOT_FOUND for an unknown cueId', async () => {
    const { server } = makeServer();
    const cookie = await getOperatorCookie(server.app);

    const res = await request(server.app)
      .post('/api/action')
      .set('Cookie', cookie)
      .send({ action_id: 'lower_third_apply', params: { cueId: 'no-such-cue' } });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('CUE_NOT_FOUND');
  });

  it('falls back to default theme for an invalid/garbage theme string', async () => {
    const { server, store } = makeServer();
    const cookie = await getOperatorCookie(server.app);

    const res = await request(server.app)
      .post('/api/action')
      .set('Cookie', cookie)
      .send({ action_id: 'lower_third_apply', params: { name: 'Someone', theme: 'not-a-real-theme' } });

    expect(res.status).toBe(200);
    expect(store.getState().graphics.lowerThird!.theme).toBe('default');
  });

  it('falls back to the previously-set theme when a later call sends a garbage theme', async () => {
    const { server, store } = makeServer();
    const cookie = await getOperatorCookie(server.app);

    await request(server.app)
      .post('/api/action')
      .set('Cookie', cookie)
      .send({ action_id: 'lower_third_apply', params: { name: 'Someone', theme: 'dark' } });

    const res = await request(server.app)
      .post('/api/action')
      .set('Cookie', cookie)
      .send({ action_id: 'lower_third_apply', params: { name: 'Someone', theme: 'still-not-real' } });

    expect(res.status).toBe(200);
    expect(store.getState().graphics.lowerThird!.theme).toBe('dark');
  });

  it('returns 400 INVALID_MODE for missing name', async () => {
    const { server } = makeServer();
    const cookie = await getOperatorCookie(server.app);

    const res = await request(server.app)
      .post('/api/action')
      .set('Cookie', cookie)
      .send({ action_id: 'lower_third_apply', params: {} });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_MODE');
  });

  it('returns 400 INVALID_MODE for a blank name', async () => {
    const { server } = makeServer();
    const cookie = await getOperatorCookie(server.app);

    const res = await request(server.app)
      .post('/api/action')
      .set('Cookie', cookie)
      .send({ action_id: 'lower_third_apply', params: { name: '   ' } });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_MODE');
  });

  it('returns 401 without auth', async () => {
    const { server } = makeServer();
    const res = await request(server.app)
      .post('/api/action')
      .send({ action_id: 'lower_third_apply', params: { name: 'Nobody' } });
    expect(res.status).toBe(401);
  });
});

describe('lower_third_hide action', () => {
  it('hides an applied lower third, preserving other fields', async () => {
    const { server, store } = makeServer();
    const cookie = await getOperatorCookie(server.app);

    await request(server.app)
      .post('/api/action')
      .set('Cookie', cookie)
      .send({
        action_id: 'lower_third_apply',
        params: { name: 'Jane Smith', title: 'CEO', subtitle: 'Faire Wire', theme: 'dark' },
      });

    const res = await request(server.app)
      .post('/api/action')
      .set('Cookie', cookie)
      .send({ action_id: 'lower_third_hide', params: {} });

    expect(res.status).toBe(200);
    const lt = store.getState().graphics.lowerThird!;
    expect(lt.visible).toBe(false);
    expect(lt.name).toBe('Jane Smith');
    expect(lt.title).toBe('CEO');
    expect(lt.subtitle).toBe('Faire Wire');
    expect(lt.theme).toBe('dark');
  });

  it('returns lowerThird: null with no error when nothing was ever applied', async () => {
    const { server, store } = makeServer();
    const cookie = await getOperatorCookie(server.app);

    const res = await request(server.app)
      .post('/api/action')
      .set('Cookie', cookie)
      .send({ action_id: 'lower_third_hide', params: {} });

    expect(res.status).toBe(200);
    expect(res.body.graphics.lowerThird).toBeNull();
    expect(store.getState().graphics.lowerThird).toBeNull();
  });

  it('returns 401 without auth', async () => {
    const { server } = makeServer();
    const res = await request(server.app)
      .post('/api/action')
      .send({ action_id: 'lower_third_hide', params: {} });
    expect(res.status).toBe(401);
  });
});
