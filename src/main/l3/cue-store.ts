import { randomUUID } from 'crypto';

export interface L3Cue {
  id: string;
  name: string;
  title: string;
  subtitle: string | null;
  theme: string;
  autoOutMs?: number | null;
  sourceType: 'manual' | 'csv' | 'image';
  originalImagePath?: string | null;
  originalImageFormat?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateL3CueInput {
  name: string;
  title: string;
  subtitle?: string | null;
  theme: string;
  autoOutMs?: number | null;
  sourceType?: 'manual' | 'csv' | 'image';
  originalImagePath?: string | null;
  originalImageFormat?: string | null;
}

export type UpdateL3CueInput = Partial<Pick<L3Cue, 'name' | 'title' | 'subtitle' | 'theme' | 'autoOutMs'>>;

export function createL3CueStore(onChange?: () => void) {
  const cues = new Map<string, L3Cue>();

  function touch(): void {
    onChange?.();
  }

  function list(): L3Cue[] {
    return Array.from(cues.values());
  }

  function findById(id: string): L3Cue | null {
    return cues.get(id) ?? null;
  }

  function create(input: CreateL3CueInput): L3Cue {
    const now = new Date().toISOString();
    const cue: L3Cue = {
      id: randomUUID(),
      name: input.name,
      title: input.title,
      subtitle: input.subtitle ?? null,
      theme: input.theme,
      autoOutMs: input.autoOutMs ?? null,
      sourceType: input.sourceType ?? 'manual',
      originalImagePath: input.originalImagePath ?? null,
      originalImageFormat: input.originalImageFormat ?? null,
      createdAt: now,
      updatedAt: now,
    };
    cues.set(cue.id, cue);
    touch();
    return { ...cue };
  }

  function update(id: string, input: UpdateL3CueInput): L3Cue | null {
    const existing = cues.get(id);
    if (!existing) return null;
    const updated: L3Cue = {
      ...existing,
      ...input,
      id,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
    };
    cues.set(id, updated);
    touch();
    return { ...updated };
  }

  function remove(id: string): boolean {
    const ok = cues.delete(id);
    if (ok) touch();
    return ok;
  }

  /** Replace all cues (used when hydrating from disk). */
  function replaceAll(items: L3Cue[]): void {
    cues.clear();
    for (const c of items) {
      cues.set(c.id, { ...c });
    }
    touch();
  }

  return { list, findById, create, update, remove, replaceAll };
}

export type L3CueStore = ReturnType<typeof createL3CueStore>;
