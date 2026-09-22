import { createHash } from 'crypto';
import type { DocErrorCode } from '../../shared/types';

/**
 * Fetching a show script out of a Google Doc.
 *
 * Deliberately pure: the HTTP call arrives as an injected `DocTransport`, so
 * nothing here imports Electron and every branch is unit-testable with a fake.
 * Main supplies an adapter that tries `net.fetch` on the
 * `persist:google-slides` session (reusing the Slides sign-in) and falls back
 * to bare `fetch` for link-shared docs.
 *
 * Three behaviours of Google's txt export could not be verified from the
 * build sandbox and are coded against defensively — see the
 * `TODO(live-verify)` markers below and the "Phase 0 — spike findings" section
 * of `docs/2026-09-21-prompter-drive-scripts-design.md`.
 */

export type { DocErrorCode };

/** Refuse anything larger than this. A show script is kilobytes, not megabytes. */
export const DOC_MAX_BYTES = 2 * 1024 * 1024;

/** Matches `forward.ts`'s posture: bounded wait, never a hung request. */
export const DOC_FETCH_TIMEOUT_MS = 10_000;

/**
 * Only `docs.google.com` *document* URLs parse, over https only. This is the
 * feature's allowlist: because every fetch target is built from an id this
 * parser produced, an arbitrary operator-supplied URL can never become a
 * request made by the main process.
 *
 * Accepts `/document/d/<id>/…` and the multi-account
 * `/document/u/<n>/d/<id>/…` form, mirroring `extractDeckId`
 * (`src/main/services/slide-ops.ts`).
 */
const GOOGLE_DOC_PATTERN = /^https:\/\/docs\.google\.com\/document\/(?:u\/\d+\/)?d\/([A-Za-z0-9_-]+)/;

