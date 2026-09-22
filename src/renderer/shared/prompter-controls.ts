/**
 * Shared "Script Source" prompter UI — design doc section 7
 * (docs/2026-09-21-prompter-drive-scripts-design.md, decision 5).
 *
 * Scope decision (documented, not silent): this module renders/wires ONLY
 * the new Google-Doc "Script Source" block — library select, ad-hoc URL
 * field, Load/Refresh/Take/Clear, a status line, and the amber "update
 * ready" pill. It deliberately does NOT subsume the existing hand-built
 * transport/font/speed controls that already live in `/remote/`
 * (`src/renderer/remote/index.ts`, `wirePrompterPage`/`renderPrompter`) or
 * in Admin's inline `<script>` (`src/renderer/admin/index.html:1927`).
 *
 * Why additive-only rather than the full consolidation the design doc's
 * decision 5 gestures at: Admin's prompter section is ~250 lines of
 * `getElementById` + `post` wiring covering transport, font/speed, mirror,
 * text-align, side-padding, and marker controls, embedded inside a
 * 2,456-line file with real inline-script/bundle-scope coupling risk. The
 * design doc itself calls that migration "the risk item in this work",
 * assigns it to Opus as its own phase (Phase 5), and says to do it "as its
 * own commit, verify it independently". Folding that surface into this
 * module now — without the live verification Phase 5 is scoped to do —
 * would either duplicate that work or ship it unverified. So: this module
 * is self-contained and covers only the net-new surface every phase-4b
 * mount needs (`/remote/`, `/prompter-control/`); full consolidation of the
 * transport/slider controls onto a shared module remains Phase 5's job, and
 * Phase 5 can compose it into the same page without any change here.
 *
 * Self-contained: no dependency on caller-page ids/classes. All queries are
 * scoped to the `root` element passed to `wirePrompterControls`, so this can
 * be mounted more than once per document without collision (not currently
 * exercised, but the contract is worth keeping honest).
 */

import type { PrompterState } from '../../shared/types';

export interface PrompterControlsOpts {
  /** POSTs a JSON body to a `/api/prompter/...` route and returns the raw Response. */
  post: (path: string, body?: object) => Promise<Response>;
  /** Subscribe to prompter state updates (WS `state`/`state_patch`, or an initial hydrate). */
  onState: (cb: (state: PrompterState) => void) => void;
}

interface LibraryEntry {
  id: string;
  name: string;
  docUrl: string;
  description: string;
}

const CSS = `
.pcp-doc { font-family: inherit; color: var(--pcp-text, var(--text, #333)); }
.pcp-doc h3 { margin: 0 0 10px; font-size: 15px; font-weight: 700; display: flex; align-items: center; gap: 8px; }
.pcp-doc-pill { font-size: 10px; font-weight: 700; letter-spacing: 0.6px; border-radius: 999px; padding: 3px 10px; border: 1px solid var(--pcp-warn, var(--warn, #9a6100)); color: var(--pcp-warn, var(--warn, #9a6100)); text-transform: uppercase; }
.pcp-doc-row { display: flex; gap: 8px; margin-bottom: 8px; }
.pcp-doc-row select, .pcp-doc-row input[type="text"] { flex: 1; min-width: 0; padding: 8px 10px; font-size: 14px; border: 1px solid var(--pcp-border, var(--border, #dfe0e1)); border-radius: 6px; background: var(--pcp-surface, var(--surface, #fff)); color: inherit; }
.pcp-doc-actions { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; }
.pcp-btn { padding: 9px 16px; border-radius: 6px; border: 1px solid var(--pcp-border, var(--border, #dfe0e1)); background: var(--pcp-surface, var(--surface, #fff)); color: inherit; font-size: 13px; font-weight: 600; cursor: pointer; }
.pcp-btn.primary { background: var(--pcp-accent, var(--accent, #1a6dd4)); border-color: var(--pcp-accent, var(--accent, #1a6dd4)); color: var(--pcp-on-accent, var(--on-accent, #fff)); }
.pcp-btn:disabled { opacity: 0.5; pointer-events: none; }
.pcp-doc-status { font-size: 13px; color: var(--pcp-text-dim, var(--text-dim, #757575)); margin: 0 0 4px; }
.pcp-doc-msg { font-size: 13px; margin: 0; min-height: 1.2em; }
.pcp-doc-msg.error { color: var(--pcp-err, var(--err, #b3261e)); }
`;

/** Renders the Script Source block. Caller inserts the returned HTML wherever the mount wants it. */
export function renderPrompterControls(state: PrompterState): string {
  const doc = state.doc;
  const updateReady = doc.status === 'ready' && doc.staged !== null;
  return `<style>${CSS}</style>
<div class="pcp-doc" data-pcp-root>
  <h3>Script Source <span class="pcp-doc-pill" data-pcp-pill${updateReady ? '' : ' hidden'}>Update ready</span></h3>
  <div class="pcp-doc-row">
    <select data-pcp-library aria-label="Saved script"><option value="">Choose a saved script…</option></select>
    <button type="button" class="pcp-btn primary" data-pcp-load-preset>Load</button>
  </div>
  <div class="pcp-doc-row">
    <input type="text" data-pcp-url placeholder="Paste a Google Doc URL…" aria-label="Ad-hoc Google Doc URL" />
    <button type="button" class="pcp-btn primary" data-pcp-load-url>Load</button>
  </div>
  <div class="pcp-doc-actions">
    <button type="button" class="pcp-btn" data-pcp-refresh>Refresh</button>
    <button type="button" class="pcp-btn primary" data-pcp-take${doc.staged ? '' : ' disabled'}>Take</button>
    <button type="button" class="pcp-btn" data-pcp-clear${doc.docId ? '' : ' disabled'}>Clear source</button>
  </div>
  <p class="pcp-doc-status" data-pcp-status></p>
  <p class="pcp-doc-msg" data-pcp-msg></p>
</div>`;
}

