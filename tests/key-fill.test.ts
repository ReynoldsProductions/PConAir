/**
 * Unit tests for the key/fill dual-output display mode.
 *
 * These tests cover:
 *   - URL validation (http/https accepted; ftp/empty/null rejected)
 *   - Window option shapes (session partition, background color, frame)
 *   - That the session partition is always `persist:keyfill`
 *   - HTTP route behavior (validation errors, 503 when hooks absent, 200 on success)
 *
 * No Electron runtime required — BrowserWindow/screen/session are not invoked
 * here. Route-level tests use the full Express test server.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { validateKeyFillUrl, KEY_FILL_SESSION_PARTITION } from '../src/main/services/key-fill';
import { createStateStore } from '../src/main/state';
import { createFullServer } from './_test-server';

// ---------------------------------------------------------------------------
// Unit: URL validation
// ---------------------------------------------------------------------------

describe('validateKeyFillUrl', () => {
  it('accepts http:// URLs', () => {
    expect(validateKeyFillUrl('http://example.com')).toBeNull();
    expect(validateKeyFillUrl('http://192.168.1.1:8080/path')).toBeNull();
  });

  it('accepts https:// URLs', () => {
    expect(validateKeyFillUrl('https://example.com')).toBeNull();
    expect(validateKeyFillUrl('https://sub.domain.co/path?q=1')).toBeNull();
  });

  it('rejects ftp:// scheme', () => {
    expect(validateKeyFillUrl('ftp://files.example.com')).not.toBeNull();
  });

  it('rejects empty string', () => {
    expect(validateKeyFillUrl('')).not.toBeNull();
  });

  it('rejects null', () => {
    expect(validateKeyFillUrl(null)).not.toBeNull();
  });

  it('rejects undefined', () => {
    expect(validateKeyFillUrl(undefined)).not.toBeNull();
  });

  it('rejects bare domain without scheme', () => {
    expect(validateKeyFillUrl('example.com')).not.toBeNull();
  });

  it('rejects data: URLs', () => {
    expect(validateKeyFillUrl('data:text/html,<h1>hello</h1>')).not.toBeNull();
  });

  it('rejects file:// URLs', () => {
    expect(validateKeyFillUrl('file:///etc/hosts')).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Unit: session partition constant
// ---------------------------------------------------------------------------

describe('KEY_FILL_SESSION_PARTITION', () => {
  it('is persist:keyfill (not a google or url partition)', () => {
    expect(KEY_FILL_SESSION_PARTITION).toBe('persist:keyfill');
    expect(KEY_FILL_SESSION_PARTITION).not.toContain('google');
    expect(KEY_FILL_SESSION_PARTITION).not.toBe('persist:google-slides');
  });
});

// ---------------------------------------------------------------------------
// Integration: HTTP routes via gsc-compat router
// ---------------------------------------------------------------------------

function makeServer(keyFillHooks?: {
  openKeyFillDisplays?: (opts: {
    fillUrl: string;
    keyUrl: string;
    fillBgColor: string;
    keyBgColor: string;
  }) => Promise<void>;
  closeKeyFillDisplays?: () => void;
}) {
  const store = createStateStore();
  const server = createFullServer({
    store,
    operatorPin: 'test1234',
    adminPin: 'testadmin8',
    operatorSessionMs: 60000,
    adminSessionMs: 60000,
    port: 0,
    openKeyFillDisplays: keyFillHooks?.openKeyFillDisplays,
    closeKeyFillDisplays: keyFillHooks?.closeKeyFillDisplays,
  });
  return { server, store };
}

describe('POST /api/open-key-fill (no Electron hooks — 503)', () => {
  let app: Express;
  let server: ReturnType<typeof makeServer>['server'];

  beforeEach(async () => {
    const made = makeServer();
    server = made.server;
    await server.listen();
    app = server.app;
  });

  afterEach(() => server.close());

  it('returns 400 when fillUrl is missing', async () => {
    const res = await request(app)
      .post('/api/open-key-fill')
      .send({ keyUrl: 'https://example.com/key' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/fillUrl/);
  });

  it('returns 400 when keyUrl is missing', async () => {
    const res = await request(app)
      .post('/api/open-key-fill')
      .send({ fillUrl: 'https://example.com/fill' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/keyUrl/);
  });

  it('returns 400 when fillUrl is ftp://', async () => {
    const res = await request(app)
      .post('/api/open-key-fill')
      .send({ fillUrl: 'ftp://bad.url', keyUrl: 'https://example.com/key' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/fillUrl/);
  });

  it('returns 400 when keyUrl is ftp://', async () => {
    const res = await request(app)
      .post('/api/open-key-fill')
      .send({ fillUrl: 'https://example.com/fill', keyUrl: 'ftp://bad.url' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/keyUrl/);
  });

  it('returns 503 when valid URLs provided but Electron hooks are absent', async () => {
    const res = await request(app)
      .post('/api/open-key-fill')
      .send({ fillUrl: 'https://fill.example.com', keyUrl: 'https://key.example.com' });
    expect(res.status).toBe(503);
    expect(res.body.error).toBeTruthy();
  });
});

describe('POST /api/open-key-fill (with Electron hooks wired)', () => {
  let app: Express;
  let server: ReturnType<typeof makeServer>['server'];
  let openKeyFillCalls: Array<{
    fillUrl: string;
    keyUrl: string;
    fillBgColor: string;
    keyBgColor: string;
  }>;
  let closeKeyFillCalls: number;

  beforeEach(async () => {
    openKeyFillCalls = [];
    closeKeyFillCalls = 0;

    const made = makeServer({
      openKeyFillDisplays: async (opts) => {
        openKeyFillCalls.push(opts);
      },
      closeKeyFillDisplays: () => {
        closeKeyFillCalls++;
      },
    });
    server = made.server;
    await server.listen();
    app = server.app;
  });

  afterEach(() => server.close());

  it('calls openKeyFillDisplays and returns 200 with valid URLs', async () => {
    const res = await request(app)
      .post('/api/open-key-fill')
      .send({
        fillUrl: 'https://fill.example.com/color',
        keyUrl: 'https://key.example.com/luma',
      });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(openKeyFillCalls).toHaveLength(1);
    expect(openKeyFillCalls[0].fillUrl).toBe('https://fill.example.com/color');
    expect(openKeyFillCalls[0].keyUrl).toBe('https://key.example.com/luma');
  });

  it('passes bg colors through and defaults invalid ones to #000000', async () => {
    const res = await request(app)
      .post('/api/open-key-fill')
      .send({
        fillUrl: 'https://fill.example.com',
        keyUrl: 'https://key.example.com',
        fillBgColor: '#FF0000',
        keyBgColor: 'not-a-color',
      });
    expect(res.status).toBe(200);
    expect(openKeyFillCalls[0].fillBgColor).toBe('#FF0000');
    expect(openKeyFillCalls[0].keyBgColor).toBe('#000000');
  });

  it('accepts http:// URLs', async () => {
    const res = await request(app)
      .post('/api/open-key-fill')
      .send({
        fillUrl: 'http://intranet.local/fill',
        keyUrl: 'http://intranet.local/key',
      });
    expect(res.status).toBe(200);
    expect(openKeyFillCalls).toHaveLength(1);
  });
});

describe('POST /api/close-key-fill', () => {
  let app: Express;
  let server: ReturnType<typeof makeServer>['server'];
  let closeKeyFillCalls: number;

  beforeEach(async () => {
    closeKeyFillCalls = 0;

    const made = makeServer({
      openKeyFillDisplays: async () => {},
      closeKeyFillDisplays: () => {
        closeKeyFillCalls++;
      },
    });
    server = made.server;
    await server.listen();
    app = server.app;
  });

  afterEach(() => server.close());

  it('returns 200 and calls closeKeyFillDisplays', async () => {
    const res = await request(app).post('/api/close-key-fill').send({});
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(closeKeyFillCalls).toBe(1);
  });

  it('returns 200 even when no hooks are wired (graceful no-op)', async () => {
    // Make a server without hooks
    const { server: s2 } = makeServer();
    await s2.listen();
    const res = await request(s2.app).post('/api/close-key-fill').send({});
    expect(res.status).toBe(200);
    await s2.close();
  });
});
