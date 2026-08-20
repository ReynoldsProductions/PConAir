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

/**
 * Convert a HEIC buffer to JPEG. Returns null when the file cannot be decoded,
 * so the caller can reject it rather than store something unplayable.
 *
 * `heic-convert` is loaded lazily: it pulls in a multi-megabyte libheif wasm
 * build, and a show that never touches HEIC should not pay for it at boot.
 */
export async function heicToJpeg(buf: Buffer): Promise<TranscodeResult | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const convert = require('heic-convert') as (opts: {
      buffer: Buffer;
      format: 'JPEG' | 'PNG';
      quality?: number;
    }) => Promise<ArrayBufferLike>;
    const out = await convert({ buffer: buf, format: 'JPEG', quality: JPEG_QUALITY });
    const jpeg = Buffer.from(out);
    // Guard against a decoder that "succeeds" with something unusable.
    if (!jpeg.length || sniffImageMime(jpeg) !== 'image/jpeg') return null;
    return { buffer: jpeg, mimeType: 'image/jpeg', ext: 'jpg' };
  } catch {
    return null;
  }
}
