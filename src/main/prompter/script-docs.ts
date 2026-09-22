import { randomUUID } from 'crypto';
import { extractDocId } from './doc-source';

/**
 * A saved Google Doc script the operator can load onto the prompter by name,
 * rather than pasting a URL every time. Mirrors `presets.ts`'s shape exactly
 * (Map-backed store, onChange callback) but — unlike presets, whose URL
 * validation lives in the route layer — validates `docUrl` in the store
 * itself via `extractDocId`. The design spec calls this out explicitly:
 * an unparseable doc URL must never make it into the library, because a bad
 * entry there would only surface later as a confusing fetch failure.
 */
export interface ScriptDoc {
  id: string;
  name: string;
  docUrl: string;
  description: string;
  createdAt: number;
  updatedAt: number;
}

export interface CreateScriptDocInput {
  name: string;
  docUrl: string;
  description: string;
}

export type UpdateScriptDocInput = Partial<Omit<ScriptDoc, 'id' | 'createdAt' | 'updatedAt'>>;

export class ScriptDocValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScriptDocValidationError';
  }
}

function assertValidName(name: unknown): asserts name is string {
  if (typeof name !== 'string' || name.trim().length === 0) {
    throw new ScriptDocValidationError('name is required');
  }
}

function assertValidDocUrl(docUrl: unknown): asserts docUrl is string {
  if (typeof docUrl !== 'string' || extractDocId(docUrl) === null) {
    throw new ScriptDocValidationError('docUrl must be a valid Google Docs document URL');
  }
}

// Persisted into the active show profile (`scriptDocs`), following the URL
// presets pattern — see syncActiveProfileScriptDocs in profiles/bootstrap.ts.
export function createScriptDocsStore(onChange?: () => void) {
  const docs = new Map<string, ScriptDoc>();

  function touch(): void {
    onChange?.();
  }

  function list(): ScriptDoc[] {
    return Array.from(docs.values());
  }

  function findById(id: string): ScriptDoc | null {
    return docs.get(id) ?? null;
  }

  function create(input: CreateScriptDocInput): ScriptDoc {
    assertValidName(input.name);
    assertValidDocUrl(input.docUrl);
    const now = Date.now();
    const doc: ScriptDoc = {
      id: randomUUID(),
      name: input.name,
      docUrl: input.docUrl,
      description: input.description ?? '',
      createdAt: now,
      updatedAt: now,
    };
    docs.set(doc.id, doc);
    touch();
    return { ...doc };
  }

  function update(id: string, input: UpdateScriptDocInput): ScriptDoc | null {
    const existing = docs.get(id);
    if (!existing) return null;
    if (input.name !== undefined) assertValidName(input.name);
    if (input.docUrl !== undefined) assertValidDocUrl(input.docUrl);
    const updated: ScriptDoc = {
      ...existing,
      ...input,
      id,
      createdAt: existing.createdAt,
      updatedAt: Date.now(),
    };
    docs.set(id, updated);
    touch();
    return { ...updated };
  }

  function remove(id: string): boolean {
    const ok = docs.delete(id);
    if (ok) touch();
    return ok;
  }

  function replaceAll(items: ScriptDoc[]): void {
    docs.clear();
    for (const d of items) {
      docs.set(d.id, { ...d });
    }
    onChange?.();
  }

  return { list, findById, create, update, remove, replaceAll };
}

export type ScriptDocsStore = ReturnType<typeof createScriptDocsStore>;
