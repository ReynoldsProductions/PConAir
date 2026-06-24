import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createStateStore } from '../src/main/state';
import type { StateStore } from '../src/main/state';
import { createFullServer } from './_test-server';
import { fairel3sStyleToCss } from '../src/main/l3/fairel3s-theme-convert';
import { FAIREL3S_STYLES } from '../src/main/l3/fairel3s-styles-data';

const PINS = { operatorPin: '1234', adminPin: 'supersecret' };

describe('fairel3sStyleToCss', () => {
  it('converts the default Faire style with correct geometry', () => {
    const entry = FAIREL3S_STYLES.find((s) => s.name === 'faire-default')!;
    const css = fairel3sStyleToCss(entry.style);
    expect(css).toContain('left: 96px');
    expect(css).toContain('bottom: 96px');
    expect(css).toContain('width: 861px');
    expect(css).toContain('height: 169px');
    expect(css).toContain('font-size: 52px'); // name
    expect(css).toContain('font-size: 32px'); // title
    expect(css).toContain('.lower-third::before'); // accent bar
    // text x = padding_left(24) + bar.width(5) + gap(16) = 45
    expect(css).toContain('left: 45px');
  });

  it('converts all 13 bundled styles without throwing', () => {
    expect(FAIREL3S_STYLES.length).toBe(13);
    for (const { style } of FAIREL3S_STYLES) {
      const css = fairel3sStyleToCss(style);
      expect(css).toContain('.lower-third');
      expect(css).toContain('.name');
    }
  });
});

describe('bundled Faire themes in the theme store', () => {
  let app: Express;
  let cookie: string;

  beforeEach(async () => {
    const store: StateStore = createStateStore();
    ({ app } = createFullServer({ store, ...PINS }));
    const login = await request(app).post('/auth/operator').send({ pin: PINS.operatorPin });
    cookie = login.headers['set-cookie'][0].split(';')[0];
  });

  it('GET /api/l3/themes lists default + 13 Faire built-ins', async () => {
    const res = await request(app).get('/api/l3/themes').set('Cookie', cookie);
    expect(res.status).toBe(200);
    const names = (res.body.themes as Array<{ name: string; isBuiltIn: boolean }>).filter((t) => t.isBuiltIn).map((t) => t.name);
    expect(names).toContain('default');
    expect(names).toContain('faire-default');
    expect(names).toContain('faire-dark');
    expect(names).toContain('faire-palette-teal');
    expect(names.length).toBe(14);
  });
});

describe('playlist next/prev stepping', () => {
  let app: Express;
  let store: StateStore;
  let opCookie: string;
  let adCookie: string;
  let cueIds: string[];

  beforeEach(async () => {
    store = createStateStore();
    ({ app } = createFullServer({ store, ...PINS }));
    const op = await request(app).post('/auth/operator').send({ pin: PINS.operatorPin });
    opCookie = op.headers['set-cookie'][0].split(';')[0];
    const ad = await request(app).post('/auth/admin').send({ pin: PINS.adminPin });
    adCookie = ad.headers['set-cookie'][0].split(';')[0];

    cueIds = [];
    for (const name of ['Alice', 'Bob', 'Carol']) {
      const res = await request(app)
        .post('/api/l3/cues')
        .set('Cookie', adCookie)
        .send({ name, title: `${name} title`, theme: 'default' });
      cueIds.push(res.body.id ?? res.body.cue?.id);
    }
    const pl = await request(app)
      .post('/api/l3/playlists')
      .set('Cookie', adCookie)
      .send({ name: 'Show order', cueIds });
    const playlistId = pl.body.id ?? pl.body.playlist?.id;
    await request(app).post(`/api/l3/playlists/${playlistId}/activate`).set('Cookie', adCookie);
  });

  it('next steps through the playlist and wraps', async () => {
    let res = await request(app).post('/api/l3/playlists/next').set('Cookie', opCookie);
    expect(res.status).toBe(200);
    expect(store.getState().l3?.activeCueId).toBe(cueIds[0]);
    expect(res.body.playlistPosition).toBe(1);
    expect(res.body.playlistLength).toBe(3);

    await request(app).post('/api/l3/playlists/next').set('Cookie', opCookie);
    await request(app).post('/api/l3/playlists/next').set('Cookie', opCookie);
    expect(store.getState().l3?.activeCueId).toBe(cueIds[2]);

    res = await request(app).post('/api/l3/playlists/next').set('Cookie', opCookie);
    expect(store.getState().l3?.activeCueId).toBe(cueIds[0]); // wrapped
  });

  it('prev from nothing takes the last cue', async () => {
    const res = await request(app).post('/api/l3/playlists/prev').set('Cookie', opCookie);
    expect(res.status).toBe(200);
    expect(store.getState().l3?.activeCueId).toBe(cueIds[2]);
  });

  it('errors when no playlist is active', async () => {
    store.setState({ l3: null });
    const res = await request(app).post('/api/l3/playlists/next').set('Cookie', opCookie);
    expect(res.status).toBe(400);
  });
});
