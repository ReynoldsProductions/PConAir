import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import JSZip from 'jszip';
import type { L3Cue } from '../l3/cue-store';
import type { MediaLibraryStore } from '../media-library/item-store';
import type { PresetsStore } from '../presets';
import type { L3CueStore } from '../l3/cue-store';
import type { L3PlaylistStore } from '../l3/playlist-store';
import type { ProfilePaths } from './paths';
import type { ShowProfile } from './types';
import {
  tryParseShowProfile,
  writeProfile,
  loadProfile,
  listProfilesMetadata,
  setActiveProfile,
} from './bootstrap';

export interface StillStoreExportV1 {
  version: '1.0';
  items: Array<{
    id: string;
    name: string;
    title: string;
    subtitle?: string;
    theme: string;
    sourceType: 'manual' | 'csv' | 'image';
    createdAt: string;
    updatedAt: string;
  }>;
  themes: Array<{ name: string; displayName: string; description?: string; isBuiltIn: boolean }>;
}

export interface MediaLibraryExportV1 {
  version: '1.0';
  items: Array<{
    id: string;
    name: string;
    type: 'image' | 'video' | 'other';
    fileFormat: string;
    filePath: string;
    fileSize: number;
    width?: number;
    height?: number;
    tags?: string[];
    createdAt: string;
    updatedAt: string;
  }>;
}

export interface BundleMetadataV1 {
  version: '1.0';
  createdAt: string;
  appVersion: string;
  profileId: string;
  profileName: string;
}

interface StagedImport {
  profile: ShowProfile;
  stillItems: StillStoreExportV1['items'];
  createdAt: number;
}

const staging = new Map<string, StagedImport>();

function cuesToStillExport(cues: L3Cue[]): StillStoreExportV1 {
  return {
    version: '1.0',
    items: cues.map((c) => ({
      id: c.id,
      name: c.name,
      title: c.title,
      subtitle: c.subtitle ?? undefined,
      theme: c.theme,
      sourceType: 'manual' as const,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    })),
    themes: [],
  };
}

