import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createStateStore, type StateStore } from '../src/main/state';
import { createFullServer } from './_test-server';
import type { DocFetchResult } from '../src/main/prompter/doc-source';

const PINS = { operatorPin: '1234', adminPin: 'supersecret' };
const DOC_URL = 'https://docs.google.com/document/d/abc123XYZ/edit';

/** A fetchDoc stub whose outcome can be swapped out per-call from the test body. */
function makeFetchDoc() {
  let impl: (docId: string) => Promise<DocFetchResult> = async () => {
    throw new Error('fetchDoc stub not configured for this call');
  };
  const calls: string[] = [];
  const fetchDoc = async (docId: string): Promise<DocFetchResult> => {
    calls.push(docId);
    return impl(docId);
  };
  return {
    fetchDoc,
    calls,
    set(next: (docId: string) => Promise<DocFetchResult>) {
      impl = next;
    },
    ok(text: string, hash = 'hash-' + text.length): DocFetchResult {
      return { ok: true, text, hash, words: text.trim() ? text.trim().split(/\s+/).length : 0 };
    },
  };
}

describe('prompter doc routes', () => {
  let srv: ReturnType<typeof createFullServer>;
  let store: StateStore;
  let op: string;
  let admin: string;
  let stub: ReturnType<typeof makeFetchDoc>;

  beforeEach(async () => {
    store = createStateStore();
    stub = makeFetchDoc();
    srv = createFullServer({
      ...PINS,
      store,
      port: 0,
      fetchDoc: stub.fetchDoc,
    });
    await srv.listen();
    const o = await request(srv.app).post('/auth/operator').send({ pin: PINS.operatorPin });
    op = o.headers['set-cookie'][0].split(';')[0];
    const a = await request(srv.app).post('/auth/admin').send({ pin: PINS.adminPin });
    admin = a.headers['set-cookie'][0].split(';')[0];
  });

  afterEach(async () => {
    await srv.close();
  });

  describe('doc/load', () => {
    it('loads via an ad-hoc URL and applies immediately', async () => {
      stub.set(async (docId) => stub.ok(`text for ${docId}`));
      const res = await request(srv.app).post('/api/prompter/doc/load').set('Cookie', op).send({ url: DOC_URL });
      expect(res.status).toBe(200);
      expect(store.getState().prompter.script).toBe('text for abc123XYZ');
      expect(store.getState().prompter.doc).toMatchObject({
        url: DOC_URL,
        docId: 'abc123XYZ',
        name: null,
        status: 'ready',
        error: null,
        staged: null,
      });
      expect(store.getState().prompter.doc.loadedHash).toBe('hash-' + 'text for abc123XYZ'.length);
      expect(store.getState().prompter.doc.loadedAt).not.toBeNull();
    });

    it('loads via a saved presetId, tagging the doc with the library name', async () => {
      const created = await request(srv.app)
        .post('/api/prompter/docs')
        .set('Cookie', admin)
        .send({ name: 'Cold Open', docUrl: DOC_URL });
      expect(created.status).toBe(201);

      stub.set(async () => stub.ok('cold open copy'));
      const res = await request(srv.app)
        .post('/api/prompter/doc/load')
        .set('Cookie', op)
        .send({ presetId: created.body.id });
      expect(res.status).toBe(200);
      expect(store.getState().prompter.script).toBe('cold open copy');
      expect(store.getState().prompter.doc).toMatchObject({ name: 'Cold Open', url: DOC_URL, docId: 'abc123XYZ' });
    });

    it('rejects a presetId that does not resolve to a saved doc', async () => {
      const res = await request(srv.app).post('/api/prompter/doc/load').set('Cookie', op).send({ presetId: 'nope' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_DOC_URL');
      expect(stub.calls).toEqual([]);
    });

    it('rejects a body with neither url nor presetId', async () => {
      const res = await request(srv.app).post('/api/prompter/doc/load').set('Cookie', op).send({});
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_DOC_URL');
    });

    it('rejects a non-Google-Docs URL before any fetch', async () => {
      const res = await request(srv.app).post('/api/prompter/doc/load').set('Cookie', op).send({ url: 'https://example.com/nope' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_DOC_URL');
      expect(stub.calls).toEqual([]);
    });

    it('surfaces a typed fetch failure and leaves the script and view untouched', async () => {
      await request(srv.app).post('/api/prompter/script').set('Cookie', op).send({ text: 'On air already.' });
      const before = await request(srv.app).get('/api/prompter/view');

      stub.set(async () => ({ ok: false, code: 'DOC_NOT_READABLE', message: 'sign in or share the link' }));
      const res = await request(srv.app).post('/api/prompter/doc/load').set('Cookie', op).send({ url: DOC_URL });
      expect(res.status).toBe(502);
      expect(res.body.error.code).toBe('DOC_NOT_READABLE');
      expect(store.getState().prompter.script).toBe('On air already.');
      expect(store.getState().prompter.doc.status).toBe('error');
      expect(store.getState().prompter.doc.error).toEqual({ code: 'DOC_NOT_READABLE', message: 'sign in or share the link' });
      expect(store.getState().prompter.doc.loadedHash).toBe('');

      const after = await request(srv.app).get('/api/prompter/view');
      expect(after.body.prompter).toEqual(before.body.prompter);
    });

    it('requires an operator session', async () => {
      const res = await request(srv.app).post('/api/prompter/doc/load').send({ url: DOC_URL });
      expect(res.status).toBe(401);
    });
  });

  describe('doc/refresh', () => {
    async function loadDoc(text: string) {
      stub.set(async () => stub.ok(text));
      await request(srv.app).post('/api/prompter/doc/load').set('Cookie', op).send({ url: DOC_URL });
    }

    it('stages new text without touching script or loadedHash', async () => {
      await loadDoc('original text');
      const loadedHash = store.getState().prompter.doc.loadedHash;

      stub.set(async () => stub.ok('revised text'));
      const res = await request(srv.app).post('/api/prompter/doc/refresh').set('Cookie', op);
      expect(res.status).toBe(200);

      expect(store.getState().prompter.script).toBe('original text');
      expect(store.getState().prompter.doc.loadedHash).toBe(loadedHash);
      expect(store.getState().prompter.doc.staged).toMatchObject({ text: 'revised text' });
      expect(store.getState().prompter.doc.status).toBe('ready');
    });

    it('leaves the view byte-identical when only staging (nothing taken)', async () => {
      await loadDoc('original text');
      const before = await request(srv.app).get('/api/prompter/view');

      stub.set(async () => stub.ok('revised text'));
      await request(srv.app).post('/api/prompter/doc/refresh').set('Cookie', op);

      const after = await request(srv.app).get('/api/prompter/view');
      expect(after.body.prompter).toEqual(before.body.prompter);
    });

    it('409s when nothing is configured to refresh', async () => {
      const res = await request(srv.app).post('/api/prompter/doc/refresh').set('Cookie', op);
      expect(res.status).toBe(409);
      expect(stub.calls).toEqual([]);
    });

    it('surfaces a typed fetch failure without touching script, loadedHash, or staged', async () => {
      await loadDoc('original text');
      const before = await request(srv.app).get('/api/prompter/view');

      stub.set(async () => ({ ok: false, code: 'DOC_UNREACHABLE', message: 'timed out' }));
      const res = await request(srv.app).post('/api/prompter/doc/refresh').set('Cookie', op);
      expect(res.status).toBe(502);
      expect(res.body.error.code).toBe('DOC_UNREACHABLE');
      expect(store.getState().prompter.script).toBe('original text');
      expect(store.getState().prompter.doc.staged).toBeNull();
      expect(store.getState().prompter.doc.status).toBe('error');

      const after = await request(srv.app).get('/api/prompter/view');
      expect(after.body.prompter).toEqual(before.body.prompter);
    });

    it('requires an operator session', async () => {
      const res = await request(srv.app).post('/api/prompter/doc/refresh');
      expect(res.status).toBe(401);
    });
  });

  describe('doc/take', () => {
    async function loadAndStage(original: string, revised: string) {
      stub.set(async () => stub.ok(original));
      await request(srv.app).post('/api/prompter/doc/load').set('Cookie', op).send({ url: DOC_URL });
      stub.set(async () => stub.ok(revised));
      await request(srv.app).post('/api/prompter/doc/refresh').set('Cookie', op);
    }

    it('applies staged text, updates loadedHash, and clears staged', async () => {
      await loadAndStage('original text', 'revised text');
      const stagedHash = store.getState().prompter.doc.staged!.hash;

      const res = await request(srv.app).post('/api/prompter/doc/take').set('Cookie', op);
      expect(res.status).toBe(200);
      expect(store.getState().prompter.script).toBe('revised text');
      expect(store.getState().prompter.doc.staged).toBeNull();
      expect(store.getState().prompter.doc.loadedHash).toBe(stagedHash);
      expect(store.getState().prompter.doc.loadedAt).not.toBeNull();
    });

    it('parks the prompter at the top on take, like any other script load', async () => {
      await loadAndStage('original text', 'revised text');
      await request(srv.app).post('/api/prompter/start').set('Cookie', op);
      await request(srv.app).post('/api/prompter/doc/take').set('Cookie', op);
      expect(store.getState().prompter.scrolling).toBe(false);
      expect(store.getState().prompter.offset).toBe(0);
    });

    it('409s with nothing staged and makes no state change', async () => {
      stub.set(async () => stub.ok('original text'));
      await request(srv.app).post('/api/prompter/doc/load').set('Cookie', op).send({ url: DOC_URL });
      const before = await request(srv.app).get('/api/prompter/view');

      const res = await request(srv.app).post('/api/prompter/doc/take').set('Cookie', op);
      expect(res.status).toBe(409);

      const after = await request(srv.app).get('/api/prompter/view');
      expect(after.body.prompter).toEqual(before.body.prompter);
    });

    it('requires an operator session', async () => {
      const res = await request(srv.app).post('/api/prompter/doc/take');
      expect(res.status).toBe(401);
    });
  });

  describe('doc/clear', () => {
    it('resets the doc block but leaves the script on the glass untouched', async () => {
      stub.set(async () => stub.ok('on the glass now'));
      await request(srv.app).post('/api/prompter/doc/load').set('Cookie', op).send({ url: DOC_URL });

      const res = await request(srv.app).post('/api/prompter/doc/clear').set('Cookie', op);
      expect(res.status).toBe(200);
      expect(store.getState().prompter.script).toBe('on the glass now');
      expect(store.getState().prompter.doc).toMatchObject({
        url: '',
        docId: '',
        name: null,
        loadedAt: null,
        loadedHash: '',
        staged: null,
        status: 'idle',
        error: null,
        lastCheckedAt: null,
      });
    });

    it('requires an operator session', async () => {
      const res = await request(srv.app).post('/api/prompter/doc/clear');
      expect(res.status).toBe(401);
    });
  });

  describe('docs library CRUD', () => {
    it('lists, creates, updates, and deletes (operator lists, admin mutates)', async () => {
      const emptyList = await request(srv.app).get('/api/prompter/docs').set('Cookie', op);
      expect(emptyList.status).toBe(200);
      expect(emptyList.body.docs).toEqual([]);

      const deniedCreate = await request(srv.app).post('/api/prompter/docs').set('Cookie', op).send({ name: 'x', docUrl: DOC_URL });
      expect(deniedCreate.status).toBe(403);

      const created = await request(srv.app)
        .post('/api/prompter/docs')
        .set('Cookie', admin)
        .send({ name: 'Cold Open', docUrl: DOC_URL, description: 'Top of show' });
      expect(created.status).toBe(201);
      expect(created.body).toMatchObject({ name: 'Cold Open', docUrl: DOC_URL, description: 'Top of show' });

      const list = await request(srv.app).get('/api/prompter/docs').set('Cookie', op);
      expect(list.body.docs).toHaveLength(1);

      const updated = await request(srv.app)
        .patch(`/api/prompter/docs/${created.body.id}`)
        .set('Cookie', admin)
        .send({ name: 'Cold Open v2' });
      expect(updated.status).toBe(200);
      expect(updated.body.name).toBe('Cold Open v2');

      const deleted = await request(srv.app).delete(`/api/prompter/docs/${created.body.id}`).set('Cookie', admin);
      expect(deleted.status).toBe(204);

      const finalList = await request(srv.app).get('/api/prompter/docs').set('Cookie', op);
      expect(finalList.body.docs).toEqual([]);
    });

    it('rejects an invalid docUrl with 400', async () => {
      const res = await request(srv.app)
        .post('/api/prompter/docs')
        .set('Cookie', admin)
        .send({ name: 'Bad', docUrl: 'https://example.com/not-a-doc' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('404s on update/delete for an unknown id', async () => {
      const upd = await request(srv.app).patch('/api/prompter/docs/nope').set('Cookie', admin).send({ name: 'x' });
      expect(upd.status).toBe(404);
      const del = await request(srv.app).delete('/api/prompter/docs/nope').set('Cookie', admin);
      expect(del.status).toBe(404);
    });

    it('requires at least an operator session to list, admin to mutate', async () => {
      expect((await request(srv.app).get('/api/prompter/docs')).status).toBe(401);
      expect((await request(srv.app).post('/api/prompter/docs').send({ name: 'x', docUrl: DOC_URL })).status).toBe(401);
      expect((await request(srv.app).patch('/api/prompter/docs/x').send({ name: 'x' })).status).toBe(401);
      expect((await request(srv.app).delete('/api/prompter/docs/x')).status).toBe(401);
    });
  });

  describe('status and view exposure', () => {
    it('GET /api/prompter/status includes the full doc block, including staged', async () => {
      stub.set(async () => stub.ok('original text'));
      await request(srv.app).post('/api/prompter/doc/load').set('Cookie', op).send({ url: DOC_URL });
      stub.set(async () => stub.ok('revised text'));
      await request(srv.app).post('/api/prompter/doc/refresh').set('Cookie', op);

      const res = await request(srv.app).get('/api/prompter/status').set('Cookie', op);
      expect(res.status).toBe(200);
      expect(res.body.prompter.doc).toBeDefined();
      expect(res.body.prompter.doc.staged).toMatchObject({ text: 'revised text' });
      expect(res.body.prompter.doc.docId).toBe('abc123XYZ');
    });

    it('GET /api/prompter/view never exposes doc.staged, or any doc field at all', async () => {
      stub.set(async () => stub.ok('original text'));
      await request(srv.app).post('/api/prompter/doc/load').set('Cookie', op).send({ url: DOC_URL });
      stub.set(async () => stub.ok('revised text'));
      await request(srv.app).post('/api/prompter/doc/refresh').set('Cookie', op);

      const res = await request(srv.app).get('/api/prompter/view');
      expect(res.status).toBe(200);
      expect(res.body.prompter.doc).toBeUndefined();
      expect(JSON.stringify(res.body)).not.toContain('revised text');
    });
  });
});
