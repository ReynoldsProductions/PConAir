import { Router, Request, Response, NextFunction } from 'express';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import type { AuthManager } from '../auth';
import type { PackageHub } from '../packages/state-hub';
import type { PresenceRegistry } from '../packages/presence';
import type { TransportEngine, TransportVerb } from '../packages/transport';
import type { DataOverridesStore } from '../packages/data-overrides';
import type { DataSourcePoller } from '../packages/data-sources';
import { requireOperator, requireAdmin } from './middleware';
import { validateColorPatch } from '../packages/controls-validate';

/**
 * Packages API + render/control/asset serving.
 * Render pages load in OBS (no cookies) and control pages are opened from the
 * web GUI; both are LAN-gated by the global IP allowlist. State mutations are
 * likewise cookie-less so Companion and control UIs share one path.
 */
const ALLOWED_ASSET_MIME: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/svg+xml': '.svg',
  'image/webp': '.webp',
};

const TRANSPORT_VERBS: TransportVerb[] = ['play', 'next', 'stop', 'clear'];

/** HTML-escape for text and attribute contexts. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * JSON safe to embed in an inline <script>. `<` is escaped so a string value
 * can never close the script element, and the two JS-illegal line separators
 * (U+2028/U+2029, legal in JSON but not in a JS string literal) with it.
 */
function jsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/**
 * The generated operator panel shell (spec 18 §3.6) for a package that
 * declares `controls` and ships no control.html.
 *
 * Deliberately tiny: it loads the shared runtime plus the panel renderer and
 * hands off. Everything about how a field is drawn lives in
 * src/runtime/pconair-controls.js, so a change there reaches every generated
 * panel without touching this file. Both scripts are loaded unconditionally
 * because a generated panel always needs both; render pages load neither.
 */
function generatedControlShell(manifest: { id: string; name: string }): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${escapeHtml(manifest.name)} — Control</title>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<link rel="stylesheet" href="/packages/_runtime/pconair.css" />
</head>
<body class="pc-panel-body">
<div id="pc-panel-root"></div>
<script src="/packages/_runtime/pconair.js"></script>
<script src="/packages/_runtime/pconair-controls.js"></script>
<script>
  window.PConAir.controlPanel(document.getElementById('pc-panel-root'), {
    packageId: ${jsonForScript(manifest.id)},
    name: ${jsonForScript(manifest.name)}
  });
