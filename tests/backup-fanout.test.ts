import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';
import { fanOutSlideCommand } from '../src/main/services/backup-fanout';

// ── helpers ──────────────────────────────────────────────────────────────────

/** Spin up a minimal HTTP server that captures requests and returns 200. */
function makeEchoServer(): Promise<{
  port: number;
  requests: Array<{ path: string; body: string; method: string }>;
  close: () => Promise<void>;
}> {
  return new Promise((resolve) => {
    const requests: Array<{ path: string; body: string; method: string }> = [];
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c: Buffer) => { body += c.toString(); });
      req.on('end', () => {
        requests.push({ path: req.url ?? '', body, method: req.method ?? '' });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{}');
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        port,
        requests,
        close: () => new Promise((res) => server.close(() => res())),
      });
    });
  });
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('fanOutSlideCommand', () => {
  it('fires one POST per backup IP with the correct endpoint and body', async () => {
    const s1 = await makeEchoServer();
    const s2 = await makeEchoServer();
    const log = vi.fn();

    await fanOutSlideCommand(
      ['127.0.0.1', '127.0.0.1'],
      // Use the two servers' ports by abusing the fact both IPs are localhost;
      // we can only test single-port fan-out reliably, so just use one server.
      s1.port,
      '/api/next-slide',
      { foo: 'bar' },
      log,
    );

    // Give the fire-and-forget requests time to land
    await new Promise((r) => setTimeout(r, 200));

    expect(s1.requests.length).toBe(2);
    s1.requests.forEach((r) => {
      expect(r.path).toBe('/api/next-slide');
      expect(r.method).toBe('POST');
      expect(JSON.parse(r.body)).toEqual({ foo: 'bar' });
    });

    await s1.close();
    await s2.close();
  });

  it('sends to a single IP when only one backup is configured', async () => {
    const s = await makeEchoServer();
    const log = vi.fn();

    await fanOutSlideCommand(['127.0.0.1'], s.port, '/api/previous-slide', {}, log);
    await new Promise((r) => setTimeout(r, 200));

    expect(s.requests.length).toBe(1);
    expect(s.requests[0].path).toBe('/api/previous-slide');

    await s.close();
  });

  it('passes the correct JSON body for go-to-slide', async () => {
    const s = await makeEchoServer();
    const log = vi.fn();

    await fanOutSlideCommand(['127.0.0.1'], s.port, '/api/go-to-slide', { slide: 5 }, log);
    await new Promise((r) => setTimeout(r, 200));

    expect(JSON.parse(s.requests[0].body)).toEqual({ slide: 5 });

    await s.close();
  });

  it('logs but does not throw when a backup IP is unreachable', async () => {
    const log = vi.fn();

    // Port 1 is almost certainly not listening
    await expect(
      fanOutSlideCommand(['127.0.0.1'], 1, '/api/next-slide', {}, log),
    ).resolves.toBeUndefined();

    // Allow time for the error callback
    await new Promise((r) => setTimeout(r, 500));

    expect(log).toHaveBeenCalled();
    const msg: string = log.mock.calls[0][0];
    expect(msg).toMatch(/Failed|Timeout/);
  });

  it('does nothing when backupIps is empty', async () => {
    const log = vi.fn();
    // No server needed — if any request were fired it would fail
    await fanOutSlideCommand([], 9595, '/api/next-slide', {}, log);
    expect(log).not.toHaveBeenCalled();
  });
});
