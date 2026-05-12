// AppState — the single source of truth for all runtime state.
// Matches specs/02-api-state-contract.md §1.1

export type Mode = 'slides' | 'url' | 'l3' | 'media-library' | 'idle';
export type ABInstance = 'A' | 'B';
export type BackgroundType = 'luma' | 'solid';
export type SessionMode = 'persistent' | 'ephemeral';

export interface Preset {
  id: string;
  name: string;
}

export interface SlidesState {
  deckId: string;
  deckTitle: string;
  slideIndex: number; // 0-based
  slideCount: number;
  isLoading: boolean;
}

export interface L3State {
  activeCueId: string | null;
  activeCueName: string | null;
  /** Secondary line (e.g. job title); mirrors cue.title or inline take. */
  activeTitle: string | null;
  isStacking: boolean;
  currentPlaylistId: string | null;
}

export interface MediaLibraryState {
  activeItemId: string | null;
  activeItemName: string | null;
}

export interface BackgroundState {
  presetId: string | null;
  presetName: string | null;
  type: BackgroundType;
  value: string; // hex color e.g. "#000000" or luma key value
}

export interface Display {
  id: string;
  name: string;
  isPrimary: boolean;
}

export interface InstanceState {
  url: string | null;
  isLoading: boolean;
  isReady: boolean;
  displayTarget: string | null; // display ID or null for default
  sessionMode: SessionMode;
}

export interface ABState {
  activeInstance: ABInstance;
  instanceA: InstanceState;
  instanceB: InstanceState;
}

export interface ConnectionStatus {
  webSocketClients: number;
  companionConnected: boolean;
  /** Show-mode admin lock (in-memory; cleared on restart). */
  adminShowLocked: boolean;
}

/** Spec 09 — panic slate on Program output (server state; broadcast to clients). */
export interface PanicSlateState {
  type: 'color';
  value: string;
}

export interface ReliabilityRuntimeState {
  panicActive: boolean;
  panicSlate: PanicSlateState;
}

/** Spec 09 §6.2 / §6.3 / §6.5 — watchdog runtime state. */
export interface WatchdogState {
  programUnresponsive: boolean;
  programUnresponsiveSecs: number;
  memoryPressure: boolean;
  memoryPressurePct: number;
  memoryHeapUsedGb: number;
  memoryHeapTotalGb: number;
  lastRendererCrashAt: string | null;
}

export interface AppState {
  currentMode: Mode;
  currentPreset: Preset | null;
  currentUrl: string | null;
  slides: SlidesState | null;
  l3: L3State | null;
  mediaLibrary: MediaLibraryState | null;
  background: BackgroundState;
  displays: Display[];
  abState: ABState;
  connectionStatus: ConnectionStatus;
  reliability: ReliabilityRuntimeState;
  watchdog: WatchdogState;
}

// ---- HTTP API types ----

export interface ApiError {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

export type ErrorCode =
  | 'INVALID_MODE'
  | 'NO_ACTIVE_DECK'
  | 'SLIDE_OUT_OF_RANGE'
  | 'INVALID_URL'
  | 'DISPLAY_NOT_FOUND'
  | 'CUE_NOT_FOUND'
  | 'PRESET_NOT_FOUND'
  | 'ITEM_NOT_FOUND'
  | 'AUTH_REQUIRED'
  | 'RATE_LIMITED'
  | 'FORBIDDEN';

// ---- WebSocket message types ----

export type WsServerMessage =
  | { type: 'state'; payload: AppState }
  | { type: 'state_patch'; payload: Partial<AppState> }
  | { type: 'error'; payload: { code: string; message: string } }
  | { type: 'action_result'; payload: unknown };

export type WsClientMessage =
  | { type: 'action'; action: string; payload: Record<string, unknown> };

// ---- Auth types ----

export interface Session {
  id: string;
  role: 'operator' | 'admin';
  createdAt: number;
  expiresAt: number;
}

export interface UrlPreset {
  id: string;
  name: string;
  url: string;
  displayTarget: string | null;
  sessionMode: SessionMode;
  description: string | null;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
}
