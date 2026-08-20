import { createHash, type BinaryLike } from 'crypto';

/** Sniff image MIME from magic bytes (v1 image types only). */
export function sniffImageMime(buf: Buffer): string | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 8 && buf[0] === 0x89 && buf.slice(1, 4).toString('ascii') === 'PNG') return 'image/png';
  if (buf.length >= 6) {
    const sig = buf.slice(0, 6).toString('ascii');
    if (sig === 'GIF87a' || sig === 'GIF89a') return 'image/gif';
  }
  if (buf.length >= 12 && buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP') {
    return 'image/webp';
  }
  const head = buf.slice(0, Math.min(512, buf.length)).toString('utf8').trimStart();
  if (head.startsWith('<svg') || head.startsWith('<?xml')) return 'image/svg+xml';
  return null;
}

export function pngDimensions(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 24) return null;
  if (buf[0] !== 0x89 || buf.slice(1, 4).toString('ascii') !== 'PNG') return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/** IHDR color type: 4 = grey+alpha, 6 = RGBA */
export function pngHasTransparency(buf: Buffer): boolean | undefined {
  if (buf.length < 26) return undefined;
  if (buf[0] !== 0x89 || buf.slice(1, 4).toString('ascii') !== 'PNG') return undefined;
  const colorType = buf[25];
  return colorType === 4 || colorType === 6;
}

export function hashBuffer(buf: BinaryLike): string {
  return createHash('sha256').update(buf).digest('hex');
}

const VIDEO_MIMES = new Set(['video/mp4', 'video/quicktime', 'video/webm']);

export function isVideoMime(mime: string): boolean {
  return VIDEO_MIMES.has(mime);
}

/**
 * Sniff video MIME from magic bytes. ISO-BMFF (MP4/MOV) carries a `ftyp` box at
 * offset 4 whose brand distinguishes QuickTime from MP4; Matroska/WebM opens
 * with the EBML magic.
 */
export function sniffVideoMime(buf: Buffer): string | null {
  if (buf.length >= 4 && buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) {
    return 'video/webm';
  }
  if (buf.length >= 12 && buf.slice(4, 8).toString('ascii') === 'ftyp') {
    const brand = buf.slice(8, 12).toString('ascii');
    if (brand === 'qt  ') return 'video/quicktime';
    return 'video/mp4';
  }
  return null;
}

/** Sniff any supported media type — images first, then video. */
export function sniffMediaMime(buf: Buffer): string | null {
  return sniffImageMime(buf) ?? sniffVideoMime(buf);
}

/**
 * Duration in milliseconds from an ISO-BMFF (MP4/MOV) `mvhd` box, which holds a
 * timescale (ticks/sec) and a duration in those ticks. Walks top-level boxes to
 * find `moov`, then scans it for `mvhd` — no full atom-tree parse needed.
 *
 * Returns null for WebM (EBML durations are float-encoded and optional) and for
 * fragmented MP4s that report a zero duration in `mvhd`.
 */
export function mp4DurationMs(buf: Buffer): number | null {
  const moov = findTopLevelBox(buf, 'moov');
  if (!moov) return null;

  // mvhd is a direct child of moov, but scan the whole range so we tolerate
  // unexpected box ordering.
  for (let i = moov.start; i + 8 <= moov.end; i += 1) {
    if (buf.slice(i + 4, i + 8).toString('ascii') !== 'mvhd') continue;
    const version = buf[i + 8];
    try {
      if (version === 1) {
        // v1: 8-byte creation + 8-byte modification, then timescale, then 8-byte duration
        const timescale = buf.readUInt32BE(i + 12 + 16);
        const duration = Number(buf.readBigUInt64BE(i + 12 + 20));
        if (!timescale || !duration) return null;
        return Math.round((duration / timescale) * 1000);
      }
      // v0: 4-byte creation + 4-byte modification, then timescale, then 4-byte duration
      const timescale = buf.readUInt32BE(i + 12 + 8);
      const duration = buf.readUInt32BE(i + 12 + 12);
      if (!timescale || !duration) return null;
      return Math.round((duration / timescale) * 1000);
    } catch {
      return null;
    }
  }
  return null;
}

function findTopLevelBox(buf: Buffer, type: string): { start: number; end: number } | null {
  let offset = 0;
  while (offset + 8 <= buf.length) {
    let size = buf.readUInt32BE(offset);
    const boxType = buf.slice(offset + 4, offset + 8).toString('ascii');
    let headerSize = 8;
    if (size === 1) {
      // 64-bit extended size follows the type
      if (offset + 16 > buf.length) return null;
      size = Number(buf.readBigUInt64BE(offset + 8));
      headerSize = 16;
    } else if (size === 0) {
      // Box runs to end of file
      size = buf.length - offset;
    }
    if (size < headerSize) return null;
    if (boxType === type) {
      return { start: offset + headerSize, end: Math.min(offset + size, buf.length) };
    }
    offset += size;
  }
  return null;
}
