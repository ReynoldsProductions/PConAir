import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

export interface L3LogoAsset {
  id: string;
  filename: string;
  /** Relative to l3FilesRoot — e.g. "logos/<id>.png". */
  relativePath: string;
  format: string;
  uploadedAt: number;
}

interface LogoIndex {
  logos: L3LogoAsset[];
}

/**
 * Global, reusable library of uploaded logo images for the lower-third logo
 * chip. Modeled directly on theme-store.ts's index.json + on-disk file
 * pattern — one JSON index plus one file per asset under l3FilesRoot/logos/.
 */
export function createL3LogoStore(opts: { l3FilesRoot: string; onChange?: () => void }) {
  const { l3FilesRoot, onChange } = opts;
  const logosDir = path.join(l3FilesRoot, 'logos');
  const indexPath = path.join(logosDir, 'index.json');

  const logos = new Map<string, L3LogoAsset>();

  function loadIndex(): void {
    try {
      if (!fs.existsSync(indexPath)) return;
      const raw = fs.readFileSync(indexPath, 'utf8');
      const idx = JSON.parse(raw) as LogoIndex;
      for (const entry of idx.logos ?? []) {
        if (!fs.existsSync(path.join(l3FilesRoot, entry.relativePath))) continue;
        logos.set(entry.id, entry);
      }
    } catch {
      // Tolerate missing or corrupt index
    }
  }

  function saveIndex(): void {
    fs.mkdirSync(logosDir, { recursive: true });
    const idx: LogoIndex = { logos: Array.from(logos.values()) };
    fs.writeFileSync(indexPath, JSON.stringify(idx, null, 2), 'utf8');
  }

  loadIndex();

  function list(): L3LogoAsset[] {
    return Array.from(logos.values());
  }

  function findById(id: string): L3LogoAsset | null {
    return logos.get(id) ?? null;
  }

  function create(input: { filename: string; format: string; buffer: Buffer }): L3LogoAsset {
    const id = randomUUID();
    const relativePath = `logos/${id}.${input.format}`;
    fs.mkdirSync(logosDir, { recursive: true });
    fs.writeFileSync(path.join(l3FilesRoot, relativePath), input.buffer);
    const asset: L3LogoAsset = {
      id,
      filename: input.filename,
      relativePath,
      format: input.format,
      uploadedAt: Date.now(),
    };
    logos.set(id, asset);
    saveIndex();
    onChange?.();
    return { ...asset };
  }

  function remove(id: string): boolean {
    const asset = logos.get(id);
    if (!asset) return false;
    logos.delete(id);
    try { fs.unlinkSync(path.join(l3FilesRoot, asset.relativePath)); } catch { /* ignore */ }
    saveIndex();
    onChange?.();
    return true;
  }

  return { list, findById, create, remove };
}

export type L3LogoStore = ReturnType<typeof createL3LogoStore>;
