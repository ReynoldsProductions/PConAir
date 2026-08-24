import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createStateStore } from '../src/main/state';
import { createFullServer } from './_test-server';

// URL windows were the one output that ignored Admin → Monitors: the window
// manager was constructed without `getDisplayPreference` and always fell back
// to the primary display. The URLs page also had no display picker at all, so
// an operator on the web remote had no way to say where a URL should land.
//
// These tests cover the API contract the remote's picker relies on: a blank
// selection means "follow the profile default" (never a failed lookup), an
// explicit id wins, and a preset's own target sits between the two.

const AUTH = {
  operatorPin: 'test1234',
  adminPin: 'testadmin8',
  operatorSessionMs: 60000,
  adminSessionMs: 60000,
};

const DISPLAYS = [
  { id: 'HDMI-1', name: 'Main', isPrimary: true },
  { id: 'HDMI-2', name: 'Side Monitor', isPrimary: false },
];

describe('URL output display', () => {
  let app: Express;
  let srv: ReturnType<typeof createFullServer>;
  let store: ReturnType<typeof createStateStore>;
  let opCookie: string;
  let adminCookie: string;

  beforeEach(async () => {
    store = createStateStore();
    srv = createFullServer({ store, ...AUTH, port: 0 });
    await srv.listen();
    app = srv.app;
    store.setState({ displays: DISPLAYS });
    const login = async (route: string, pin: string) => {
      const res = await request(app).post(route).send({ pin });
      return ((res.headers['set-cookie'] as unknown) as string[])[0];
    };
    opCookie = await login('/auth/operator', AUTH.operatorPin);
    adminCookie = await login('/auth/admin', AUTH.adminPin);
  });

  afterEach(() => srv.close());

  describe('GET /api/displays', () => {
    it('reports no default until one is set in Admin → Monitors', async () => {
      const res = await request(app).get('/api/displays').set('Cookie', opCookie);
      expect(res.status).toBe(200);
      expect(res.body.defaultDisplayId).toBeNull();
    });

    it('reports the profile display preference to operator clients', async () => {
      await request(app)
        .patch('/api/profiles/display-preference')
        .set('Cookie', adminCookie)
        .send({ displayPreference: 'HDMI-2' })
        .expect(200);

      const res = await request(app).get('/api/displays').set('Cookie', opCookie);
      expect(res.status).toBe(200);
      expect(res.body.defaultDisplayId).toBe('HDMI-2');
    });
  });

  describe('POST /api/url', () => {
    it('leaves displayTarget null when no display is given', async () => {
      const res = await request(app)
        .post('/api/url')
        .set('Cookie', opCookie)
        .send({ url: 'https://example.com' });
      expect(res.status).toBe(200);
      expect(res.body.abState.instanceA.displayTarget).toBeNull();
    });

    it('treats a blank display as "follow the default", not a missing display', async () => {
      const res = await request(app)
        .post('/api/url')
        .set('Cookie', opCookie)
        .send({ url: 'https://example.com', display: '' });
      expect(res.status).toBe(200);
      expect(res.body.abState.instanceA.displayTarget).toBeNull();
    });

    it('honours an explicit display id', async () => {
      const res = await request(app)
        .post('/api/url')
        .set('Cookie', opCookie)
        .send({ url: 'https://example.com', display: 'HDMI-2' });
      expect(res.status).toBe(200);
      expect(res.body.abState.instanceA.displayTarget).toBe('HDMI-2');
    });

    it('still rejects a display that does not exist', async () => {
      const res = await request(app)
        .post('/api/url')
        .set('Cookie', opCookie)
        .send({ url: 'https://example.com', display: 'HDMI-9' });
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('DISPLAY_NOT_FOUND');
    });
  });

  describe('set_display', () => {
    beforeEach(async () => {
      await request(app)
        .post('/api/url')
        .set('Cookie', opCookie)
        .send({ url: 'https://example.com', display: 'HDMI-2' })
        .expect(200);
    });

    it('clears back to the profile default with an explicit null', async () => {
      const res = await request(app)
        .post('/api/action')
        .set('Cookie', opCookie)
        .send({ action_id: 'set_display', params: { display: null } });
      expect(res.status).toBe(200);
      expect(res.body.abState.instanceA.displayTarget).toBeNull();
    });

    it('clears back to the profile default with a blank string', async () => {
      const res = await request(app)
        .post('/api/action')
        .set('Cookie', opCookie)
        .send({ action_id: 'set_display', params: { display: '' } });
      expect(res.status).toBe(200);
      expect(res.body.abState.instanceA.displayTarget).toBeNull();
    });

    it('still rejects an omitted display param', async () => {
      const res = await request(app)
        .post('/api/action')
        .set('Cookie', opCookie)
        .send({ action_id: 'set_display', params: {} });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('MISSING_PARAM');
    });

    it('rejects a non-string, non-null display', async () => {
      const res = await request(app)
        .post('/api/action')
        .set('Cookie', opCookie)
        .send({ action_id: 'set_display', params: { display: 42 } });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('MISSING_PARAM');
    });
  });

  describe('load_url_preset display precedence', () => {
    async function addPreset(displayTarget: string | null): Promise<string> {
      const res = await request(app)
        .post('/api/presets')
        .set('Cookie', adminCookie)
        .send({ name: 'Scoreboard', url: 'https://scores.example.com', sessionMode: 'persistent', displayTarget })
        .expect(201);
      return res.body.id as string;
    }

    it('uses the preset own target when the caller sends a blank display', async () => {
      const id = await addPreset('HDMI-2');
      const res = await request(app)
        .post('/api/action')
        .set('Cookie', opCookie)
        .send({ action_id: 'load_url_preset', params: { preset: id, display: '' } });
      expect(res.status).toBe(200);
      expect(res.body.abState.instanceA.displayTarget).toBe('HDMI-2');
    });

    it('lets an explicit display override the preset own target', async () => {
      const id = await addPreset('HDMI-2');
      const res = await request(app)
        .post('/api/action')
        .set('Cookie', opCookie)
        .send({ action_id: 'load_url_preset', params: { preset: id, display: 'HDMI-1' } });
      expect(res.status).toBe(200);
      expect(res.body.abState.instanceA.displayTarget).toBe('HDMI-1');
    });

    it('falls through to the profile default when neither is set', async () => {
      const id = await addPreset(null);
      const res = await request(app)
        .post('/api/action')
        .set('Cookie', opCookie)
        .send({ action_id: 'load_url_preset', params: { preset: id, display: '' } });
      expect(res.status).toBe(200);
      expect(res.body.abState.instanceA.displayTarget).toBeNull();
    });
  });
});
