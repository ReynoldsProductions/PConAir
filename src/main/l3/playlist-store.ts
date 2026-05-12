import { randomUUID } from 'crypto';
import type { L3CueStore } from './cue-store';

export interface L3Playlist {
  id: string;
  name: string;
  cueIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateL3PlaylistInput {
  name: string;
  cueIds: string[];
}

export function createL3PlaylistStore(cues: L3CueStore, onChange?: () => void) {
  const playlists = new Map<string, L3Playlist>();

  function touch(): void {
    onChange?.();
  }

  function validateCueIds(cueIds: string[]): string | null {
    for (const id of cueIds) {
      if (!cues.findById(id)) return id;
    }
    return null;
  }

  function list(): L3Playlist[] {
    return Array.from(playlists.values());
  }

  function findById(id: string): L3Playlist | null {
    return playlists.get(id) ?? null;
  }

  function create(input: CreateL3PlaylistInput): { ok: true; playlist: L3Playlist } | { ok: false; missingCueId: string } {
    const missing = validateCueIds(input.cueIds);
    if (missing) return { ok: false, missingCueId: missing };
    const now = new Date().toISOString();
    const p: L3Playlist = {
      id: randomUUID(),
      name: input.name,
      cueIds: [...input.cueIds],
      createdAt: now,
      updatedAt: now,
    };
    playlists.set(p.id, p);
    touch();
    return { ok: true, playlist: { ...p } };
  }

  function update(
    id: string,
    patch: { name?: string; cueIds?: string[] }
  ): { ok: true; playlist: L3Playlist } | { ok: false; reason: 'not_found' | 'cue_not_found'; missingCueId?: string } {
    const existing = playlists.get(id);
    if (!existing) return { ok: false, reason: 'not_found' };
    if (patch.cueIds) {
      const missing = validateCueIds(patch.cueIds);
      if (missing) return { ok: false, reason: 'cue_not_found', missingCueId: missing };
    }
    const updated: L3Playlist = {
      ...existing,
      name: patch.name ?? existing.name,
      cueIds: patch.cueIds ? [...patch.cueIds] : existing.cueIds,
      updatedAt: new Date().toISOString(),
    };
    playlists.set(id, updated);
    touch();
    return { ok: true, playlist: { ...updated } };
  }

  function remove(id: string): boolean {
    const ok = playlists.delete(id);
    if (ok) touch();
    return ok;
  }

  function replaceAll(items: L3Playlist[]): void {
    playlists.clear();
    for (const p of items) {
      playlists.set(p.id, { ...p });
    }
    touch();
  }

  return { list, findById, create, update, remove, replaceAll };
}

export type L3PlaylistStore = ReturnType<typeof createL3PlaylistStore>;
