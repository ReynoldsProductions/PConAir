import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createStateStore } from '../src/main/state';
import { createFullServer } from './_test-server';
import { isVideoMime, mp4DurationMs, sniffMediaMime, sniffVideoMime } from '../src/main/media-library/image-meta';

const AUTH = {
  operatorPin: '1234',
  adminPin: 'supersecret',
  operatorSessionMs: 3600000,
  adminSessionMs: 3600000,
};

function box(type: string, payload: Buffer): Buffer {
  const size = Buffer.alloc(4);
  size.writeUInt32BE(8 + payload.length, 0);
  return Buffer.concat([size, Buffer.from(type, 'ascii'), payload]);
}

/** Minimal ISO-BMFF file: ftyp + moov>mvhd (v0) + mdat. */
function makeMp4(brand: string, timescale: number, duration: number): Buffer {
  const ftyp = box('ftyp', Buffer.concat([Buffer.from(brand, 'ascii'), Buffer.alloc(4), Buffer.from(brand, 'ascii')]));
  const mvhdPayload = Buffer.concat([
    Buffer.alloc(4), // version 0 + flags
    Buffer.alloc(4), // creation
    Buffer.alloc(4), // modification
    (() => { const b = Buffer.alloc(4); b.writeUInt32BE(timescale, 0); return b; })(),
    (() => { const b = Buffer.alloc(4); b.writeUInt32BE(duration, 0); return b; })(),
    Buffer.alloc(80), // rate/volume/matrix/predefined/next-track
  ]);
  const moov = box('moov', box('mvhd', mvhdPayload));
  return Buffer.concat([ftyp, moov, box('mdat', Buffer.alloc(64))]);
}

const MP4 = makeMp4('isom', 1000, 2500); // 2.5s
const MOV = makeMp4('qt  ', 600, 1200); // 2.0s
const WEBM = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(64)]);
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

describe('video magic-byte sniffing', () => {
  it('identifies MP4, QuickTime and WebM', () => {
    expect(sniffVideoMime(MP4)).toBe('video/mp4');
    expect(sniffVideoMime(MOV)).toBe('video/quicktime');
    expect(sniffVideoMime(WEBM)).toBe('video/webm');
  });

  it('does not claim images or junk as video', () => {
    expect(sniffVideoMime(PNG_1PX)).toBeNull();
    expect(sniffVideoMime(Buffer.from('not media at all'))).toBeNull();
  });

  it('keeps image sniffing working through the combined sniffer', () => {
    expect(sniffMediaMime(PNG_1PX)).toBe('image/png');
    expect(sniffMediaMime(MP4)).toBe('video/mp4');
    expect(sniffMediaMime(Buffer.from('junk'))).toBeNull();
  });

  it('classifies video mimes', () => {
    expect(isVideoMime('video/mp4')).toBe(true);
    expect(isVideoMime('image/png')).toBe(false);
  });
});

describe('mp4 duration parsing', () => {
  it('reads duration from an mvhd timescale', () => {
    expect(mp4DurationMs(MP4)).toBe(2500);
    expect(mp4DurationMs(MOV)).toBe(2000);
  });

  it('returns null when duration cannot be determined', () => {
    expect(mp4DurationMs(WEBM)).toBeNull();
    expect(mp4DurationMs(PNG_1PX)).toBeNull();
    // Fragmented MP4s report zero in mvhd
    expect(mp4DurationMs(makeMp4('isom', 1000, 0))).toBeNull();
  });
});

describe('video upload through the media library', () => {
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

  it('imports an MP4 and records its mime and duration', async () => {
    const res = await request(app)
      .post('/api/media-library/upload')
      .set('Cookie', operatorCookie)
      .attach('files[]', MP4, 'clip.mp4');
    expect(res.status).toBe(200);
    expect(res.body.imported).toBe(1);
    expect(res.body.items[0].mimeType).toBe('video/mp4');

    const list = await request(app).get('/api/media-library').set('Cookie', operatorCookie);
    expect(list.body.items[0].mimeType).toBe('video/mp4');
    expect(list.body.items[0].durationMs).toBe(2500);
  });

  it('still rejects non-media files', async () => {
    const res = await request(app)
      .post('/api/media-library/upload')
      .set('Cookie', operatorCookie)
      .attach('files[]', Buffer.from('definitely not media'), 'evil.mp4');
    expect(res.status).toBe(200);
    expect(res.body.imported).toBe(0);
    expect(res.body.failed).toBe(1);
  });

  it('serves video inline so <video> plays it, and images as attachments', async () => {
    const vid = await request(app)
      .post('/api/media-library/upload')
      .set('Cookie', operatorCookie)
      .attach('files[]', MP4, 'clip.mp4');
    const dl = await request(app).get(`/api/media-library/${vid.body.items[0].id}/download`);
    expect(dl.headers['content-type']).toContain('video/mp4');
    expect(dl.headers['content-disposition']).toContain('inline');

    const png = await request(app)
      .post('/api/media-library/upload')
      .set('Cookie', operatorCookie)
      .attach('files[]', PNG_1PX, 'a.png');
    const pdl = await request(app).get(`/api/media-library/${png.body.items[0].id}/download`);
    expect(pdl.headers['content-disposition']).toContain('attachment');
  });

  it('exposes mime and duration on state when a video is taken', async () => {
    const up = await request(app)
      .post('/api/media-library/upload')
      .set('Cookie', operatorCookie)
      .attach('files[]', MP4, 'clip.mp4');
    const id = up.body.items[0].id;
    const take = await request(app)
      .post('/api/media-library/take')
      .set('Cookie', operatorCookie)
      .send({ itemId: id });
    expect(take.status).toBe(200);
    expect(take.body.mediaLibrary.activeItemMime).toBe('video/mp4');
    expect(take.body.mediaLibrary.activeItemDurationMs).toBe(2500);
  });
});
