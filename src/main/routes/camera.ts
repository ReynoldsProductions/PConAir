import { Router, Request, Response } from 'express';
import type { StateStore } from '../state';
import type { AuthManager } from '../auth';
import type { CameraConnectionStatus, CameraOutputMode, CameraPermissionStatus } from '../../shared/types';
import { requireOperator, requireAdmin } from './middleware';

const PERMISSION_STATUSES: CameraPermissionStatus[] = ['unknown', 'granted', 'denied', 'restricted'];
const CONNECTION_STATUSES: CameraConnectionStatus[] = ['disconnected', 'connecting', 'connected', 'error'];
const OUTPUT_MODES: CameraOutputMode[] = ['ndi', 'local-display'];

// Spec 24, Decisions item 2: "PConAir — <ROOM> <ROLE>". No hard length rule
// in the spec; 100 matches the UrlPreset `name` convention (spec 02 §2.8).
const MAX_NDI_SOURCE_NAME_LEN = 100;

/**
 * `/api/camera/*` — spec 24 Phase 1B contract. Track 1A owns device
 * enumeration/hotplug/persistence and Track 1C owns the operator UI; this
 * router only records the state both of them read and write, following the
 * same request/response and error-code conventions as the other mode
 * routers (see `background.ts`, `media-library.ts`, `tunnel.ts`).
 */
export function createCameraRouter(store: StateStore, auth: AuthManager): Router {
  const router = Router();
  const opGuard = requireOperator(auth);
  const adminGuard = requireAdmin(auth);

  // GET /api/camera — current camera state.
  router.get('/', opGuard, (_req: Request, res: Response) => {
    res.json({ camera: store.getState().camera });
  });

  // POST /api/camera/device — select or clear the active UVC device.
  // Track 1A owns enumeration; this endpoint only records the choice, it
  // does not validate `id` against any device list.
  router.post('/device', opGuard, (req: Request, res: Response) => {
    const { id, label } = req.body as { id?: string | null; label?: string | null };

    // Only an explicit `null` clears the selection — an omitted `id` (e.g. an
    // empty body) is a caller mistake, not "clear", so it 400s below like
    // every other required field in this router.
    if (id === null) {
      const s = store.getState();
      store.setState({ camera: { ...s.camera, selectedDevice: null } });
      res.json({ camera: store.getState().camera });
      return;
    }

    if (typeof id !== 'string' || id.trim().length === 0) {
      res.status(400).json({
        error: { code: 'INVALID_MODE', message: 'id must be a non-empty string, or null to clear the selection' },
      });
      return;
    }
    if (typeof label !== 'string' || label.trim().length === 0) {
      res.status(400).json({ error: { code: 'INVALID_MODE', message: 'label is required when id is set' } });
      return;
    }

    const s = store.getState();
    store.setState({ camera: { ...s.camera, selectedDevice: { id, label } } });
    res.json({ camera: store.getState().camera });
  });

  // POST /api/camera/permission — report OS media-capture (getUserMedia)
  // permission. Track 1A calls this after a permission probe/prompt.
  router.post('/permission', opGuard, (req: Request, res: Response) => {
    const { status } = req.body as { status?: string };
    if (!status || !PERMISSION_STATUSES.includes(status as CameraPermissionStatus)) {
      res.status(400).json({
        error: { code: 'INVALID_MODE', message: `status must be one of: ${PERMISSION_STATUSES.join(', ')}` },
      });
      return;
    }
    const s = store.getState();
    store.setState({ camera: { ...s.camera, permissionStatus: status as CameraPermissionStatus } });
    res.json({ camera: store.getState().camera });
  });

  // POST /api/camera/connection — report live connection/hotplug status.
  // A non-"error" status always clears any previously recorded error.
  router.post('/connection', opGuard, (req: Request, res: Response) => {
    const { status, error } = req.body as { status?: string; error?: string | null };
    if (!status || !CONNECTION_STATUSES.includes(status as CameraConnectionStatus)) {
      res.status(400).json({
        error: { code: 'INVALID_MODE', message: `status must be one of: ${CONNECTION_STATUSES.join(', ')}` },
      });
      return;
    }
    if (status === 'error' && (typeof error !== 'string' || error.trim().length === 0)) {
      res.status(400).json({
        error: { code: 'INVALID_MODE', message: 'error message is required when status is "error"' },
      });
      return;
    }
    const s = store.getState();
    store.setState({
      camera: {
        ...s.camera,
        connectionStatus: status as CameraConnectionStatus,
        lastError: status === 'error' ? (error as string) : null,
      },
    });
    res.json({ camera: store.getState().camera });
  });

  // POST /api/camera/output-mode — switch NDI vs. local-display. Phase 3
  // implements the actual output router; this only records the operator's
  // choice, mirroring /api/mode's mode-switch semantics. The two modes are
  // mutually exclusive: switching to "ndi" always clears outputDisplayId.
  router.post('/output-mode', opGuard, (req: Request, res: Response) => {
    const { mode, displayId } = req.body as { mode?: string; displayId?: string | null };
    if (!mode || !OUTPUT_MODES.includes(mode as CameraOutputMode)) {
      res.status(400).json({
        error: { code: 'INVALID_MODE', message: `mode must be one of: ${OUTPUT_MODES.join(', ')}` },
      });
      return;
    }

    const s = store.getState();

    if (mode === 'ndi') {
      store.setState({ camera: { ...s.camera, outputMode: 'ndi', outputDisplayId: null } });
      res.json({ camera: store.getState().camera });
      return;
    }

    // local-display: an omitted displayId keeps whatever was already set;
    // null/'' clears it (falls back to a default display, same convention
    // as url-ops.ts's lookupDisplay).
    let nextDisplayId = s.camera.outputDisplayId;
    if (displayId !== undefined) {
      if (displayId === null || displayId === '') {
        nextDisplayId = null;
      } else {
        const found = s.displays.find((d) => d.id === displayId);
        if (!found) {
          res.status(404).json({ error: { code: 'DISPLAY_NOT_FOUND', message: `Display '${displayId}' not found` } });
          return;
        }
        nextDisplayId = found.id;
      }
    }
    store.setState({ camera: { ...s.camera, outputMode: 'local-display', outputDisplayId: nextDisplayId } });
    res.json({ camera: store.getState().camera });
  });

  // POST /api/camera/ndi — NDI source name (spec 24 Decisions item 2:
  // "PConAir — <ROOM> <ROLE>"). Admin-only, same tier as background presets
  // and app settings — the operator UI reads it but doesn't edit it.
  router.post('/ndi', adminGuard, (req: Request, res: Response) => {
    const { sourceName } = req.body as { sourceName?: string };
    if (typeof sourceName !== 'string' || sourceName.trim().length === 0) {
      res.status(400).json({ error: { code: 'INVALID_MODE', message: 'sourceName is required' } });
      return;
    }
    const trimmed = sourceName.trim();
    if (trimmed.length > MAX_NDI_SOURCE_NAME_LEN) {
      res.status(400).json({
        error: { code: 'INVALID_MODE', message: `sourceName must be ${MAX_NDI_SOURCE_NAME_LEN} characters or fewer` },
      });
      return;
    }
    const s = store.getState();
    store.setState({ camera: { ...s.camera, ndi: { sourceName: trimmed } } });
    res.json({ camera: store.getState().camera });
  });

  return router;
}
