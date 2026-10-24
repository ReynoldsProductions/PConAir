import { describe, it, expect } from 'vitest';
import { cameraBootPatchFromSettings } from '../src/main/camera/settings-bridge';
import { DEFAULT_APP_SETTINGS } from '../src/main/app-settings';

describe('cameraBootPatchFromSettings', () => {
  it('maps a device-less, ndi-default settings file to no selection', () => {
    const patch = cameraBootPatchFromSettings(DEFAULT_APP_SETTINGS);
    expect(patch).toEqual({
      selectedDevice: null,
      outputMode: 'ndi',
      outputDisplayId: null,
      ndi: { sourceName: '' },
    });
  });

  it('maps a persisted device id and label into selectedDevice', () => {
    const patch = cameraBootPatchFromSettings({
      ...DEFAULT_APP_SETTINGS,
      cameraDeviceId: 'uvc-1',
      cameraDeviceLabel: 'Q-SYS USB Video Bridge',
    });
    expect(patch.selectedDevice).toEqual({ id: 'uvc-1', label: 'Q-SYS USB Video Bridge' });
  });

  it('falls back to the id itself as the label when no label was persisted', () => {
    const patch = cameraBootPatchFromSettings({
      ...DEFAULT_APP_SETTINGS,
      cameraDeviceId: 'uvc-1',
      cameraDeviceLabel: null,
    });
    expect(patch.selectedDevice).toEqual({ id: 'uvc-1', label: 'uvc-1' });
  });

  it('maps local-display output mode and display id through', () => {
    const patch = cameraBootPatchFromSettings({
      ...DEFAULT_APP_SETTINGS,
      cameraOutputMode: 'local-display',
      cameraOutputDisplayId: 'HDMI-1',
    });
    expect(patch.outputMode).toBe('local-display');
    expect(patch.outputDisplayId).toBe('HDMI-1');
  });

  it('maps the NDI source name through', () => {
    const patch = cameraBootPatchFromSettings({
      ...DEFAULT_APP_SETTINGS,
      cameraNdiSourceName: 'PConAir — SF AH Stage',
    });
    expect(patch.ndi).toEqual({ sourceName: 'PConAir — SF AH Stage' });
  });
});