function stillItemsToCues(items: StillStoreExportV1['items']): L3Cue[] {
  return items.map((row) => ({
    id: row.id,
    name: row.name,
    title: row.title,
    subtitle: row.subtitle ?? null,
    theme: row.theme,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));
}

export async function buildProfileExportZip(opts: {
  profile: ShowProfile;
  cues: L3Cue[];
  mediaLibrary: MediaLibraryStore;
  appVersion: string;
  includeStillStore: boolean;
  includeMediaLibrary: boolean;
}): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('profile.json', JSON.stringify(opts.profile, null, 2));

  const meta: BundleMetadataV1 = {
    version: '1.0',
    createdAt: new Date().toISOString(),
    appVersion: opts.appVersion,
    profileId: opts.profile.id,
    profileName: opts.profile.name,
  };
  zip.file('bundle-metadata.json', JSON.stringify(meta, null, 2));

  if (opts.includeStillStore && opts.cues.length > 0) {
    const still = cuesToStillExport(opts.cues);
    zip.file('still-store/index.json', JSON.stringify(still, null, 2));
  }

  if (opts.includeMediaLibrary) {
    const items = opts.mediaLibrary.list();
    if (items.length > 0) {
      const exportItems: MediaLibraryExportV1['items'] = [];
      for (const it of items) {
        const ext = path.extname(it.relativePath).replace(/^\./, '') || 'bin';
        const rel = `media-library/files/${it.id}.${ext}`;
        exportItems.push({
          id: it.id,
          name: it.displayName,
          type: it.mimeType.startsWith('image/') ? 'image' : 'other',
          fileFormat: ext,
          filePath: rel,
          fileSize: it.fileSize,
          width: it.width,
          height: it.height,
          tags: it.tags,
          createdAt: new Date(it.uploadedAt).toISOString(),
          updatedAt: new Date(it.updatedAt).toISOString(),
        });
        const abs = opts.mediaLibrary.absolutePath(it);
        if (fs.existsSync(abs)) {
          zip.file(rel, fs.readFileSync(abs));
        }
      }
      const ml: MediaLibraryExportV1 = { version: '1.0', items: exportItems };
      zip.file('media-library/index.json', JSON.stringify(ml, null, 2));
    }
  }

  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

export async function stageProfileZipImport(
  buf: Buffer,
  paths: ProfilePaths
): Promise<{
  bundleId: string;
  body: Record<string, unknown>;
}> {
  const errors: string[] = [];
  const warnings: string[] = [];
  let profile: ShowProfile | null = null;
  let stillItems: StillStoreExportV1['items'] = [];

  try {
    const zip = await JSZip.loadAsync(buf);
    const profFile = zip.file('profile.json');
    if (!profFile) errors.push('Missing profile.json');
    else {
      const raw = JSON.parse(await profFile.async('string')) as unknown;
      profile = tryParseShowProfile(raw);
      if (!profile) errors.push('Invalid profile.json or unsupported schemaVersion');
    }

    const stillFile = zip.file('still-store/index.json');
    if (stillFile) {
      try {
        const parsed = JSON.parse(await stillFile.async('string')) as Partial<StillStoreExportV1>;
        if (parsed.version === '1.0' && Array.isArray(parsed.items)) {
          stillItems = parsed.items as StillStoreExportV1['items'];
        }
      } catch {
        warnings.push('Could not parse still-store/index.json');
      }
    }

    if (profile) {
      const themeNames = new Set(stillItems.map((i) => i.theme));
      for (const t of themeNames) {
        const css = zip.file(`themes/${t}.css`);
        if (!css && t && !['default', 'dark', 'light'].includes(t)) {
          warnings.push(`Theme '${t}' not found in bundle`);
        }
      }
    }
  } catch {
    errors.push('Invalid zip archive');
  }

  const isValid = errors.length === 0 && profile !== null;
  if (!isValid || !profile) {
    return {
      bundleId: '',
      body: {
        bundle: null,
        validation: { isValid: false, errors, warnings },
        diff: null,
        conflictResolution: null,
      },
    };
  }

  const existing = listProfilesMetadata(paths).find((p) => p.name === profile.name);
  const current = existing ? loadProfile(paths, existing.id) : null;

  const diff = {
    new: {
      urlPresets: profile.urlPresets.length,
      backgroundPresets: profile.backgroundPresets.length,
      stillStoreItems: stillItems.length,
    },
    overwrite: current
      ? {
          urlPresets: current.urlPresets.length,
          backgroundPresets: current.backgroundPresets.length,
        }
      : { urlPresets: 0, backgroundPresets: 0 },
    missing: warnings.filter((w) => w.startsWith('Theme ')),
  };

  const bundleId = randomUUID();
  staging.set(bundleId, { profile, stillItems, createdAt: Date.now() });

  return {
    bundleId,
    body: {
      bundle: {
        profileId: profile.id,
        profileName: profile.name,
        createdAt: profile.createdAt,
      },
      validation: { isValid: true, errors, warnings },
      diff,
      conflictResolution: {
        profileExists: Boolean(existing),
        existingProfileId: existing?.id ?? null,
        options: ['overwrite', 'import_as_copy', 'cancel'],
      },
    },
  };
}

export function confirmProfileImport(opts: {
  bundleId: string;
  action: 'overwrite' | 'import_as_copy';
  switchToProfileAfter: boolean;
  paths: ProfilePaths;
  presets: PresetsStore;
  cues: L3CueStore;
  playlists: L3PlaylistStore;
  activeProfileId: string;
}):
  | { ok: true; profileId: string; profileName: string; message: string; actionTaken: string; restartRequired: boolean }
  | { ok: false; error: string } {
  const job = staging.get(opts.bundleId);
  if (!job) return { ok: false, error: 'Unknown or expired bundleId; run import again.' };
  staging.delete(opts.bundleId);

  let profile = structuredClone(job.profile);
  const stillItems = job.stillItems;

  const existingMeta = listProfilesMetadata(opts.paths).find((p) => p.name === profile.name);
  let actionTaken = opts.action;

  if (opts.action === 'import_as_copy') {
    const base = loadProfile(opts.paths, opts.activeProfileId);
    if (!base) return { ok: false, error: 'Active profile not found' };
    const stamp = new Date().toISOString().split('T')[0];
    const newName = `${job.profile.name} (imported ${stamp})`;
    profile = {
      ...job.profile,
      id: randomUUID(),
      name: newName,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      operatorPinHash: base.operatorPinHash,
      adminPinHash: base.adminPinHash,
    };
    writeProfile(opts.paths, profile, 'automatic');
    actionTaken = 'import_as_copy';
  } else if (opts.action === 'overwrite' && existingMeta) {
    const cur = loadProfile(opts.paths, existingMeta.id);
    if (!cur) return { ok: false, error: 'Existing profile missing' };
    profile = {
      ...job.profile,
      id: cur.id,
      createdAt: cur.createdAt,
      operatorPinHash: cur.operatorPinHash,
      adminPinHash: cur.adminPinHash,
      updatedAt: new Date().toISOString(),
    };
    writeProfile(opts.paths, profile, 'automatic');
    actionTaken = 'overwrite';
  } else {
    profile = {
      ...job.profile,
      updatedAt: new Date().toISOString(),
    };
    writeProfile(opts.paths, profile, 'automatic');
    actionTaken = 'overwrite';
  }

  const saved = loadProfile(opts.paths, profile.id);
  if (!saved) return { ok: false, error: 'Failed to persist profile' };

  if (opts.switchToProfileAfter) {
    setActiveProfile(opts.paths, saved.id);
  }

  if (opts.switchToProfileAfter || opts.activeProfileId === saved.id) {
    opts.presets.replaceAll(saved.urlPresets);
  }
  if (stillItems.length > 0) {
    opts.cues.replaceAll(stillItemsToCues(stillItems));
    opts.playlists.replaceAll([]);
  }

  return {
    ok: true,
    profileId: saved.id,
    profileName: saved.name,
    message: 'Profile imported successfully.',
    actionTaken,
    restartRequired: true,
  };
}

export function sweepImportStaging(): void {
  const now = Date.now();
  for (const [k, v] of staging) {
    if (now - v.createdAt > 30 * 60 * 1000) staging.delete(k);
  }
}
