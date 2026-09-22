import { describe, it, expect, beforeEach } from 'vitest';
import { createScriptDocsStore, ScriptDocValidationError } from '../src/main/prompter/script-docs';

const VALID_URL = 'https://docs.google.com/document/d/abc123XYZ_-/edit';
const VALID_URL_2 = 'https://docs.google.com/document/d/def456QRS_-/edit';

describe('ScriptDocsStore', () => {
  let store: ReturnType<typeof createScriptDocsStore>;

  beforeEach(() => {
    store = createScriptDocsStore();
  });

  it('starts empty', () => {
    expect(store.list()).toEqual([]);
  });

  it('create: adds a script doc and returns it with id/timestamps', () => {
    const d = store.create({ name: 'Cold Open', docUrl: VALID_URL, description: 'Act 1' });
    expect(d.id).toBeTruthy();
    expect(d.name).toBe('Cold Open');
    expect(d.docUrl).toBe(VALID_URL);
    expect(d.description).toBe('Act 1');
    expect(d.createdAt).toBeTypeOf('number');
    expect(d.updatedAt).toBeTypeOf('number');
    expect(store.list()).toHaveLength(1);
  });

  it('create: rejects an empty name', () => {
    expect(() => store.create({ name: '', docUrl: VALID_URL, description: '' })).toThrow(ScriptDocValidationError);
    expect(store.list()).toHaveLength(0);
  });

  it('create: rejects a whitespace-only name', () => {
    expect(() => store.create({ name: '   ', docUrl: VALID_URL, description: '' })).toThrow(ScriptDocValidationError);
  });

  it('create: rejects a non-Google-Docs URL', () => {
    expect(() => store.create({ name: 'Bad', docUrl: 'https://example.com/not-a-doc', description: '' })).toThrow(
      ScriptDocValidationError
    );
    expect(store.list()).toHaveLength(0);
  });

  it('create: rejects a Google Slides URL (not a document)', () => {
    expect(() =>
      store.create({ name: 'Bad', docUrl: 'https://docs.google.com/presentation/d/abc123/edit', description: '' })
    ).toThrow(ScriptDocValidationError);
  });

  it('findById: returns doc or null', () => {
    const d = store.create({ name: 'X', docUrl: VALID_URL, description: '' });
    expect(store.findById(d.id)).toMatchObject({ name: 'X' });
    expect(store.findById('missing')).toBeNull();
  });

  it('update: replaces fields and bumps updatedAt', () => {
    const d = store.create({ name: 'A', docUrl: VALID_URL, description: '' });
    const updated = store.update(d.id, { name: 'B', docUrl: VALID_URL_2 });
    expect(updated).not.toBeNull();
    expect(updated!.name).toBe('B');
    expect(updated!.docUrl).toBe(VALID_URL_2);
    expect(updated!.createdAt).toBe(d.createdAt);
    expect(updated!.updatedAt).toBeGreaterThanOrEqual(d.createdAt);
  });

  it('update: returns null for unknown id', () => {
    expect(store.update('nope', { name: 'X' })).toBeNull();
  });

  it('update: rejects an invalid docUrl and leaves the existing entry untouched', () => {
    const d = store.create({ name: 'A', docUrl: VALID_URL, description: '' });
    expect(() => store.update(d.id, { docUrl: 'not-a-doc-url' })).toThrow(ScriptDocValidationError);
    expect(store.findById(d.id)!.docUrl).toBe(VALID_URL);
  });

  it('update: rejects an empty name and leaves the existing entry untouched', () => {
    const d = store.create({ name: 'A', docUrl: VALID_URL, description: '' });
    expect(() => store.update(d.id, { name: '' })).toThrow(ScriptDocValidationError);
    expect(store.findById(d.id)!.name).toBe('A');
  });

  it('remove: deletes doc and returns true', () => {
    const d = store.create({ name: 'Y', docUrl: VALID_URL, description: '' });
    expect(store.remove(d.id)).toBe(true);
    expect(store.list()).toHaveLength(0);
  });

  it('remove: returns false for unknown id', () => {
    expect(store.remove('nope')).toBe(false);
  });

  it('replaceAll: swaps the whole set without re-validating (trusted persisted input)', () => {
    store.create({ name: 'A', docUrl: VALID_URL, description: '' });
    store.replaceAll([
      { id: '1', name: 'Loaded', docUrl: VALID_URL_2, description: 'from profile', createdAt: 1, updatedAt: 2 },
    ]);
    expect(store.list()).toEqual([
      { id: '1', name: 'Loaded', docUrl: VALID_URL_2, description: 'from profile', createdAt: 1, updatedAt: 2 },
    ]);
  });

  it('onChange fires on create/update/remove/replaceAll', () => {
    let calls = 0;
    const s = createScriptDocsStore(() => {
      calls += 1;
    });
    const d = s.create({ name: 'A', docUrl: VALID_URL, description: '' });
    expect(calls).toBe(1);
    s.update(d.id, { name: 'B' });
    expect(calls).toBe(2);
    s.remove(d.id);
    expect(calls).toBe(3);
    s.replaceAll([]);
    expect(calls).toBe(4);
  });

  it('onChange does not fire on a failed create/update or a no-op remove', () => {
    let calls = 0;
    const s = createScriptDocsStore(() => {
      calls += 1;
    });
    expect(() => s.create({ name: '', docUrl: VALID_URL, description: '' })).toThrow();
    expect(calls).toBe(0);
    const d = s.create({ name: 'A', docUrl: VALID_URL, description: '' });
    expect(calls).toBe(1);
    expect(() => s.update(d.id, { docUrl: 'bad' })).toThrow();
    expect(calls).toBe(1);
    expect(s.remove('missing')).toBe(false);
    expect(calls).toBe(1);
  });
});
