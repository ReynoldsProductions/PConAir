import type { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';
import bcrypt from 'bcryptjs';
import { parseCookieHeader } from '../cookie-parse';

const TUNNEL_COOKIE = 'pconair_tunnel_ok';
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_FAILURES = 5;
const FAILURE_WINDOW_MS = 5 * 60 * 1000;

/**
 * Requests arriving through cloudflared carry Cloudflare headers and reach us
 * from loopback. LAN clients never have cf-* headers (and if a LAN client
 * spoofs one, it only opts itself into a stricter gate — fail-safe).
 */
export function isTunnelClient(req: Request): boolean {
  return Boolean(req.headers['cf-connecting-ip'] ?? req.headers['cf-ray'] ?? req.headers['cf-visitor']);
}

function tunnelClientKey(req: Request): string {
  const cf = req.headers['cf-connecting-ip'];
  return typeof cf === 'string' && cf.length > 0 ? cf : req.socket.remoteAddress ?? 'unknown';
}

function pinPageHtml(message: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>PConAir — PIN required</title>
  <style>
    body { font-family: system-ui, sans-serif; background: #111315; color: #e8eaec; margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
    .box { background: #1c1f22; border: 1px solid #33383d; border-radius: 10px; padding: 28px 32px; max-width: 20rem; width: 100%; box-sizing: border-box; text-align: center; }
    h1 { font-size: 1.1rem; margin: 0 0 6px; }
    p { font-size: 13px; color: #9aa0a6; margin: 0 0 18px; }
    .err { color: #ff6e62; font-size: 13px; margin-bottom: 12px; }
    input { width: 100%; box-sizing: border-box; padding: 12px; font-size: 22px; letter-spacing: 12px; text-align: center; border: 1px solid #33383d; border-radius: 6px; background: #111315; color: #e8eaec; margin-bottom: 14px; }
    button { width: 100%; padding: 12px; font-size: 14px; font-weight: 600; border: none; border-radius: 6px; background: #4da3ff; color: #08111c; cursor: pointer; }
  </style>
</head>
<body>
  <div class="box">
    <h1>PConAir</h1>
    <p>Enter the access PIN for remote control.</p>
    ${message ? `<div class="err">${message}</div>` : ''}
    <form method="post" action="/auth/tunnel-pin">
      <input name="pin" type="password" inputmode="numeric" maxlength="8" autocomplete="one-time-code" required autofocus />
      <button type="submit">Unlock</button>
    </form>
  </div>
</body>
</html>`;
}

export interface TunnelPinGateDeps {
  /** Current bcrypt hash of the tunnel PIN, or null when no PIN is configured. */
  getTunnelPinHash: () => string | null;
}

/**
 * PIN gate for tunnel clients. Mounted before all routes: when a request comes
 * through the Cloudflare tunnel and a tunnel PIN is configured, every path is
 * blocked until the PIN has been entered (session cookie, 24 h TTL).
 */
export function createTunnelPinGate(deps: TunnelPinGateDeps) {
  const sessions = new Map<string, number>(); // token -> expiresAt
  const failures = new Map<string, { count: number; firstAt: number }>();

  function hasValidSession(req: Request): boolean {
    const cookies = parseCookieHeader(req.headers.cookie);
    const token = cookies[TUNNEL_COOKIE];
    if (!token) return false;
    const exp = sessions.get(token);
    if (!exp || exp < Date.now()) {
      if (token) sessions.delete(token);
      return false;
    }
    return true;
  }

  function isLockedOut(key: string): boolean {
    const row = failures.get(key);
    if (!row) return false;
    if (Date.now() - row.firstAt > FAILURE_WINDOW_MS) {
      failures.delete(key);
      return false;
    }
    return row.count >= MAX_FAILURES;
  }

  function recordFailure(key: string): void {
    const row = failures.get(key);
    if (!row || Date.now() - row.firstAt > FAILURE_WINDOW_MS) {
      failures.set(key, { count: 1, firstAt: Date.now() });
      return;
    }
    row.count += 1;
  }

  async function handlePinSubmit(req: Request, res: Response): Promise<void> {
    const hash = deps.getTunnelPinHash();
    if (!hash) {
      res.redirect(303, '/remote/');
      return;
    }
    const key = tunnelClientKey(req);
    if (isLockedOut(key)) {
      res.status(429).send(pinPageHtml('Too many attempts. Wait five minutes.'));
      return;
    }
    const { pin } = req.body as { pin?: string };
    const ok = typeof pin === 'string' && (await bcrypt.compare(pin, hash));
    if (!ok) {
      recordFailure(key);
      res.status(401).send(pinPageHtml('Incorrect PIN.'));
      return;
    }
    failures.delete(key);
    const token = randomUUID();
    sessions.set(token, Date.now() + SESSION_TTL_MS);
    res.cookie(TUNNEL_COOKIE, token, { httpOnly: true, sameSite: 'lax', maxAge: SESSION_TTL_MS });
    res.redirect(303, '/remote/');
  }

  function middleware(req: Request, res: Response, next: NextFunction): void {
    const hash = deps.getTunnelPinHash();
    if (!hash || !isTunnelClient(req)) {
      next();
      return;
    }
    if (req.method === 'POST' && req.path === '/auth/tunnel-pin') {
      void handlePinSubmit(req, res);
      return;
    }
    if (hasValidSession(req)) {
      next();
      return;
    }
    if (isLockedOut(tunnelClientKey(req))) {
      res.status(429).send(pinPageHtml('Too many attempts. Wait five minutes.'));
      return;
    }
    res.status(401).setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(pinPageHtml(''));
  }

  return { middleware };
}

export type TunnelPinGate = ReturnType<typeof createTunnelPinGate>;
