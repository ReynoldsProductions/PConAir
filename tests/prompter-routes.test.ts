import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { createStateStore, type StateStore } from '../src/main/state';
import { createFullServer } from './_test-server';

const PINS = { operatorPin: '1234', adminPin: 'supersecret' };

describe('prompter routes', () => {
  let srv: ReturnType<typeof createFullServer>;
  let store: StateStore;
  let op: string;
  let admin: string;
  let savedPatches: Array<Record<string, unknown>>;
  let host: string;
  let enabled: boolean;

  beforeEach(async () => {
    store = createStateStore();
    savedPatches = [];
    host = '';
    enabled = false;
    srv = createFullServer({
      ...PINS,
      store,
      port: 0,
      getPrompterHost: () => host,
      isPrompterEnabled: () => enabled,
      savePrompterSettings: (patch) => savedPatches.push(patch as Record<string, unknown>),
    });
    await srv.listen();
    const o = await request(srv.app).post('/auth/operator').send({ pin: PINS.operatorPin });
    op = o.headers['set-cookie'][0].split(';')[0];
    const a = await request(srv.app).post('/auth/admin').send({ pin: PINS.adminPin });
    admin = a.headers['set-cookie'][0].split(';')[0];
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await srv.close();
  });

  describe('transport', () => {
    it('starts and stops the built-in prompter with no external service configured', async () => {
      const started = await request(srv.app).post('/api/prompter/start').set('Cookie', op);
      expect(started.status).toBe(200);
      expect(started.body.prompter.scrolling).toBe(true);
      expect(store.getState().prompter.startedAt).not.toBeNull();

      const stopped = await request(srv.app).post('/api/prompter/stop').set('Cookie', op);
      expect(stopped.body.prompter.scrolling).toBe(false);
      expect(store.getState().prompter.startedAt).toBeNull();
    });

    it('toggles and rewinds', async () => {
      await request(srv.app).post('/api/prompter/toggle').set('Cookie', op);
      expect(store.getState().prompter.scrolling).toBe(true);
      await request(srv.app).post('/api/prompter/toggle').set('Cookie', op);
      expect(store.getState().prompter.scrolling).toBe(false);

      await request(srv.app).post('/api/prompter/position').set('Cookie', op).send({ position: 800 });
      expect(store.getState().prompter.offset).toBe(800);
      await request(srv.app).post('/api/prompter/rewind').set('Cookie', op);
      expect(store.getState().prompter.offset).toBe(0);
    });

    it('nudges the position by a delta', async () => {
      await request(srv.app).post('/api/prompter/position').set('Cookie', op).send({ position: 500 });
      await request(srv.app).post('/api/prompter/position').set('Cookie', op).send({ delta: -200 });
      expect(store.getState().prompter.offset).toBe(300);
    });

    it('rejects a position body with neither position nor delta', async () => {
      const res = await request(srv.app).post('/api/prompter/position').set('Cookie', op).send({});
      expect(res.status).toBe(400);
    });

    it('steps and clamps speed and font size', async () => {
      await request(srv.app).post('/api/prompter/scroll').set('Cookie', op).send({ direction: 'faster' });
      expect(store.getState().prompter.speed).toBe(50);
      await request(srv.app).post('/api/prompter/scroll').set('Cookie', op).send({ direction: 'slower' });
      expect(store.getState().prompter.speed).toBe(40);

      const bad = await request(srv.app).post('/api/prompter/scroll').set('Cookie', op).send({ direction: 'sideways' });
      expect(bad.status).toBe(400);

      await request(srv.app).post('/api/prompter/speed').set('Cookie', op).send({ speed: 999 });
      expect(store.getState().prompter.speed).toBe(200);

      await request(srv.app).post('/api/prompter/font-size').set('Cookie', op).send({ direction: 'in' });
      expect(store.getState().prompter.fontSize).toBe(76);
      await request(srv.app).post('/api/prompter/font-size').set('Cookie', op).send({ fontSize: 1 });
      expect(store.getState().prompter.fontSize).toBe(24);
    });

    it('sets line height and mirror axes', async () => {
      await request(srv.app).post('/api/prompter/line-height').set('Cookie', op).send({ lineHeight: 2 });
      expect(store.getState().prompter.lineHeight).toBe(2);

      await request(srv.app).post('/api/prompter/mirror').set('Cookie', op).send({ x: true });
      expect(store.getState().prompter).toMatchObject({ mirrorX: true, mirrorY: false });
    });

    it('stores the script and parks it at the top', async () => {
      await request(srv.app).post('/api/prompter/start').set('Cookie', op);
      const res = await request(srv.app).post('/api/prompter/script').set('Cookie', op).send({ text: 'Good evening.' });
      expect(res.status).toBe(200);
      expect(store.getState().prompter).toMatchObject({ script: 'Good evening.', scrolling: false, offset: 0 });
    });

    it('rejects a non-string script', async () => {
      const res = await request(srv.app).post('/api/prompter/script').set('Cookie', op).send({ text: 42 });
      expect(res.status).toBe(400);
    });

    it('requires an operator session', async () => {
      expect((await request(srv.app).post('/api/prompter/start')).status).toBe(401);
      expect((await request(srv.app).post('/api/prompter/script').send({ text: 'x' })).status).toBe(401);
    });
  });

  describe('external prompter service', () => {
    it('does not call out when no service is configured', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      const res = await request(srv.app).post('/api/prompter/start').set('Cookie', op);
      expect(res.body.forwarded).toBe('off');
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('forwards transport and script changes when one is configured', async () => {
      host = 'http://prompter.local:8082';
      enabled = true;
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));

      const res = await request(srv.app).post('/api/prompter/start').set('Cookie', op);
      expect(res.body.forwarded).toBe('ok');
      expect(fetchSpy).toHaveBeenCalledWith(
        'http://prompter.local:8082/api/state',
        expect.objectContaining({ method: 'POST' })
      );
      const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
      expect(body).toEqual({ scrolling: true });

      await request(srv.app).post('/api/prompter/script').set('Cookie', op).send({ text: 'Hello' });
      const scriptBody = JSON.parse((fetchSpy.mock.calls[1][1] as RequestInit).body as string);
      expect(scriptBody).toEqual({ script: 'Hello' });
    });

    it('still applies the change locally when the external service is unreachable', async () => {
      host = 'http://prompter.local:8082';
      enabled = true;
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));

      const res = await request(srv.app).post('/api/prompter/start').set('Cookie', op);
      expect(res.status).toBe(200);
      expect(res.body.forwarded).toBe('failed');
      expect(store.getState().prompter.scrolling).toBe(true);
    });
  });

  describe('output window', () => {
    it('is reported unavailable outside the desktop app', async () => {
      const res = await request(srv.app).post('/api/prompter/window').set('Cookie', op).send({ open: true });
      expect(res.status).toBe(501);
      const status = await request(srv.app).get('/api/prompter/status').set('Cookie', op);
      expect(status.body.window).toMatchObject({ open: false, available: false });
    });
  });

  describe('config', () => {
    it('saves the external service settings (admin only)', async () => {
      const denied = await request(srv.app)
        .post('/api/prompter/config')
        .set('Cookie', op)
        .send({ host: 'http://x:1', enabled: true });
      expect(denied.status).toBe(403);

      const res = await request(srv.app)
        .post('/api/prompter/config')
        .set('Cookie', admin)
        .send({ host: '  http://prompter.local:8082 ', enabled: true });
      expect(res.status).toBe(200);
      expect(savedPatches).toEqual([{ host: 'http://prompter.local:8082', enabled: true }]);
      expect(store.getState().prompter).toMatchObject({ host: 'http://prompter.local:8082', enabled: true });
    });
  });

  describe('status', () => {
    it('reports the live position and external connection state', async () => {
      await request(srv.app).post('/api/prompter/script').set('Cookie', op).send({ text: 'line' });
      await request(srv.app).post('/api/prompter/position').set('Cookie', op).send({ position: 250 });
      const res = await request(srv.app).get('/api/prompter/status').set('Cookie', op);
      expect(res.status).toBe(200);
      expect(res.body.prompter.script).toBe('line');
      expect(res.body.position).toBe(250);
      expect(res.body.external).toEqual({ configured: false, enabled: false, connected: false });
      expect(typeof res.body.serverNow).toBe('number');
    });
  });

  describe('talent-facing display', () => {
    it('serves the prompter page without a login', async () => {
      const res = await request(srv.app).get('/prompter/');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/html/);
      expect(res.text).toContain('id="script"');
      expect(res.headers['content-security-policy']).toBeDefined();
    });

    it('serves the view snapshot the display hydrates from, with a server clock', async () => {
      await request(srv.app).post('/api/prompter/script').set('Cookie', op).send({ text: 'Good evening.' });
      const before = Date.now();
      const res = await request(srv.app).get('/api/prompter/view');
      expect(res.status).toBe(200);
      expect(res.body.prompter).toMatchObject({
        script: 'Good evening.',
        fontSize: 72,
        lineHeight: 1.4,
        speed: 40,
        scrolling: false,
        offset: 0,
        mirrorX: false,
        mirrorY: false,
      });
      expect(res.body.serverNow).toBeGreaterThanOrEqual(before);
      // The talent view never needs the external service credentials/URL.
      expect(res.body.prompter.host).toBeUndefined();
    });
  });
});

