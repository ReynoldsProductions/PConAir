import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createStateStore } from '../src/main/state';
import { createFullServer } from './_test-server';

function makeHttpServer() {
  const store = createStateStore();
  const server = createFullServer({
    store,
    operatorPin: 'test1234',
    adminPin: 'adminpass8',
    operatorSessionMs: 60000,
    adminSessionMs: 60000,
    port: 0,
  });
  return { server, store };
}

async function getCookies(app: Express) {
  const op = await request(app).post('/auth/operator').send({ pin: 'test1234' });
  const adm = await request(app).post('/auth/admin').send({ pin: 'adminpass8' });
  return {
    operator: ((op.headers['set-cookie'] as unknown) as string[])[0],
    admin: ((adm.headers['set-cookie'] as unknown) as string[])[0],
  };
}

describe('GET /api/camera', () => {
  let app: Express;
  let cookies: { operator: string; admin: string };
  let srv: ReturnType<typeof makeHttpServer>['server'];

  beforeEach(async () => {
    const made = makeHttpServer();
    srv = made.server;
    await srv.listen();
    app = srv.app;
    cookies = await getCookies(app);
  });

  afterEach(() => srv.close());

  it('returns default camera state (200)', async () => {
    const res = await request(app).get('/api/camera').set('Cookie', cookies.operator);
    expect(res.status).toBe(200);
    expect(res.body.camera).toEqual({
      selectedDevice: null,
      permissionStatus: 'unknown',
      connectionStatus: 'disconnected',
      lastError: null,
      outputMode: 'ndi',
      outputDisplayId: null,
      ndi: { sourceName: '' },
    });
  });

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/camera');
    expect(res.status).toBe(401);
  });

  it('is included in GET /api/status', async () => {
    const res = await request(app).get('/api/status').set('Cookie', cookies.operator);
    expect(res.status).toBe(200);
    expect(res.body.camera.outputMode).toBe('ndi');
  });
});

