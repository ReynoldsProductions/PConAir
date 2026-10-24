import type { AppSettings } from '../app-settings';
import type { CameraDevice, CameraOutputMode } from '../../shared/types';

/**
 * Pure translation from persisted `AppSettings` into the camera boot patch
 * `index.ts` applies to the store (spec 24 Phase 1A, "survives restart
 * unattended"). Kept separate from `index.ts`'s Electron wiring so this
 * mapping -- the part that can actually be wrong -- is unit-testable without
 * the Electron mock, the same way `resolvePort`/`isValidOverlayPosition`
 * etc. in `app-settings.ts` are pure and separately tested from `index.ts`'s
 * boot sequence that calls them.
 *
 * `permissionStatus`/`connectionStatus` are intentionally absent: those are
 * live/transient and re-probed by `camera/manager.ts`, not seeded from disk.
 */
export interface CameraBootPatch {
  selectedDevice: CameraDevice | null;
  outputMode: CameraOutputMode;
  outputDisplayId: string | null;
  ndi: { sourceName: string };
}

export function cameraBootPatchFromSettings(
  settings: Pick<AppSettings, 'cameraDeviceId' | 'cameraDeviceLabel' | 'cameraOutputMode' | 'cameraOutputDisplayId' | 'cameraNdiSourceName'>
): CameraBootPatch {
  return {
    selectedDevice: settings.cameraDeviceId
      ? { id: settings.cameraDeviceId, label: settings.cameraDeviceLabel ?? settings.cameraDeviceId }
      : null,
    outputMode: settings.cameraOutputMode,
    outputDisplayId: settings.cameraOutputDisplayId,
    ndi: { sourceName: settings.cameraNdiSourceName },
  };
}
