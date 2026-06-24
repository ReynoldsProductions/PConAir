import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createStateStore, type StateStore } from '../src/main/state';
import { createFullServer } from './_test-server';
import { getOverlayBounds, buildOverlayHtml } from '../src/main/stagetimer/overlay-content';

const PINS = { operatorPin: '1234', adminPin: 'supersecret' };

describe('getOverlayBounds', () => {
  const display = { x: 100, y: 50, width: 1920, height: 1080 };

  it('sizes the overlay as a percent of the display with a 12px margin', () => {
    const b = getOverlayBounds(display, 'bottom-left', 10);
    expect(b).toEqual({ x: 112, y: 50 + 1080 - 108 - 12, width: 192, height: 108 });
  });

  it('anchors each corner', () => {
    expect(getOverlayBounds(display, 'top-left', 10)).toMatchObject({ x: 112, y: 62 });
    expect(getOverlayBounds(display, 'top-right', 10)).toMatchObject({ x: 100 + 1920 - 192 - 12, y: 62 });
    expect(getOverlayBounds(display, 'bottom-right', 10)).toMatchObject({ x: 100 + 1920 - 192 - 12 });
  });

  it('drops the margin at 100% (fullscreen)', () => {
    expect(getOverlayBounds(display, 'bottom-left', 100)).toEqual({ x: 100, y: 50, width: 1920, height: 1080 });
  });
});

describe('buildOverlayHtml', () => {
  it('embeds the credentials as JS strings', () => {
    const html = buildOverlayHtml('room1', 'key"</script>');
    expect(html).toContain('const roomId = "room1"');
    // JSON.stringify escapes the quote so the script cannot be broken out of
    expect(html).toContain('key\\"</script>');
    expect(html).toContain('api.stagetimer.io');
  });

  it('uses header-row layout with time-wrap and fitTimeDisplay (GSC #22 density fix)', () => {
    const html = buildOverlayHtml('room123', 'key456');
    expect(html).toContain('id="time-wrap"');
    expect(html).toContain('id="header"');
    expect(html).toContain('fitTimeDisplay');
    expect(html).toContain('clamp(');
  });
});

describe('stagetimer routes', () => {
  let srv: ReturnType<typeof createFullServer>;
  let store: StateStore;
  let operatorCookie: string;
  let adminCookie: string;
  const overlayCalls: string[] = [];
  const savedPatches: Array<Record<string, unknown>> = [];

  beforeEach(async () => {
    overlayCalls.length = 0;
    savedPatches.length = 0;
    store = createStateStore();
    srv = createFullServer({
      ...PINS,
      store,
      port: 0,
      stageTimer: {
        showOverlay: (pos, size) => overlayCalls.push(`show:${pos}:${size}`),
        hideOverlay: () => overlayCalls.push('hide'),
        updateOverlaySettings: (pos, size) => overlayCalls.push(`update:${pos}:${size}`),
        saveStageTimerSettings: (patch) => savedPatches.push(patch as Record<string, unknown>),
        hasApiKey: () => savedPatches.some((p) => typeof p.stagetimerApiKey === 'string'),
      },
    });
    await srv.listen();
    const op = await request(srv.app).post('/auth/operator').send({ pin: PINS.operatorPin });
    operatorCookie = op.headers['set-cookie'][0].split(';')[0];
    const ad = await request(srv.app).post('/auth/admin').send({ pin: PINS.adminPin });
    adminCookie = ad.headers['set-cookie'][0].split(';')[0];
  });

  afterEach(async () => {
    await srv.close();
  });

  it('GET /api/stagetimer returns the default state', async () => {
    const res = await request(srv.app).get('/api/stagetimer').expect(200);
    expect(res.body.stageTimer).toEqual({
      overlayEnabled: false,
      overlayPosition: 'bottom-left',
      overlaySize: 10,
      roomId: null,
      configured: false,
    });
  });

  it('operator toggles the overlay; state, hook, and persistence all fire', async () => {
    const on = await request(srv.app)
      .post('/api/stagetimer/overlay')
      .set('Cookie', operatorCookie)
      .send({ enabled: true })
      .expect(200);
    expect(on.body.stageTimer.overlayEnabled).toBe(true);
    expect(overlayCalls).toEqual(['show:bottom-left:10']);
    expect(savedPatches).toEqual([{ stageTimerOverlayEnabled: true }]);

    await request(srv.app)
      .post('/api/stagetimer/overlay')
      .set('Cookie', operatorCookie)
      .send({ enabled: false })
      .expect(200);
    expect(store.getState().stageTimer.overlayEnabled).toBe(false);
    expect(overlayCalls).toEqual(['show:bottom-left:10', 'hide']);
  });

  it('rejects overlay toggle without a session and non-boolean payloads', async () => {
    await request(srv.app).post('/api/stagetimer/overlay').send({ enabled: true }).expect(401);
    await request(srv.app)
      .post('/api/stagetimer/overlay')
      .set('Cookie', operatorCookie)
      .send({ enabled: 'yes' })
      .expect(400);
  });

  it('admin config sets credentials, marks configured, and reopens a visible overlay', async () => {
    await request(srv.app)
      .post('/api/stagetimer/overlay')
      .set('Cookie', operatorCookie)
      .send({ enabled: true })
      .expect(200);
    overlayCalls.length = 0;

    const res = await request(srv.app)
      .post('/api/stagetimer/config')
      .set('Cookie', adminCookie)
      .send({ roomId: 'ROOM42', apiKey: 'secret-key' })
      .expect(200);
    expect(res.body.stageTimer.roomId).toBe('ROOM42');
    expect(res.body.stageTimer.configured).toBe(true);
    // The API key itself never appears in state.
    expect(JSON.stringify(res.body)).not.toContain('secret-key');
    expect(savedPatches).toContainEqual({ stagetimerRoomId: 'ROOM42', stagetimerApiKey: 'secret-key' });
    // Credentials are baked into the page → hide + show to reload it.
    expect(overlayCalls).toEqual(['hide', 'show:bottom-left:10']);
  });

  it('admin config updates position/size and live-updates a visible overlay', async () => {
    await request(srv.app)
      .post('/api/stagetimer/overlay')
      .set('Cookie', operatorCookie)
      .send({ enabled: true });
    overlayCalls.length = 0;

    const res = await request(srv.app)
      .post('/api/stagetimer/config')
      .set('Cookie', adminCookie)
      .send({ position: 'top-right', size: 25 })
      .expect(200);
    expect(res.body.stageTimer.overlayPosition).toBe('top-right');
    expect(res.body.stageTimer.overlaySize).toBe(25);
    expect(overlayCalls).toEqual(['update:top-right:25']);

    await request(srv.app)
      .post('/api/stagetimer/config')
      .set('Cookie', adminCookie)
      .send({ position: 'middle' })
      .expect(400);
    await request(srv.app)
      .post('/api/stagetimer/config')
      .set('Cookie', adminCookie)
      .send({ size: 0 })
      .expect(400);
    await request(srv.app).post('/api/stagetimer/config').set('Cookie', operatorCookie).send({ size: 20 }).expect(403);
  });

  it('GSC-compat endpoints work cookie-less with GSC response shapes', async () => {
    const show = await request(srv.app).post('/api/show-stage-timer-overlay').expect(200);
    expect(show.body).toEqual({ success: true, stageTimerOverlayEnabled: true });
    expect(store.getState().stageTimer.overlayEnabled).toBe(true);

    const upd = await request(srv.app)
      .post('/api/update-stage-timer-overlay-settings')
      .send({ position: 'top-left', size: 15 })
      .expect(200);
    expect(upd.body).toEqual({ success: true, stageTimerOverlayPosition: 'top-left', stageTimerOverlaySize: 15 });

    await request(srv.app)
      .post('/api/update-stage-timer-overlay-settings')
      .send({ position: 'nope' })
      .expect(400);

    const hide = await request(srv.app).post('/api/hide-stage-timer-overlay').expect(200);
    expect(hide.body).toEqual({ success: true, stageTimerOverlayEnabled: false });
    expect(store.getState().stageTimer.overlayEnabled).toBe(false);
  });
});