describe('POST /api/camera/device', () => {
  let app: Express;
  let cookies: { operator: string; admin: string };
  let srv: ReturnType<typeof makeHttpServer>['server'];
  let store: ReturnType<typeof makeHttpServer>['store'];

  beforeEach(async () => {
    const made = makeHttpServer();
    srv = made.server;
    store = made.store;
    await srv.listen();
    app = srv.app;
    cookies = await getCookies(app);
  });

  afterEach(() => srv.close());

  it('selects a device (200, operator)', async () => {
    const res = await request(app)
      .post('/api/camera/device')
      .set('Cookie', cookies.operator)
      .send({ id: 'uvc-1', label: 'Q-SYS USB Video Bridge' });
    expect(res.status).toBe(200);
    expect(res.body.camera.selectedDevice).toEqual({ id: 'uvc-1', label: 'Q-SYS USB Video Bridge' });
    expect(store.getState().camera.selectedDevice).toEqual({ id: 'uvc-1', label: 'Q-SYS USB Video Bridge' });
  });

  it('clears the selection when id is null', async () => {
    await request(app)
      .post('/api/camera/device')
      .set('Cookie', cookies.operator)
      .send({ id: 'uvc-1', label: 'Q-SYS USB Video Bridge' });
    const res = await request(app)
      .post('/api/camera/device')
      .set('Cookie', cookies.operator)
      .send({ id: null });
    expect(res.status).toBe(200);
    expect(res.body.camera.selectedDevice).toBeNull();
  });

  it('returns 400 INVALID_MODE when label is missing', async () => {
    const res = await request(app)
      .post('/api/camera/device')
      .set('Cookie', cookies.operator)
      .send({ id: 'uvc-1' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_MODE');
  });

  it('returns 400 INVALID_MODE for empty id', async () => {
    const res = await request(app)
      .post('/api/camera/device')
      .set('Cookie', cookies.operator)
      .send({ id: '', label: 'x' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_MODE');
  });

  it('returns 400 INVALID_MODE when id is omitted entirely (not the same as explicit null)', async () => {
    const res = await request(app)
      .post('/api/camera/device')
      .set('Cookie', cookies.operator)
      .send({ label: 'x' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_MODE');
  });

  it('returns 401 without auth', async () => {
    const res = await request(app).post('/api/camera/device').send({ id: 'uvc-1', label: 'x' });
    expect(res.status).toBe(401);
  });
});

describe('POST /api/camera/permission', () => {
  let app: Express;
  let cookies: { operator: string; admin: string };
  let srv: ReturnType<typeof makeHttpServer>['server'];

  beforeEach(async () => {
    const made = makeHttpServer();
    srv = made.server;
    await srv.listen();
    app = srv.app;
    cookies = await getCookies(app);
  });

  afterEach(() => srv.close());

  it('sets permission status (200)', async () => {
    const res = await request(app)
      .post('/api/camera/permission')
      .set('Cookie', cookies.operator)
      .send({ status: 'granted' });
    expect(res.status).toBe(200);
    expect(res.body.camera.permissionStatus).toBe('granted');
  });

  it('returns 400 INVALID_MODE for unknown status', async () => {
    const res = await request(app)
      .post('/api/camera/permission')
      .set('Cookie', cookies.operator)
      .send({ status: 'maybe' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_MODE');
  });
});

describe('POST /api/camera/connection', () => {
  let app: Express;
  let cookies: { operator: string; admin: string };
  let srv: ReturnType<typeof makeHttpServer>['server'];

  beforeEach(async () => {
    const made = makeHttpServer();
    srv = made.server;
    await srv.listen();
    app = srv.app;
    cookies = await getCookies(app);
  });

  afterEach(() => srv.close());

  it('sets connected status and clears lastError', async () => {
    const res = await request(app)
      .post('/api/camera/connection')
      .set('Cookie', cookies.operator)
      .send({ status: 'connected' });
    expect(res.status).toBe(200);
    expect(res.body.camera.connectionStatus).toBe('connected');
    expect(res.body.camera.lastError).toBeNull();
  });

  it('sets error status with a message', async () => {
    const res = await request(app)
      .post('/api/camera/connection')
      .set('Cookie', cookies.operator)
      .send({ status: 'error', error: 'device unplugged' });
    expect(res.status).toBe(200);
    expect(res.body.camera.connectionStatus).toBe('error');
    expect(res.body.camera.lastError).toBe('device unplugged');
  });

  it('returns 400 INVALID_MODE when status is "error" with no message', async () => {
    const res = await request(app)
      .post('/api/camera/connection')
      .set('Cookie', cookies.operator)
      .send({ status: 'error' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_MODE');
  });

  it('returns 400 INVALID_MODE for unknown status', async () => {
    const res = await request(app)
      .post('/api/camera/connection')
      .set('Cookie', cookies.operator)
      .send({ status: 'flying' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_MODE');
  });

  it('a later non-error status clears a previous lastError', async () => {
    await request(app)
      .post('/api/camera/connection')
      .set('Cookie', cookies.operator)
      .send({ status: 'error', error: 'device unplugged' });
    const res = await request(app)
      .post('/api/camera/connection')
      .set('Cookie', cookies.operator)
      .send({ status: 'connecting' });
    expect(res.status).toBe(200);
    expect(res.body.camera.lastError).toBeNull();
  });
});

describe('POST /api/camera/output-mode', () => {
  let app: Express;
  let cookies: { operator: string; admin: string };
  let srv: ReturnType<typeof makeHttpServer>['server'];
  let store: ReturnType<typeof makeHttpServer>['store'];

  beforeEach(async () => {
    const made = makeHttpServer();
    srv = made.server;
    store = made.store;
    await srv.listen();
    app = srv.app;
    cookies = await getCookies(app);
  });

  afterEach(() => srv.close());

  it('switches to local-display with a valid display id', async () => {
    store.setState({ displays: [{ id: 'HDMI-1', name: 'HDMI-1', isPrimary: true }] });
    const res = await request(app)
      .post('/api/camera/output-mode')
      .set('Cookie', cookies.operator)
      .send({ mode: 'local-display', displayId: 'HDMI-1' });
    expect(res.status).toBe(200);
    expect(res.body.camera.outputMode).toBe('local-display');
    expect(res.body.camera.outputDisplayId).toBe('HDMI-1');
  });

  it('returns 404 DISPLAY_NOT_FOUND for an unknown display id', async () => {
    const res = await request(app)
      .post('/api/camera/output-mode')
      .set('Cookie', cookies.operator)
      .send({ mode: 'local-display', displayId: 'nope' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('DISPLAY_NOT_FOUND');
  });

  it('switching to ndi clears outputDisplayId', async () => {
    store.setState({ displays: [{ id: 'HDMI-1', name: 'HDMI-1', isPrimary: true }] });
    await request(app)
      .post('/api/camera/output-mode')
      .set('Cookie', cookies.operator)
      .send({ mode: 'local-display', displayId: 'HDMI-1' });
    const res = await request(app)
      .post('/api/camera/output-mode')
      .set('Cookie', cookies.operator)
      .send({ mode: 'ndi' });
    expect(res.status).toBe(200);
    expect(res.body.camera.outputMode).toBe('ndi');
    expect(res.body.camera.outputDisplayId).toBeNull();
  });

  it('returns 400 INVALID_MODE for an unknown mode', async () => {
    const res = await request(app)
      .post('/api/camera/output-mode')
      .set('Cookie', cookies.operator)
      .send({ mode: 'virtual-cam' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_MODE');
  });

  it('the two output modes are mutually exclusive in state', async () => {
    store.setState({ displays: [{ id: 'HDMI-1', name: 'HDMI-1', isPrimary: true }] });
    const res = await request(app)
      .post('/api/camera/output-mode')
      .set('Cookie', cookies.operator)
      .send({ mode: 'local-display', displayId: 'HDMI-1' });
    const cam = res.body.camera;
    expect(cam.outputMode === 'ndi' || cam.outputMode === 'local-display').toBe(true);
    expect(Object.keys(cam)).toContain('outputMode');
  });
});

describe('POST /api/camera/ndi', () => {
  let app: Express;
  let cookies: { operator: string; admin: string };
  let srv: ReturnType<typeof makeHttpServer>['server'];

  beforeEach(async () => {
    const made = makeHttpServer();
    srv = made.server;
    await srv.listen();
    app = srv.app;
    cookies = await getCookies(app);
  });

  afterEach(() => srv.close());

  it('sets the NDI source name (200, admin)', async () => {
    const res = await request(app)
      .post('/api/camera/ndi')
      .set('Cookie', cookies.admin)
      .send({ sourceName: 'PConAir — SF AH Stage' });
    expect(res.status).toBe(200);
    expect(res.body.camera.ndi.sourceName).toBe('PConAir — SF AH Stage');
  });

  it('trims surrounding whitespace', async () => {
    const res = await request(app)
      .post('/api/camera/ndi')
      .set('Cookie', cookies.admin)
      .send({ sourceName: '  PConAir — SF AH Stage  ' });
    expect(res.status).toBe(200);
    expect(res.body.camera.ndi.sourceName).toBe('PConAir — SF AH Stage');
  });

  it('returns 403 for operator (admin-only)', async () => {
    const res = await request(app)
      .post('/api/camera/ndi')
      .set('Cookie', cookies.operator)
      .send({ sourceName: 'PConAir — SF AH Stage' });
    expect(res.status).toBe(403);
  });

  it('returns 400 INVALID_MODE for empty sourceName', async () => {
    const res = await request(app)
      .post('/api/camera/ndi')
      .set('Cookie', cookies.admin)
      .send({ sourceName: '   ' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_MODE');
  });

  it('returns 400 INVALID_MODE for an over-length sourceName', async () => {
    const res = await request(app)
      .post('/api/camera/ndi')
      .set('Cookie', cookies.admin)
      .send({ sourceName: 'x'.repeat(101) });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_MODE');
  });
});

describe('GET /api/camera/devices and POST /api/camera/devices/refresh', () => {
  let app: Express;
  let cookies: { operator: string; admin: string };
  let srv: ReturnType<typeof makeHttpServer>['server'];

  afterEach(() => srv?.close());

  it('returns an empty list when no listDevices hook is configured', async () => {
    const made = makeHttpServer();
    srv = made.server;
    await srv.listen();
    app = srv.app;
    cookies = await getCookies(app);

    const res = await request(app).get('/api/camera/devices').set('Cookie', cookies.operator);
    expect(res.status).toBe(200);
    expect(res.body.devices).toEqual([]);
  });

  it('returns the configured device list', async () => {
    const store = createStateStore();
    const server = createFullServer({
      store,
      operatorPin: 'test1234',
      adminPin: 'adminpass8',
      operatorSessionMs: 60000,
      adminSessionMs: 60000,
      port: 0,
      listCameraDevices: () => [{ id: 'uvc-1', label: 'Q-SYS USB Video Bridge' }],
    });
    srv = server;
    await srv.listen();
    app = srv.app;
    cookies = await getCookies(app);

    const res = await request(app).get('/api/camera/devices').set('Cookie', cookies.operator);
    expect(res.status).toBe(200);
    expect(res.body.devices).toEqual([{ id: 'uvc-1', label: 'Q-SYS USB Video Bridge' }]);
  });

  it('returns 401 without auth', async () => {
    const made = makeHttpServer();
    srv = made.server;
    await srv.listen();
    app = srv.app;
    const res = await request(app).get('/api/camera/devices');
    expect(res.status).toBe(401);
  });

  it('returns 501 NOT_IMPLEMENTED for refresh when no refreshDevices hook is configured', async () => {
    const made = makeHttpServer();
    srv = made.server;
    await srv.listen();
    app = srv.app;
    cookies = await getCookies(app);

    const res = await request(app).post('/api/camera/devices/refresh').set('Cookie', cookies.operator);
    expect(res.status).toBe(501);
    expect(res.body.error.code).toBe('NOT_IMPLEMENTED');
  });

  it('forces a refresh through the configured hook and returns the result', async () => {
    const store = createStateStore();
    const refreshDevices = async () => [{ id: 'uvc-2', label: 'Forced Refresh' }];
    const server = createFullServer({
      store,
      operatorPin: 'test1234',
      adminPin: 'adminpass8',
      operatorSessionMs: 60000,
      adminSessionMs: 60000,
      port: 0,
      refreshCameraDevices: refreshDevices,
    });
    srv = server;
    await srv.listen();
    app = srv.app;
    cookies = await getCookies(app);

    const res = await request(app).post('/api/camera/devices/refresh').set('Cookie', cookies.operator);
    expect(res.status).toBe(200);
    expect(res.body.devices).toEqual([{ id: 'uvc-2', label: 'Forced Refresh' }]);
  });

  it('returns 500 PROBE_FAILED when the refresh hook rejects', async () => {
    const store = createStateStore();
    const server = createFullServer({
      store,
      operatorPin: 'test1234',
      adminPin: 'adminpass8',
      operatorSessionMs: 60000,
      adminSessionMs: 60000,
      port: 0,
      refreshCameraDevices: async () => {
        throw new Error('probe exploded');
      },
    });
    srv = server;
    await srv.listen();
    app = srv.app;
    cookies = await getCookies(app);

    const res = await request(app).post('/api/camera/devices/refresh').set('Cookie', cookies.operator);
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('PROBE_FAILED');
  });
});

describe('camera settings persistence (spec 24 Phase 1A)', () => {
  let app: Express;
  let cookies: { operator: string; admin: string };
  let srv: ReturnType<typeof makeHttpServer>['server'];
  let saveCameraSettings: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    saveCameraSettings = vi.fn();
    const store = createStateStore();
    srv = createFullServer({
      store,
      operatorPin: 'test1234',
      adminPin: 'adminpass8',
      operatorSessionMs: 60000,
      adminSessionMs: 60000,
      port: 0,
      saveCameraSettings,
    });
    await srv.listen();
    app = srv.app;
    cookies = await getCookies(app);
  });

  afterEach(() => srv.close());

  it('persists a device selection', async () => {
    await request(app)
      .post('/api/camera/device')
      .set('Cookie', cookies.operator)
      .send({ id: 'uvc-1', label: 'Q-SYS USB Video Bridge' });
    expect(saveCameraSettings).toHaveBeenCalledWith({ cameraDeviceId: 'uvc-1', cameraDeviceLabel: 'Q-SYS USB Video Bridge' });
  });

  it('persists clearing the device selection', async () => {
    await request(app).post('/api/camera/device').set('Cookie', cookies.operator).send({ id: null });
    expect(saveCameraSettings).toHaveBeenCalledWith({ cameraDeviceId: null, cameraDeviceLabel: null });
  });

  it('persists an output-mode switch to local-display', async () => {
    const store = createStateStore();
    store.setState({ displays: [{ id: 'HDMI-1', name: 'HDMI-1', isPrimary: true }] });
    // Re-point at a server built on this store so the display lookup succeeds.
    await srv.close();
    saveCameraSettings = vi.fn();
    srv = createFullServer({
      store,
      operatorPin: 'test1234',
      adminPin: 'adminpass8',
      operatorSessionMs: 60000,
      adminSessionMs: 60000,
      port: 0,
      saveCameraSettings,
    });
    await srv.listen();
    app = srv.app;
    cookies = await getCookies(app);

    await request(app)
      .post('/api/camera/output-mode')
      .set('Cookie', cookies.operator)
      .send({ mode: 'local-display', displayId: 'HDMI-1' });
    expect(saveCameraSettings).toHaveBeenCalledWith({ cameraOutputMode: 'local-display', cameraOutputDisplayId: 'HDMI-1' });
  });

  it('persists an output-mode switch to ndi', async () => {
    await request(app).post('/api/camera/output-mode').set('Cookie', cookies.operator).send({ mode: 'ndi' });
    expect(saveCameraSettings).toHaveBeenCalledWith({ cameraOutputMode: 'ndi', cameraOutputDisplayId: null });
  });

  it('persists the NDI source name', async () => {
    await request(app).post('/api/camera/ndi').set('Cookie', cookies.admin).send({ sourceName: 'PConAir — SF AH Stage' });
    expect(saveCameraSettings).toHaveBeenCalledWith({ cameraNdiSourceName: 'PConAir — SF AH Stage' });
  });

  it('never persists a /permission report', async () => {
    await request(app).post('/api/camera/permission').set('Cookie', cookies.operator).send({ status: 'granted' });
    expect(saveCameraSettings).not.toHaveBeenCalled();
  });

  it('never persists a /connection report', async () => {
    await request(app).post('/api/camera/connection').set('Cookie', cookies.operator).send({ status: 'connected' });
    expect(saveCameraSettings).not.toHaveBeenCalled();
  });
});

describe('POST /api/mode with "camera"', () => {
  let app: Express;
  let cookies: { operator: string; admin: string };
  let srv: ReturnType<typeof makeHttpServer>['server'];

  beforeEach(async () => {
    const made = makeHttpServer();
    srv = made.server;
    await srv.listen();
    app = srv.app;
    cookies = await getCookies(app);
  });

  afterEach(() => srv.close());

  it('accepts "camera" as a valid mode', async () => {
    const res = await request(app)
      .post('/api/mode')
      .set('Cookie', cookies.operator)
      .send({ mode: 'camera' });
    expect(res.status).toBe(200);
    expect(res.body.currentMode).toBe('camera');
  });

  it('switching away from camera mode does not clear camera state', async () => {
    await request(app)
      .post('/api/camera/device')
      .set('Cookie', cookies.operator)
      .send({ id: 'uvc-1', label: 'Q-SYS USB Video Bridge' });
    await request(app).post('/api/mode').set('Cookie', cookies.operator).send({ mode: 'camera' });
    await request(app).post('/api/mode').set('Cookie', cookies.operator).send({ mode: 'idle' });

    const res = await request(app).get('/api/camera').set('Cookie', cookies.operator);
    expect(res.body.camera.selectedDevice).toEqual({ id: 'uvc-1', label: 'Q-SYS USB Video Bridge' });
  });
});
