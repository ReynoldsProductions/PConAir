import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import type { AuthManager } from '../auth';
import type { PresetsStore } from '../presets';
import type { L3CueStore } from '../l3/cue-store';
import type { L3PlaylistStore } from '../l3/playlist-store';
import type { MediaLibraryStore } from '../media-library/item-store';
import type { ProfilePaths } from '../profiles/paths';
import type { ShowProfile } from '../profiles/types';
import { requireAdmin } from './middleware';
import {
  listProfilesMetadata,
  loadProfile,
  writeProfile,
  patchShowProfile,
  toApiProfile,
  deleteProfileFiles,
  setActiveProfile,
  listBackupsForProfile,
  createManualBackupRecord,
  restoreBackupIntoProfile,
  deleteBackup,
  findBackupFile,
  createNewProfile,
} from '../profiles/bootstrap';
import { buildProfileExportZip, confirmProfileImport, stageProfileZipImport, sweepImportStaging } from '../profiles/bundle-zip';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 512 * 1024 * 1024 } });

export interface ProfilesRouterDeps {
  paths: ProfilePaths;
  getActiveProfileId: () => string;
  auth: AuthManager;
  presets: PresetsStore;
  l3Cues: L3CueStore;
  l3Playlists: L3PlaylistStore;
  mediaLibrary: MediaLibraryStore;
  onProfileActivate?: () => void;
}

