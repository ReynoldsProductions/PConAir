import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import type { PackageHub } from '../packages/state-hub';

/**
 * Packages API + render/control/asset serving.
 * Render pages load in OBS (no cookies) and control pages are opened from the
 * web GUI; both are LAN-gated by the global IP allowlist. State mutations are
 * likewise cookie-less so Companion and control UIs share one path.
 */
export function createPackagesRouter(hub: PackageHub): Router {
  const router = Router();

  router.get('/api/packages', (_req: Request, res: Response) => {
    res.json({
      packages: hub.list().map((p) => ({
        id: p.manifest.id,
        name: p.manifest.name,
        version: p.manifest.version,
        description: p.manifest.description ?? '',
        renders: p.manifest.renders.map((r) => ({ id: r.id, label: r.label ?? r.id })),
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
    const patch = req.body as Record<string, unknown>;
    if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) {
      res.status(400).json({ error: { code: 'INVALID_MODE', message: 'Body must be a JSON object (state patch)' } });
      return;
    }
    const next = hub.patchState(req.params.id, patch);
    if (!next) {
      res.status(404).json({ error: { code: 'ITEM_NOT_FOUND', message: `Package '${req.params.id}' not found` } });
      return;
    }
    res.json({ state: next });
  });

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
    sendPackageFile(res, pkg.dir, render.file);
  });

  // Single-render convenience: /packages/:id/render serves the first render.
  router.get('/packages/:id/render', (req: Request, res: Response) => {
    const pkg = hub.find(req.params.id);
    if (!pkg) {
      res.status(404).type('text/plain').send('Package not found');
      return;
    }
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
