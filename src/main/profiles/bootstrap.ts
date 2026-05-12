import { randomUUID } from 'crypto';
import bcrypt from 'bcryptjs';
import fs from 'fs';
import path from 'path';
import type { UrlPreset } from '../../shared/types';
import type { ProfilePaths } from './paths';
import { getProfilePaths, profileFilePath, profileRuntimeStatePath } from './paths';
import type {
  ActiveProfileMarker,
  AppPreferences,
  BackupEnvelopeV1,
  ShowProfile,
  ProfileListEntry,
  ApiShowProfile,
} from './types';

export interface BootstrapPins {
  operatorPin: string;
  adminPin: string;
}

export interface BootstrapResult {
  paths: ProfilePaths;
  activeId: string;
  profile: ShowProfile;
  migratedLegacyRuntime: boolean;
}

const SCHEMA: ShowProfile['schemaVersion'] = '1.0';

function defaultAppPreferences(): AppPreferences {
  return {
    defaultStackingEnabled: true,
    operatorSessionDurationMinutes: 480,
    adminSessionDurationMinutes: 240,
    ipAllowlist: null,
    adminLockOnShow: false,
    operatorUiScale: 1.0,
  };
}

export function createDefaultShowProfile(
  id: string,
  name: string,
  operatorPinHash: string,
  adminPinHash: string,
  urlPresets: UrlPreset[] = []
): ShowProfile {
  const now = new Date().toISOString();
  return {
    schemaVersion: SCHEMA,
    id,
    name,
    createdAt: now,
    updatedAt: now,
    urlPresets,
    backgroundPresets: [],
    displayPreference: null,
    companionSettings: { enabled: false, listenPort: 8080 },
    tunnelSettings: { provider: 'none', token: '', region: 'us' },
    appPreferences: defaultAppPreferences(),
    operatorPinHash,
    adminPinHash,
    stillStoreIncluded: true,
    themesIncluded: false,
  };
}

export function parseProfileCliArg(argv: string[]): string | undefined {
  const i = argv.indexOf('--profile');
  if (i === -1) return undefined;
  const v = argv[i + 1];
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function atomicWriteJson(filePath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${randomUUID()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, filePath);
}

function sanitizeProfileNameForFile(name: string): string {
  return name.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9_.-]+/g, '');
}

