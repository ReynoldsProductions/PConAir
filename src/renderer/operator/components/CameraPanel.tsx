// Camera mode operator-UI panel (spec 24, Phase 1 Track 1C). Plain
// HTML/CSS-class markup (`panel`/`form-group`/`select-input`/`btn …`),
// matching the idiom the Slides/URL/Media Library tabs already use in
// `index.html`/`index.tsx` — not the Slate design system, since the only
// two Slate components typed in this codebase (`Tag`, `Button`, see
// `slate-globals.d.ts`) don't cover a `<select>`, and the rest of
// `window.Slate` is untyped `any`.
//
// All dynamic text (device labels, NDI source name, error messages) is
// rendered as JSX text content, never built into an HTML string and
// injected via `innerHTML` — React escapes it, so an operator-visible
// device label can't become markup/script.
//
// See `../camera-logic.ts`'s header comment for the device-id-vs-label
// matching rationale this component's preview effect depends on.
import * as React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppState, CameraDevice, CameraOutputMode } from '../../../shared/types';
import * as api from '../api';
import {
  buildDisplayOptions,
  classifyPreviewError,
  describeConnectionStatus,
  describeNdiSource,
  describePermissionStatus,
  describePreviewError,
  describeUnmatchedDeviceError,
  matchBrowserDeviceId,
  showsDisplayPicker,
  type BrowserMediaDeviceInfo,
} from '../camera-logic';

export interface CameraPanelProps {
  state: AppState;
  /**
   * True only while the Camera tab is the one visible nav section (see
   * `activeTab` in index.tsx). The live preview is gated on this, not on
   * component mount — `camera-panel-root` is a permanent React root like
   * the other two, so "mount" never happens again after boot. Gating on
   * tab visibility is what actually stops the camera being held open once
   * the operator switches away (requirement: don't leak a `MediaStream`
   * on mode/tab switch-away), and it also means the browser's camera
   * permission prompt only ever fires from an explicit operator action
   * (opening this tab with a device already chosen), never on an
   * unattended boot — this is an *operator* browser tab, not Track 1A's
   * unattended main-process probe window, so there's no one to click
   * "Allow" if this fired on its own.
   */
  active: boolean;
  onError: (message: string) => void;
}

