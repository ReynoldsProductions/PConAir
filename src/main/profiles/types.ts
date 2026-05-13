import type { UrlPreset } from '../../shared/types';

export type ProfileSchemaVersion = '1.0';

export interface BackgroundPreset {
  id: string;
  name: string;
  type: 'luma' | 'solid';
  value: string;
  createdAt: string;
  updatedAt: string;
}

export interface CompanionSettings {
  enabled: boolean;
  listenPort: number;
}

export interface TunnelSettings {
  provider: 'ngrok' | 'none';
  token: string;
  region: string;
}

export interface AppPreferences {
  defaultStackingEnabled: boolean;
  operatorSessionDurationMinutes: number;
  adminSessionDurationMinutes: number;
  ipAllowlist: string[] | null;
  /** When true, only IPs/CIDRs in `ipAllowlist` may access the server. */
  ipAllowlistEnabled: boolean;
  adminLockOnShow: boolean;
  operatorUiScale: number;
  // New fields for GSC parity:
  operatorTheme?: 'light' | 'dark';
  verboseLogging?: boolean;
  gpuMode?: 'default' | 'angle' | 'disabled';
}

/** Full profile as stored on disk (includes PIN hashes). */
export interface ShowProfile {
  schemaVersion: ProfileSchemaVersion;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  urlPresets: UrlPreset[];
  backgroundPresets: BackgroundPreset[];
  displayPreference: string | null;
  companionSettings: CompanionSettings;
  tunnelSettings: TunnelSettings;
  appPreferences: AppPreferences;
  operatorPinHash: string;
  adminPinHash: string;
  stillStoreIncluded: boolean;
  themesIncluded: boolean;
}

export interface ActiveProfileMarker {
  id: string;
  name: string;
}

export interface BackupEnvelopeV1 {
  backupKind: 'automatic' | 'manual';
  backupId: string;
  timestamp: string;
  note?: string;
  profile: ShowProfile;
}

export interface ProfileListEntry {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export type ApiShowProfile = Omit<ShowProfile, 'operatorPinHash' | 'adminPinHash'> & {
  hasPins: { operator: boolean; admin: boolean };
};