</script>
</body>
</html>
`;
}

/**
 * Operator auth for the transport routes: a valid operator/admin session
 * cookie, OR the `operator_pin` query param verified against the operator
 * PIN -- same fallback POST /api/action already gives Companion (routes/
 * action.ts), because unlike the admin web GUI's other operator-gated
 * routes (including spec 16's read-only presence routes and spec 20's data
 * source routes below, which stay cookie-only via requireOperator/
 * requireAdmin), the Companion module talks to PConAir cookie-less and only
 * ever carries a PIN. requireOperator() (middleware.ts) is cookie-only,
 * which is right for the admin GUI but would make the transport routes
 * uncallable from Companion, defeating spec 15 section 3.7.
 */
function requireOperatorOrPin(auth: AuthManager) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
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
    next();
  };
}

export interface PackagesRouterDeps {
  hub: PackageHub;
  auth: AuthManager;
  transportEngine: TransportEngine;
  presence: PresenceRegistry;
  /** Spec 20 -- null when the packages system as a whole is disabled. */
  dataOverrides: DataOverridesStore | null;
  dataSourcePoller: DataSourcePoller | null;
}

export function createPackagesRouter(deps: PackagesRouterDeps): Router {
  const { hub, auth, transportEngine, presence, dataOverrides, dataSourcePoller } = deps;
  const router = Router();
  const opGuard = requireOperator(auth);
  const adminGuard = requireAdmin(auth);
  const operatorGuard = requireOperatorOrPin(auth);

  const assetUpload = multer({
    storage: multer.diskStorage({
      destination: (req, _file, cb) => {
        const pkg = hub.find((req.params as { id: string }).id);
        if (!pkg) {
          cb(new Error('Package not found'), '');
          return;
        }
        const assetsDir = path.join(pkg.dir, 'assets');
        fs.mkdirSync(assetsDir, { recursive: true });
        cb(null, assetsDir);
      },
      filename: (_req, file, cb) => {
        const ext = ALLOWED_ASSET_MIME[file.mimetype] ?? (path.extname(file.originalname).toLowerCase() || '.bin');
        const base = path.basename(file.originalname, path.extname(file.originalname))
          .replace(/[^a-zA-Z0-9_-]/g, '_')
          .slice(0, 64);
        cb(null, `${base}${ext}`);
      },
    }),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      if (ALLOWED_ASSET_MIME[file.mimetype]) {
        cb(null, true);
      } else {
        cb(new Error('Only image files are allowed'));
      }
    },
  });

  router.post('/api/packages/:id/assets', assetUpload.single('file'), (req: Request, res: Response) => {
    const pkg = hub.find(req.params.id);
    if (!pkg) {
      res.status(404).json({ error: { code: 'ITEM_NOT_FOUND', message: `Package '${req.params.id}' not found` } });
      return;
    }
    if (!req.file) {
      res.status(400).json({ error: { code: 'INVALID_MODE', message: 'No file uploaded' } });
      return;
    }
    res.json({
      path: `/packages/${req.params.id}/assets/${req.file.filename}`,
      filename: req.file.filename,
    });
  });

  router.get('/api/packages/:id/assets', (req: Request, res: Response) => {
    const pkg = hub.find(req.params.id);
    if (!pkg) {
      res.status(404).json({ error: { code: 'ITEM_NOT_FOUND', message: `Package '${req.params.id}' not found` } });
      return;
    }
    const assetsDir = path.join(pkg.dir, 'assets');
    if (!fs.existsSync(assetsDir)) {
      res.json({ assets: [] });
      return;
    }
    const files = fs.readdirSync(assetsDir).filter((f) => {
      try { return fs.statSync(path.join(assetsDir, f)).isFile(); } catch { return false; }
    });
    res.json({
      assets: files.map((f) => ({
        filename: f,
        path: `/packages/${req.params.id}/assets/${f}`,
      })),
    });
  });

  router.get('/api/packages', (_req: Request, res: Response) => {
    res.json({
      packages: hub.list().map((p) => ({
        id: p.manifest.id,
        name: p.manifest.name,
        version: p.manifest.version,
        description: p.manifest.description ?? '',
        renders: p.manifest.renders.map((r) => ({
          id: r.id,
          label: r.label ?? r.id,
          // Lets the Companion module synthesise transport actions/feedback/
          // variables for this render without a second round trip.
          transport: r.transport ?? null,
        })),
        hasControl: p.controlFile !== null,
        live: hub.subscriberCount(p.manifest.id) > 0,
        // Declarative Companion interface — registered dynamically by the
        // PConAir Companion module (phase 9).
        companionActions: p.manifest.companionActions ?? [],
        companionFeedbacks: p.manifest.companionFeedbacks ?? [],
        companionVariables: p.manifest.companionVariables ?? [],
        companionDerived: p.manifest.companionDerived ?? [],
      })),
      errors: hub.errors(),
    });
  });

  router.post('/api/packages/rescan', (_req: Request, res: Response) => {
    hub.rescan();
    // Manifests may have changed which data sources exist, or their URLs/poll
    // intervals — rebuild the poller's timers to match.
    dataSourcePoller?.reload();
    res.json({ count: hub.list().length, errors: hub.errors() });
  });

  router.get('/api/packages/:id/state', (req: Request, res: Response) => {
    const state = hub.getState(req.params.id);
    if (!state) {
      res.status(404).json({ error: { code: 'ITEM_NOT_FOUND', message: `Package '${req.params.id}' not found` } });
      return;
    }
    res.json({ state });
  });

  router.post('/api/packages/:id/state', (req: Request, res: Response) => {
    const raw = req.body as Record<string, unknown>;
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      res.status(400).json({ error: { code: 'INVALID_MODE', message: 'Body must be a JSON object (state patch)' } });
      return;
    }
    // Leading-underscore keys are reserved for the engine (_transport this
    // spec, _data/_meta later) — strip them from a generic state patch so a
    // naive or malicious caller cannot clobber engine-managed state via the
    // package's own state route. See specs/15-graphics-transport.md §Global
    // Constraints.
    const patch: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(raw)) {
      if (key.startsWith('_')) continue;
      patch[key] = value;
    }
    // A `color`-typed control's value ends up in a CSS custom property on a
    // live render's <html style="...">, via client.applyStyle(). This is the
    // gate: an unvalidated value reaching state here would be a CSS injection
    // into every connected output, and every output would then have it before
    // anyone noticed. Checked BEFORE hub.patchState so a rejected patch
    // applies nothing at all. See spec 18 §3.3.
    const colorError = validateColorPatch(hub.find(req.params.id)?.manifest.controls, patch);
    if (colorError) {
      res.status(400).json({ error: { code: 'INVALID_MODE', message: colorError } });
      return;
    }
    const next = hub.patchState(req.params.id, patch);
    if (!next) {
      res.status(404).json({ error: { code: 'ITEM_NOT_FOUND', message: `Package '${req.params.id}' not found` } });
      return;
    }
    // `delivered: 0` means the call succeeded and nothing was listening — it is
    // not an error (spec 16 §3.3, docs/designing-packages.md).
    res.json({ state: next, delivered: presence.forPackage(req.params.id).renders });
  });

  // Spec 15's transport routes (below) now carry `delivered` too -- see the
  // res.json calls in the transport section for how each is scoped.

  /** GET /api/packages/:id/presence — presence for one package. */
  router.get('/api/packages/:id/presence', opGuard, (req: Request, res: Response) => {
    res.json(presence.forPackage(req.params.id));
  });

  /** GET /api/presence — presence for every package, plus the raw client list. */
  router.get('/api/presence', opGuard, (_req: Request, res: Response) => {
    const packages: Record<string, ReturnType<typeof presence.forPackage>> = {};
    for (const p of hub.list()) {
      packages[p.manifest.id] = presence.forPackage(p.manifest.id);
    }
    res.json({ packages, clients: presence.all() });
  });

  // ── Transport (spec 15) ──────────────────────────────────────────────────

  router.get('/api/packages/:id/transport', operatorGuard, (req: Request, res: Response) => {
    const pkg = hub.find(req.params.id);
    if (!pkg) {
      res.status(404).json({ error: { code: 'ITEM_NOT_FOUND', message: `Package '${req.params.id}' not found` } });
      return;
    }
    const snapshot: Record<string, unknown> = {};
    for (const r of pkg.manifest.renders) {
      if (!r.transport) continue;
      const s = transportEngine.get(pkg.manifest.id, r.id);
      if (s) snapshot[r.id] = s;
    }
    res.json(snapshot);
  });

  router.post('/api/packages/:id/transport/clear-all', operatorGuard, (req: Request, res: Response) => {
    const pkg = hub.find(req.params.id);
    if (!pkg) {
      res.status(404).json({ error: { code: 'ITEM_NOT_FOUND', message: `Package '${req.params.id}' not found` } });
      return;
    }
    const cleared = pkg.manifest.renders.filter((r) => r.transport).map((r) => r.id);
    transportEngine.clearAll(pkg.manifest.id);
    // delivered (spec 16 s3.3): count every render output subscribed to this
    // package, not just the transport-managed ones -- matches the meaning
    // `delivered` already carries on POST /state above.
    res.json({ ok: true, cleared, delivered: presence.forPackage(pkg.manifest.id).renders });
  });

  router.post('/api/packages/:id/transport/:renderId/:verb', operatorGuard, (req: Request, res: Response) => {
    const { id, renderId, verb } = req.params;
    if (!TRANSPORT_VERBS.includes(verb as TransportVerb)) {
      res.status(400).json({
        error: { code: 'INVALID_VERB', message: `verb must be one of: ${TRANSPORT_VERBS.join(', ')}` },
      });
      return;
    }
    const pkg = hub.find(id);
    const render = pkg?.manifest.renders.find((r) => r.id === renderId);
    if (!pkg || !render || !render.transport) {
      res.status(404).json({
        error: { code: 'ITEM_NOT_FOUND', message: `Render '${renderId}' in package '${id}' is not transport-managed` },
      });
      return;
    }
    const state = transportEngine.dispatch(id, renderId, verb as TransportVerb);
    if (!state) {
      res.status(404).json({ error: { code: 'ITEM_NOT_FOUND', message: 'Transport dispatch failed' } });
      return;
    }
    // delivered (spec 16 s3.3): count only outputs for THIS render -- a
    // scoreboard's clock take should not read as delivered because the
    // package's ticker render happens to have a browser source open.
    res.json({
      ok: true,
      verb,
      renderId,
      transport: state,
      delivered: presence.forPackage(id).byRender[renderId] ?? 0,
    });
  });

  /**
   * Render pages may be framed by another page from this same origin — that is
   * how a package composes several of its renders into one browser source (see
   * news/render-all.html). The global X-Frame-Options: DENY would block that, so
   * render routes relax it to SAMEORIGIN; control pages, the admin GUI and every
   * other route keep DENY. Renders carry no controls and no authenticated
   * actions, so there is nothing for a same-origin frame to clickjack.
   */
  function allowSameOriginFraming(res: Response): void {
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  }

  function sendPackageFile(res: Response, baseDir: string, relFile: string): void {
    const abs = path.resolve(baseDir, relFile);
    if (!abs.startsWith(path.resolve(baseDir) + path.sep)) {
      res.status(400).type('text/plain').send('Invalid path');
      return;
    }
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
      res.status(404).type('text/plain').send('Not found');
      return;
    }
    res.sendFile(abs);
  }

  router.get('/packages/:id/render/:renderId', (req: Request, res: Response) => {
    const pkg = hub.find(req.params.id);
    const render = pkg?.manifest.renders.find((r) => r.id === req.params.renderId);
    if (!pkg || !render) {
      res.status(404).type('text/plain').send('Package or render not found');
      return;
    }
    allowSameOriginFraming(res);
    sendPackageFile(res, pkg.dir, render.file);
  });

  // Single-render convenience: /packages/:id/render serves the first render.
  router.get('/packages/:id/render', (req: Request, res: Response) => {
    const pkg = hub.find(req.params.id);
    if (!pkg) {
      res.status(404).type('text/plain').send('Package not found');
      return;
    }
    allowSameOriginFraming(res);
    sendPackageFile(res, pkg.dir, pkg.manifest.renders[0].file);
  });

  /**
   * Serving precedence (spec 18 §3.6):
   *   1. control.html present        → serve it, unchanged. Existing packages
   *                                    keep their hand-written panels, and a
   *                                    package may have BOTH and call
   *                                    PConAir.controlPanel() itself for part
   *                                    of the page.
   *   2. manifest declares `controls` → serve the generated shell.
   *   3. neither                      → 404, as before.
   */
  router.get('/packages/:id/control', (req: Request, res: Response) => {
    const pkg = hub.find(req.params.id);
    if (!pkg) {
      res.status(404).type('text/plain').send('Package or control UI not found');
      return;
    }
    if (pkg.controlFile) {
      sendPackageFile(res, pkg.dir, pkg.controlFile);
      return;
    }
    if (pkg.manifest.controls) {
      // Note: no allowSameOriginFraming() here. A control page is an operator
      // surface with mutating actions, so it keeps the global DENY; only
      // render routes relax framing.
      res.type('html').send(generatedControlShell(pkg.manifest));
      return;
    }
    res.status(404).type('text/plain').send('Package or control UI not found');
  });

  /**
   * The validated `controls` document, plus the identity and render list the
   * generated panel needs for its header and preview selector. One small
   * document rather than the whole manifest (spec 18 §3.6).
   */
  router.get('/api/packages/:id/controls', opGuard, (req: Request, res: Response) => {
    const pkg = hub.find(req.params.id);
    if (!pkg || !pkg.manifest.controls) {
      res.status(404).json({
        error: { code: 'ITEM_NOT_FOUND', message: `Package '${req.params.id}' declares no controls` },
      });
      return;
    }
    res.json({
      id: pkg.manifest.id,
      name: pkg.manifest.name,
      renders: pkg.manifest.renders.map((r) => ({
        id: r.id,
        label: r.label ?? r.id,
        transport: r.transport ?? null,
      })),
      controls: pkg.manifest.controls,
    });
  });

  router.get('/packages/:id/assets/*', (req: Request, res: Response) => {
    const pkg = hub.find(req.params.id);
    if (!pkg) {
      res.status(404).type('text/plain').send('Package not found');
      return;
    }
    const relStr = String((req.params as unknown as Record<string, string>)[0] ?? '');
    // Assets are confined to the package's assets/ subdirectory.
    sendPackageFile(res, path.join(pkg.dir, 'assets'), relStr);
  });

  // ── Data sources (spec 20) ──────────────────────────────────────────────
  // Declaration (manifest) + operator/admin override + last result, merged.
  // See src/main/packages/data-sources.ts for the poller and safety guard.

  function findDataSource(packageId: string, sourceId: string) {
    const pkg = hub.find(packageId);
    const source = pkg?.manifest.dataSources?.find((s) => s.id === sourceId);
    return { pkg, source };
  }

  router.get('/api/packages/:id/data', opGuard, (req: Request, res: Response) => {
    const pkg = hub.find(req.params.id);
    if (!pkg) {
      res.status(404).json({ error: { code: 'ITEM_NOT_FOUND', message: `Package '${req.params.id}' not found` } });
      return;
    }
    if (!dataSourcePoller) {
      res.status(501).json({ error: { code: 'NOT_IMPLEMENTED', message: 'Data sources are not available' } });
      return;
    }
    res.json({ sources: dataSourcePoller.buildViews(pkg.manifest.id) });
  });

  router.put('/api/packages/:id/data/:sourceId', adminGuard, (req: Request, res: Response) => {
    const { pkg, source } = findDataSource(req.params.id, req.params.sourceId);
    if (!pkg) {
      res.status(404).json({ error: { code: 'ITEM_NOT_FOUND', message: `Package '${req.params.id}' not found` } });
      return;
    }
    if (!source) {
      res.status(404).json({ error: { code: 'ITEM_NOT_FOUND', message: `Data source '${req.params.sourceId}' not found` } });
      return;
    }
    if (!dataOverrides || !dataSourcePoller) {
      res.status(501).json({ error: { code: 'NOT_IMPLEMENTED', message: 'Data sources are not available' } });
      return;
    }
    const body = req.body as { url?: unknown; pollSeconds?: unknown; enabled?: unknown };
    const patch: { url?: string; pollSeconds?: number; enabled?: boolean } = {};
    if (body.url !== undefined) {
      if (typeof body.url !== 'string') {
        res.status(400).json({ error: { code: 'INVALID_MODE', message: 'url must be a string' } });
        return;
      }
      patch.url = body.url;
    }
    if (body.pollSeconds !== undefined) {
      if (typeof body.pollSeconds !== 'number' || !Number.isInteger(body.pollSeconds) || body.pollSeconds <= 0) {
        res.status(400).json({ error: { code: 'INVALID_MODE', message: 'pollSeconds must be a positive integer' } });
        return;
      }
      patch.pollSeconds = body.pollSeconds;
    }
    if (body.enabled !== undefined) {
      if (typeof body.enabled !== 'boolean') {
        res.status(400).json({ error: { code: 'INVALID_MODE', message: 'enabled must be a boolean' } });
        return;
      }
      patch.enabled = body.enabled;
    }
    dataOverrides.set(pkg.manifest.id, source.id, patch);
    dataSourcePoller.reload();
    const view = dataSourcePoller.buildViews(pkg.manifest.id).find((v) => v.id === source.id);
    res.json({ source: view });
  });

  router.post('/api/packages/:id/data/:sourceId/refresh', opGuard, async (req: Request, res: Response) => {
    const { pkg, source } = findDataSource(req.params.id, req.params.sourceId);
    if (!pkg) {
      res.status(404).json({ error: { code: 'ITEM_NOT_FOUND', message: `Package '${req.params.id}' not found` } });
      return;
    }
    if (!source) {
      res.status(404).json({ error: { code: 'ITEM_NOT_FOUND', message: `Data source '${req.params.sourceId}' not found` } });
      return;
    }
    if (!dataSourcePoller) {
      res.status(501).json({ error: { code: 'NOT_IMPLEMENTED', message: 'Data sources are not available' } });
      return;
    }
    const result = await dataSourcePoller.refresh(pkg.manifest.id, source.id);
    res.json({ result });
  });

  // ── Diagnostics (spec 21) ────────────────────────────────────────────────
  router.get('/api/diagnostics', opGuard, (_req: Request, res: Response) => {
    const pkgjson = require('../../../package.json');
    const mem = process.memoryUsage();
    const packages = hub.list().map((pkg) => ({
      id: pkg.manifest.id,
      version: pkg.manifest.version,
      renders: pkg.manifest.renders.map((r) => r.id),
      hasControl: pkg.controlFile !== null,
    }));
    // Spec 16's presence registry is guaranteed present now that both specs
    // are merged (this file's constructor no longer takes an optional auth,
    // so `presence` is always in scope) -- shares the exact shape GET
    // /api/presence returns, per specs/21-debug-diagnostics.md s3.6.
    const presenceBody = {
      packages: Object.fromEntries(hub.list().map((pkg) => [pkg.manifest.id, presence.forPackage(pkg.manifest.id)])),
      clients: presence.all(),
    };
    res.json({
      version: pkgjson.version,
      uptimeSeconds: Math.floor(process.uptime()),
      platform: process.platform + ' ' + require('os').release(),
      memoryMB: {
        rss: Math.round(mem.rss / 1024 / 1024),
        heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
      },
      packages,
      presence: presenceBody,
    });
  });


  return router;
}
