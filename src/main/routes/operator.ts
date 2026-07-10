import { Router, Request, Response } from 'express';
import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import type { AuthManager } from '../auth';
import { requireOperator } from './middleware';

// webpack-dev-server's HMR client (bundled into index.js in dev builds only) uses
// eval() internally, which a strict `script-src 'self'` CSP blocks — that throws
// before the rest of the bundle (including all nav/button wiring) ever runs.
// Packaged builds never include the HMR client, so this only loosens dev CSP.
// `electron`'s `app` resolves to a plain string (not an object) when this module
// is loaded outside a running Electron process (e.g. under vitest), so guard with
// optional chaining rather than assuming `app` is always the real Electron API.
const OPERATOR_SCRIPT_SRC = app?.isPackaged ? "script-src 'self'" : "script-src 'self' 'unsafe-eval'";

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

function operatorLoginHtml(message: string): string {
  const msg = message ? `<p class="err">${escapeHtml(message)}</p>` : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>PC On Air — Operator sign-in</title>
  <style>
    body { font-family: system-ui, sans-serif; background: #fbf8f6; color: #333; margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
    .box { background: #fff; border: 1px solid #dfe0e1; border-radius: 4px; padding: 28px 32px; max-width: 22rem; width: 100%; box-sizing: border-box; }
    h1 { font-size: 1.25rem; font-weight: 600; margin: 0 0 8px; }
    p.sub { font-size: 13px; color: #757575; margin: 0 0 20px; line-height: 1.45; }
    .err { color: #921100; font-size: 13px; margin: 0 0 14px; }
    label { display: block; font-size: 13px; font-weight: 500; margin-bottom: 6px; }
    input { width: 100%; box-sizing: border-box; padding: 8px 12px; font-size: 15px; border: 1px solid #dfe0e1; border-radius: 4px; margin-bottom: 16px; }
    button { width: 100%; padding: 10px 16px; font-size: 14px; font-weight: 600; border: none; border-radius: 4px; background: #333; color: #fff; cursor: pointer; }
    button:hover { background: #000; }
  </style>
</head>
<body>
  <div class="box">
    <h1>Operator sign-in</h1>
    <p class="sub">Enter the operator PIN for this show machine. The Electron app signs in automatically; a normal browser needs this step.</p>
    ${msg}
    <form method="post" action="/auth/operator/browser" autocomplete="off">
      <label for="pin">Operator PIN</label>
      <input id="pin" name="pin" type="password" inputmode="numeric" required autofocus />
      <button type="submit">Continue</button>
    </form>
  </div>
</body>
</html>`;
}

// Read once at startup — fs.readFileSync works inside Electron asars; res.sendFile does not.
const OPERATOR_HTML_CANDIDATES = [
  path.resolve(__dirname, '../renderer/operator/index.html'),
  // Vitest resolves this module from src/main/routes; packaged app uses .webpack/main
  path.resolve(__dirname, '../../renderer/operator/index.html'),
];

function resolveOperatorHtmlPath(): string {
  for (const p of OPERATOR_HTML_CANDIDATES) {
    if (fs.existsSync(p)) return p;
  }
  return OPERATOR_HTML_CANDIDATES[0];
}

const OPERATOR_HTML_PATH = resolveOperatorHtmlPath();

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

  router.get('/', (req: Request, res: Response) => {
    if (!operatorSessionOk(req, auth)) {
      const code = typeof req.query.login === 'string' ? req.query.login : '';
      const hint = LOGIN_QUERY_HINTS[code] ?? '';
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader(
        'Content-Security-Policy',
        "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' https:; font-src 'self'"
      );
      res.send(operatorLoginHtml(hint));
      return;
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader(
      'Content-Security-Policy',
      `default-src 'self'; style-src 'self' 'unsafe-inline'; ${OPERATOR_SCRIPT_SRC}; img-src 'self' https:; font-src 'self'`
    );
    res.send(OPERATOR_HTML_CONTENT);
  });

  return router;
}
