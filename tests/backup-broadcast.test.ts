/**
 * tests/backup-broadcast.test.ts
 *
 * Unit tests for broadcastToBackups and integration tests for the
 * set-backup-controls endpoint and slide-route fan-out behaviour.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createStateStore } from '../src/main/state';
import { createFullServer } from './_test-server';
import { broadcastToBackups } from '../src/main/services/backup-broadcast';

// ---------------------------------------------------------------------------
// Unit tests — broadcastToBackups
// ---------------------------------------------------------------------------

describe('broadcastToBackups — unit', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does nothing when backupIps is empty', async () => {
    const log = vi.fn();
    await broadcastToBackups([], '/api/slides/next', {}, log);
    expect(fetch).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });

  it('POSTs to each IP in parallel with the correct path and body', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', mockFetch);
    const log = vi.fn();

    await broadcastToBackups(
      ['192.168.1.10', '192.168.1.11'],
      '/api/slides/next',
      { foo: 'bar' },
      log,
    );

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch).toHaveBeenCalledWith('http://192.168.1.10/api/slides/next', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ foo: 'bar' }),
      signal: expect.any(AbortSignal),
    });
    expect(mockFetch).toHaveBeenCalledWith('http://192.168.1.11/api/slides/next', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ foo: 'bar' }),
      signal: expect.any(AbortSignal),
    });
  });

  it('catches a network error and logs — does not throw', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    vi.stubGlobal('fetch', mockFetch);
    const log = vi.fn();

    await expect(
      broadcastToBackups(['192.168.1.10'], '/api/slides/next', {}, log),
    ).resolves.toBeUndefined();

    expect(log).toHaveBeenCalledOnce();
    expect(log.mock.calls[0][0]).toMatch(/Failed to send.*ECONNREFUSED/);
  });

  it('handles an AbortError (timeout) gracefully — does not throw', async () => {
    const abortErr = Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
    const mockFetch = vi.fn().mockRejectedValue(abortErr);
    vi.stubGlobal('fetch', mockFetch);
    const log = vi.fn();

    await expect(
      broadcastToBackups(['192.168.1.10'], '/api/slides/goto', { slideIndex: 3 }, log),
    ).resolves.toBeUndefined();

    expect(log).toHaveBeenCalledOnce();
    expect(log.mock.calls[0][0]).toMatch(/Timeout/);
  });

  it('continues sending to remaining IPs when one rejects', async () => {
    let callCount = 0;
    const mockFetch = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) throw new Error('connection refused');
      return { ok: true };
    });
    vi.stubGlobal('fetch', mockFetch);
    const log = vi.fn();

    await broadcastToBackups(
      ['192.168.1.10', '192.168.1.11'],
      '/api/slides/prev',
      {},
      log,
    );

    expect(mockFetch).toHaveBeenCalledTimes(2);
    // One failure log, one success log
    expect(log).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// Integration tests — POST /api/set-backup-controls
// ---------------------------------------------------------------------------

const AUTH = {
  operatorPin: 'op1234',
  adminPin: 'admin5678',
  operatorSessionMs: 60_000,
  adminSessionMs: 60_000,
};

async function makeApp() {
  const store = createStateStore();
  const srv = createFullServer({
    store,
    operatorPin: AUTH.operatorPin,
    adminPin: AUTH.adminPin,
    operatorSessionMs: AUTH.operatorSessionMs,
    adminSessionMs: AUTH.adminSessionMs,
    port: 0,
  });
  await srv.listen();

  const opRes = await request(srv.app).post('/auth/operator').send({ pin: AUTH.operatorPin });
  const opCookie = (opRes.headers['set-cookie'] as string[])[0];

  const admRes = await request(srv.app).post('/auth/admin').send({ pin: AUTH.adminPin });
  const admCookie = (admRes.headers['set-cookie'] as string[])[0];

  return { app: srv.app, store, srv, opCookie, admCookie, profilePaths: srv.profilePaths, activeProfileId: srv.activeProfileId };
}

describe('POST /api/set-backup-controls', () => {
  it('returns 401 without auth', async () => {
    const { app, srv } = await makeApp();
    try {
      const res = await request(app)
        .post('/api/set-backup-controls')
        .send({ role: 'primary', backupIps: [] });
      expect(res.status).toBe(401);
    } finally {
      await srv.close();
    }
  }, 30_000);

  it('returns 403 for operator cookie (admin-only endpoint)', async () => {
    const { app, srv, opCookie } = await makeApp();
    try {
      const res = await request(app)
        .post('/api/set-backup-controls')
        .set('Cookie', opCookie)
        .send({ role: 'primary', backupIps: [] });
      expect(res.status).toBe(403);
    } finally {
      await srv.close();
    }
  }, 30_000);

  it('returns 400 for invalid role', async () => {
    const { app, srv, admCookie } = await makeApp();
    try {
      const res = await request(app)
        .post('/api/set-backup-controls')
        .set('Cookie', admCookie)
        .send({ role: 'master', backupIps: [] });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_ROLE');
    } finally {
      await srv.close();
    }
  });

  it('returns 400 when backupIps is not an array', async () => {
    const { app, srv, admCookie } = await makeApp();
    try {
      const res = await request(app)
        .post('/api/set-backup-controls')
        .set('Cookie', admCookie)
        .send({ role: 'primary', backupIps: '192.168.1.10' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_PARAM');
    } finally {
      await srv.close();
    }
  });

  it('persists role=primary with two IPs and returns success', async () => {
    const { app, srv, admCookie } = await makeApp();
    try {
      const res = await request(app)
        .post('/api/set-backup-controls')
        .set('Cookie', admCookie)
        .send({ role: 'primary', backupIps: ['192.168.1.10', '192.168.1.11'] });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.backupRole).toBe('primary');
      expect(res.body.backupMachineIps).toEqual(['192.168.1.10', '192.168.1.11']);
    } finally {
      await srv.close();
    }
  });

  it('accepts role=standalone with empty backupIps', async () => {
    const { app, srv, admCookie } = await makeApp();
    try {
      const res = await request(app)
        .post('/api/set-backup-controls')
        .set('Cookie', admCookie)
        .send({ role: 'standalone', backupIps: [] });
      expect(res.status).toBe(200);
      expect(res.body.backupRole).toBe('standalone');
      expect(res.body.backupMachineIps).toEqual([]);
    } finally {
      await srv.close();
    }
  });

  it('accepts role=backup', async () => {
    const { app, srv, admCookie } = await makeApp();
    try {
      const res = await request(app)
        .post('/api/set-backup-controls')
        .set('Cookie', admCookie)
        .send({ role: 'backup' });
      expect(res.status).toBe(200);
      expect(res.body.backupRole).toBe('backup');
      expect(res.body.backupMachineIps).toEqual([]);
    } finally {
      await srv.close();
    }
  });
});

// ---------------------------------------------------------------------------
// Integration tests — slide routes fan-out behaviour
// ---------------------------------------------------------------------------

describe('slides route fan-out', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does NOT call fetch when role is standalone (default)', async () => {
    const { app, srv, opCookie, store } = await makeApp();
    // Prime state so slide ops succeed
    store.setState({
      currentMode: 'slides',
      slides: { deckId: 'abc', deckTitle: 'Test', slideIndex: 0, slideCount: 5, isLoading: false },
    });
    try {
      await request(app).post('/api/slides/next').set('Cookie', opCookie).send({});
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      await srv.close();
    }
  });

  it('calls fetch for each backup IP when role is primary', async () => {
    const { app, srv, opCookie, admCookie, store } = await makeApp();

    // Set primary role first
    await request(app)
      .post('/api/set-backup-controls')
      .set('Cookie', admCookie)
      .send({ role: 'primary', backupIps: ['192.168.1.10', '192.168.1.11'] });

    // Prime state so slide ops succeed
    store.setState({
      currentMode: 'slides',
      slides: { deckId: 'abc', deckTitle: 'Test', slideIndex: 0, slideCount: 5, isLoading: false },
    });

    try {
      const res = await request(app).post('/api/slides/next').set('Cookie', opCookie).send({});
      expect(res.status).toBe(200);

      // Allow microtasks to flush
      await new Promise((resolve) => setImmediate(resolve));

      expect(fetch).toHaveBeenCalledTimes(2);
      const urls = (fetch as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0]);
      expect(urls).toContain('http://192.168.1.10/api/slides/next');
      expect(urls).toContain('http://192.168.1.11/api/slides/next');
    } finally {
      await srv.close();
    }
  });

  it('does NOT call fetch when role is backup', async () => {
    const { app, srv, opCookie, admCookie, store } = await makeApp();

    await request(app)
      .post('/api/set-backup-controls')
      .set('Cookie', admCookie)
      .send({ role: 'backup', backupIps: ['192.168.1.10'] });

    store.setState({
      currentMode: 'slides',
      slides: { deckId: 'abc', deckTitle: 'Test', slideIndex: 0, slideCount: 5, isLoading: false },
    });

    try {
      await request(app).post('/api/slides/next').set('Cookie', opCookie).send({});
      await new Promise((resolve) => setImmediate(resolve));
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      await srv.close();
    }
  });
});
