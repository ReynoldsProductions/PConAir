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

export type SlidesContentKind = 'slides' | 'url' | 'none';

export interface SlidesState {
  deckId: string;
  deckTitle: string;
  slideIndex: number; // 0-based
  slideCount: number;
  isLoading: boolean;
  /** Original deck URL as loaded (for status display / reload). */
  deckUrl: string | null;
  /** A/B failover: backup deck loaded alongside the primary. */
  backupDeckId: string | null;
  backupDeckUrl: string | null;
  backupLoaded: boolean;
  /** Current slide's speaker notes (normalized; '' when none). */
  notes: string;
  /** Google's presenter-notes popup is open (capture source). */
  notesOpen: boolean;
  /** Current/next slide preview images as data URLs (null until captured). */
  thumbnailCurrent: string | null;
  thumbnailNext: string | null;
  /** Offline mode toggle (cache-warm plumbing; Google blocks true offline presenting). */
  offlineMode: boolean;
  cacheWarmed: boolean;
  contentKind: SlidesContentKind;
}

/** Build a full SlidesState from the core fields plus optional overrides. */
export function makeSlidesState(
  init: Pick<SlidesState, 'deckId' | 'deckTitle' | 'slideIndex' | 'slideCount' | 'isLoading'> & Partial<SlidesState>
): SlidesState {
  return {
    deckUrl: null,
    backupDeckId: null,
    backupDeckUrl: null,
    backupLoaded: false,
    notes: '',
    notesOpen: false,
    thumbnailCurrent: null,
    thumbnailNext: null,
    offlineMode: false,
    cacheWarmed: false,
    contentKind: 'slides',
    ...init,
  };
}

export interface L3State {
  activeCueId: string | null;
  activeCueName: string | null;
  /** Secondary line (e.g. job title); mirrors cue.title or inline take. */
  activeTitle: string | null;
  /** Theme name of the live cue — render pages fetch its CSS. */
  activeTheme: string | null;
  isStacking: boolean;
  currentPlaylistId: string | null;
  /** 1-based position of the active cue within the active playlist (null when none). */
  playlistPosition: number | null;
  /** Cue count of the active playlist (null when none). */
  playlistLength: number | null;
}

export type SlideshowTransition = 'cut' | 'fade';

/** Still-store slideshow runtime state (Companion-first: flat, named fields). */
export interface SlideshowState {
  running: boolean;
  paused: boolean;
  itemIds: string[];
  /** 0-based index into itemIds. */
  position: number;
  intervalSec: number;
  transition: SlideshowTransition;
}

export interface MediaLibraryState {
  activeItemId: string | null;
  activeItemName: string | null;
  slideshow: SlideshowState | null;
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

// ---- Software output path (render pages) ----

export type RenderContentType = 'slides' | 'l3' | 'stills' | 'url';
export type RenderBg = 'transparent' | 'black' | 'white' | 'chroma' | 'opaque';

export interface RenderOutputState {
  bg: RenderBg;
  /** Used when bg === 'chroma'. */
  chromaColor: string;
  /** Output claimed for this content type: display id, 'obs', or null (unassigned). */
  claimedOutput: string | null;
}

export type RenderOutputsState = Record<RenderContentType, RenderOutputState>;

export type TunnelStatus = 'inactive' | 'starting' | 'active' | 'error';

/** Cloudflare tunnel runtime state (Companion-first: all operator-relevant fields named). */
export interface TunnelState {
  enabled: boolean;
  status: TunnelStatus;
  /** Public URL — trycloudflare.com quick-tunnel URL or the configured custom domain. */
  url: string | null;
  /** A tunnel PIN is configured (tunnel clients must enter it). */
  pinRequired: boolean;
  /** Last error message when status === 'error'. */
  lastError: string | null;
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
  tunnel: TunnelState;
  renderOutputs: RenderOutputsState;
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
