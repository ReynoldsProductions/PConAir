import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import type { AuthManager } from '../auth';
import { requireOperator } from './middleware';

// Read once at startup — fs.readFileSync works inside Electron asars; res.sendFile does not.
const OPERATOR_HTML_PATH = path.resolve(__dirname, '../renderer/operator/index.html');

const OPERATOR_HTML_CONTENT: string = (() => {
  try {
    return fs.readFileSync(OPERATOR_HTML_PATH, 'utf-8');
  } catch {
    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>PC On Air — Operator</title></head><body><p>PC On Air Operator UI</p></body></html>`;
  }
})();

const OPERATOR_JS_CONTENT: Buffer | null = (() => {
  const nextToHtml = path.join(path.dirname(OPERATOR_HTML_PATH), 'index.js');
  const fallbacks = [
    nextToHtml,
    // Vitest loads this module from src/; bundle lives under .webpack/
    path.resolve(__dirname, '../../../.webpack/renderer/operator/index.js'),
    path.resolve(__dirname, '../../../.webpack/arm64/renderer/operator/index.js'),
  ];
  for (const p of fallbacks) {
    try {
      return fs.readFileSync(p);
    } catch {
      /* try next */
    }
  }
  return null;
})();

export function createOperatorRouter(auth: AuthManager): Router {
  const router = Router();
  const opGuard = requireOperator(auth);

  router.get('/index.js', opGuard, (_req: Request, res: Response) => {
    if (!OPERATOR_JS_CONTENT) {
      res.status(404).type('text/plain').send('Operator bundle not found');
      return;
    }
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.send(OPERATOR_JS_CONTENT);
  });

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
