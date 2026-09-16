import { Router, Request, Response, NextFunction } from 'express';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import type { PackageHub } from '../packages/state-hub';
import type { PresenceRegistry } from '../packages/presence';
import type { AuthManager } from '../auth';
import type { TransportEngine, TransportVerb } from '../packages/transport';
import { requireOperator } from './middleware';

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

/**
 * Operator auth for the transport routes: a valid operator/admin session
 * cookie, OR the `operator_pin` query param verified against the operator
 * PIN -- same fallback POST /api/action already gives Companion (routes/
 * action.ts), because unlike the admin web GUI's other operator-gated
 * routes (including spec 16's read-only presence routes below, which stay
 * cookie-only via requireOperator), the Companion module talks to PConAir
 * cookie-less and only ever carries a PIN. requireOperator() (middleware.ts)
 * is cookie-only, which is right for the admin GUI but would make the
 * transport routes uncallable from Companion, defeating spec 15 section 3.7.
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

export function createPackagesRouter(
  hub: PackageHub,
  auth: AuthManager,
  transportEngine: TransportEngine,
  presence: PresenceRegistry
): Router {
  const router = Router();
  const opGuard = requireOperator(auth);
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

  router.get('/packages/:id/control', (req: Request, res: Response) => {
    const pkg = hub.find(req.params.id);
    if (!pkg || !pkg.controlFile) {
      res.status(404).type('text/plain').send('Package or control UI not found');
      return;
    }
    sendPackageFile(res, pkg.dir, pkg.controlFile);
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

  return router;
}
