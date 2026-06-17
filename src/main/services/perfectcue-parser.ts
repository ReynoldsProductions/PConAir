/**
 * Binary byte parser for PerfectCue network extenders.
 * Ported from Google-Slides-Controller/src/perfectcue-parser.js, extended with
 * DSAN bytes and a per-port debounce stage.
 *
 * Two hardware families share the wire:
 *
 *  DSAN (USR-TCP232-style):
 *    0x0F = next, 0x1F = prev, 0xFF = keepalive (no-op).
 *
 *  WaveShare RS232/485/422 TO POE ETH (B):
 *    0x0c = next, 0x08 = prev. RS485 line noise corrupts the two high bits
 *    (7+6), so mask with & 0x3f before lookup. 0x06 is 0x0c right-shifted one
 *    bit by a UART start-bit mis-frame on a floating idle bus, so it also maps
 *    to next. A 150ms debounce suppresses floating-bus false triggers.
 */

export type PerfectCueCommand = 'next' | 'prev' | 'keepalive';

/** Result of feeding one byte through the parser. `null` = ignore this byte. */
export type PerfectCueParseResult = PerfectCueCommand | null;

/**
 * DSAN bytes are unique 8-bit values; WaveShare bytes are matched after a
 * `& 0x3f` mask. We try the exact DSAN value first, then the masked WaveShare
 * lookup. 0xFF (DSAN keepalive) must be caught before masking, because
 * 0xFF & 0x3f === 0x3f which is not a WaveShare command anyway, but the
 * keepalive intent should be explicit.
 */
const DSAN_BYTES: Record<number, PerfectCueCommand> = {
  0x0f: 'next',
  0x1f: 'prev',
  0xff: 'keepalive',
};

// Masked (& 0x3f) WaveShare command table.
const WAVESHARE_MASKED: Record<number, PerfectCueCommand> = {
  0x0c: 'next',
  0x06: 'next', // 0x0c right-shifted 1 bit (RS485 start-bit mis-frame)
  0x08: 'prev',
};

/**
 * Pure byte → command lookup, no debounce. Returns 'next' | 'prev' |
 * 'keepalive' | null. Exposed for unit testing and for callers that handle
 * debouncing themselves.
 */
export function lookupPerfectCueByte(byte: number): PerfectCueParseResult {
  const dsan = DSAN_BYTES[byte];
  if (dsan !== undefined) return dsan;
  return WAVESHARE_MASKED[byte & 0x3f] ?? null;
}

export interface PerfectCueParser {
  /**
   * Feed one byte. Returns the command, or null if the byte is unknown or a
   * 'next'/'prev' was debounced. 'keepalive' is never debounced.
   */
  parseByte(byte: number, now?: number): PerfectCueParseResult;
}

/** Default floating-bus debounce window for slide-advance commands (ms). */
export const PERFECTCUE_DEBOUNCE_MS = 150;

/**
 * Create a stateful per-port parser. The debounce window is tracked per parser
 * instance (i.e. per TCP port), not globally, so two ports never debounce each
 * other. Only 'next'/'prev' are debounced; 'keepalive' passes through.
 */
export function createPerfectCueParser(debounceMs: number = PERFECTCUE_DEBOUNCE_MS): PerfectCueParser {
  let lastCmdTime = -Infinity;

  return {
    parseByte(byte: number, now: number = Date.now()): PerfectCueParseResult {
      const cmd = lookupPerfectCueByte(byte);
      if (cmd === null || cmd === 'keepalive') return cmd;

      if (now - lastCmdTime < debounceMs) {
        return null;
      }
      lastCmdTime = now;
      return cmd;
    },
  };
}
