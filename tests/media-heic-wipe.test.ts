import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createStateStore } from '../src/main/state';
import { createFullServer } from './_test-server';
import { sniffBmffImageMime, sniffMediaMime, sniffVideoMime } from '../src/main/media-library/image-meta';

const AUTH = {
  operatorPin: '1234',
  adminPin: 'supersecret',
  operatorSessionMs: 3600000,
  adminSessionMs: 3600000,
};

/**
 * A real 32x32 HEIC produced by macOS `sips`, inlined so the test needs no
 * platform image tooling. Major brand `heic`, compatible brands
 * `mif1 MiPr miaf MiHB heic` — i.e. the same shape as an iPhone photo.
 */
const HEIC = Buffer.from('AAAAJGZ0eXBoZWljAAAAAG1pZjFNaVBybWlhZk1pSEJoZWljAAABhm1ldGEAAAAAAAAAIWhkbHIAAAAAAAAAAHBpY3QAAAAAAAAAAAAAAAAAAAAAJGRpbmYAAAAcZHJlZgAAAAAAAAABAAAADHVybCAAAAABAAAADnBpdG0AAAAAAAEAAAAjaWluZgAAAAAAAQAAABVpbmZlAgAAAAABAABodmMxAAAAAOZpcHJwAAAAxWlwY28AAAATY29scm5jbHgAAgACAAaAAAAADGNsbGkAywBAAAAAFGlzcGUAAAAAAAAAIAAAACAAAAAJaXJvdAAAAAAQcGl4aQAAAAADCAgIAAAAcWh2Y0MBA3AAAACwAAAAAAAe8AD8/fj4AAALA6AAAQAXQAEMAf//A3AAAAMAsAAAAwAAAwAecCShAAEAI0IBAQNwAAADALAAAAMAAAMAHqAUIEHAgwjiHuRZVNwICBgCogABAAlEAcBhcshEU2QAAAAZaXBtYQAAAAAAAAABAAEGgQIDBYaEAAAAHmlsb2MAAAAARAAAAQABAAAAAQAAAboAAABhAAAAAW1kYXQAAAAAAAAAcQAAAF0oAa+jwYBGfgQDE5YskXG/pmc/sGAf4WRapQp5kVdUh8TG5ksv3RCiKZvZdVl7c0MfN9Pg0t1LIfqPF49//0Y//4R/r0yyZ/omu2kf/mjP0ertJn2J2UZ3+FNr/8A=', 'base64');

const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

function box(type: string, payload: Buffer): Buffer {
  const size = Buffer.alloc(4);
  size.writeUInt32BE(8 + payload.length, 0);
  return Buffer.concat([size, Buffer.from(type, 'ascii'), payload]);
}
function ftypOnly(major: string, compatible: string[]): Buffer {
  return box('ftyp', Buffer.concat([
    Buffer.from(major, 'ascii'),
    Buffer.alloc(4),
    ...compatible.map((b) => Buffer.from(b, 'ascii')),
  ]));
}
const MP4 = Buffer.concat([ftypOnly('isom', ['isom', 'iso2', 'mp41']), box('mdat', Buffer.alloc(16))]);

describe('HEIC is not mistaken for video', () => {
  it('sniffs a real HEIC as an image, never as MP4', () => {
    expect(sniffBmffImageMime(HEIC)).toBe('image/heic');
    expect(sniffMediaMime(HEIC)).toBe('image/heic');
    // The regression that matters: ISO-BMFF images must not fall through to video.
    expect(sniffVideoMime(HEIC)).toBeNull();
  });

  it('still sniffs real MP4 brands as video', () => {
    expect(sniffVideoMime(MP4)).toBe('video/mp4');
    expect(sniffBmffImageMime(MP4)).toBeNull();
    expect(sniffMediaMime(MP4)).toBe('video/mp4');
  });

  it('recognises AVIF and generic HEIF brands as images', () => {
    expect(sniffBmffImageMime(ftypOnly('avif', ['avif', 'mif1']))).toBe('image/avif');
    expect(sniffBmffImageMime(ftypOnly('mif1', ['mif1']))).toBe('image/heic');
    expect(sniffBmffImageMime(ftypOnly('qt  ', ['qt  ']))).toBeNull();
  });
});