describe('prompter output window (desktop app)', () => {
  let srv: ReturnType<typeof createFullServer>;
  let store: StateStore;
  let op: string;
  let opened: Array<string | null>;
  let closes: number;
  let state: { open: boolean; displayId: string | null };

  beforeEach(async () => {
    store = createStateStore();
    opened = [];
    closes = 0;
    state = { open: false, displayId: null };
    srv = createFullServer({
      ...PINS,
      store,
      port: 0,
      prompterWindow: {
        open: async (displayId) => {
          opened.push(displayId);
          state = { open: true, displayId };
        },
        close: () => {
          closes += 1;
          state = { open: false, displayId: null };
        },
        status: () => state,
      },
    });
    await srv.listen();
    const o = await request(srv.app).post('/auth/operator').send({ pin: PINS.operatorPin });
    op = o.headers['set-cookie'][0].split(';')[0];
  });

  afterEach(async () => {
    await srv.close();
  });

  it('opens the output on a chosen display and closes it again', async () => {
    const res = await request(srv.app)
      .post('/api/prompter/window')
      .set('Cookie', op)
      .send({ open: true, displayId: '12345' });
    expect(res.status).toBe(200);
    expect(opened).toEqual(['12345']);
    expect(res.body.window).toEqual({ open: true, displayId: '12345' });

    const closed = await request(srv.app).post('/api/prompter/window').set('Cookie', op).send({ open: false });
    expect(closes).toBe(1);
    expect(closed.body.window.open).toBe(false);
  });

  it('falls back to the display preference when none is named', async () => {
    await request(srv.app).post('/api/prompter/window').set('Cookie', op).send({ open: true });
    expect(opened).toEqual([null]);
  });

  it('rejects a request that does not say whether to open or close', async () => {
    const res = await request(srv.app).post('/api/prompter/window').set('Cookie', op).send({});
    expect(res.status).toBe(400);
  });
});
