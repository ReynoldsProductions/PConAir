import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import type { AuthManager } from '../auth';
import { requireOperator } from './middleware';
import { renderLoginPage } from './login-page';

/**
 * `/prompter-control/` — standalone operator-PIN-gated page for the Google
 * Doc script source (design doc section 7 / `docs/plans/2026-09-18-prompter-
 * control-page.md`). Mirrors `remote.ts`'s serving pattern exactly (asar-safe
 * `fs.readFileSync`, `renderLoginPage` with `next`, operator-session gate,
 * same CSP shape) but is a focused single-purpose page rather than a tabbed
 * SPA: it mounts the shared `prompter-controls` module as its entire
 * content — "everything the operator needs for the prompter, nothing else".
 */

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

function prompterControlLoginHtml(message: string): string {
  return renderLoginPage({
    title: 'PConAir — Sign in',
    heading: 'PConAir',
    intro: 'Enter the operator PIN to open the prompter controls.',
    action: '/auth/operator/browser',
    pinLabel: 'Operator PIN',
    message,
    next: '/prompter-control/',
  });
}

// Read once at startup — fs.readFileSync works inside Electron asars; res.sendFile does not.
const PROMPTER_CONTROL_HTML_CANDIDATES = [
  path.resolve(__dirname, '../renderer/prompter-control/index.html'),
  // Vitest resolves this module from src/main/routes; packaged app uses .webpack/main
  path.resolve(__dirname, '../../renderer/prompter-control/index.html'),
];

function resolvePrompterControlHtmlPath(): string {
  for (const p of PROMPTER_CONTROL_HTML_CANDIDATES) {
    if (fs.existsSync(p)) return p;
  }
  return PROMPTER_CONTROL_HTML_CANDIDATES[0];
}

const PROMPTER_CONTROL_HTML_PATH = resolvePrompterControlHtmlPath();

const PROMPTER_CONTROL_HTML_CONTENT: string = (() => {
  try {
    return fs.readFileSync(PROMPTER_CONTROL_HTML_PATH, 'utf-8');
  } catch {
    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>PConAir</title></head><body><p>PConAir prompter control</p></body></html>`;
  }
})();

const PROMPTER_CONTROL_JS_CONTENT: Buffer | null = (() => {
  const nextToHtml = path.join(path.dirname(PROMPTER_CONTROL_HTML_PATH), 'index.js');
  const fallbacks = [
    nextToHtml,
    path.resolve(__dirname, '../../../.webpack/renderer/prompter-control/index.js'),
    path.resolve(__dirname, '../../../.webpack/arm64/renderer/prompter-control/index.js'),
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

const PROMPTER_CONTROL_CSP =
  "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self' ws: wss:";

export function createPrompterControlRouter(auth: AuthManager): Router {
  const router = Router();
  const opGuard = requireOperator(auth);

  router.get('/index.js', opGuard, (_req: Request, res: Response) => {
    if (!PROMPTER_CONTROL_JS_CONTENT) {
      res.status(404).type('text/plain').send('Prompter control bundle not found');
      return;
    }
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    // Must match the HTML's policy, or a fresh page loads a stale bundle.
    res.setHeader('Cache-Control', 'no-store, must-revalidate');
    res.send(PROMPTER_CONTROL_JS_CONTENT);
  });

  router.get('/', (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Security-Policy', PROMPTER_CONTROL_CSP);
    // The page ships inside the app, so a cached copy on an operator's tablet
    // silently pins them to a previous build's UI. Always revalidate.
    res.setHeader('Cache-Control', 'no-store, must-revalidate');
    if (!operatorSessionOk(req, auth)) {
      const code = typeof req.query.login === 'string' ? req.query.login : '';
      res.send(prompterControlLoginHtml(LOGIN_QUERY_HINTS[code] ?? ''));
      return;
    }
    res.send(PROMPTER_CONTROL_HTML_CONTENT);
  });

  return router;
}
