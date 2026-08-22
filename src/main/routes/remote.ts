import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import type { AuthManager } from '../auth';
import { requireOperator } from './middleware';
import { renderLoginPage } from './login-page';

function operatorSessionOk(req: Request, auth: AuthManager): boolean {
  const sessionId =
    (req.cookies?.pconair_operator_session as string | undefined) ??
    (req.cookies?.pconair_admin_session as string | undefined);
  return Boolean(sessionId && auth.getSession(sessionId));
}


const LOGIN_QUERY_HINTS: Record<string, string> = {
  bad: 'Incorrect PIN. Try again.',
  locked: 'Too many failed attempts. Wait five minutes, then try again.',
  missing: 'Enter your operator PIN.',
  ratelimited: 'Too many failed attempts. Please try again later.',
};

function remoteLoginHtml(message: string): string {
  return renderLoginPage({
    title: 'PConAir — Sign in',
    heading: 'PConAir',
    intro: 'Enter the operator PIN to open the remote.',
    action: '/auth/operator/browser',
    pinLabel: 'Operator PIN',
    message,
    next: '/remote/',
  });
}

// Read once at startup — fs.readFileSync works inside Electron asars; res.sendFile does not.
const REMOTE_HTML_CANDIDATES = [
  path.resolve(__dirname, '../renderer/remote/index.html'),
  // Vitest resolves this module from src/main/routes; packaged app uses .webpack/main
  path.resolve(__dirname, '../../renderer/remote/index.html'),
];

function resolveRemoteHtmlPath(): string {
  for (const p of REMOTE_HTML_CANDIDATES) {
    if (fs.existsSync(p)) return p;
  }
  return REMOTE_HTML_CANDIDATES[0];
}

const REMOTE_HTML_PATH = resolveRemoteHtmlPath();

const REMOTE_HTML_CONTENT: string = (() => {
  try {
    return fs.readFileSync(REMOTE_HTML_PATH, 'utf-8');
  } catch {
    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>PConAir</title></head><body><p>PConAir web remote</p></body></html>`;
  }
})();

const REMOTE_JS_CONTENT: Buffer | null = (() => {
  const nextToHtml = path.join(path.dirname(REMOTE_HTML_PATH), 'index.js');
  const fallbacks = [
    nextToHtml,
    path.resolve(__dirname, '../../../.webpack/renderer/remote/index.js'),
    path.resolve(__dirname, '../../../.webpack/arm64/renderer/remote/index.js'),
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

// frame-src: the Timer page embeds stagetimer.io (v2 plan §Timer page).
const REMOTE_CSP =
  "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data: https:; font-src 'self'; connect-src 'self' ws: wss:; frame-src https://stagetimer.io";

export function createRemoteRouter(auth: AuthManager): Router {
  const router = Router();
  const opGuard = requireOperator(auth);

  router.get('/index.js', opGuard, (_req: Request, res: Response) => {
    if (!REMOTE_JS_CONTENT) {
      res.status(404).type('text/plain').send('Remote bundle not found');
      return;
    }
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    // Must match the HTML's policy, or a fresh page loads a stale bundle.
    res.setHeader('Cache-Control', 'no-store, must-revalidate');
    res.send(REMOTE_JS_CONTENT);
  });

  router.get('/', (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Security-Policy', REMOTE_CSP);
    // The page ships inside the app, so a cached copy on an operator's tablet
    // silently pins them to a previous build's UI — controls appear missing and
    // fixes look like they never landed. Always revalidate.
    res.setHeader('Cache-Control', 'no-store, must-revalidate');
    if (!operatorSessionOk(req, auth)) {
      const code = typeof req.query.login === 'string' ? req.query.login : '';
      res.send(remoteLoginHtml(LOGIN_QUERY_HINTS[code] ?? ''));
      return;
    }
    res.send(REMOTE_HTML_CONTENT);
  });

  return router;
}