function formatTime(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function wordCount(text: string): number {
  const trimmed = text.trim();
  return trimmed === '' ? 0 : trimmed.split(/\s+/).length;
}

function describeStatus(state: PrompterState): string {
  const doc = state.doc;
  if (!doc.docId) return 'No script source attached — load a saved script or paste a URL.';
  const attached = doc.name ? doc.name : doc.url;
  const loaded =
    doc.loadedAt !== null
      ? `loaded ${formatTime(doc.loadedAt)} · ${wordCount(state.script).toLocaleString()} words`
      : 'not yet loaded';
  const staged = doc.staged ? ` · refreshed ${formatTime(doc.staged.fetchedAt)}, ${doc.staged.words.toLocaleString()} words staged` : '';
  return `${attached} — ${loaded}${staged}`;
}

/**
 * Wires the block rendered by `renderPrompterControls` into the DOM under
 * `root`. Fetches the saved-script library once on mount (GET, so it goes
 * through the page's own session cookie rather than the injected `post`,
 * which the contract defines as POST-only) and re-renders the read-only
 * bits whenever `onState` fires.
 */
export function wirePrompterControls(root: HTMLElement, opts: { post: PrompterControlsOpts['post']; onState: PrompterControlsOpts['onState'] }): void {
  const { post, onState } = opts;

  const librarySelect = root.querySelector<HTMLSelectElement>('[data-pcp-library]');
  const urlInput = root.querySelector<HTMLInputElement>('[data-pcp-url]');
  const loadPresetBtn = root.querySelector<HTMLButtonElement>('[data-pcp-load-preset]');
  const loadUrlBtn = root.querySelector<HTMLButtonElement>('[data-pcp-load-url]');
  const refreshBtn = root.querySelector<HTMLButtonElement>('[data-pcp-refresh]');
  const takeBtn = root.querySelector<HTMLButtonElement>('[data-pcp-take]');
  const clearBtn = root.querySelector<HTMLButtonElement>('[data-pcp-clear]');
  const pill = root.querySelector<HTMLElement>('[data-pcp-pill]');
  const statusEl = root.querySelector<HTMLElement>('[data-pcp-status]');
  const msgEl = root.querySelector<HTMLElement>('[data-pcp-msg]');

  if (!librarySelect || !urlInput || !loadPresetBtn || !loadUrlBtn || !refreshBtn || !takeBtn || !clearBtn || !pill || !statusEl || !msgEl) {
    return; // markup mismatch — nothing to wire against
  }

  let library: LibraryEntry[] = [];

  function setMsg(text: string, isError: boolean): void {
    msgEl!.textContent = text;
    msgEl!.classList.toggle('error', isError);
  }

  async function handleResponse(res: Response, okMessage: string): Promise<void> {
    if (res.ok) {
      setMsg(okMessage, false);
      return;
    }
    const data = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    setMsg(data?.error?.message ?? `HTTP ${res.status}`, true);
  }

  function renderLibraryOptions(): void {
    const prev = librarySelect!.value;
    librarySelect!.innerHTML = '<option value="">Choose a saved script…</option>';
    for (const entry of library) {
      const opt = document.createElement('option');
      opt.value = entry.id;
      opt.textContent = entry.name;
      librarySelect!.appendChild(opt);
    }
    if (library.some((e) => e.id === prev)) librarySelect!.value = prev;
  }

  async function loadLibrary(): Promise<void> {
    try {
      const res = await fetch('/api/prompter/docs');
      if (!res.ok) return;
      const data = (await res.json()) as { docs?: LibraryEntry[] };
      library = data.docs ?? [];
      renderLibraryOptions();
    } catch {
      /* the operator can still use the ad-hoc URL field */
    }
  }

  loadPresetBtn.addEventListener('click', () => {
    const presetId = librarySelect!.value;
    if (!presetId) {
      setMsg('Choose a saved script first.', true);
      return;
    }
    setMsg('Loading…', false);
    void post('/api/prompter/doc/load', { presetId }).then((res) => handleResponse(res, 'Loaded.'));
  });

  loadUrlBtn.addEventListener('click', () => {
    const url = urlInput!.value.trim();
    if (!url) {
      setMsg('Paste a Google Doc URL first.', true);
      return;
    }
    setMsg('Loading…', false);
    void post('/api/prompter/doc/load', { url }).then((res) => handleResponse(res, 'Loaded.'));
  });

  refreshBtn.addEventListener('click', () => {
    setMsg('Checking for updates…', false);
    void post('/api/prompter/doc/refresh').then((res) => handleResponse(res, 'Checked.'));
  });

  takeBtn.addEventListener('click', () => {
    setMsg('Taking…', false);
    void post('/api/prompter/doc/take').then((res) => handleResponse(res, 'Taken — now on the glass.'));
  });

  clearBtn.addEventListener('click', () => {
    setMsg('Clearing source…', false);
    void post('/api/prompter/doc/clear').then((res) => handleResponse(res, 'Source cleared. Current script left on the glass.'));
  });

  function update(state: PrompterState): void {
    const doc = state.doc;
    const updateReady = doc.status === 'ready' && doc.staged !== null;
    pill!.hidden = !updateReady;
    takeBtn!.disabled = !doc.staged;
    clearBtn!.disabled = !doc.docId;
    statusEl!.textContent = describeStatus(state);
    if (doc.status === 'error' && doc.error) {
      setMsg(doc.error.message, true);
    }
  }

  onState(update);
  void loadLibrary();
}