export interface DocResponse {
  ok: boolean;
  status: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/**
 * The one piece of I/O this module needs, injected so tests never touch the
 * network and the module never touches Electron.
 */
export type DocTransport = (url: string, init: { signal: AbortSignal }) => Promise<DocResponse>;

export type DocFetchResult =
  | { ok: true; text: string; hash: string; words: number }
  | { ok: false; code: DocErrorCode; message: string };

/** Pull the document id out of a Google Docs URL, or null if it isn't one. */
export function extractDocId(url: string): string | null {
  if (typeof url !== 'string') return null;
  const match = GOOGLE_DOC_PATTERN.exec(url.trim());
  return match ? match[1] : null;
}

/** The plain-text export endpoint for a doc id. `txt` drops comments for free. */
export function exportUrlForDocId(docId: string): string {
  return `https://docs.google.com/document/d/${encodeURIComponent(docId)}/export?format=txt`;
}

/**
 * Clean up exported text for the glass.
 *
 * Follows `normalizeSpeakerNotes` (`src/main/slides/window-manager.ts`) rather
 * than inventing a second dialect: Google's responses can arrive with no
 * declared charset, and the U+FFFD handling there is the scar tissue from
 * exactly that. This adds the parts a whole script needs that a notes blob
 * did not — BOM, trailing whitespace, blank-line collapse.
 *
 * TODO(live-verify) — Phase 0 question 1: this assumes `format=txt` does NOT
 * prepend the document title as a first line. If a live check shows it does,
 * the title strip belongs right here, before the CRLF pass: drop a leading
 * line that equals the doc title followed by a blank line. Nothing downstream
 * needs to change.
 *
 * TODO(live-verify) — Phase 0 question 3: this assumes a multi-tab doc's txt
 * export concatenates every tab with no separator, which would mean an
 * operator silently gets all tabs. If confirmed, that needs a documentation
 * callout (multi-tab selection is out of scope per the spec); if instead a
 * separator or tab heading appears, it must be stripped here.
 */
export function normalizeScriptText(raw: string): string {
  if (raw == null || typeof raw !== 'string') return '';
  return (
    raw
      // Line endings first, so everything after can assume LF.
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .replace(/\u2028/g, '\n')
      .replace(/\u2029/g, '\n')
      // Charset corruption, as in normalizeSpeakerNotes: a run of replacement
      // characters is where a line break used to be.
      .replace(/\uFFFD+/g, '\n')
      .replace(/\u0000/g, '')
      // BOM anywhere, not just at the head — it turns up mid-body on pasted content.
      .replace(/\uFEFF/g, '')
      // Trailing whitespace per line, so "blank" really means blank.
      .replace(/[ \t]+$/gm, '')
      // Three or more consecutive newlines (2+ blank lines) become two.
      .replace(/\n{3,}/g, '\n\n\n')
      // Leading/trailing blank lines; per-line leading indent is the
      // producer's formatting and is left alone.
      .replace(/^\n+/, '')
      .replace(/\n+$/, '')
  );
}

/** sha256 hex of the normalized text. Change detection compares hashes, never raw strings. */
export function hashScriptText(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

/**
 * An unauthorized export does not 403 — it returns 200 with Google's sign-in
 * page. Putting that on the talent display would be the worst possible
 * outcome, so anything that opens like a markup document is a hard failure.
 */
function looksLikeHtml(text: string): boolean {
  const head = text.trimStart().slice(0, 2048).toLowerCase();
  if (!head.startsWith('<')) return false;
  return head.startsWith('<!doctype html') || head.includes('<html');
}

const NOT_READABLE_MESSAGE =
  'Could not read that Google Doc. Sign in to Google in PConAir (the same sign-in Slides mode uses), or set the doc to "Anyone with the link can view".';

/**
 * Fetch a doc's plain text, normalized and hashed.
 *
 * Every failure is typed and non-destructive: callers must leave the script
 * currently on the glass untouched on anything but `ok: true`.
 *
 * TODO(live-verify) — Phase 0 question 2 (safety-critical, spec "Known risks"
 * #3): this assumes suggested edits made in *Suggesting* mode are EXCLUDED
 * from `format=txt`, i.e. the export reflects accepted/base text only. If a
 * live check shows suggestions come through as accepted text, unapproved copy
 * can reach the talent, and this feature must not ship without at minimum a
 * prominent "review in Editing mode" warning in the UI and docs. Verify
 * against a real doc with a pending suggestion before release.
 */
export async function fetchDocText(docId: string, transport: DocTransport): Promise<DocFetchResult> {
  if (typeof docId !== 'string' || !/^[A-Za-z0-9_-]+$/.test(docId)) {
    return {
      ok: false,
      code: 'INVALID_DOC_URL',
      message: 'That is not a Google Docs document URL.',
    };
  }

  let res: DocResponse;
  try {
    res = await transport(exportUrlForDocId(docId), {
      signal: AbortSignal.timeout(DOC_FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    return {
      ok: false,
      code: 'DOC_UNREACHABLE',
      message: `Could not reach Google Docs: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      return { ok: false, code: 'DOC_NOT_READABLE', message: NOT_READABLE_MESSAGE };
    }
    return {
      ok: false,
      code: 'DOC_UNREACHABLE',
      message: `Google Docs returned HTTP ${res.status} for that document.`,
    };
  }

  let buf: ArrayBuffer;
  try {
    buf = await res.arrayBuffer();
  } catch (err) {
    return {
      ok: false,
      code: 'DOC_UNREACHABLE',
      message: `Could not read the response from Google Docs: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (buf.byteLength > DOC_MAX_BYTES) {
    return {
      ok: false,
      code: 'DOC_TOO_LARGE',
      message: `That document is ${Math.round(buf.byteLength / 1024)} KB; the limit is ${DOC_MAX_BYTES / 1024 / 1024} MB.`,
    };
  }

  // Decode explicitly. Google's export can arrive with no declared charset,
  // and `res.text()` would then guess — that guess is the origin of the
  // U+FFFD corruption normalizeSpeakerNotes exists to clean up. Never `.text()`.
  const raw = new TextDecoder('utf-8').decode(buf);

  if (looksLikeHtml(raw)) {
    return { ok: false, code: 'DOC_NOT_READABLE', message: NOT_READABLE_MESSAGE };
  }

  const text = normalizeScriptText(raw);
  if (!text.trim()) {
    return {
      ok: false,
      code: 'DOC_EMPTY',
      message: 'That document is empty. The script on the prompter has been left alone.',
    };
  }

  return { ok: true, text, hash: hashScriptText(text), words: countWords(text) };
}
