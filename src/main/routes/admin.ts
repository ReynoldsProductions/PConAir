import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import type { AuthManager } from '../auth';

// Read once at startup — fs.readFileSync works inside Electron asars; res.sendFile does not.
const ADMIN_HTML_CONTENT: string = (() => {
  try {
    return fs.readFileSync(path.resolve(__dirname, '../renderer/admin/index.html'), 'utf-8');
  } catch {
    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>PC On Air — Admin</title></head><body><p>PC On Air Admin UI</p></body></html>`;
  }
})();

const HTML_CSP =
  "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self' ws: wss:; img-src 'self' data: https:; font-src 'self'";

const ADMIN_UNLOCK_JS = `(function(){
  var f=document.getElementById('unlock-form');
  if(!f)return;
  f.addEventListener('submit',function(ev){
    ev.preventDefault();
    var pin=document.getElementById('pin').value;
    fetch('/auth/unlock-admin',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pin:pin})})
      .then(function(r){return r.json().then(function(j){return{ok:r.ok,status:r.status,j:j};});})
      .then(function(x){
        if(x.ok){window.location.reload();return;}
        var err=document.getElementById('err');
        if(err)err.textContent=(x.j&&x.j.error&&x.j.error.message)||'Unlock failed';
      }).catch(function(){var err=document.getElementById('err');if(err)err.textContent='Network error';});
  });
})();`;

const FALLBACK_ADMIN_HTML = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><title>PC On Air — Admin</title></head>
<body><p>PC On Air Admin UI</p></body></html>`;

const LOGIN_QUERY_HINTS: Record<string, string> = {
  bad: 'Incorrect admin PIN. Try again.',
  locked: 'Too many failed attempts. Wait five minutes, then try again.',
  missing: 'Enter the admin PIN.',
  ratelimited: 'Too many failed attempts. Please try again later.',
};