describe('stagetimer backup sync (GSC #21)', () => {
  it('does not call fanOutSlideCommand when getBackupSettings is absent', async () => {
    // createFullServer does not pass getBackupSettings → fan-out should silently do nothing
    const store2 = createStateStore();
    const fanOutCalls: string[] = [];
    const srv2 = createFullServer({
      ...PINS,
      store: store2,
      port: 0,
      stageTimer: {
        showOverlay: () => {},
        hideOverlay: () => {},
        updateOverlaySettings: () => {},
      },
    });
    await srv2.listen();
    // No error: show/hide fire cleanly without backup settings
    await request(srv2.app).post('/api/show-stage-timer-overlay').expect(200);
    await request(srv2.app).post('/api/hide-stage-timer-overlay').expect(200);
    expect(fanOutCalls).toHaveLength(0);
    await srv2.close();
  });

  it('fanOutIfPrimary fires when operationMode is primary with backup IPs', async () => {
    // Build a minimal express app around the stagetimer router (no auth session needed
    // for the GSC-compat cookie-less endpoints).
    const { createStageTimerRouter } = await import('../src/main/routes/stagetimer');
    const { createStateStore: cs } = await import('../src/main/state');
    const { createAuthManager } = await import('../src/main/auth');
    const express = (await import('express')).default;
    const bodyParser = (await import('body-parser')).default;
    const supertest = (await import('supertest')).default;

    const s3 = cs();
    const auth3 = createAuthManager({
      operatorPin: '0000',
      adminPin: '0000',
      operatorSessionMs: 60000,
      adminSessionMs: 60000,
      maxFailures: 5,
      failureWindowMs: 300000,
      lockoutMs: 300000,
    });
    const app3 = express();
    app3.use(bodyParser.json());
    app3.use(createStageTimerRouter({
      store: s3,
      auth: auth3,
      showOverlay: () => {},
      hideOverlay: () => {},
      getBackupSettings: () => ({ operationMode: 'primary', backupIps: ['192.168.1.99'], port: 9595 }),
    }));

    // show: should succeed (fan-out fires fire-and-forget, will fail to connect to fake IP but not throw)
    const showRes = await supertest(app3).post('/api/show-stage-timer-overlay').expect(200);
    expect(showRes.body.success).toBe(true);
    // hide: should also succeed
    const hideRes = await supertest(app3).post('/api/hide-stage-timer-overlay').expect(200);
    expect(hideRes.body.success).toBe(true);
  });
});
