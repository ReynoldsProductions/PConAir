import { Router, Request, Response } from 'express';
import type { AuthManager } from '../auth';
import type { ActionDispatcher } from '../action-dispatch';

export function createActionRouter(auth: AuthManager, execute: ActionDispatcher): Router {
  const router = Router();

  router.post('/', async (req: Request, res: Response) => {
    const pinQ = typeof req.query.operator_pin === 'string' ? req.query.operator_pin : undefined;
    const opCookie = req.cookies?.pconair_operator_session as string | undefined;
    const admCookie = req.cookies?.pconair_admin_session as string | undefined;
    const sid = opCookie ?? admCookie;
    let authed = Boolean(sid && auth.getSession(sid));
    if (!authed && pinQ) {
      authed = await auth.verifyOperatorPin(pinQ);
    }
    if (!authed) {
      res.status(401).json({ error: { code: 'AUTH_REQUIRED', message: 'Authentication required' } });
      return;
    }

    const { action_id, params } = req.body as { action_id?: string; params?: Record<string, unknown> };
    if (!action_id) {
      res.status(400).json({ error: { code: 'INVALID_MODE', message: 'action_id is required' } });
      return;
    }

    const r = await execute(action_id, params ?? {});
    if (!r.ok) {
      res.status(r.status).json({ error: r.error });
      return;
    }
    res.json(r.body);
  });

  return router;
}
