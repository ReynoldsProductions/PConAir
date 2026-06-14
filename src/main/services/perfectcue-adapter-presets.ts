/**
 * TCP keep-alive presets per serial-TCP converter family.
 * DSAN (USR-TCP232-style) needs frequent application-level 0xFF traffic.
 * WaveShare firmware typically tolerates longer intervals (field-tunable).
 *
 * Ported from Google-Slides-Controller/src/perfectcue-adapter-presets.js.
 */

export type PerfectCueAdapterId = 'dsan' | 'waveshare';

export interface PerfectCueAdapterPreset {
  pingIntervalMs: number;
  idleTimeoutMs: number;
}

const PRESETS: Record<PerfectCueAdapterId, PerfectCueAdapterPreset> = {
  dsan: { pingIntervalMs: 15_000, idleTimeoutMs: 50_000 },
  waveshare: { pingIntervalMs: 45_000, idleTimeoutMs: 120_000 },
};

export const PERFECTCUE_ADAPTER_IDS: readonly PerfectCueAdapterId[] = ['dsan', 'waveshare'];

/** Coerce any value to a known adapter id, defaulting to 'dsan'. */
export function normalizeAdapterId(value: unknown): PerfectCueAdapterId {
  return value === 'waveshare' ? 'waveshare' : 'dsan';
}

/** Keep-alive ping interval and idle timeout for the given adapter. */
export function getPerfectCueAdapterPreset(adapter: unknown): PerfectCueAdapterPreset {
  return PRESETS[normalizeAdapterId(adapter)];
}
