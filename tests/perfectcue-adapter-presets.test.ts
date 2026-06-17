import { describe, it, expect } from 'vitest';
import {
  normalizeAdapterId,
  getPerfectCueAdapterPreset,
  PERFECTCUE_ADAPTER_IDS,
} from '../src/main/services/perfectcue-adapter-presets';

describe('normalizeAdapterId', () => {
  it('returns waveshare only for the exact "waveshare" value', () => {
    expect(normalizeAdapterId('waveshare')).toBe('waveshare');
  });

  it('defaults to dsan for anything else', () => {
    expect(normalizeAdapterId('dsan')).toBe('dsan');
    expect(normalizeAdapterId('WAVESHARE')).toBe('dsan');
    expect(normalizeAdapterId(undefined)).toBe('dsan');
    expect(normalizeAdapterId(null)).toBe('dsan');
    expect(normalizeAdapterId(42)).toBe('dsan');
  });
});

describe('getPerfectCueAdapterPreset', () => {
  it('returns DSAN timing (15s ping / 50s idle)', () => {
    expect(getPerfectCueAdapterPreset('dsan')).toEqual({ pingIntervalMs: 15_000, idleTimeoutMs: 50_000 });
  });

  it('returns WaveShare timing (45s ping / 120s idle)', () => {
    expect(getPerfectCueAdapterPreset('waveshare')).toEqual({ pingIntervalMs: 45_000, idleTimeoutMs: 120_000 });
  });

  it('falls back to DSAN timing for unknown adapters', () => {
    expect(getPerfectCueAdapterPreset('nonsense')).toEqual({ pingIntervalMs: 15_000, idleTimeoutMs: 50_000 });
  });
});

describe('PERFECTCUE_ADAPTER_IDS', () => {
  it('lists both supported families', () => {
    expect([...PERFECTCUE_ADAPTER_IDS]).toEqual(['dsan', 'waveshare']);
  });
});
