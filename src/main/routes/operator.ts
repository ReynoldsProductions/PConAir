import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import type { AuthManager } from '../auth';
import { requireOperator } from './middleware';

// Read once at startup — fs.readFileSync works inside Electron asars; res.sendFile does not.
const OPERATOR_HTML_PATH = path.resolve(__dirname, '../../renderer/operator/index.html');
const OPERATOR_HTML_CONTENT: string = (() => {
  try {
    return fs.readFileSync(OPERATOR_HTML_PATH, 'utf-8');
  } catch {
    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>PC On Air — Operator</title></head><body><p>PC On Air Operator UI</p></body></html>`;
  }
})();

export function createOperatorRouter(auth: AuthManager): Router {
  const router = Router();
  const opGuard = requireOperator(auth);

  router.get('/', opGuard, (_req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/html');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' https:; font-src 'self'"
    );
    res.send(OPERATOR_HTML_CONTENT);
  });

  return router;
}
