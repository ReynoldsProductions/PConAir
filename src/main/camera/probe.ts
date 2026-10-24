import type { BrowserWindow } from 'electron';
import type { CameraDevice, CameraPermissionStatus } from '../../shared/types';

export interface CameraProbeResult {
  devices: CameraDevice[];
  permissionStatus: CameraPermissionStatus;
  /** Set when the probe script itself failed (not a permission denial). */
  error: string | null;
}

const PERMISSION_STATUSES: CameraPermissionStatus[] = ['unknown', 'granted', 'denied', 'restricted'];

/**
 * Runs inside the hidden probe window via `executeJavaScript`. The main
 * process has no `navigator.mediaDevices` -- this is the only place in the
 * whole feature that can see real device labels or probe permission.
 *
 * Requests (and immediately releases) a video stream first: Chromium blanks
 * `label` on every device from `enumerateDevices()` until something has
 * actually been granted camera access, so enumeration-without-permission
 * would otherwise come back with ids but no human-readable names. The
 * request also doubles as the permission probe -- its outcome is reported
 * back as `permissionStatus` instead of a separate round trip.
 */
const PROBE_SCRIPT = `
(async () => {
  const result = { devices: [], permissionStatus: 'unknown', error: null };
  try {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      stream.getTracks().forEach((t) => t.stop());
      result.permissionStatus = 'granted';
    } catch (permErr) {
      result.permissionStatus = (permErr && permErr.name === 'NotAllowedError') ? 'denied' : 'unknown';
    }
    const list = await navigator.mediaDevices.enumerateDevices();
    result.devices = list
      .filter((d) => d.kind === 'videoinput')
      .map((d) => ({ id: d.deviceId, label: d.label || 'Camera' }));
  } catch (err) {
    result.error = String((err && err.message) || err);
  }
  return result;
})()
`;

function isCameraDevice(v: unknown): v is CameraDevice {
  return (
    !!v &&
    typeof v === 'object' &&
    typeof (v as CameraDevice).id === 'string' &&
    typeof (v as CameraDevice).label === 'string'
  );
}

function normalizeResult(raw: unknown): CameraProbeResult {
  if (!raw || typeof raw !== 'object') {
    // The hidden window's page may not have finished loading yet, or (in
    // tests) the mock's executeJavaScript resolves to undefined by default.
    // Either way this is "nothing learned yet", not an error.
    return { devices: [], permissionStatus: 'unknown', error: null };
  }
  const r = raw as Partial<CameraProbeResult>;
  const devices = Array.isArray(r.devices) ? r.devices.filter(isCameraDevice) : [];
  const permissionStatus = PERMISSION_STATUSES.includes(r.permissionStatus as CameraPermissionStatus)
    ? (r.permissionStatus as CameraPermissionStatus)
    : 'unknown';
  const error = typeof r.error === 'string' ? r.error : null;
  return { devices, permissionStatus, error };
}

/**
 * Probes the hidden window for the current camera device list and
 * permission status. Never rejects: a thrown/rejected `executeJavaScript`
 * call (the window navigating away, being destroyed mid-call, or any other
 * Electron-side failure) is caught here and reported through the same
 * `{ error }` shape the in-page probe script itself uses, so every caller
 * has exactly one error path to handle instead of two.
 */
export async function probeCameraDevices(win: BrowserWindow): Promise<CameraProbeResult> {
  try {
    const raw = await win.webContents.executeJavaScript(PROBE_SCRIPT);
    return normalizeResult(raw);
  } catch (err) {
    return { devices: [], permissionStatus: 'unknown', error: String((err as Error)?.message ?? err) };
  }
}

export const CAMERA_PROBE_SCRIPT = PROBE_SCRIPT;
