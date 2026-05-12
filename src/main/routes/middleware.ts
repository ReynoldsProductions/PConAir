import { Request, Response, NextFunction } from 'express';
import type { AuthManager } from '../auth';

export function requireOperator(auth: AuthManager) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const sessionId =
      (req.cookies?.pconair_operator_session as string | undefined) ??
      (req.cookies?.pconair_admin_session as string | undefined);
    if (!sessionId || !auth.getSession(sessionId)) {
      res.status(401).json({ error: { code: 'AUTH_REQUIRED', message: 'Authentication required' } });
      return;
    }
    next();
  };
}

export function requireAdmin(auth: AuthManager) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const sessionId = req.cookies?.pconair_admin_session as string | undefined;
    if (!sessionId || !auth.getSession(sessionId)) {
      res.status(401).json({ error: { code: 'AUTH_REQUIRED', message: 'Authentication required' } });
      return;
    }
    next();
  };
}
