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

export type IngestOutcome =
  | { ok: true; record: MediaLibraryItemRecord }
  | { ok: false; reason: string };

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

  /**
   * An item already in the library under this name, matched on the stored
   * filename as well as the display name: a HEIC arrives as `photo.heic` but is
   * stored as `photo.jpg`, so only the stored name matches on re-upload.
   */
  function findByName(base: string): MediaLibraryItemRecord | null {
    for (const it of items.values()) {
      if (it.filename === base || it.displayName === base) return it;
    }
    return null;
  }

  function ingestBuffer(originalFilename: string, buf: Buffer): MediaLibraryItemRecord | null {
    const mime = sniffMediaMime(buf);
    if (!mime) return null;
    const base = safeBasename(originalFilename);
    // Re-uploading a name replaces it in place and keeps the id, so slideshow
    // selections and anything currently on air still point at a live item.
    const existing = findByName(base);
    const id = existing?.id ?? randomUUID();
    const extFromName = path.extname(base).slice(1).toLowerCase();
    const ext = extForMime(mime, extFromName || 'bin');
    const relativePath = `files/${id}.${ext}`;
    const dest = path.join(rootDir, relativePath);
    fs.mkdirSync(filesDir, { recursive: true });
    fs.writeFileSync(dest, buf);
    // A format change (photo.png replaced by a photo.jpg) leaves the old file
    // behind under a different extension.
    if (existing && existing.relativePath !== relativePath) {
      try {
        const stale = path.join(rootDir, existing.relativePath);
        if (fs.existsSync(stale)) fs.unlinkSync(stale);
      } catch {
        /* ignore — index no longer references it */
      }
    }
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
      // Keep the original slot in the gallery when replacing.
      uploadedAt: existing?.uploadedAt ?? now,
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
   *
   * Returns a reason on failure rather than a bare null. The operator is on a
   * remote page with no console, so "upload failed" with no cause is unusable —
   * the reason travels back in the upload response.
   */
  async function ingestUpload(
    originalFilename: string,
    buf: Buffer
  ): Promise<IngestOutcome> {
    if (buf.length === 0) return { ok: false, reason: 'file is empty' };

    const sniffed = sniffMediaMime(buf);
    if (!sniffed) {
      return {
        ok: false,
        reason: 'unrecognised file type (supported: PNG, JPEG, GIF, WebP, SVG, HEIC, AVIF, MP4, MOV, WebM)',
      };
    }

    if (!needsTranscode(sniffed)) {
      const rec = ingestBuffer(originalFilename, buf);
      // sniffMediaMime already accepted it, so a null here means the write failed.
      return rec ? { ok: true, record: rec } : { ok: false, reason: `could not store ${sniffed} file` };
    }

    const converted = await heicToJpeg(buf);
    if (!converted.ok) return { ok: false, reason: converted.reason };

    const base = safeBasename(originalFilename);
    const renamed = `${base.replace(/\.[^.]+$/, '')}.${converted.result.ext}`;
    const rec = ingestBuffer(renamed, converted.result.buffer);
    if (!rec) return { ok: false, reason: 'converted JPEG could not be stored' };

    // Keep the name the operator uploaded so the gallery stays recognisable,
    // even though the bytes on disk are now JPEG.
    rec.displayName = base;
    rec.originalMimeType = sniffed;
    touch();
    return { ok: true, record: rec };
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
