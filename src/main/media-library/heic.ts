import { sniffImageMime } from './image-meta';

/**
 * HEIC/HEIF decoding for the still store.
 *
 * Chromium — and therefore Electron, and therefore the render page — cannot
 * decode HEIC in an <img>, so an iPhone photo stored as-is would go to air as a
 * black frame. Converting at ingest keeps every downstream consumer (render
 * page, remote gallery, slideshow) working with no special cases.
 */

/** JPEG quality for converted HEICs — high enough to be broadcast-safe. */
const JPEG_QUALITY = 0.92;

export interface TranscodeResult {
  buffer: Buffer;
  mimeType: string;
  /** Extension to use for the stored file, without the dot. */
  ext: string;
}

export type TranscodeOutcome =
  | { ok: true; result: TranscodeResult }
  | { ok: false; reason: string };

/**
 * Convert a HEIC buffer to JPEG.
 *
 * Failures carry a reason rather than a bare null: this runs inside a packaged
 * Electron app where the operator has no console, so a swallowed error means an
 * upload that "just fails" with nothing to act on. The reason is surfaced in the
 * upload response.
 *
 * `heic-convert` is loaded lazily: it pulls in a multi-megabyte libheif build,
 * and a show that never touches HEIC should not pay for it at boot.
 */
export async function heicToJpeg(buf: Buffer): Promise<TranscodeOutcome> {
  let convert: (opts: {
    buffer: Buffer;
    format: 'JPEG' | 'PNG';
    quality?: number;
  }) => Promise<ArrayBufferLike>;

  // Resolution and decoding fail for different reasons and need telling apart:
  // a missing module is a packaging problem, a decode error is a bad file.
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    convert = require('heic-convert');
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    console.error('[media-library] heic-convert unavailable:', detail);
    return { ok: false, reason: `HEIC support unavailable in this build (${detail})` };
  }

  try {
    const out = await convert({ buffer: buf, format: 'JPEG', quality: JPEG_QUALITY });
    const jpeg = Buffer.from(out);
    // Guard against a decoder that "succeeds" with something unusable.
    if (!jpeg.length) return { ok: false, reason: 'HEIC decoded to an empty image' };
    if (sniffImageMime(jpeg) !== 'image/jpeg') {
      return { ok: false, reason: 'HEIC decoded to something that is not a JPEG' };
    }
    return { ok: true, result: { buffer: jpeg, mimeType: 'image/jpeg', ext: 'jpg' } };
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    console.error('[media-library] HEIC decode failed:', detail);
    return { ok: false, reason: `HEIC could not be decoded (${detail})` };
  }
}