export function createProfilesRouter(d: ProfilesRouterDeps): Router {
  const router = Router();
  const admin = requireAdmin(d.auth);

  router.get('/', (_req: Request, res: Response) => {
    res.json({ profiles: listProfilesMetadata(d.paths) });
  });

  router.get('/active', (_req: Request, res: Response) => {
    const id = d.getActiveProfileId();
    const p = loadProfile(d.paths, id);
    if (!p) {
      res.status(404).json({ error: { code: 'PRESET_NOT_FOUND', message: 'No active profile' } });
      return;
    }
    res.json({
      id: p.id,
      name: p.name,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    });
  });

  router.get('/:profileId', admin, (req: Request, res: Response) => {
    const p = loadProfile(d.paths, req.params.profileId);
    if (!p) {
      res.status(404).json({ error: { code: 'PRESET_NOT_FOUND', message: 'Profile not found' } });
      return;
    }
    res.json(toApiProfile(p));
  });

  router.post('/', admin, (req: Request, res: Response) => {
    const name = (req.body as { name?: string }).name?.trim();
    if (!name) {
      res.status(400).json({ error: { code: 'INVALID_URL', message: 'name is required' } });
      return;
    }
    const active = loadProfile(d.paths, d.getActiveProfileId());
    if (!active) {
      res.status(500).json({ error: { code: 'INVALID_MODE', message: 'Active profile missing' } });
      return;
    }
    const created = createNewProfile(d.paths, name, active);
    res.status(201).json({
      id: created.id,
      name: created.name,
      createdAt: created.createdAt,
      updatedAt: created.updatedAt,
    });
  });

  router.patch('/:profileId', admin, (req: Request, res: Response) => {
    const cur = loadProfile(d.paths, req.params.profileId);
    if (!cur) {
      res.status(404).json({ error: { code: 'PRESET_NOT_FOUND', message: 'Profile not found' } });
      return;
    }
    const body = { ...(req.body as Partial<ShowProfile>) };
    delete (body as { hasPins?: unknown }).hasPins;
    delete (body as { operatorPinHash?: unknown }).operatorPinHash;
    delete (body as { adminPinHash?: unknown }).adminPinHash;
    delete (body as { id?: unknown }).id;
    delete (body as { schemaVersion?: unknown }).schemaVersion;
    const next = patchShowProfile(cur, body);
    writeProfile(d.paths, next, 'automatic');
    if (req.params.profileId === d.getActiveProfileId() && body.urlPresets) {
      d.presets.replaceAll(next.urlPresets);
    }
    const saved = loadProfile(d.paths, req.params.profileId)!;
    res.json(toApiProfile(saved));
  });

  router.delete('/:profileId', admin, (req: Request, res: Response) => {
    const id = req.params.profileId;
    if (id === d.getActiveProfileId()) {
      res.status(400).json({ error: { code: 'INVALID_MODE', message: 'Cannot delete the active profile' } });
      return;
    }
    const confirm = (req.body as { confirm?: boolean }).confirm === true;
    if (!confirm) {
      res.status(400).json({ error: { code: 'INVALID_URL', message: 'confirm: true required' } });
      return;
    }
    if (!loadProfile(d.paths, id)) {
      res.status(404).json({ error: { code: 'PRESET_NOT_FOUND', message: 'Profile not found' } });
      return;
    }
    deleteProfileFiles(d.paths, id);
    res.status(204).end();
  });

  router.post('/:profileId/activate', admin, (req: Request, res: Response) => {
    const p = setActiveProfile(d.paths, req.params.profileId);
    if (!p) {
      res.status(404).json({ error: { code: 'PRESET_NOT_FOUND', message: 'Profile not found' } });
      return;
    }
    d.onProfileActivate?.();
    res.json({
      message: 'Profile activated. App will restart.',
      profileId: p.id,
      profileName: p.name,
    });
  });

  router.post('/:profileId/export', admin, async (req: Request, res: Response) => {
    const p = loadProfile(d.paths, req.params.profileId);
    if (!p) {
      res.status(404).json({ error: { code: 'PRESET_NOT_FOUND', message: 'Profile not found' } });
      return;
    }
    const body = (req.body as { includeStillStore?: boolean; includeMediaLibrary?: boolean }) ?? {};
    const includeStillStore = body.includeStillStore !== false;
    const includeMediaLibrary = body.includeMediaLibrary !== false;
    const buf = await buildProfileExportZip({
      profile: p,
      cues: d.l3Cues.list(),
      mediaLibrary: d.mediaLibrary,
      appVersion: process.env.npm_package_version ?? '0.1.0',
      includeStillStore,
      includeMediaLibrary,
    });
    const day = new Date().toISOString().slice(0, 10);
    const safe = p.name.replace(/[^\w.\-()+ ]+/g, '_').slice(0, 80) || 'profile';
    const filename = `pc-on-air-${safe}-${day}.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buf);
  });

  router.post('/import', admin, upload.single('file'), async (req: Request, res: Response) => {
    sweepImportStaging();
    const file = req.file;
    if (!file?.buffer) {
      res.status(400).json({ error: { code: 'INVALID_URL', message: 'file field required (zip bundle)' } });
      return;
    }
    const { bundleId, body } = await stageProfileZipImport(file.buffer, d.paths);
    if (!bundleId) {
      res.status(400).json(body);
      return;
    }
    res.json({ bundleId, ...body });
  });

  router.post('/import/confirm', admin, (req: Request, res: Response) => {
    const { bundleId, action, switchToProfileAfter } = req.body as {
      bundleId?: string;
      action?: string;
      switchToProfileAfter?: boolean;
    };
    if (!bundleId || (action !== 'overwrite' && action !== 'import_as_copy')) {
      res
        .status(400)
        .json({ error: { code: 'INVALID_URL', message: 'bundleId and action (overwrite|import_as_copy) required' } });
      return;
    }
    const r = confirmProfileImport({
      bundleId,
      action,
      switchToProfileAfter: Boolean(switchToProfileAfter),
      paths: d.paths,
      presets: d.presets,
      cues: d.l3Cues,
      playlists: d.l3Playlists,
      activeProfileId: d.getActiveProfileId(),
    });
    if (!r.ok) {
      res.status(400).json({ error: { code: 'INVALID_MODE', message: r.error } });
      return;
    }
    res.json(r);
  });

  router.get('/:profileId/backups', admin, (req: Request, res: Response) => {
    const id = req.params.profileId;
    if (!loadProfile(d.paths, id)) {
      res.status(404).json({ error: { code: 'PRESET_NOT_FOUND', message: 'Profile not found' } });
      return;
    }
    const backups = listBackupsForProfile(d.paths, id).map((b) => ({
      id: b.id,
      timestamp: b.timestamp,
      type: b.type,
      note: b.note,
    }));
    res.json({ profileId: id, backups });
  });

  router.post('/:profileId/backups', admin, (req: Request, res: Response) => {
    const id = req.params.profileId;
    if (!loadProfile(d.paths, id)) {
      res.status(404).json({ error: { code: 'PRESET_NOT_FOUND', message: 'Profile not found' } });
      return;
    }
    const note = (req.body as { note?: string }).note;
    const rec = createManualBackupRecord(d.paths, id, note);
    if (!rec) {
      res.status(500).json({ error: { code: 'INVALID_MODE', message: 'Backup failed' } });
      return;
    }
    res.status(201).json(rec);
  });

  router.post('/:profileId/backups/:backupId/restore', admin, (req: Request, res: Response) => {
    const id = req.params.profileId;
    const env = restoreBackupIntoProfile(d.paths, id, req.params.backupId);
    if (!env) {
      res.status(404).json({ error: { code: 'PRESET_NOT_FOUND', message: 'Backup not found' } });
      return;
    }
    if (id === d.getActiveProfileId()) {
      d.presets.replaceAll(env.urlPresets);
    }
    res.json({
      message: 'Profile restored from backup.',
      timestamp: req.params.backupId,
      restartRequired: true,
    });
  });

  router.get('/:profileId/backups/:backupId/download', admin, (req: Request, res: Response) => {
    const id = req.params.profileId;
    const fp = findBackupFile(d.paths, id, req.params.backupId);
    if (!fp) {
      res.status(404).json({ error: { code: 'PRESET_NOT_FOUND', message: 'Backup not found' } });
      return;
    }
    const prof = loadProfile(d.paths, id);
    const safe = (prof?.name ?? 'profile').replace(/[^\w.\-()+ ]+/g, '_');
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${safe}-backup.json"`);
    res.sendFile(path.resolve(fp));
  });

  router.delete('/:profileId/backups/:backupId', admin, (req: Request, res: Response) => {
    const ok = deleteBackup(d.paths, req.params.profileId, req.params.backupId);
    if (!ok) {
      res.status(404).json({ error: { code: 'PRESET_NOT_FOUND', message: 'Backup not found' } });
      return;
    }
    res.status(204).end();
  });

  return router;
}
