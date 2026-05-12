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
