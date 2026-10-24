import { BrowserWindow, session } from 'electron';

/**
 * Persistent partition for the hidden camera probe window (see below). A
 * dedicated partition, not `session.defaultSession`, keeps the permission
 * auto-grant scoped to this one internal window instead of silently
 * widening every other window's media-permission behavior.
 */
export const CAMERA_PROBE_PARTITION = 'persist:pconair-camera';

/**
 * Creates the hidden offscreen window Track 1A uses for device enumeration,
 * permission probing and hotplug polling (see `probe.ts` and `manager.ts`).
 *
 * This is deliberately NOT the Phase 2 OSR compositor window described in
 * spec 24's "Architecture decision" -- that window renders the actual
 * camera+graphics composite for the pixel pipeline and must not be built
 * until the real-hardware pacer soak confirms Candidate A. Keeping this
 * probe window separate means Phase 2 can build or replace that window
 * freely without touching device selection/persistence, and this window's
 * job stays small enough to fully characterize with the Electron mock.
 *
 * Permission design (spec 24 non-negotiable 4, "survives restart
 * unattended"): nobody is at the console to click "Allow" on an interactive
 * permission dialog when this window asks for camera access at boot, so
 * Electron's session-level permission gate is always auto-granted for
 * `media` requests/checks against this partition. This is the Electron-side
 * half of the permission story only -- it does not and cannot bypass
 * macOS's own TCC camera authorization, which is a one-time per-machine
 * grant made during setup (the same category as the Screen Recording /
 * Microphone grants this deployment already needs for Zoom/Q-SYS), not a
 * per-boot prompt. A denied or not-yet-granted OS-level permission still
 * surfaces normally through `getUserMedia` rejecting inside the probe
 * script -- see `probe.ts` for how that is detected and reported as
 * `permissionStatus`.
 */
export function createCameraProbeWindow(): BrowserWindow {
  const sess = session.fromPartition(CAMERA_PROBE_PARTITION);

  sess.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === 'media');
  });
  sess.setPermissionCheckHandler((_webContents, permission) => permission === 'media');

  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      offscreen: true,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      session: sess,
    },
  });
  // Explicit load rather than relying on a BrowserWindow's implicit blank
  // document -- same convention as the other window managers in this
  // codebase (see url/window-manager.ts, media-library/window-manager.ts).
  void win.loadURL('about:blank');
  return win;
}