describe('HEIC upload', () => {
  let app: Express;
  let operatorCookie: string;

  beforeEach(async () => {
    const store = createStateStore();
    ({ app } = createFullServer({
      store,
      operatorPin: AUTH.operatorPin,
      adminPin: AUTH.adminPin,
      operatorSessionMs: AUTH.operatorSessionMs,
      adminSessionMs: AUTH.adminSessionMs,
    }));
    const op = await request(app).post('/auth/operator').send({ pin: '1234' });
    operatorCookie = op.headers['set-cookie'][0].split(';')[0];
  });

  it('converts HEIC to JPEG so the render page can actually display it', async () => {
    const res = await request(app)
      .post('/api/media-library/upload')
      .set('Cookie', operatorCookie)
      .attach('files[]', HEIC, 'IMG_1234.heic');
    expect(res.status).toBe(200);
    expect(res.body.imported).toBe(1);
    // Stored as JPEG — Chromium cannot decode HEIC in an <img>.
    expect(res.body.items[0].mimeType).toBe('image/jpeg');
    // The operator still sees the name they uploaded.
    expect(res.body.items[0].displayName).toBe('IMG_1234.heic');

    const dl = await request(app).get(`/api/media-library/${res.body.items[0].id}/download`);
    expect(dl.headers['content-type']).toContain('image/jpeg');
    expect(dl.body[0]).toBe(0xff);
    expect(dl.body[1]).toBe(0xd8);
  });

  it('rejects a file that claims HEIC brands but cannot be decoded, and says why', async () => {
    const fake = Buffer.concat([ftypOnly('heic', ['mif1', 'heic']), Buffer.alloc(64)]);
    const res = await request(app)
      .post('/api/media-library/upload')
      .set('Cookie', operatorCookie)
      .attach('files[]', fake, 'broken.heic');
    expect(res.status).toBe(200);
    expect(res.body.imported).toBe(0);
    expect(res.body.failed).toBe(1);
    // The operator has no console — the cause must travel in the response.
    expect(res.body.failures[0]).toContain('broken.heic');
    expect(res.body.failures[0]).toMatch(/HEIC/i);
  });

  it('explains an unrecognised file type instead of failing silently', async () => {
    const res = await request(app)
      .post('/api/media-library/upload')
      .set('Cookie', operatorCookie)
      .attach('files[]', Buffer.from('this is a text file, not media'), 'notes.txt');
    expect(res.body.failed).toBe(1);
    expect(res.body.failures[0]).toContain('notes.txt');
    expect(res.body.failures[0]).toMatch(/unrecognised file type/i);
    // Lists what IS accepted, so the operator knows what to do next.
    expect(res.body.failures[0]).toMatch(/HEIC/);
    expect(res.body.failures[0]).toMatch(/MP4/);
  });

  it('explains an empty file', async () => {
    const res = await request(app)
      .post('/api/media-library/upload')
      .set('Cookie', operatorCookie)
      .attach('files[]', Buffer.alloc(0), 'empty.png');
    expect(res.body.failed).toBe(1);
    expect(res.body.failures[0]).toMatch(/empty/i);
  });
});

