import { describe, it, expect } from 'vitest';
import { createHash } from 'crypto';
import {
  extractDocId,
  normalizeScriptText,
  fetchDocText,
  exportUrlForDocId,
  DOC_MAX_BYTES,
  type DocTransport,
} from '../src/main/prompter/doc-source';

/** Build a transport that answers every request with one canned response. */
function stubTransport(res: {
  ok?: boolean;
  status?: number;
  body?: string | Uint8Array;
}): DocTransport & { calls: string[] } {
  const calls: string[] = [];
  const bytes =
    typeof res.body === 'string' ? new TextEncoder().encode(res.body) : (res.body ?? new Uint8Array());
  const transport = async (url: string) => {
    calls.push(url);
    return {
      ok: res.ok ?? true,
      status: res.status ?? 200,
      arrayBuffer: async () =>
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    };
  };
  return Object.assign(transport, { calls });
}

const DOC_ID = '1AbC_dEf-GhIjKlMnOpQrStUvWxYz0123456789';

describe('extractDocId', () => {
  it('accepts the canonical /document/d/<id>/ shape', () => {
    expect(extractDocId(`https://docs.google.com/document/d/${DOC_ID}/edit`)).toBe(DOC_ID);
    expect(extractDocId(`https://docs.google.com/document/d/${DOC_ID}/edit#heading=h.abc`)).toBe(DOC_ID);
    expect(extractDocId(`https://docs.google.com/document/d/${DOC_ID}/`)).toBe(DOC_ID);
    expect(extractDocId(`https://docs.google.com/document/d/${DOC_ID}`)).toBe(DOC_ID);
  });

  it('accepts the multi-account /document/u/<n>/d/<id>/ shape', () => {
    expect(extractDocId(`https://docs.google.com/document/u/0/d/${DOC_ID}/edit`)).toBe(DOC_ID);
    expect(extractDocId(`https://docs.google.com/document/u/12/d/${DOC_ID}/edit`)).toBe(DOC_ID);
  });

  it('tolerates surrounding whitespace from a paste', () => {
    expect(extractDocId(`  https://docs.google.com/document/d/${DOC_ID}/edit \n`)).toBe(DOC_ID);
  });

  // Security boundary: only Google Docs document URLs parse, so an arbitrary
  // URL can never become a fetch target in the main process.
  it('rejects non-Docs hosts, including lookalikes', () => {
    expect(extractDocId(`https://evil.example.com/document/d/${DOC_ID}/edit`)).toBeNull();
    expect(extractDocId(`https://docs.google.com.evil.example/document/d/${DOC_ID}/edit`)).toBeNull();
    expect(extractDocId(`https://notdocs.google.com/document/d/${DOC_ID}/edit`)).toBeNull();
    expect(extractDocId(`https://docs.google.co/document/d/${DOC_ID}/edit`)).toBeNull();
  });

  it('rejects non-https schemes', () => {
    expect(extractDocId(`http://docs.google.com/document/d/${DOC_ID}/edit`)).toBeNull();
    expect(extractDocId(`file:///document/d/${DOC_ID}`)).toBeNull();
    expect(extractDocId(`javascript:alert(1)//docs.google.com/document/d/${DOC_ID}`)).toBeNull();
  });

  it('rejects other Google Docs product URLs', () => {
    expect(extractDocId(`https://docs.google.com/presentation/d/${DOC_ID}/edit`)).toBeNull();
    expect(extractDocId(`https://docs.google.com/spreadsheets/d/${DOC_ID}/edit`)).toBeNull();
    expect(extractDocId(`https://docs.google.com/forms/d/${DOC_ID}/edit`)).toBeNull();
    expect(extractDocId('https://drive.google.com/file/d/abc/view')).toBeNull();
  });

  it('rejects junk input', () => {
    expect(extractDocId('')).toBeNull();
    expect(extractDocId('not a url')).toBeNull();
    expect(extractDocId('https://docs.google.com/document/d//edit')).toBeNull();
    expect(extractDocId('https://docs.google.com/document/edit')).toBeNull();
    expect(extractDocId(undefined as unknown as string)).toBeNull();
    expect(extractDocId(42 as unknown as string)).toBeNull();
  });
});