function adminLoginHtml(message: string): string {
  const msg = message ? `<p class="err">${message.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>` : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>PConAir — Admin</title>
  <style>
    body { font-family: system-ui, sans-serif; background: #111315; color: #e8eaec; margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
    .box { background: #1c1f22; border: 1px solid #33383d; border-radius: 10px; padding: 28px 32px; max-width: 22rem; width: 100%; box-sizing: border-box; }
    h1 { font-size: 1.25rem; font-weight: 600; margin: 0 0 8px; }
    p.sub { font-size: 13px; color: #9aa0a6; margin: 0 0 20px; line-height: 1.45; }
    .err { color: #ff6e62; font-size: 13px; margin: 0 0 14px; }
    label { display: block; font-size: 13px; font-weight: 500; margin-bottom: 6px; }
    input { width: 100%; box-sizing: border-box; padding: 10px 12px; font-size: 16px; border: 1px solid #33383d; border-radius: 6px; margin-bottom: 16px; background: #111315; color: #e8eaec; }
    button { width: 100%; padding: 12px 16px; font-size: 14px; font-weight: 600; border: none; border-radius: 6px; background: #e5a53a; color: #08111c; cursor: pointer; }
  </style>
</head>
<body>
  <div class="box">
    <h1>PConAir Admin</h1>
    <p class="sub">Enter the admin PIN to access the dashboard.</p>
    ${msg}
    <form method="post" action="/auth/admin/browser" autocomplete="off">
      <label for="pin">Admin PIN</label>
      <input id="pin" name="pin" type="password" inputmode="numeric" required autofocus />
      <button type="submit">Continue</button>
    </form>
  </div>
</body>
</html>`;
}

const LOCKED_SHELL = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Admin locked</title><style>body{font-family:system-ui,sans-serif;max-width:28rem;margin:2rem auto;padding:0 1rem}</style></head>
<body>
<h1>Admin locked for show.</h1>
<p>Enter admin PIN to unlock.</p>
<p id="err" style="color:#b00020"></p>
<form id="unlock-form">
  <label>PIN <input id="pin" type="password" name="pin" autocomplete="off" required style="width:100%;padding:0.5rem;margin:0.5rem 0"/></label>
  <button type="submit" style="padding:0.5rem 1rem">Unlock</button>
</form>
<script src="/admin/assets/admin-unlock.js"></script>
</body></html>`;

const HEALTH_DASH_JS = `(function(){
  var root=document.getElementById('health-root');
  var errEl=document.getElementById('health-err');
  function showErr(t){if(errEl)errEl.textContent=t||'';}
  async function load(){
    showErr('');
    try{
      var r=await fetch('/api/health',{credentials:'same-origin'});
      var j=await r.json();
      if(!r.ok){showErr((j.error&&j.error.message)||('HTTP '+r.status));return;}
      if(root)root.textContent=JSON.stringify(j,null,2);
    }catch(e){showErr('Network error');}
  }
  var b=document.getElementById('health-refresh');
  if(b)b.addEventListener('click',function(){load();});
  setInterval(load,5000);
  load();
})();`;

const HEALTH_PAGE_HTML = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>PC On Air — Health</title>
<style>
body{font-family:system-ui,sans-serif;margin:0;background:#111;color:#e0e0e0}
header{padding:12px 16px;background:#1e1e1e;border-bottom:1px solid #333;display:flex;align-items:center;gap:12px;flex-wrap:wrap}
h1{font-size:1rem;margin:0;font-weight:600}
#health-err{color:#ff8a80;margin:0;flex:1 1 100%}
pre#health-root{margin:16px;font-size:12px;white-space:pre-wrap;word-break:break-all;color:#b0bec5}
button{padding:8px 14px;border-radius:4px;border:1px solid #444;background:#2a2a2a;color:#fff;cursor:pointer}
button:hover{background:#333}
.muted{color:#888;font-size:12px}
</style></head>
<body>
<header>
  <h1>Health dashboard</h1>
  <button type="button" id="health-refresh">Refresh now</button>
  <span class="muted">Auto-refresh every 5s · Times UTC in JSON</span>
  <p id="health-err"></p>
</header>
<pre id="health-root">Loading…</pre>
<script src="/admin/assets/health-dashboard.js"></script>
</body></html>`;

export interface AdminRouterDeps {
  auth: AuthManager;
  getAdminShowLocked: () => boolean;
}

export function createAdminRouter(d: AdminRouterDeps): Router {
  const router = Router();

  router.get('/index.js', (_req: Request, res: Response) => {
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    const jsPath = path.resolve(__dirname, '../renderer/admin/index.js');
    if (fs.existsSync(jsPath)) {
      res.send(fs.readFileSync(jsPath));
    } else {
      res.send('/* admin stub */');
    }
  });

  router.get('/assets/health-dashboard.js', (_req: Request, res: Response) => {
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('Content-Security-Policy', "default-src 'none'");
    res.send(HEALTH_DASH_JS);
  });

  router.get('/health', (req: Request, res: Response) => {
    const adminSid = req.cookies?.pconair_admin_session as string | undefined;
    const adminSession = adminSid ? d.auth.getSession(adminSid) : null;
    if (!adminSession || adminSession.role !== 'admin') {
      res.status(401).json({ error: { code: 'AUTH_REQUIRED', message: 'Authentication required' } });
      return;
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Security-Policy', HTML_CSP);
    res.send(HEALTH_PAGE_HTML);
  });

  router.get('/assets/admin-unlock.js', (_req: Request, res: Response) => {
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('Content-Security-Policy', "default-src 'none'");
    res.send(ADMIN_UNLOCK_JS);
  });

  router.get('/', (req: Request, res: Response) => {
    const adminSid = req.cookies?.pconair_admin_session as string | undefined;
    const adminSession = adminSid ? d.auth.getSession(adminSid) : null;

    if (!adminSession || adminSession.role !== 'admin') {
      // Browser navigations (sec-fetch-dest: document) get an HTML login page.
      // API clients get JSON errors.
      const isBrowserNav = req.headers['sec-fetch-dest'] === 'document';
      if (isBrowserNav) {
        const loginCode = typeof req.query.login === 'string' ? req.query.login : '';
        res.status(401).setHeader('Content-Type', 'text/html; charset=utf-8').send(
          adminLoginHtml(LOGIN_QUERY_HINTS[loginCode] ?? '')
        );
        return;
      }
      if (opSession) {
        res.status(403).json({
          error: { code: 'FORBIDDEN', message: 'Admin access required' },
        });
        return;
      }
      res.status(401).json({ error: { code: 'AUTH_REQUIRED', message: 'Authentication required' } });
      return;
    }

    if (d.getAdminShowLocked()) {
      const accept = req.headers.accept ?? '';
      if (accept.includes('application/json')) {
        res.status(403).json({
          error: {
            code: 'FORBIDDEN',
            message: 'Admin locked for show. Enter admin PIN to unlock.',
          },
        });
        return;
      }
      res.status(403);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Content-Security-Policy', HTML_CSP);
      res.send(LOCKED_SHELL);
      return;
    }

    res.setHeader('Content-Security-Policy', HTML_CSP);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(ADMIN_HTML_CONTENT);
  });

  return router;
}
