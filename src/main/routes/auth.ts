import { Router, Request, Response } from 'express';
import type { AuthManager } from '../auth';

const RATE_LIMIT_BODY = {
  code: 'RATE_LIMITED',
  message: 'Too many failed authentication attempts. Please try again in 5 minutes.',
  details: { retryAfter: 300 },
} as const;

const COOKIE_BASE = { httpOnly: true, sameSite: 'strict' as const, path: '/' };

export interface AuthRouterOpts {
  setAdminShowLocked: (locked: boolean) => void;
  syncAdminShowLockedToStore: () => void;
  closeSocketsForSession: (sessionId: string) => void;
}

export function createAuthRouter(auth: AuthManager, opts: AuthRouterOpts): Router {
  const router = Router();

  function clientIp(req: Request): string {
    const ext = (req as Request & { pconairClientIp?: string }).pconairClientIp;
    return ext ?? req.ip ?? '0.0.0.0';
  }

  function sendRateLimited(res: Response, ip: string): void {
    const retryAfter = auth.getRetryAfterSeconds(ip) ?? 300;
    const reset = auth.getRateLimitResetUnix(ip);
    res
      .status(429)
      .set('X-Retry-After', String(retryAfter))
      .set('X-RateLimit-Remaining', '0')
      .set('X-RateLimit-Limit', '5')
      .set('X-RateLimit-Reset', reset != null ? String(reset) : String(Math.ceil((Date.now() + retryAfter * 1000) / 1000)))
      .json({ error: { ...RATE_LIMIT_BODY, details: { retryAfter } } });
  }

  router.post('/operator', async (req: Request, res: Response) => {
    const { pin } = req.body as { pin?: string };
    const ip = clientIp(req);

    if (!pin) {
      res.status(400).json({ error: { code: 'AUTH_REQUIRED', message: 'PIN required' } });
      return;
    }

    if (auth.isLockedOut(ip)) {
      sendRateLimited(res, ip);
      return;
    }

    const session = await auth.createSession('operator', pin, ip);
    if (!session) {
      res.status(401).json({ error: { code: 'AUTH_REQUIRED', message: 'Authentication failed' } });
      return;
    }

    res
      .cookie('pconair_operator_session', session.id, {
        ...COOKIE_BASE,
        maxAge: session.expiresAt - session.createdAt,
      })
      .json({ role: 'operator' });
  });

  /** HTML form login (browser): sets cookie and redirects to /operator/ */
  router.post('/operator/browser', async (req: Request, res: Response) => {
    const raw = req.body as { pin?: unknown };
    const pin = typeof raw.pin === 'string' ? raw.pin : undefined;
    const ip = clientIp(req);

    if (!pin) {
      res.redirect(303, '/operator/?login=missing');
      return;
    }

    if (auth.isLockedOut(ip)) {
      res.redirect(303, '/operator/?login=locked');
      return;
    }

    const session = await auth.createSession('operator', pin, ip);
    if (!session) {
      if (auth.isLockedOut(ip)) {
        res.redirect(303, '/operator/?login=locked');
        return;
      }
      res.redirect(303, '/operator/?login=bad');
      return;
    }

    res.cookie('pconair_operator_session', session.id, {
      ...COOKIE_BASE,
      maxAge: session.expiresAt - session.createdAt,
    });
    res.redirect(303, '/operator/');
  });

  router.post('/admin', async (req: Request, res: Response) => {
    const { pin } = req.body as { pin?: string };
    const ip = clientIp(req);

    if (!pin) {
      res.status(400).json({ error: { code: 'AUTH_REQUIRED', message: 'PIN required' } });
      return;
    }

    if (auth.isLockedOut(ip)) {
      sendRateLimited(res, ip);
      return;
    }

    const session = await auth.createSession('admin', pin, ip);
    if (!session) {
      res.status(401).json({ error: { code: 'AUTH_REQUIRED', message: 'Authentication failed' } });
      return;
    }

    res
      .cookie('pconair_admin_session', session.id, {
        ...COOKIE_BASE,
        maxAge: session.expiresAt - session.createdAt,
      })
      .json({ role: 'admin' });
  });

  router.post('/logout', (req: Request, res: Response) => {
    const body = req.body as { role?: string };
    const role = body.role;
    if (role !== 'operator' && role !== 'admin') {
      res.status(400).json({ error: { code: 'INVALID_MODE', message: 'role must be operator or admin' } });
      return;
    }

    if (role === 'operator') {
      const sid = req.cookies?.pconair_operator_session as string | undefined;
      const adm = req.cookies?.pconair_admin_session as string | undefined;
      const adminSession = adm ? auth.getSession(adm) : null;
      const opSession = sid ? auth.getSession(sid) : null;
      const allowed = Boolean(
        (opSession && opSession.role === 'operator') || (adminSession && adminSession.role === 'admin')
      );
      if (!allowed) {
        res.status(401).json({ error: { code: 'AUTH_REQUIRED', message: 'Authentication required' } });
        return;
      }
      if (sid) {
        auth.deleteSession(sid);
        opts.closeSocketsForSession(sid);
      }
      res
        .clearCookie('pconair_operator_session', { path: '/' })
        .json({ message: 'Logged out successfully.' });
      return;
    }

    const adminSid = req.cookies?.pconair_admin_session as string | undefined;
    const adminSession = adminSid ? auth.getSession(adminSid) : null;
    if (!adminSid || !adminSession || adminSession.role !== 'admin') {
      res.status(401).json({ error: { code: 'AUTH_REQUIRED', message: 'Authentication required' } });
      return;
    }
    auth.deleteSession(adminSid);
    opts.closeSocketsForSession(adminSid);
    res
      .clearCookie('pconair_admin_session', { path: '/' })
      .json({ message: 'Logged out successfully.' });
  });

  /** HTML form login (browser): sets admin cookie and redirects to /admin/ */
  router.post('/admin/browser', async (req: Request, res: Response) => {
    const raw = req.body as { pin?: unknown };
    const pin = typeof raw.pin === 'string' ? raw.pin : undefined;
    const ip = clientIp(req);

    if (!pin) {
      res.redirect(303, '/admin/?login=missing');
      return;
    }

    if (auth.isLockedOut(ip)) {
      res.redirect(303, '/admin/?login=locked');
      return;
    }

    const session = await auth.createSession('admin', pin, ip);
    if (!session) {
      if (auth.isLockedOut(ip)) {
        res.redirect(303, '/admin/?login=locked');
        return;
      }
      res.redirect(303, '/admin/?login=bad');
      return;
    }

    res.cookie('pconair_admin_session', session.id, {
      ...COOKIE_BASE,
      maxAge: session.expiresAt - session.createdAt,
    });
    res.redirect(303, '/admin/');
  });

  router.post('/unlock-admin', async (req: Request, res: Response) => {
    const { pin } = req.body as { pin?: string };
    const ip = clientIp(req);

    if (!pin) {
      res.status(400).json({ error: { code: 'AUTH_REQUIRED', message: 'PIN required' } });
      return;
    }

    if (auth.isLockedOut(ip)) {
      sendRateLimited(res, ip);
      return;
    }

    const ok = await auth.verifyAdminPin(pin);
    if (!ok) {
      auth.recordAdminPinFailure(ip);
      res.status(401).json({ error: { code: 'AUTH_REQUIRED', message: 'Authentication failed' } });
      return;
    }

    auth.recordAdminPinSuccess(ip);
    opts.setAdminShowLocked(false);
    opts.syncAdminShowLockedToStore();
    res.json({ locked: false });
  });

  return router;
}