export function CameraPanel({ state, active, onError }: CameraPanelProps): React.ReactElement {
  const camera = state.camera;
  const [mainDevices, setMainDevices] = useState<CameraDevice[]>([]);
  const [devicesLoading, setDevicesLoading] = useState(false);
  const [displays, setDisplays] = useState<Array<{ id: string; name: string; isPrimary: boolean }>>([]);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  // Bumped on every (re)start of the preview effect; an in-flight
  // getUserMedia/enumerateDevices chain checks this after every await and
  // discards itself (stopping whatever it opened) if it no longer matches
  // — guards the race between a fresh device-picker selection and a
  // still-resolving previous preview attempt.
  const requestIdRef = useRef(0);

  const stopPreview = useCallback(() => {
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) track.stop();
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const refreshDevices = useCallback(async () => {
    setDevicesLoading(true);
    try {
      const { devices } = await api.cameraRefreshDevices();
      setMainDevices(devices ?? []);
    } catch (e) {
      onError(`Camera device scan failed: ${(e as Error).message}`);
    } finally {
      setDevicesLoading(false);
    }
  }, [onError]);

  // Populate the picker when the tab opens: a quick, non-probing read of
  // whatever Track 1A last enumerated, then a forced re-scan (per spec:
  // "call POST /api/camera/devices/refresh … e.g. a refresh button, and/or
  // on mount") so the list is current even if no probe has run yet.
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    api.cameraListDevices()
      .then(({ devices }) => { if (!cancelled && devices && devices.length > 0) setMainDevices(devices); })
      .catch(() => { /* non-fatal — the forced refresh below still runs */ });
    void refreshDevices();
    api.listDisplays()
      .then(({ displays: d }) => { if (!cancelled) setDisplays(d ?? []); })
      .catch(() => { /* display picker just stays "Primary (default)" only */ });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const selectedLabel = camera.selectedDevice?.label ?? null;

  // Start/stop the operator browser's OWN getUserMedia preview — distinct
  // from, and never fed by, Track 1A's hidden main-process probe window.
  useEffect(() => {
    if (!active || !selectedLabel) {
      stopPreview();
      setPreviewError(null);
      return;
    }

    const myRequestId = ++requestIdRef.current;

    async function run(): Promise<void> {
      try {
        let devices = await navigator.mediaDevices.enumerateDevices();
        let matchedId = matchBrowserDeviceId(selectedLabel!, devices as unknown as BrowserMediaDeviceInfo[]);

        if (!matchedId) {
          // Device labels read back blank until this tab has an active
          // getUserMedia grant. Open *some* camera purely to obtain that
          // grant and real labels, then stop it immediately — it is never
          // shown, and matching is retried right after.
          const probeStream = await navigator.mediaDevices.getUserMedia({ video: true });
          for (const t of probeStream.getTracks()) t.stop();
          if (myRequestId !== requestIdRef.current) return;
          devices = await navigator.mediaDevices.enumerateDevices();
          matchedId = matchBrowserDeviceId(selectedLabel!, devices as unknown as BrowserMediaDeviceInfo[]);
        }

        if (myRequestId !== requestIdRef.current) return;

        if (!matchedId) {
          // Never fall back to showing some other camera as if it were the
          // one selected — see camera-logic.ts header comment.
          setPreviewError(describeUnmatchedDeviceError(selectedLabel!));
          return;
        }

        const stream = await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: matchedId } } });
        if (myRequestId !== requestIdRef.current) {
          for (const t of stream.getTracks()) t.stop();
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
        setPreviewError(null);
      } catch (err) {
        if (myRequestId !== requestIdRef.current) return;
        setPreviewError(describePreviewError(classifyPreviewError(err)));
      }
    }

    void run();

    // Runs on every dep change (new selection, tab closed) AND on real
    // unmount — releases whatever this effect's own run currently holds.
    return () => {
      stopPreview();
    };
  }, [active, selectedLabel, stopPreview]);

  const handleSelectDevice = useCallback(
    async (id: string) => {
      try {
        if (!id) {
          await api.cameraSelectDevice(null);
          return;
        }
        const device = mainDevices.find((d) => d.id === id);
        if (!device) return;
        await api.cameraSelectDevice(device);
      } catch (e) {
        onError((e as Error).message);
      }
    },
    [mainDevices, onError]
  );

  const handleOutputModeChange = useCallback(
    async (mode: CameraOutputMode) => {
      try {
        await api.cameraSetOutputMode(mode);
      } catch (e) {
        onError((e as Error).message);
      }
    },
    [onError]
  );

  const handleDisplayChange = useCallback(
    async (displayId: string) => {
      try {
        await api.cameraSetOutputMode('local-display', displayId || null);
      } catch (e) {
        onError((e as Error).message);
      }
    },
    [onError]
  );

  const displayOptions = buildDisplayOptions(displays);

  return (
    <>
      <div className="panel">
        <div className="panel-title">Camera device</div>
        <p className="field-hint" style={{ marginBottom: 12 }}>
          This list comes from the app&apos;s own camera probe, not your browser. The preview below opens
          independently in this browser tab and is matched to your pick by device name — if a device you expect
          isn&apos;t previewing correctly, try Refresh below.
        </p>
        <div className="form-group">
          <label htmlFor="camera-device-select">Camera</label>
          <div className="ml-l3-select-wrap">
            <select
              id="camera-device-select"
              className="select-input"
              value={camera.selectedDevice?.id ?? ''}
              onChange={(e) => void handleSelectDevice(e.target.value)}
            >
              <option value="">— None selected —</option>
              {mainDevices.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => void refreshDevices()}
              disabled={devicesLoading}
            >
              {devicesLoading ? 'Scanning…' : 'Refresh'}
            </button>
          </div>
          {mainDevices.length === 0 && !devicesLoading && (
            <p className="field-hint" style={{ marginTop: 8 }}>
              No cameras found. Plug one in and click Refresh.
            </p>
          )}
        </div>
      </div>

      <div className="panel">
        <div className="panel-title">Live preview</div>
        {!camera.selectedDevice ? (
          <p className="field-hint">Select a camera above to preview it.</p>
        ) : (
          <>
            <video
              ref={videoRef}
              autoPlay
              muted
              playsInline
              style={{ width: '100%', maxWidth: 480, borderRadius: 8, background: '#000', display: 'block' }}
            />
            {previewError && (
              <p className="field-hint" style={{ color: '#c0392b', marginTop: 8 }}>
                {previewError}
              </p>
            )}
          </>
        )}
      </div>

      <div className="panel">
        <div className="panel-title">Output</div>
        <div className="btn-row">
          <button
            type="button"
            className={camera.outputMode === 'ndi' ? 'btn btn-primary' : 'btn btn-secondary'}
            onClick={() => void handleOutputModeChange('ndi')}
          >
            NDI
          </button>
          <button
            type="button"
            className={camera.outputMode === 'local-display' ? 'btn btn-primary' : 'btn btn-secondary'}
            onClick={() => void handleOutputModeChange('local-display')}
          >
            Local display
          </button>
        </div>
        {showsDisplayPicker(camera.outputMode) && (
          <div className="form-group" style={{ marginTop: 12 }}>
            <label htmlFor="camera-display-select">Target display</label>
            <select
              id="camera-display-select"
              className="select-input"
              value={camera.outputDisplayId ?? ''}
              onChange={(e) => void handleDisplayChange(e.target.value)}
            >
              {displayOptions.map((o) => (
                <option key={o.value || 'primary'} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        )}
        <p className="field-hint" style={{ marginTop: 12 }}>
          NDI source name: <strong>{describeNdiSource(camera.ndi)}</strong> (admin-only setting)
        </p>
      </div>

      <div className="panel">
        <div className="panel-title">Status</div>
        <p className="field-hint">OS permission: {describePermissionStatus(camera.permissionStatus)}</p>
        <p className="field-hint">Connection: {describeConnectionStatus(camera.connectionStatus, camera.lastError)}</p>
      </div>
    </>
  );
}
