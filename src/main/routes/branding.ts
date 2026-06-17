import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import type { AuthManager } from '../auth';
import { requireAdmin } from './middleware';

/**
 * Branding routes — serve operator-supplied logo and CSS override files.
 *
 * GET /branding/logo          — stream the custom logo if set and the file exists; 404 otherwise.
 * GET /branding/style.css     — stream the custom CSS file if set and exists; empty CSS otherwise.
 * GET /branding/template.css  — serve a boilerplate CSS template the operator can download as a starting point.
 */

export interface BrandingRouterDeps {
  auth: AuthManager;
  /** Returns the current custom logo path (may change at runtime). */
  getCustomLogoPath: () => string | null;
  /** Returns the current custom CSS path (may change at runtime). */
  getCustomCssPath: () => string | null;
  /** Persists branding paths to app-settings.json. */
  saveBrandingSettings: (patch: { customLogoPath?: string | null; customCssPath?: string | null }) => void;
}

const MIME_MAP: Record<string, string> = {
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg':  'image/svg+xml',
  '.webp': 'image/webp',
};

/**
 * CSS template operators can download as a starting point for white-labelling.
 * Documents the CSS custom-property hooks exposed by the remote / operator UIs.
 */
const CSS_TEMPLATE = `/*
  PConAir Custom Branding Template
  ─────────────────────────────────────────────────────────────────────────────
  This file is loaded last on the web remote (/remote/) and operator (/operator/)
  pages, so any rule here will override the defaults.

  Typical use: re-colour the accent and surface palette for a client deployment.

  1. CUSTOM PROPERTIES (CSS variables)
     Override these on :root to re-theme globally.

  2. COMPONENT OVERRIDES
     Uncomment and edit the examples below to target specific elements.

  Save this file and point the "Custom CSS file" field in Admin → Branding at it.
  Changes take effect on the next page load (no restart required).
*/

/* ── 1. REMOTE (web remote) colour overrides ──────────────────────────────── */
/* The remote uses these variables — override them here: */
/*
:root {
  --bg:        #111315;
  --surface:   #1c1f22;
  --surface-2: #25292d;
  --border:    #33383d;
  --text:      #e8eaec;
  --text-dim:  #9aa0a6;
  --accent:    #4da3ff;   /* buttons, active nav, links */
  --live:      #2ecc71;   /* "ON AIR" badge */
  --warn:      #e5a53a;
  --err:       #e53935;
}
*/

/* ── 2. OPERATOR UI colour overrides ──────────────────────────────────────── */
/* The operator UI uses a light palette by default: */
/*
:root {
  --bg:           #ffffff;
  --surface-2:    #fbf8f6;
  --surface-3:    #f3f0ed;
  --border:       #dfe0e1;
  --text:         #333333;
  --text-subdued: #757575;
}
*/

/* ── 3. LOGO SIZING ───────────────────────────────────────────────────────── */
/* The brand logo is shown in the remote page header when /branding/logo returns 200. */
/*
.branding-logo {
  height: 28px;
  width: auto;
  object-fit: contain;
}
*/

/* ── 4. EXAMPLE: swap the accent colour ──────────────────────────────────── */
/*
:root {
  --accent: #e5a53a;
}
*/
`;

export function createBrandingRouter(deps: BrandingRouterDeps): Router {
  const router = Router();
  const adminGuard = requireAdmin(deps.auth);

  // GET /branding/settings — return current branding config (admin only)
  router.get('/settings', adminGuard, (_req: Request, res: Response) => {
    res.json({
      customLogoPath: deps.getCustomLogoPath(),
      customCssPath: deps.getCustomCssPath(),
    });
  });

  // POST /branding/settings — save branding config (admin only)
  router.post('/settings', adminGuard, (req: Request, res: Response) => {
    const body = req.body as Record<string, unknown>;
    const patch: { customLogoPath?: string | null; customCssPath?: string | null } = {};

    if ('customLogoPath' in body) {
      patch.customLogoPath = typeof body.customLogoPath === 'string' && body.customLogoPath.length > 0
        ? body.customLogoPath
        : null;
    }
    if ('customCssPath' in body) {
      patch.customCssPath = typeof body.customCssPath === 'string' && body.customCssPath.length > 0
        ? body.customCssPath
        : null;
    }

    deps.saveBrandingSettings(patch);
    res.json({
      customLogoPath: deps.getCustomLogoPath(),
      customCssPath: deps.getCustomCssPath(),
    });
  });

  // GET /branding/logo
  router.get('/logo', (_req: Request, res: Response) => {
    const logoPath = deps.getCustomLogoPath();
    if (!logoPath) {
      res.status(404).type('text/plain').send('No custom logo configured');
      return;
    }
    if (!fs.existsSync(logoPath)) {
      res.status(404).type('text/plain').send('Logo file not found');
      return;
    }
    const ext = path.extname(logoPath).toLowerCase();
    const mime = MIME_MAP[ext] ?? 'application/octet-stream';
    try {
      const buf = fs.readFileSync(logoPath);
      res.setHeader('Content-Type', mime);
      res.setHeader('Cache-Control', 'no-cache');
      res.send(buf);
    } catch {
      res.status(500).type('text/plain').send('Error reading logo file');
    }
  });

  // GET /branding/style.css
  router.get('/style.css', (_req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/css; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    const cssPath = deps.getCustomCssPath();
    if (!cssPath || !fs.existsSync(cssPath)) {
      // Return empty CSS — the <link> tag is always present in HTML, so 404 would
      // produce a browser console error. Empty CSS is harmless.
      res.send('/* no custom styles */\n');
      return;
    }
    try {
      const css = fs.readFileSync(cssPath, 'utf-8');
      res.send(css);
    } catch {
      res.status(500).type('text/plain').send('Error reading CSS file');
    }
  });

  // GET /branding/template.css
  router.get('/template.css', (_req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/css; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="pconair-branding-template.css"');
    res.setHeader('Cache-Control', 'no-cache');
    res.send(CSS_TEMPLATE);
  });

  return router;
}
