import type { BackgroundType, UrlPreset } from '../../shared/types';
import type { ScriptDoc } from '../prompter/script-docs';

export type ProfileSchemaVersion = '1.0';

export interface BackgroundPreset {
  id: string;
  name: string;
  type: BackgroundType;
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
  /**
   * Hosts (exact hostname or literal IP, not CIDR) a data source manifest may
   * reach even though they're loopback/link-local/RFC1918 (spec 20 §3.4).
   * Default empty — an operator opts a host in explicitly.
   */
  dataSourceAllowedHosts: string[];
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
  scriptDocs: ScriptDoc[];
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