describe('wiping the still store', () => {
  let app: Express;
  let operatorCookie: string;

  beforeEach(async () => {
    const store = createStateStore();
    ({ app } = createFullServer({
      store,
      operatorPin: AUTH.operatorPin,
      adminPin: AUTH.adminPin,
      operatorSessionMs: AUTH.operatorSessionMs,
      adminSessionMs: AUTH.adminSessionMs,
    }));
    const op = await request(app).post('/auth/operator').send({ pin: '1234' });
    operatorCookie = op.headers['set-cookie'][0].split(';')[0];
  });

  async function seed(count: number): Promise<string[]> {
    const ids: string[] = [];
    for (let i = 0; i < count; i += 1) {
      const r = await request(app)
        .post('/api/media-library/upload')
        .set('Cookie', operatorCookie)
        .attach('files[]', PNG_1PX, `item${i}.png`);
      ids.push(r.body.items[0].id);
    }
    return ids;
  }

  it('removes every item and reports the count', async () => {
    await seed(3);
    const res = await request(app)
      .delete('/api/media-library')
      .set('Cookie', operatorCookie)
      .send({ confirm: true });
    expect(res.status).toBe(200);
    expect(res.body.removed).toBe(3);

    const list = await request(app).get('/api/media-library').set('Cookie', operatorCookie);
    expect(list.body.items).toEqual([]);
  });

  it('refuses to wipe without explicit confirmation', async () => {
    await seed(2);
    const res = await request(app)
      .delete('/api/media-library')
      .set('Cookie', operatorCookie)
      .send({});
    expect(res.status).toBe(400);

    const list = await request(app).get('/api/media-library').set('Cookie', operatorCookie);
    expect(list.body.items).toHaveLength(2);
  });

  it('requires a session', async () => {
    await seed(1);
    const res = await request(app).delete('/api/media-library').send({ confirm: true });
    expect(res.status).toBe(401);
    const list = await request(app).get('/api/media-library').set('Cookie', operatorCookie);
    expect(list.body.items).toHaveLength(1);
  });

  it('takes the output off air and stops the slideshow', async () => {
    const ids = await seed(2);
    await request(app)
      .post('/api/media-library/slideshow')
      .set('Cookie', operatorCookie)
      .send({ action: 'play', itemIds: ids, intervalSec: 5, transition: 'cut' });

    const wipe = await request(app)
      .delete('/api/media-library')
      .set('Cookie', operatorCookie)
      .send({ confirm: true });
    expect(wipe.status).toBe(200);

    expect(wipe.body.currentMode).toBe('idle');
    expect(wipe.body.mediaLibrary).toBeNull();

    const state = await request(app).get('/api/status');
    expect(state.body.currentMode).toBe('idle');
    expect(state.body.mediaLibrary).toBeNull();
  });

  it('is a no-op on an empty store rather than an error', async () => {
    const res = await request(app)
      .delete('/api/media-library')
      .set('Cookie', operatorCookie)
      .send({ confirm: true });
    expect(res.status).toBe(200);
    expect(res.body.removed).toBe(0);
  });

  it('does not swallow a single-item delete', async () => {
    const ids = await seed(2);
    const del = await request(app)
      .delete(`/api/media-library/${ids[0]}`)
      .set('Cookie', operatorCookie);
    expect(del.status).toBe(204);
    const list = await request(app).get('/api/media-library').set('Cookie', operatorCookie);
    expect(list.body.items).toHaveLength(1);
  });
});

describe('upload failure reporting', () => {
  let app: Express;
  let operatorCookie: string;

  beforeEach(async () => {
    const store = createStateStore();
    ({ app } = createFullServer({
      store,
      operatorPin: AUTH.operatorPin,
      adminPin: AUTH.adminPin,
      operatorSessionMs: AUTH.operatorSessionMs,
      adminSessionMs: AUTH.adminSessionMs,
    }));
    const op = await request(app).post('/auth/operator').send({ pin: '1234' });
    operatorCookie = op.headers['set-cookie'][0].split(';')[0];
  });

  it('names which files were rejected, not just how many', async () => {
    const res = await request(app)
      .post('/api/media-library/upload')
      .set('Cookie', operatorCookie)
      .attach('files[]', PNG_1PX, 'good.png')
      .attach('files[]', Buffer.from('not media'), 'bad.png');
    expect(res.status).toBe(200);
    expect(res.body.imported).toBe(1);
    expect(res.body.failed).toBe(1);
    // The operator needs to know *which* file failed.
    expect(res.body.failures).toHaveLength(1);
    expect(res.body.failures[0]).toContain('bad.png');
  });

  it('reports an over-count upload with a usable message instead of a 500', async () => {
    let req = request(app).post('/api/media-library/upload').set('Cookie', operatorCookie);
    for (let i = 0; i < 26; i += 1) req = req.attach('files[]', PNG_1PX, `f${i}.png`);
    const res = await req;
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/max 25/i);
  });

  it('reports a successful import count', async () => {
    const res = await request(app)
      .post('/api/media-library/upload')
      .set('Cookie', operatorCookie)
      .attach('files[]', PNG_1PX, 'a.png')
      .attach('files[]', PNG_1PX, 'b.png');
    expect(res.status).toBe(200);
    expect(res.body.imported).toBe(2);
    expect(res.body.failed).toBe(0);
    expect(res.body.items).toHaveLength(2);
  });
});

