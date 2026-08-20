import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createStateStore } from '../src/main/state';
import { createFullServer } from './_test-server';

const AUTH_CONFIG = {
  operatorPin: '1234',
  adminPin: 'supersecret',
  operatorSessionMs: 3600000,
  adminSessionMs: 3600000,
};

describe('GET /admin/ login page', () => {
  let app: Express;

  beforeEach(() => {
    const store = createStateStore();
    ({ app } = createFullServer({
      store,
      operatorPin: AUTH_CONFIG.operatorPin,
      adminPin: AUTH_CONFIG.adminPin,
      operatorSessionMs: AUTH_CONFIG.operatorSessionMs,
      adminSessionMs: AUTH_CONFIG.adminSessionMs,
    }));
  });

  it('serves the login form to a browser navigation that sends Sec-Fetch-Dest', async () => {
    const res = await request(app)
      .get('/admin/')
      .set('Sec-Fetch-Dest', 'document')
      .set('Accept', 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8');
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.text).toContain('/auth/admin/browser');
  });

  // Browsers omit Sec-Fetch-* on non-"potentially trustworthy" origins, i.e. plain
  // http:// to a LAN IP. The navigation must still get the HTML login form.
  it('serves the login form to a browser navigation over http://<LAN-IP> (no Sec-Fetch-Dest)', async () => {
    const res = await request(app)
      .get('/admin/')
      .set('Accept', 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8')
      .set('User-Agent', 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/126 Safari/537.36');
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.text).toContain('/auth/admin/browser');
  });

  it('still returns a JSON error to a genuine API client', async () => {
    const res = await request(app).get('/admin/').set('Accept', 'application/json');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTH_REQUIRED');
  });
});
