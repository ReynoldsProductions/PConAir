import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';
import { createStateStore } from '../src/main/state';
import { createFullServer } from './_test-server';

const AUTH = {
  operatorPin: '1234',
  adminPin: 'supersecret',
  operatorSessionMs: 3600000,
  adminSessionMs: 3600000,
};

/** Minimal valid 1×1 PNG */
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

describe('Media Library API', () => {
  let app: Express;
  let operatorCookie: string;
  let adminCookie: string;

  beforeEach(async () => {
    const store = createStateStore();
    const mlRoot = path.join(os.tmpdir(), `pconair-ml-${randomUUID()}`);
    fs.mkdirSync(mlRoot, { recursive: true });
    ({ app } = createFullServer({
      store,
      operatorPin: AUTH.operatorPin,
      adminPin: AUTH.adminPin,
      operatorSessionMs: AUTH.operatorSessionMs,
      adminSessionMs: AUTH.adminSessionMs,
      mediaLibraryRoot: mlRoot,
    }));

    const op = await request(app).post('/auth/operator').send({ pin: '1234' });
    operatorCookie = op.headers['set-cookie'][0].split(';')[0];
    const ad = await request(app).post('/auth/admin').send({ pin: 'supersecret' });
    adminCookie = ad.headers['set-cookie'][0].split(';')[0];
  });

  it('GET /api/media-library returns 401 without auth', async () => {
    const res = await request(app).get('/api/media-library');
    expect(res.status).toBe(401);
  });

  it('GET /api/media-library returns empty list', async () => {
    const res = await request(app).get('/api/media-library').set('Cookie', operatorCookie);
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
  });

  it('POST /api/media-library/upload returns 401 for operator', async () => {
    const res = await request(app)
      .post('/api/media-library/upload')
      .set('Cookie', operatorCookie)
      .attach('files[]', PNG_1PX, 'a.png');
    expect(res.status).toBe(401);
  });

  it('POST /api/media-library/upload imports PNG as admin', async () => {
    const res = await request(app)
      .post('/api/media-library/upload')
      .set('Cookie', adminCookie)
      .attach('files[]', PNG_1PX, 'chart.png');
    expect(res.status).toBe(200);
    expect(res.body.imported).toBe(1);
    expect(res.body.failed).toBe(0);
    expect(res.body.items[0]).toMatchObject({
      displayName: 'chart.png',
      mimeType: 'image/png',
    });
    const id = res.body.items[0].id as string;

    const list = await request(app).get('/api/media-library').set('Cookie', operatorCookie);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0].id).toBe(id);
  });

  it('POST /api/media-library/take sets media-library mode', async () => {
    const up = await request(app)
      .post('/api/media-library/upload')
      .set('Cookie', adminCookie)
      .attach('files', PNG_1PX, 'x.png');
    const id = up.body.items[0].id as string;

    const res = await request(app)
      .post('/api/media-library/take')
      .set('Cookie', operatorCookie)
      .send({ itemId: id });
    expect(res.status).toBe(200);
    expect(res.body.currentMode).toBe('media-library');
    expect(res.body.mediaLibrary.activeItemId).toBe(id);

    const st = await request(app).get('/api/status').set('Cookie', operatorCookie);
    expect(st.body.currentMode).toBe('media-library');
    expect(st.body.l3).toBeNull();
    expect(st.body.mediaLibrary?.activeItemId).toBe(id);
  });

  it('POST /api/media-library/take returns 404 for unknown id', async () => {
    const res = await request(app)
      .post('/api/media-library/take')
      .set('Cookie', operatorCookie)
      .send({ itemId: randomUUID() });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('ITEM_NOT_FOUND');
  });

  it('POST /api/media-library/clear returns to idle', async () => {
    const up = await request(app)
      .post('/api/media-library/upload')
      .set('Cookie', adminCookie)
      .attach('files[]', PNG_1PX, 'c.png');
    const id = up.body.items[0].id as string;
    await request(app).post('/api/media-library/take').set('Cookie', operatorCookie).send({ itemId: id });

    const res = await request(app).post('/api/media-library/clear').set('Cookie', operatorCookie);
    expect(res.status).toBe(200);
    expect(res.body.currentMode).toBe('idle');
    const st = await request(app).get('/api/status').set('Cookie', operatorCookie);
    expect(st.body.mediaLibrary).toBeNull();
  });

  it('DELETE /api/media-library/:id removes item and clears output if active', async () => {
    const up = await request(app)
      .post('/api/media-library/upload')
      .set('Cookie', adminCookie)
      .attach('files[]', PNG_1PX, 'd.png');
    const id = up.body.items[0].id as string;
    await request(app).post('/api/media-library/take').set('Cookie', operatorCookie).send({ itemId: id });

    const del = await request(app).delete(`/api/media-library/${id}`).set('Cookie', adminCookie);
    expect(del.status).toBe(204);

    const list = await request(app).get('/api/media-library').set('Cookie', operatorCookie);
    expect(list.body.items).toHaveLength(0);
    const st = await request(app).get('/api/status').set('Cookie', operatorCookie);
    expect(st.body.currentMode).toBe('idle');
  });

  it('GET /api/media-library/:id/download returns bytes', async () => {
    const up = await request(app)
      .post('/api/media-library/upload')
      .set('Cookie', adminCookie)
      .attach('files[]', PNG_1PX, 'e.png');
    const id = up.body.items[0].id as string;

    const res = await request(app).get(`/api/media-library/${id}/download`).set('Cookie', operatorCookie).buffer(true);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('image/png');
    expect(Buffer.isBuffer(res.body)).toBe(true);
    expect((res.body as Buffer).length).toBeGreaterThan(0);
  });

  it('POST /api/mode clears mediaLibrary when leaving media-library mode', async () => {
    const up = await request(app)
      .post('/api/media-library/upload')
      .set('Cookie', adminCookie)
      .attach('files[]', PNG_1PX, 'f.png');
    const id = up.body.items[0].id as string;
    await request(app).post('/api/media-library/take').set('Cookie', operatorCookie).send({ itemId: id });

    await request(app).post('/api/mode').set('Cookie', operatorCookie).send({ mode: 'url' });
    const st = await request(app).get('/api/status').set('Cookie', operatorCookie);
    expect(st.body.currentMode).toBe('url');
    expect(st.body.mediaLibrary).toBeNull();
  });
});