describe('normalizeScriptText', () => {
  it('converts CRLF and bare CR to LF', () => {
    expect(normalizeScriptText('one\r\ntwo\rthree')).toBe('one\ntwo\nthree');
  });

  it('strips a leading BOM', () => {
    expect(normalizeScriptText('\uFEFFGood evening')).toBe('Good evening');
  });

  it('strips U+FFFD corruption and NULs', () => {
    expect(normalizeScriptText('cue��line')).toBe('cue\nline');
    expect(normalizeScriptText('cue\u0000line')).toBe('cueline');
  });

  it('normalizes U+2028/U+2029 line and paragraph separators to LF', () => {
    expect(normalizeScriptText('a\u2028b\u2029c')).toBe('a\nb\nc');
  });

  it('collapses three or more blank lines to two', () => {
    expect(normalizeScriptText('one\n\n\n\n\n\ntwo')).toBe('one\n\n\ntwo');
    expect(normalizeScriptText('one\n\ntwo')).toBe('one\n\ntwo');
  });

  it('trims trailing whitespace on every line', () => {
    expect(normalizeScriptText('one   \ntwo\t\nthree')).toBe('one\ntwo\nthree');
  });

  it('trims leading and trailing blank space from the whole script', () => {
    expect(normalizeScriptText('\n\n  Welcome back.\n\n\n')).toBe('  Welcome back.');
  });

  it('returns empty string for non-string input', () => {
    expect(normalizeScriptText(null as unknown as string)).toBe('');
    expect(normalizeScriptText(undefined as unknown as string)).toBe('');
    expect(normalizeScriptText(7 as unknown as string)).toBe('');
  });

  it('is idempotent', () => {
    const once = normalizeScriptText('a\r\n\r\n\r\n\r\nb   \r\n');
    expect(normalizeScriptText(once)).toBe(once);
  });
});

