import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import {
  hashBuffer,
  isVideoMime,
  mp4DurationMs,
  needsTranscode,
  pngDimensions,
  pngHasTransparency,
  sniffMediaMime,
} from './image-meta';
import { heicToJpeg } from './heic';

const INDEX_VERSION = 1 as const;

export interface MediaLibraryItemRecord {
  id: string;
  filename: string;
  displayName: string;
  mimeType: string;
  /** Path relative to this store's `rootDir`, e.g. `files/{id}.png` */
  relativePath: string;
  fileSize: number;
  fileHash: string;
  width?: number;
  height?: number;
  hasTransparency?: boolean;
  /** Video only: playback length in ms, when it could be determined. */
  durationMs?: number;
  /** Set when the upload was transcoded on ingest, e.g. `image/heic` for a HEIC. */
  originalMimeType?: string;
  tags?: string[];
  uploadedAt: number;
  updatedAt: number;
}

interface IndexFileV1 {
  version: typeof INDEX_VERSION;
  items: MediaLibraryItemRecord[];
}

function safeBasename(name: string): string {
  const base = path.basename(name).replace(/[^\w.\-()+ ]+/g, '_').slice(0, 200);
  return base || 'upload';
}

function extForMime(mime: string, fallbackExt: string): string {
  const m: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/svg+xml': 'svg',
    'video/mp4': 'mp4',
    'video/quicktime': 'mov',
    'video/webm': 'webm',
    'image/avif': 'avif',
    'image/heic': 'heic',
  };
  return m[mime] ?? fallbackExt;
}

export function createMediaLibraryStore(opts: { rootDir: string; onChange?: () => void }) {
  const { rootDir, onChange } = opts;
  const filesDir = path.join(rootDir, 'files');
  const indexPath = path.join(rootDir, 'items.json');
  const items = new Map<string, MediaLibraryItemRecord>();
  let saveTimer: NodeJS.Timeout | null = null;

  function touch(): void {
    onChange?.();
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      flushIndex();
    }, 400);
  }

  function flushIndex(): void {
    const payload: IndexFileV1 = {
      version: INDEX_VERSION,
      items: Array.from(items.values()),
    };
    fs.mkdirSync(rootDir, { recursive: true });
    fs.writeFileSync(indexPath, JSON.stringify(payload, null, 2), 'utf8');
  }

  function loadIndex(): void {
    try {
      if (!fs.existsSync(indexPath)) return;
      const raw = JSON.parse(fs.readFileSync(indexPath, 'utf8')) as Partial<IndexFileV1>;
      if (raw.version !== INDEX_VERSION || !Array.isArray(raw.items)) return;
      for (const it of raw.items) {
        if (it?.id && typeof it.relativePath === 'string') items.set(it.id, { ...it });
      }
    } catch {
      /* corrupt index */
    }
  }

  function absolutePath(it: MediaLibraryItemRecord): string {
    return path.join(rootDir, it.relativePath);
  }

  function ingestBuffer(originalFilename: string, buf: Buffer): MediaLibraryItemRecord | null {
    const mime = sniffMediaMime(buf);
    if (!mime) return null;
    const id = randomUUID();
    const base = safeBasename(originalFilename);
    const extFromName = path.extname(base).slice(1).toLowerCase();
    const ext = extForMime(mime, extFromName || 'bin');
    const relativePath = `files/${id}.${ext}`;
    const dest = path.join(rootDir, relativePath);
    fs.mkdirSync(filesDir, { recursive: true });
    fs.writeFileSync(dest, buf);
    const now = Date.now();
    const video = isVideoMime(mime);
    const dims = mime === 'image/png' ? pngDimensions(buf) : null;
    const alpha = mime === 'image/png' ? pngHasTransparency(buf) : mime === 'image/svg+xml' ? true : undefined;
    const durationMs = video ? (mp4DurationMs(buf) ?? undefined) : undefined;
    const rec: MediaLibraryItemRecord = {
      id,
      filename: base,
      displayName: base,
      mimeType: mime,
      relativePath,
      fileSize: buf.length,
      fileHash: hashBuffer(buf),
      uploadedAt: now,
      updatedAt: now,
    };
    if (dims) {
      rec.width = dims.width;
      rec.height = dims.height;
    }
    if (alpha !== undefined) rec.hasTransparency = alpha;
    if (durationMs !== undefined) rec.durationMs = durationMs;
    items.set(id, rec);
    touch();
    return rec;
  }

  /**
   * Ingest that first converts formats the render page cannot display (HEIC).
   * Async because decoding is; callers handling uploads should prefer this over
   * `ingestBuffer`, which stays sync for the formats that need no conversion.
   */
  async function ingestUpload(
    originalFilename: string,
    buf: Buffer
  ): Promise<MediaLibraryItemRecord | null> {
    const sniffed = sniffMediaMime(buf);
    if (!sniffed || !needsTranscode(sniffed)) return ingestBuffer(originalFilename, buf);

    const converted = await heicToJpeg(buf);
    if (!converted) return null;

    const base = safeBasename(originalFilename);
    const renamed = `${base.replace(/\.[^.]+$/, '')}.${converted.ext}`;
    const rec = ingestBuffer(renamed, converted.buffer);
    if (rec) {
      // Keep the name the operator uploaded so the gallery stays recognisable,
      // even though the bytes on disk are now JPEG.
      rec.displayName = base;
      rec.originalMimeType = sniffed;
      touch();
    }
    return rec;
  }

  fs.mkdirSync(filesDir, { recursive: true });
  loadIndex();

  return {
    ingestUpload,
    rootDir,
    list(): MediaLibraryItemRecord[] {
      return Array.from(items.values()).sort((a, b) => b.uploadedAt - a.uploadedAt);
    },
    findById(id: string): MediaLibraryItemRecord | null {
      return items.get(id) ?? null;
    },
    absolutePath,
    ingestBuffer,
    remove(id: string): boolean {
      const it = items.get(id);
      if (!it) return false;
      items.delete(id);
      try {
        const abs = path.join(rootDir, it.relativePath);
        if (fs.existsSync(abs)) fs.unlinkSync(abs);
      } catch {
        /* ignore */
      }
      touch();
      return true;
    },
    /**
     * Wipe the whole library — every record and its file on disk. Returns how
     * many items were removed so the caller can report it. Files that fail to
     * unlink are still dropped from the index: leaving a record pointing at a
     * file we could not delete is worse than an orphan on disk.
     */
    removeAll(): number {
      const all = [...items.values()];
      items.clear();
      for (const it of all) {
        try {
          const abs = path.join(rootDir, it.relativePath);
          if (fs.existsSync(abs)) fs.unlinkSync(abs);
        } catch {
          /* ignore — index entry is gone regardless */
        }
      }
      touch();
      return all.length;
    },
    replaceAll(next: MediaLibraryItemRecord[]): void {
      items.clear();
      for (const it of next) items.set(it.id, { ...it });
      touch();
    },
  };
}

export type MediaLibraryStore = ReturnType<typeof createMediaLibraryStore>;