describe('large imports across sequential batches', () => {
  let app: Express;
  let operatorCookie: string;

  beforeEach(async () => {
    const store = createStateStore();
    ({ app } = createFullServer({
      store,
      operatorPin: AUTH.operatorPin,
      adminPin: AUTH.adminPin,
      operatorSessionMs: AUTH.operatorSessionMs,
      adminSessionMs: AUTH.adminSessionMs,
    }));
    const op = await request(app).post('/auth/operator').send({ pin: '1234' });
    operatorCookie = op.headers['set-cookie'][0].split(';')[0];
  });

  /** Mirrors the client's batching: sequential requests of BATCH files each. */
  async function importInBatches(count: number, batchSize: number) {
    let imported = 0;
    const failures: string[] = [];
    for (let start = 0; start < count; start += batchSize) {
      const n = Math.min(batchSize, count - start);
      let req = request(app).post('/api/media-library/upload').set('Cookie', operatorCookie);
      for (let i = 0; i < n; i += 1) req = req.attach('files[]', PNG_1PX, `f${start + i}.png`);
      const res = await req;
      expect(res.status).toBe(200);
      imported += res.body.imported;
      failures.push(...(res.body.failures ?? []));
    }
    return { imported, failures };
  }

  it('imports 240 files — far past any single-request cap', async () => {
    const { imported, failures } = await importInBatches(240, 20);
    expect(imported).toBe(240);
    expect(failures).toEqual([]);

    const list = await request(app).get('/api/media-library').set('Cookie', operatorCookie);
    expect(list.body.items).toHaveLength(240);
  });

  it('a bad file costs only itself, not the rest of the batch or the import', async () => {
    // 20 good, one unusable in the middle of the second batch, 19 more good.
    let first = request(app).post('/api/media-library/upload').set('Cookie', operatorCookie);
    for (let i = 0; i < 20; i += 1) first = first.attach('files[]', PNG_1PX, `a${i}.png`);
    expect((await first).body.imported).toBe(20);

    let second = request(app).post('/api/media-library/upload').set('Cookie', operatorCookie);
    for (let i = 0; i < 10; i += 1) second = second.attach('files[]', PNG_1PX, `b${i}.png`);
    second = second.attach('files[]', Buffer.from('junk'), 'corrupt.png');
    for (let i = 10; i < 19; i += 1) second = second.attach('files[]', PNG_1PX, `b${i}.png`);
    const res2 = await second;
    expect(res2.body.imported).toBe(19);
    expect(res2.body.failed).toBe(1);
    expect(res2.body.failures[0]).toContain('corrupt.png');

    const list = await request(app).get('/api/media-library').set('Cookie', operatorCookie);
    expect(list.body.items).toHaveLength(39);
  });

  it('keeps the per-request cap as a backstop', async () => {
    let req = request(app).post('/api/media-library/upload').set('Cookie', operatorCookie);
    for (let i = 0; i < 26; i += 1) req = req.attach('files[]', PNG_1PX, `f${i}.png`);
    const res = await req;
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_MODE');
  });
});
