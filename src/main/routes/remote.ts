import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import type { AuthManager } from '../auth';
import { requireOperator } from './middleware';

function operatorSessionOk(req: Request, auth: AuthManager): boolean {
  const sessionId =
    (req.cookies?.pconair_operator_session as string | undefined) ??
    (req.cookies?.pconair_admin_session as string | undefined);
  return Boolean(sessionId && auth.getSession(sessionId));
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const LOGIN_QUERY_HINTS: Record<string, string> = {
  bad: 'Incorrect PIN. Try again.',
  locked: 'Too many failed attempts. Wait five minutes, then try again.',
  missing: 'Enter your operator PIN.',
  ratelimited: 'Too many failed attempts. Please try again later.',
};

function remoteLoginHtml(message: string): string {
  const msg = message ? `<p class="err">${escapeHtml(message)}</p>` : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>PConAir — Sign in</title>
  <style>
    body { font-family: system-ui, sans-serif; background: #111315; color: #e8eaec; margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
    .box { background: #1c1f22; border: 1px solid #33383d; border-radius: 10px; padding: 28px 32px; max-width: 22rem; width: 100%; box-sizing: border-box; }
    h1 { font-size: 1.25rem; font-weight: 600; margin: 0 0 8px; }
    p.sub { font-size: 13px; color: #9aa0a6; margin: 0 0 20px; line-height: 1.45; }
    .err { color: #ff6e62; font-size: 13px; margin: 0 0 14px; }
    label { display: block; font-size: 13px; font-weight: 500; margin-bottom: 6px; }
    input { width: 100%; box-sizing: border-box; padding: 10px 12px; font-size: 16px; border: 1px solid #33383d; border-radius: 6px; margin-bottom: 16px; background: #111315; color: #e8eaec; }
    button { width: 100%; padding: 12px 16px; font-size: 14px; font-weight: 600; border: none; border-radius: 6px; background: #4da3ff; color: #08111c; cursor: pointer; }
  </style>
</head>
<body>
  <div class="box">
    <h1>PConAir</h1>
    <p class="sub">Enter the operator PIN to open the remote.</p>
    ${msg}
    <form method="post" action="/auth/operator/browser" autocomplete="off">
      <input type="hidden" name="next" value="/remote/" />
      <label for="pin">Operator PIN</label>
      <input id="pin" name="pin" type="password" inputmode="numeric" required autofocus />
      <button type="submit">Continue</button>
    </form>
  </div>
</body>
</html>`;
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

const REMOTE_CSP =
  "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data: https:; font-src 'self'; connect-src 'self' ws: wss:";

export function createRemoteRouter(auth: AuthManager): Router {
  const router = Router();
  const opGuard = requireOperator(auth);

  router.get('/index.js', opGuard, (_req: Request, res: Response) => {
    if (!REMOTE_JS_CONTENT) {
      res.status(404).type('text/plain').send('Remote bundle not found');
      return;
    }
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.send(REMOTE_JS_CONTENT);
  });

  router.get('/', (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Security-Policy', REMOTE_CSP);
    if (!operatorSessionOk(req, auth)) {
      const code = typeof req.query.login === 'string' ? req.query.login : '';
      res.send(remoteLoginHtml(LOGIN_QUERY_HINTS[code] ?? ''));
      return;
    }
    res.send(REMOTE_HTML_CONTENT);
  });

  return router;
}