function backupTimestampForFilename(iso: string): string {
  return iso.replace(/:/g, '-').replace(/\+/g, '-');
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

export function tryParseShowProfile(raw: unknown): ShowProfile | null {
  if (!isRecord(raw)) return null;
  if (raw.schemaVersion !== '1.0') return null;
  if (typeof raw.id !== 'string' || typeof raw.name !== 'string') return null;
  if (typeof raw.operatorPinHash !== 'string' || typeof raw.adminPinHash !== 'string') return null;
  if (!Array.isArray(raw.urlPresets)) return null;
  return raw as unknown as ShowProfile;
}

function readJsonFile<T>(p: string): T | null {
  try {
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf8')) as T;
  } catch {
    return null;
  }
}

interface LegacyRuntimeV1 {
  version: 1;
  urlPresets?: UrlPreset[];
  l3Cues?: unknown[];
  l3Playlists?: unknown[];
}

function migrateLegacyRuntimeState(userDataRoot: string): LegacyRuntimeV1 | null {
  const legacy = path.join(userDataRoot, 'runtime-state.json');
  const raw = readJsonFile<Partial<LegacyRuntimeV1>>(legacy);
  if (!raw || raw.version !== 1) return null;
  return raw as LegacyRuntimeV1;
}

export function bootstrapProfiles(
  userDataRoot: string,
  pins: BootstrapPins,
  cliProfileNameOrId?: string
): BootstrapResult {
  const paths = getProfilePaths(userDataRoot);
  fs.mkdirSync(paths.profilesDir, { recursive: true, mode: 0o700 });
  fs.mkdirSync(paths.backupsDir, { recursive: true, mode: 0o700 });

  const legacy = migrateLegacyRuntimeState(userDataRoot);
  let migratedLegacyRuntime = false;

  const marker = readJsonFile<ActiveProfileMarker>(paths.activeProfileFile);
  let profileFiles = fs.existsSync(paths.profilesDir)
    ? fs.readdirSync(paths.profilesDir).filter((f) => f.startsWith('profile-') && f.endsWith('.json'))
    : [];

  if (profileFiles.length === 0) {
    const id = randomUUID();
    const opHash = bcrypt.hashSync(pins.operatorPin, 12);
    const adHash = bcrypt.hashSync(pins.adminPin, 12);
    const urlPresets = Array.isArray(legacy?.urlPresets) ? legacy.urlPresets : [];
    const profile = createDefaultShowProfile(id, 'Default', opHash, adHash, urlPresets);
    atomicWriteJson(profileFilePath(paths, id), profile);
    atomicWriteJson(paths.activeProfileFile, { id: profile.id, name: profile.name });
    appendBackup(paths, profile, 'automatic');
    const cues = Array.isArray(legacy?.l3Cues) ? legacy.l3Cues : [];
    const playlists = Array.isArray(legacy?.l3Playlists) ? legacy.l3Playlists : [];
    if (cues.length > 0 || playlists.length > 0) {
      const rtPath = profileRuntimeStatePath(paths, id);
      fs.mkdirSync(path.dirname(rtPath), { recursive: true });
      fs.writeFileSync(
        rtPath,
        JSON.stringify({ version: 2, l3Cues: cues, l3Playlists: playlists }, null, 2),
        'utf8'
      );
    }
    migratedLegacyRuntime = urlPresets.length > 0;
    return { paths, activeId: id, profile, migratedLegacyRuntime };
  }

  let activeId = marker?.id ?? '';
  let activeProfile: ShowProfile | null = activeId ? loadProfile(paths, activeId) : null;

  if (!activeProfile || !marker) {
    const first = profileFiles[0];
    const id = first.replace(/^profile-/, '').replace(/\.json$/, '');
    activeProfile = loadProfile(paths, id);
    if (activeProfile) {
      atomicWriteJson(paths.activeProfileFile, { id: activeProfile.id, name: activeProfile.name });
      activeId = activeProfile.id;
    }
  }

  if (!activeProfile) {
    throw new Error('No valid profile found');
  }

  if (cliProfileNameOrId) {
    const found = findProfileByNameOrId(paths, cliProfileNameOrId);
    if (found) {
      activeId = found.id;
      activeProfile = found;
      atomicWriteJson(paths.activeProfileFile, { id: found.id, name: found.name });
    } else {
      console.warn(`[profiles] --profile "${cliProfileNameOrId}" not found; using active profile.`);
    }
  }

  return { paths, activeId, profile: activeProfile, migratedLegacyRuntime };
}

export function findProfileByNameOrId(paths: ProfilePaths, nameOrId: string): ShowProfile | null {
  const needle = nameOrId.trim().toLowerCase();
  for (const p of listProfileIds(paths)) {
    const prof = loadProfile(paths, p);
    if (!prof) continue;
    if (prof.id.toLowerCase() === needle || prof.name.toLowerCase() === needle) return prof;
  }
  return null;
}

export function listProfileIds(paths: ProfilePaths): string[] {
  if (!fs.existsSync(paths.profilesDir)) return [];
  return fs
    .readdirSync(paths.profilesDir)
    .filter((f) => f.startsWith('profile-') && f.endsWith('.json'))
    .map((f) => f.replace(/^profile-/, '').replace(/\.json$/, ''));
}

export function loadProfile(paths: ProfilePaths, id: string): ShowProfile | null {
  const raw = readJsonFile<unknown>(profileFilePath(paths, id));
  return tryParseShowProfile(raw);
}

export function listProfilesMetadata(paths: ProfilePaths): ProfileListEntry[] {
  const out: ProfileListEntry[] = [];
  for (const id of listProfileIds(paths)) {
    const p = loadProfile(paths, id);
    if (p) {
      out.push({ id: p.id, name: p.name, createdAt: p.createdAt, updatedAt: p.updatedAt });
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export function toApiProfile(p: ShowProfile): ApiShowProfile {
  const { operatorPinHash, adminPinHash, ...rest } = p;
  return {
    ...rest,
    hasPins: {
      operator: operatorPinHash.length > 0,
      admin: adminPinHash.length > 0,
    },
  };
}

export function writeProfile(paths: ProfilePaths, profile: ShowProfile, kind: 'automatic' | 'manual' = 'automatic'): void {
  const next: ShowProfile = { ...profile, updatedAt: new Date().toISOString() };
  atomicWriteJson(profileFilePath(paths, next.id), next);
  const marker = getActiveMarker(paths);
  if (marker?.id === next.id && marker.name !== next.name) {
    atomicWriteJson(paths.activeProfileFile, { id: next.id, name: next.name });
  }
  if (kind === 'automatic') {
    appendBackup(paths, next, 'automatic');
  }
}

export function appendBackup(
  paths: ProfilePaths,
  profile: ShowProfile,
  kind: 'automatic' | 'manual',
  note?: string
): { backupId: string; timestamp: string } {
  const backupId = randomUUID();
  const timestamp = new Date().toISOString();
  const env: BackupEnvelopeV1 = {
    backupKind: kind,
    backupId,
    timestamp,
    note,
    profile: { ...profile, updatedAt: profile.updatedAt },
  };
  const safeName = sanitizeProfileNameForFile(profile.name) || 'profile';
  const fn = `${safeName}-backup-${backupId}-${backupTimestampForFilename(timestamp)}.json`;
  atomicWriteJson(path.join(paths.backupsDir, fn), env);
  rotateBackups(paths, profile.id);
  return { backupId, timestamp };
}

function rotateBackups(paths: ProfilePaths, profileId: string, keep = 5): void {
  const files = fs.existsSync(paths.backupsDir) ? fs.readdirSync(paths.backupsDir).filter((f) => f.endsWith('.json')) : [];
  const hits: { file: string; ts: number }[] = [];
  for (const file of files) {
    const full = path.join(paths.backupsDir, file);
    const env = readJsonFile<Partial<BackupEnvelopeV1>>(full);
    if (!env?.profile || env.profile.id !== profileId || !env.timestamp) continue;
    hits.push({ file, ts: new Date(env.timestamp).getTime() });
  }
  hits.sort((a, b) => b.ts - a.ts);
  for (const h of hits.slice(keep)) {
    try {
      fs.unlinkSync(path.join(paths.backupsDir, h.file));
    } catch {
      /* ignore */
    }
  }
}

export interface BackupListItem {
  id: string;
  timestamp: string;
  type: 'automatic' | 'manual';
  note?: string;
  filename: string;
}

export function listBackupsForProfile(paths: ProfilePaths, profileId: string): BackupListItem[] {
  const files = fs.existsSync(paths.backupsDir) ? fs.readdirSync(paths.backupsDir).filter((f) => f.endsWith('.json')) : [];
  const out: BackupListItem[] = [];
  for (const file of files) {
    const full = path.join(paths.backupsDir, file);
    const env = readJsonFile<Partial<BackupEnvelopeV1>>(full);
    if (!env?.profile || env.profile.id !== profileId || !env.backupId || !env.timestamp) continue;
    out.push({
      id: env.backupId,
      timestamp: env.timestamp,
      type: env.backupKind === 'manual' ? 'manual' : 'automatic',
      note: env.note,
      filename: file,
    });
  }
  return out.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
}

export function findBackupFile(paths: ProfilePaths, profileId: string, backupId: string): string | null {
  for (const b of listBackupsForProfile(paths, profileId)) {
    if (b.id === backupId) return path.join(paths.backupsDir, b.filename);
  }
  return null;
}

export function readBackupEnvelope(paths: ProfilePaths, profileId: string, backupId: string): BackupEnvelopeV1 | null {
  const fp = findBackupFile(paths, profileId, backupId);
  if (!fp) return null;
  const env = readJsonFile<BackupEnvelopeV1>(fp);
  if (!env?.profile || env.profile.id !== profileId) return null;
  return env;
}

export function deleteBackup(paths: ProfilePaths, profileId: string, backupId: string): boolean {
  const fp = findBackupFile(paths, profileId, backupId);
  if (!fp) return false;
  try {
    fs.unlinkSync(fp);
    return true;
  } catch {
    return false;
  }
}

export function restoreBackupIntoProfile(paths: ProfilePaths, profileId: string, backupId: string): ShowProfile | null {
  const env = readBackupEnvelope(paths, profileId, backupId);
  if (!env) return null;
  const restored = { ...env.profile, id: profileId, updatedAt: new Date().toISOString() };
  writeProfile(paths, restored, 'automatic');
  return loadProfile(paths, profileId);
}

export function setActiveProfile(paths: ProfilePaths, profileId: string): ShowProfile | null {
  const p = loadProfile(paths, profileId);
  if (!p) return null;
  atomicWriteJson(paths.activeProfileFile, { id: p.id, name: p.name });
  return p;
}

export function getActiveMarker(paths: ProfilePaths): ActiveProfileMarker | null {
  return readJsonFile<ActiveProfileMarker>(paths.activeProfileFile);
}

/** New profile inherits PIN hashes from an existing profile (typically the active one). */
export function createNewProfile(paths: ProfilePaths, name: string, pinSource: ShowProfile): ShowProfile {
  const id = randomUUID();
  const profile = createDefaultShowProfile(id, name, pinSource.operatorPinHash, pinSource.adminPinHash, []);
  writeProfile(paths, profile, 'automatic');
  return loadProfile(paths, id)!;
}

export function patchShowProfile(existing: ShowProfile, patch: Partial<ShowProfile>): ShowProfile {
  const merged: ShowProfile = {
    ...existing,
    ...patch,
    id: existing.id,
    schemaVersion: SCHEMA,
    operatorPinHash: existing.operatorPinHash,
    adminPinHash: existing.adminPinHash,
    urlPresets: patch.urlPresets ?? existing.urlPresets,
    backgroundPresets: patch.backgroundPresets ?? existing.backgroundPresets,
    companionSettings: patch.companionSettings
      ? { ...existing.companionSettings, ...patch.companionSettings }
      : existing.companionSettings,
    tunnelSettings: patch.tunnelSettings ? { ...existing.tunnelSettings, ...patch.tunnelSettings } : existing.tunnelSettings,
    appPreferences: patch.appPreferences
      ? { ...existing.appPreferences, ...patch.appPreferences }
      : existing.appPreferences,
  };
  return merged;
}

export function syncActiveProfileUrlPresets(paths: ProfilePaths, activeId: string, urlPresets: UrlPreset[]): void {
  const p = loadProfile(paths, activeId);
  if (!p) return;
  writeProfile(paths, { ...p, urlPresets }, 'automatic');
}

export function deleteProfileFiles(paths: ProfilePaths, profileId: string): void {
  const pf = profileFilePath(paths, profileId);
  const rt = profileRuntimeStatePath(paths, profileId);
  try {
    if (fs.existsSync(pf)) fs.unlinkSync(pf);
  } catch {
    /* ignore */
  }
  try {
    if (fs.existsSync(rt)) fs.unlinkSync(rt);
  } catch {
    /* ignore */
  }
  for (const b of listBackupsForProfile(paths, profileId)) {
    deleteBackup(paths, profileId, b.id);
  }
}

export function createManualBackupRecord(
  paths: ProfilePaths,
  profileId: string,
  note?: string
): { id: string; timestamp: string; type: 'manual'; note?: string } | null {
  const p = loadProfile(paths, profileId);
  if (!p) return null;
  const { backupId, timestamp } = appendBackup(paths, p, 'manual', note);
  return { id: backupId, timestamp, type: 'manual', note };
}
