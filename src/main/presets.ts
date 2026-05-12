import { randomUUID } from 'crypto';
import type { UrlPreset, SessionMode } from '../shared/types';

export interface CreatePresetInput {
  name: string;
  url: string;
  sessionMode: SessionMode;
  displayTarget: string | null;
  description: string | null;
}

export type UpdatePresetInput = Partial<Omit<UrlPreset, 'id' | 'createdAt' | 'updatedAt'>>;

// Persisted via runtime-state.json when persistence is wired (see src/main/runtime-persistence.ts).
export function createPresetsStore(onChange?: () => void) {
  const presets = new Map<string, UrlPreset>();

  function touch(): void {
    onChange?.();
  }

  function list(): UrlPreset[] {
    return Array.from(presets.values());
  }

  function findById(id: string): UrlPreset | null {
    return presets.get(id) ?? null;
  }

  function create(input: CreatePresetInput): UrlPreset {
    const now = new Date().toISOString();
    const preset: UrlPreset = {
      id: randomUUID(),
      name: input.name,
      url: input.url,
      sessionMode: input.sessionMode,
      displayTarget: input.displayTarget,
      description: input.description,
      createdAt: now,
      updatedAt: now,
    };
    presets.set(preset.id, preset);
    touch();
    return { ...preset };
  }

  function update(id: string, input: UpdatePresetInput): UrlPreset | null {
    const existing = presets.get(id);
    if (!existing) return null;
    const updated: UrlPreset = { ...existing, ...input, id, createdAt: existing.createdAt, updatedAt: new Date().toISOString() };
    presets.set(id, updated);
    touch();
    return { ...updated };
  }

  function remove(id: string): boolean {
    const ok = presets.delete(id);
    if (ok) touch();
    return ok;
  }

  function replaceAll(items: UrlPreset[]): void {
    presets.clear();
    for (const p of items) {
      presets.set(p.id, { ...p });
    }
    onChange?.();
  }

  return { list, findById, create, update, remove, replaceAll };
}

export type PresetsStore = ReturnType<typeof createPresetsStore>;
