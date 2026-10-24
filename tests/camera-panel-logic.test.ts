import { describe, it, expect } from 'vitest';
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
} from '../src/renderer/operator/camera-logic';

describe('matchBrowserDeviceId', () => {
  const devices: BrowserMediaDeviceInfo[] = [
    { deviceId: 'browser-1', label: 'Q-SYS USB Video Bridge', kind: 'videoinput' },
    { deviceId: 'browser-2', label: 'FaceTime HD Camera', kind: 'videoinput' },
    { deviceId: 'browser-mic', label: 'Q-SYS USB Video Bridge', kind: 'audioinput' },
  ];

  it('matches on exact label, ignoring audioinput/audiooutput entries of the same label', () => {
    expect(matchBrowserDeviceId('Q-SYS USB Video Bridge', devices)).toBe('browser-1');
  });

  it('falls back to a trim+case-insensitive match', () => {
    expect(matchBrowserDeviceId('  q-sys usb video bridge  ', devices)).toBe('browser-1');
  });

  it('returns null when no device has that label', () => {
    expect(matchBrowserDeviceId('Some Other Camera', devices)).toBeNull();
  });

  it('returns null for an empty target label', () => {
    expect(matchBrowserDeviceId('', devices)).toBeNull();
  });

  it('returns null when every device has a blank label (no getUserMedia grant yet)', () => {
    const unlabeled: BrowserMediaDeviceInfo[] = [{ deviceId: 'x', label: '', kind: 'videoinput' }];
    expect(matchBrowserDeviceId('Q-SYS USB Video Bridge', unlabeled)).toBeNull();
  });

  it('returns null given an empty device list', () => {
    expect(matchBrowserDeviceId('Q-SYS USB Video Bridge', [])).toBeNull();
  });

  it('prefers the first exact match when two video inputs share a label (documented best-effort)', () => {
    const dup: BrowserMediaDeviceInfo[] = [
      { deviceId: 'first', label: 'Generic UVC Camera', kind: 'videoinput' },
      { deviceId: 'second', label: 'Generic UVC Camera', kind: 'videoinput' },
    ];
    expect(matchBrowserDeviceId('Generic UVC Camera', dup)).toBe('first');
  });
});

describe('classifyPreviewError', () => {
  it.each([
    ['NotAllowedError', 'permission-denied'],
    ['SecurityError', 'permission-denied'],
    ['NotFoundError', 'not-found'],
    ['OverconstrainedError', 'not-found'],
    ['DevicesNotFoundError', 'not-found'],
    ['NotReadableError', 'in-use'],
    ['TrackStartError', 'in-use'],
    ['SomeWeirdError', 'unknown'],
  ])('maps DOMException name %s to %s', (name, expected) => {
    expect(classifyPreviewError({ name })).toBe(expected);
  });

  it('maps a non-Error, non-object throw to unknown', () => {
    expect(classifyPreviewError('boom')).toBe('unknown');
    expect(classifyPreviewError(null)).toBe('unknown');
    expect(classifyPreviewError(undefined)).toBe('unknown');
  });
});

describe('describePreviewError', () => {
  it('returns a non-empty, distinct message for every classified kind', () => {
    const kinds = ['permission-denied', 'not-found', 'in-use', 'unknown'] as const;
    const messages = kinds.map((k) => describePreviewError(k));
    expect(messages.every((m) => m.length > 0)).toBe(true);
    expect(new Set(messages).size).toBe(kinds.length);
  });
});

describe('describeUnmatchedDeviceError', () => {
  it('includes the label that failed to match, and never throws on odd input', () => {
    expect(describeUnmatchedDeviceError('Q-SYS USB Video Bridge')).toContain('Q-SYS USB Video Bridge');
    expect(() => describeUnmatchedDeviceError('')).not.toThrow();
  });
});

describe('describePermissionStatus', () => {
  it.each([
    ['granted', 'Granted'],
    ['denied', 'Denied'],
    ['restricted', 'Restricted (OS/MDM policy)'],
    ['unknown', 'Unknown (not probed yet)'],
  ] as const)('%s -> %s', (status, expected) => {
    expect(describePermissionStatus(status)).toBe(expected);
  });
});

describe('describeConnectionStatus', () => {
  it('reports connected/connecting/disconnected without needing lastError', () => {
    expect(describeConnectionStatus('connected', null)).toBe('Connected');
    expect(describeConnectionStatus('connecting', null)).toBe('Connecting…');
    expect(describeConnectionStatus('disconnected', null)).toBe('Disconnected');
  });

  it('includes lastError text when status is error', () => {
    expect(describeConnectionStatus('error', 'camera unplugged')).toBe('Error — camera unplugged');
  });

  it('falls back to a bare "Error" when status is error but lastError is null', () => {
    expect(describeConnectionStatus('error', null)).toBe('Error');
  });
});

describe('describeNdiSource', () => {
  it('returns the trimmed source name when set', () => {
    expect(describeNdiSource({ sourceName: '  PConAir — SF AH Stage  ' })).toBe('PConAir — SF AH Stage');
  });

  it('returns a placeholder when unset/blank', () => {
    expect(describeNdiSource({ sourceName: '' })).toBe('(not set — admin only)');
    expect(describeNdiSource({ sourceName: '   ' })).toBe('(not set — admin only)');
  });
});

describe('buildDisplayOptions', () => {
  it('always prepends a "Primary display (default)" option with value ""', () => {
    const options = buildDisplayOptions([]);
    expect(options).toEqual([{ value: '', label: 'Primary display (default)' }]);
  });

  it('marks the primary display in its label and keeps other displays plain', () => {
    const options = buildDisplayOptions([
      { id: '1', name: 'Main', isPrimary: true },
      { id: '2', name: 'Confidence Monitor', isPrimary: false },
    ]);
    expect(options).toEqual([
      { value: '', label: 'Primary display (default)' },
      { value: '1', label: 'Main (primary)' },
      { value: '2', label: 'Confidence Monitor' },
    ]);
  });
});

describe('showsDisplayPicker', () => {
  it('is true only for local-display', () => {
    expect(showsDisplayPicker('local-display')).toBe(true);
    expect(showsDisplayPicker('ndi')).toBe(false);
  });
});
