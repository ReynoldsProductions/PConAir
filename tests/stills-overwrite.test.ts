import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { Express } from 'express';
import { createStateStore } from '../src/main/state';
import { createMediaLibraryStore } from '../src/main/media-library/item-store';
import { createFullServer } from './_test-server';

const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);
// Visibly different second image (16x16) so replacement is detectable by size.
const PNG_16 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAN0lEQVR4nGNgoBaQkpL6TwqmSDOGIYPbgKeWpuQZANKIjulnADbN2AwZxF6gSizQNyFRnJkoAQCmlBdhZhfnBgAAAABJRU5ErkJggg==',
  'base64'
);

describe('re-uploading a name replaces rather than duplicates', () => {
  let app: Express;
  let cookie: string;

  beforeEach(async () => {
    const store = createStateStore();
    ({ app } = createFullServer({
      store, operatorPin: '1234', adminPin: 'supersecret',
      operatorSessionMs: 3600000, adminSessionMs: 3600000,
    }));
    const op = await request(app).post('/auth/operator').send({ pin: '1234' });
    cookie = op.headers['set-cookie'][0].split(';')[0];
  });

  const put = (buf: Buffer, name: string) =>
    request(app).post('/api/media-library/upload').set('Cookie', cookie).attach('files[]', buf, name);

  const list = async () =>
    (await request(app).get('/api/media-library').set('Cookie', cookie)).body.items;

  it('does not create a second entry for the same filename', async () => {
    await put(PNG_1PX, 'logo.png');
    await put(PNG_16, 'logo.png');
    const items = await list();
    expect(items).toHaveLength(1);
  });

  it('keeps the same id, so slideshow selections stay valid', async () => {
    const first = await put(PNG_1PX, 'logo.png');
    const idBefore = first.body.items[0].id;
    const second = await put(PNG_16, 'logo.png');
    expect(second.body.items[0].id).toBe(idBefore);
  });

  it('actually serves the new bytes', async () => {
    await put(PNG_1PX, 'logo.png');
    const replaced = await put(PNG_16, 'logo.png');
    const id = replaced.body.items[0].id;
    const dl = await request(app).get(`/api/media-library/${id}/download`);
    expect(dl.body.length).toBe(PNG_16.length);
    expect(dl.body.length).not.toBe(PNG_1PX.length);
  });

  it('bumps updatedAt so caches and the render key change', async () => {
    const first = await put(PNG_1PX, 'logo.png');
    const before = (await list())[0];
    await new Promise((r) => setTimeout(r, 5));
    await put(PNG_16, 'logo.png');
    const after = (await list())[0];
    expect(after.id).toBe(first.body.items[0].id);
    expect(after.updatedAt).toBeGreaterThan(before.updatedAt);
    // Original gallery position is preserved.
    expect(after.uploadedAt).toBe(before.uploadedAt);
  });

  it('refreshes what is on air, including the version the render page keys on', async () => {
    const first = await put(PNG_1PX, 'logo.png');
    const id = first.body.items[0].id;
    const take = await request(app).post('/api/media-library/take')
      .set('Cookie', cookie).send({ itemId: id });
    const v1 = take.body.mediaLibrary.activeItemVersion;
    expect(typeof v1).toBe('number');

    await new Promise((r) => setTimeout(r, 5));
    await put(PNG_16, 'logo.png');
    const retake = await request(app).post('/api/media-library/take')
      .set('Cookie', cookie).send({ itemId: id });
    expect(retake.body.mediaLibrary.activeItemVersion).toBeGreaterThan(v1);
  });

  it('leaves different filenames alone', async () => {
    await put(PNG_1PX, 'one.png');
    await put(PNG_1PX, 'two.png');
    expect(await list()).toHaveLength(2);
  });

  it('does not leave the old file behind when the format changes', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pconair-ow-'));
    try {
      const media = createMediaLibraryStore({ rootDir: dir });
      const a = media.ingestBuffer('shot.png', PNG_1PX)!;
      const oldPath = path.join(dir, a.relativePath);
      expect(fs.existsSync(oldPath)).toBe(true);

      // Same base name, different stored extension.
      const b = media.ingestBuffer('shot.png', PNG_16)!;
      expect(b.id).toBe(a.id);
      expect(media.list()).toHaveLength(1);
      // Exactly one file on disk for this item.
      const files = fs.readdirSync(path.join(dir, 'files'));
      expect(files).toHaveLength(1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('a mixed folder reports exactly what it rejected', () => {
  let app: Express;
  let cookie: string;

  beforeEach(async () => {
    const store = createStateStore();
    ({ app } = createFullServer({
      store, operatorPin: '1234', adminPin: 'supersecret',
      operatorSessionMs: 3600000, adminSessionMs: 3600000,
    }));
    const op = await request(app).post('/auth/operator').send({ pin: '1234' });
    cookie = op.headers['set-cookie'][0].split(';')[0];
  });

  // With the picker's accept filter removed, sidecar files from a camera export
  // now reach the server and must be reported rather than silently dropped.
  it('imports the images and names the sidecars it skipped', async () => {
    let req = request(app).post('/api/media-library/upload').set('Cookie', cookie);
    for (let i = 0; i < 12; i += 1) req = req.attach('files[]', PNG_1PX, `IMG_${i}.png`);
    // Photos-style sidecars: real bytes, but not media.
    for (let i = 0; i < 6; i += 1) {
      req = req.attach('files[]', Buffer.from('adjustment data'), `IMG_${i}.AAE`);
    }
    const res = await req;
    expect(res.status).toBe(200);
    expect(res.body.imported).toBe(12);
    expect(res.body.failed).toBe(6);
    expect(res.body.failures).toHaveLength(6);
    // Every rejection names its file and a reason the operator can act on.
    for (const f of res.body.failures) {
      expect(f).toMatch(/IMG_\d\.AAE/);
      expect(f).toMatch(/unrecognised file type/i);
    }
    // And the library holds only the real images.
    const list = await request(app).get('/api/media-library').set('Cookie', cookie);
    expect(list.body.items).toHaveLength(12);
  });
});