describe('fetchDocText', () => {
  it('requests the txt export endpoint for the doc id', async () => {
    const t = stubTransport({ body: 'Line one' });
    await fetchDocText(DOC_ID, t);
    expect(t.calls).toEqual([exportUrlForDocId(DOC_ID)]);
    expect(t.calls[0]).toContain('format=txt');
  });

  it('rejects an invalid doc id before touching the transport', async () => {
    const t = stubTransport({ body: 'Line one' });
    const res = await fetchDocText('', t);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('INVALID_DOC_URL');
    expect(t.calls).toEqual([]);
  });

  it('decodes charset-less UTF-8 bytes correctly', async () => {
    // Multi-byte characters a latin-1 decode would mangle: em dash, curly
    // quotes, ellipsis. No charset is declared anywhere — the decode is ours.
    const text = 'Good evening — “welcome back”…';
    const t = stubTransport({ body: new TextEncoder().encode(text) });
    const res = await fetchDocText(DOC_ID, t);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.text).toBe(text);
      expect(res.text).not.toContain('�');
    }
  });

  it('strips a UTF-8 BOM emitted by the export', async () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('Top of show')]);
    const res = await fetchDocText(DOC_ID, stubTransport({ body: bytes }));
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.text).toBe('Top of show');
  });

  it('returns a sha256 hash of the normalized text and a word count', async () => {
    const t = stubTransport({ body: 'one two\r\nthree   \n\n\n\n four' });
    const res = await fetchDocText(DOC_ID, t);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.text).toBe('one two\nthree\n\n\n four');
      expect(res.hash).toBe(createHash('sha256').update(res.text, 'utf8').digest('hex'));
      expect(res.hash).toMatch(/^[0-9a-f]{64}$/);
      expect(res.words).toBe(4);
    }
  });

  it('hashes identical content identically and differing content differently', async () => {
    const a = await fetchDocText(DOC_ID, stubTransport({ body: 'same text' }));
    const b = await fetchDocText(DOC_ID, stubTransport({ body: 'same text\r\n' }));
    const c = await fetchDocText(DOC_ID, stubTransport({ body: 'other text' }));
    expect(a.ok && b.ok && c.ok).toBe(true);
    if (a.ok && b.ok && c.ok) {
      expect(a.hash).toBe(b.hash);
      expect(a.hash).not.toBe(c.hash);
    }
  });

  it('reports an HTML sign-in interstitial as DOC_NOT_READABLE, not a script', async () => {
    const body =
      '<!DOCTYPE html><html><head><title>Google Docs</title></head><body>Sign in to continue</body></html>';
    const res = await fetchDocText(DOC_ID, stubTransport({ status: 200, ok: true, body }));
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe('DOC_NOT_READABLE');
      // Both remedies must be named so the failure is self-diagnosing.
      expect(res.message.toLowerCase()).toContain('sign in');
      expect(res.message.toLowerCase()).toContain('link');
    }
  });

  it('detects an HTML interstitial with leading whitespace or no doctype', async () => {
    const a = await fetchDocText(DOC_ID, stubTransport({ body: '\n  <html><body>Sign in</body></html>' }));
    const b = await fetchDocText(DOC_ID, stubTransport({ body: '<!doctype HTML><body>x</body>' }));
    expect(a.ok).toBe(false);
    expect(b.ok).toBe(false);
    if (!a.ok) expect(a.code).toBe('DOC_NOT_READABLE');
    if (!b.ok) expect(b.code).toBe('DOC_NOT_READABLE');
  });

  it('does not mistake a script that merely mentions angle brackets for HTML', async () => {
    const res = await fetchDocText(DOC_ID, stubTransport({ body: 'HOST: the <html> tag is where it starts.' }));
    expect(res.ok).toBe(true);
  });

  it('maps a 404 to DOC_UNREACHABLE', async () => {
    const res = await fetchDocText(DOC_ID, stubTransport({ ok: false, status: 404, body: 'Not Found' }));
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe('DOC_UNREACHABLE');
      expect(res.message).toContain('404');
    }
  });

  it('maps 401/403 to DOC_NOT_READABLE', async () => {
    for (const status of [401, 403]) {
      const res = await fetchDocText(DOC_ID, stubTransport({ ok: false, status, body: 'nope' }));
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('DOC_NOT_READABLE');
    }
  });

  it('maps a thrown transport error (network down / timeout) to DOC_UNREACHABLE', async () => {
    const res = await fetchDocText(DOC_ID, async () => {
      throw new Error('socket hang up');
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe('DOC_UNREACHABLE');
      expect(res.message).toContain('socket hang up');
    }
  });

  it('refuses to stage an empty doc', async () => {
    const res = await fetchDocText(DOC_ID, stubTransport({ body: '' }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('DOC_EMPTY');
  });

  it('treats a whitespace-only doc as empty', async () => {
    const res = await fetchDocText(DOC_ID, stubTransport({ body: '\r\n   \n\n\uFEFF  \n' }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('DOC_EMPTY');
  });

  it('rejects a body over the size cap', async () => {
    const big = new Uint8Array(DOC_MAX_BYTES + 1).fill(0x41);
    const res = await fetchDocText(DOC_ID, stubTransport({ body: big }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('DOC_TOO_LARGE');
  });

  it('accepts a body exactly at the size cap', async () => {
    const atCap = new Uint8Array(DOC_MAX_BYTES).fill(0x41);
    const res = await fetchDocText(DOC_ID, stubTransport({ body: atCap }));
    expect(res.ok).toBe(true);
  });
});
