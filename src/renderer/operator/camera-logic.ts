// Pure logic for the Camera mode operator-UI panel (spec 24, Phase 1 Track
// 1C). Kept free of React/DOM/Electron imports so it can be unit-tested
// directly with Vitest under the suite's default `environment: 'node'`,
// the same way `tests/` already tests other non-renderer pure logic — see
// CLAUDE.md / the repo's TDD note on this track and
// `tests/operator-renderer-boot.test.ts`'s header comment for why no
// component-rendering test suite exists here.
//
// ── Device-id vs. device-label matching (read this before touching
//    anything in here) ───────────────────────────────────────────────
//
// Track 1A's `GET /api/camera/devices` list (`CameraDevice[]`, `{id, label}`)
// comes from a hidden, offscreen `BrowserWindow` in the *main* process
// probing its own `navigator.mediaDevices.enumerateDevices()`. The Camera
// panel's live preview, by contrast, has to open the camera from the
// *operator's own browser tab* via that tab's own
// `navigator.mediaDevices.getUserMedia()`/`enumerateDevices()` — there is no
// shared id space between the two processes/contexts, and nothing in the
// Track 1A contract (spec 24 Phase 1, Track 1A open question #3) guarantees
// the probe window's `deviceId` for a physical camera equals the operator
// browser tab's own `deviceId` for that same physical camera. They are two
// independent enumerations of the same hardware and can legitimately
// disagree.
//
// What *is* shared between them is the device's human-readable `label`
// (e.g. "Q-SYS USB Video Bridge") — in practice stable for a given UVC
// device across processes on the same machine, though this is a practical
// observation about how browsers/OSes name UVC devices, not something the
// WebRTC/MediaDevices spec formally guarantees. `matchBrowserDeviceId`
// below is the one place that assumption is made, and it is made
// explicitly: matching is by exact label, falling back to a
// trim+case-insensitive comparison, and returns `null` (never a guess) when
// no match exists — callers must surface that as an error, not silently
// preview some other camera. See `CameraPanel.tsx` for how the caller uses
// this and why it never falls back to "just open *a* camera" silently.
import type {
  CameraConnectionStatus,
  CameraOutputMode,
  CameraPermissionStatus,
  NdiConfig,
} from '../../shared/types';

/** Shape-compatible subset of the browser's real `MediaDeviceInfo`. */
export interface BrowserMediaDeviceInfo {
  deviceId: string;
  label: string;
  kind: string;
}

/**
 * Matches a Track 1A probe device's `label` against the operator browser's
 * own `enumerateDevices()` list, returning that browser's `deviceId` for
 * the matching physical camera — or `null` when no match exists (e.g. the
 * device isn't present in this browser context, or its label differs
 * between the two processes). Never guesses: callers must treat `null` as
 * "cannot confirm", not "use some other camera instead".
 */
export function matchBrowserDeviceId(
  targetLabel: string,
  browserDevices: BrowserMediaDeviceInfo[]
): string | null {
  const videoInputs = browserDevices.filter((d) => d.kind === 'videoinput' && d.label.length > 0);
  if (videoInputs.length === 0 || targetLabel.length === 0) return null;

  const exact = videoInputs.find((d) => d.label === targetLabel);
  if (exact) return exact.deviceId;

  const normalizedTarget = targetLabel.trim().toLowerCase();
  const loose = videoInputs.find((d) => d.label.trim().toLowerCase() === normalizedTarget);
  return loose ? loose.deviceId : null;
}

export type PreviewErrorKind = 'permission-denied' | 'not-found' | 'in-use' | 'unknown';

/** Classifies a `getUserMedia`/`enumerateDevices` rejection by its `DOMException` name. */
export function classifyPreviewError(err: unknown): PreviewErrorKind {
  const name = (err as { name?: unknown } | null | undefined)?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'permission-denied';
  if (name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'DevicesNotFoundError') return 'not-found';
  if (name === 'NotReadableError' || name === 'TrackStartError') return 'in-use';
  return 'unknown';
}

/** Operator-facing message for a classified preview error. Never throws, never blank. */
export function describePreviewError(kind: PreviewErrorKind): string {
  switch (kind) {
    case 'permission-denied':
      return 'Camera permission was denied in this browser tab. Allow camera access for this page and try again.';
    case 'not-found':
      return 'The matched camera could not be opened — it may have been unplugged or is no longer present.';
    case 'in-use':
      return 'The camera could not be opened — it may already be in use by another application.';
    case 'unknown':
    default:
      return 'Could not start the camera preview.';
  }
}

/** The explicit "cannot confirm this is the right physical camera" message — see module header. */
export function describeUnmatchedDeviceError(label: string): string {
  return (
    `Could not match "${label}" to a camera available in this browser tab. ` +
    'The device picker list comes from the app\'s own probe and may not share names with this browser — ' +
    'try Refresh, or check this device in your OS camera privacy settings.'
  );
}

export function describePermissionStatus(status: CameraPermissionStatus): string {
  switch (status) {
    case 'granted':
      return 'Granted';
    case 'denied':
      return 'Denied';
    case 'restricted':
      return 'Restricted (OS/MDM policy)';
    case 'unknown':
    default:
      return 'Unknown (not probed yet)';
  }
}

export function describeConnectionStatus(status: CameraConnectionStatus, lastError: string | null): string {
  switch (status) {
    case 'connected':
      return 'Connected';
    case 'connecting':
      return 'Connecting…';
    case 'error':
      return lastError ? `Error — ${lastError}` : 'Error';
    case 'disconnected':
    default:
      return 'Disconnected';
  }
}

/** The NDI router comment calls this admin-only; the operator UI only ever reads it. */
export function describeNdiSource(ndi: NdiConfig): string {
  const trimmed = ndi.sourceName.trim();
  return trimmed.length > 0 ? trimmed : '(not set — admin only)';
}

export interface DisplayOption {
  value: string;
  label: string;
}

/** Same "primary display (default)" convention as `refreshDisplaySelect()` in index.tsx. */
export function buildDisplayOptions(
  displays: Array<{ id: string; name: string; isPrimary: boolean }>
): DisplayOption[] {
  return [
    { value: '', label: 'Primary display (default)' },
    ...displays.map((d) => ({ value: d.id, label: d.isPrimary ? `${d.name} (primary)` : d.name })),
  ];
}

/** Whether the local-display target picker should render for the current output mode. */
export function showsDisplayPicker(mode: CameraOutputMode): boolean {
  return mode === 'local-display';
}
