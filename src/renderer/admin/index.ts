/**
 * Admin SPA bundle entry.
 *
 * The Admin page is still, overwhelmingly, one large inline `<script>` in
 * `index.html`. This bundle is the migration target for sections that are
 * being lifted out of it — phase 5 of
 * `docs/2026-09-21-prompter-drive-scripts-design.md` moved the Prompter
 * section here first.
 *
 * How the two halves talk to each other
 * -------------------------------------
 * The inline script is a classic (non-module) script, so its top-level
 * `function` declarations — `api`, `content`, `escHtml`, `showSuccess`,
 * `showError` — are properties of `window`. The bundle reads them from there
 * rather than re-implementing them, so there is exactly one `api()` on the
 * page and this port stays trivially diffable against the inline original.
 *
 * In the other direction the bundle registers its section renderers on
 * `window.__pconairAdminSections`. The inline script keeps a thin
 * `renderPrompter()` shim that delegates to the registered implementation,
 * which means:
 *
 *  - `renderSection()`'s dispatch table still has a real function for every
 *    `case` (asserted by `tests/admin-renderer-boot.test.ts`, which boots the
 *    inline script alone under jsdom and never loads this bundle), and
 *  - if `/admin/index.js` fails to load, the section says so instead of
 *    throwing a ReferenceError inside a click handler.
 *
 * Ordering is safe: HtmlWebpackPlugin injects this bundle as a `defer`red
 * script, so it executes after the inline script has been parsed and its
 * declarations exist, and before the inline boot IIFE's first awaited fetch
 * resolves and calls `renderSection()`.
 */

import type { PrompterState } from '../../shared/types';
import { makePrompterState } from '../../shared/types';
import { renderPrompterControls, wirePrompterControls } from '../shared/prompter-controls';

// ── Bridge to the inline script ──────────────────────────────────────────────

type ApiFn = (
  method: string,
  path: string,
  body?: unknown,
  isFormData?: boolean
) => Promise<Record<string, unknown> | null>;

interface AdminInlineGlobals {
  api: ApiFn;
  content: () => HTMLElement;
  escHtml: (s: unknown) => string;
  showSuccess: (msg: string) => void;
  /**
   * Set by this bundle, called by the inline script's WebSocket handler on
   * every `state`/`state_patch` frame that carries a `prompter` payload. The
   * inline script owns the page's only socket; this is how bundle-side
   * sections get live state without opening a second one.
   */
  __pconairAdminPrompterState?: (state: PrompterState) => void;
  showError: (msg: string) => void;
  /** Section renderers this bundle registers for the inline dispatch shims. */
  __pconairAdminSections?: Record<string, () => void>;
}

const w = window as unknown as Window & AdminInlineGlobals;

const api: ApiFn = (method, path, body, isFormData) => w.api(method, path, body, isFormData);
const content = (): HTMLElement => w.content();
const escHtml = (s: unknown): string => w.escHtml(s);
const showSuccess = (msg: string): void => w.showSuccess(msg);
const showError = (msg: string): void => w.showError(msg);

/**
 * `document.getElementById` with the same failure mode the inline script had
 * (a throw), but a message that names the missing id. Every call site runs
 * immediately after `renderPrompter()` wrote the markup, so a miss is a bug in
 * this file, not a runtime condition.
 */
function must<T extends HTMLElement = HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`admin prompter: #${id} is missing from the rendered markup`);
  return node as T;
}

// ── Prompter ─────────────────────────────────────────────────────────────────
// Ported verbatim from the inline `<script>` in index.html (the block that
// began `// ── Prompter ──` and ran to the end of `renderPrompter`). Same
// element ids, same endpoints, same request bodies, same ordering — the only
// intentional differences are TypeScript types, the `must()` lookups above,
// and reading the shared helpers off `window`.
//
// The talent-facing display lives at /prompter on this server: open it on a
// tablet over the LAN, point OBS at it, or push it fullscreen onto a wired
// monitor with the display picker below. Everything here drives that page.
const PROMPTER_WPM = 140;

interface DisplayInfo {
  id: string | number;
  name?: string;
  isPrimary?: boolean;
}

interface PrompterWindowStatus {
  open: boolean;
  displayId?: string | null;
  available?: boolean;
}

interface PrompterExternalStatus {
  configured: boolean;
  enabled: boolean;
  connected: boolean;
}

interface PrompterStatusResponse {
  prompter?: PrompterState;
  window?: PrompterWindowStatus;
  external?: PrompterExternalStatus;
}

function prompterReadTime(text: string): string {
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const minutes = words / PROMPTER_WPM;
  const mm = Math.floor(minutes);
  const ss = Math.round((minutes - mm) * 60);
  return words + ' words · about ' + mm + ':' + String(ss).padStart(2, '0') + ' to read aloud';
}

// ── Script Source (design doc section 7 / shared/prompter-controls.ts) ───────
// Additive mount alongside the transport/slider controls ported above — see
// the scope note at the top of src/renderer/shared/prompter-controls.ts for
// why that module doesn't subsume them.
//
// Same `post`/`onState` contract `/remote/` and `/prompter-control/` use. Two
// differences forced by this page:
//
//  - `post` is a raw `fetch` rather than the inline `api()`, because the
//    shared module reads `Response.ok`/`Response.json()` itself and renders
//    failures into its own message line; routing it through `api()` would
//    also fire a red toast for errors the block already displays inline.
//    `credentials: 'include'` matches what `api()` sends, since Admin is
//    behind a session cookie.
//  - `onState` is fed from the inline script's existing WebSocket via
//    `window.__pconairAdminPrompterState` instead of a socket of this
//    bundle's own, plus a one-shot hydrate from the `/api/prompter/status`
//    response `renderPrompter()` already has in hand.

let scriptSourceUpdate: ((state: PrompterState) => void) | null = null;

async function rawPost(path: string, body?: object): Promise<Response> {
  return fetch(path, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
}

/**
 * Mounts the shared Script Source block into the card `renderPrompter()` just
 * rendered, and hydrates it from the status payload that render already
 * fetched. Called on every re-render, so the previous mount's callback is
 * replaced rather than accumulating.
 */
function mountScriptSource(prompter: PrompterState | undefined): void {
  const mount = document.getElementById('tp-doc-mount');
  if (!mount) return;
  scriptSourceUpdate = null;
  mount.innerHTML = renderPrompterControls(makePrompterState());
  wirePrompterControls(mount, {
    post: rawPost,
    onState: (cb) => {
      scriptSourceUpdate = cb;
      // Hydrate from the status payload `renderPrompter()` already fetched,
      // so the block is correct before the first WS frame arrives. Server
      // state predating phase 1 has no `doc` field and the block reads it
      // unconditionally, so skip rather than throw in that case.
      if (prompter && prompter.doc) cb(prompter);
    },
  });
}

w.__pconairAdminPrompterState = (state: PrompterState): void => {
  scriptSourceUpdate?.(state);
};

async function renderPrompter(): Promise<void> {
  const c = content();
  c.innerHTML = '<div class="section-title">Prompter</div><div class="card"><div class="card-title">Loading…</div></div>';
  let status: PrompterStatusResponse;
  let serverInfo: { prompterUrls?: string[] } | null;
  let displaysData: { displays?: DisplayInfo[] } | null;
  try {
    [status, serverInfo, displaysData] = (await Promise.all([
      api('GET', '/api/prompter/status'),
      api('GET', '/api/server-info').catch(() => ({ prompterUrls: [] })),
      api('GET', '/api/displays').catch(() => ({ displays: [] })),
    ])) as [PrompterStatusResponse, { prompterUrls?: string[] } | null, { displays?: DisplayInfo[] } | null];
  } catch {
    c.innerHTML = '<div class="section-title">Prompter</div><div class="card"><p class="field-label">Failed to load.</p></div>';
    return;
  }

  const p = (status.prompter || {}) as Partial<PrompterState>;
  const urls = (serverInfo && serverInfo.prompterUrls) || [];
  // Loopback is for this machine's own window and an IPv6 link-local address
  // is unusable from a tablet, so lead with a routable IPv4 address.
  const lanUrl =
    urls.find((u) => /^http:\/\/\d+\.\d+\.\d+\.\d+:/.test(u) && u.indexOf('127.0.0.1') === -1)
    || urls.find((u) => u.indexOf('127.0.0.1') === -1)
    || urls[0]
    || '/prompter/';
  const displays = (displaysData && displaysData.displays) || [];
  const windowState: PrompterWindowStatus = status.window || { open: false };
  const windowAvailable = windowState.available !== false;
  const ext: PrompterExternalStatus = status.external || { configured: false, enabled: false, connected: false };
  const extLabel = !ext.configured
    ? '<span style="color:var(--text-dim)">Not configured</span>'
    : ext.connected
      ? '<span style="color:#22c55e">● Reachable</span>'
      : '<span style="color:#ef4444">● Unreachable</span>';

  c.innerHTML = `
    <div class="section-title">Prompter</div>

    <div class="card">
      <div class="card-title">Talent display</div>
      <p style="font-size:12px;color:var(--text-dim);margin-bottom:12px;line-height:1.5;">
        Open this address on the reader's tablet or laptop — no PIN needed on the local network.
        Add <code>?mirror=x</code> for beam-splitter glass, <code>?font=90</code> or
        <code>?line=30</code> to tune one display without changing the others.
      </p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px">
        <input id="tp-url" type="text" class="input" readonly value="${escHtml(lanUrl)}" style="flex:1;min-width:260px" />
        <button id="tp-copy-url" class="btn">Copy</button>
        <a class="btn" href="/prompter/" target="_blank" rel="noopener">Preview</a>
      </div>
      <div class="field-label">Fullscreen output on this machine</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:6px">
        <select id="tp-display" class="input" style="max-width:280px" ${windowAvailable ? '' : 'disabled'}>
          <option value="">Default display (Admin → Monitors)</option>
          ${displays.map((d) => `<option value="${escHtml(String(d.id))}" ${String(windowState.displayId) === String(d.id) ? 'selected' : ''}>${escHtml(d.name || ('Display ' + d.id))}${d.isPrimary ? ' (primary)' : ''}</option>`).join('')}
        </select>
        <button id="tp-window-open" class="btn btn-primary" ${windowAvailable ? '' : 'disabled'}>Open output</button>
        <button id="tp-window-close" class="btn" ${windowAvailable ? '' : 'disabled'}>Close output</button>
        <span class="field-label" style="margin:0">${windowAvailable ? (windowState.open ? 'Output is open' : 'Output is closed') : 'Desktop app only'}</span>
      </div>
    </div>

    <div class="card" id="tp-doc-mount"></div>

    <div class="card">
      <div class="card-title">Script</div>
      <textarea id="tp-script" class="input" rows="10" style="width:100%;resize:vertical;font-family:monospace;font-size:13px" placeholder="Paste the script here…">${escHtml(p.script || '')}</textarea>
      <p id="tp-script-meta" class="field-label" style="margin:8px 0 0">${prompterReadTime(p.script || '')}</p>
      <p class="field-label" style="margin:4px 0 0">Blank lines split paragraphs. Lines in [brackets] are shown dimmed as directions, not copy.</p>
      <button id="tp-set-script" class="btn btn-primary" style="margin-top:8px">Load script</button>
    </div>

    <div class="card">
      <div class="card-title">Transport</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button id="tp-toggle" class="btn btn-primary">${p.scrolling ? '⏸ Pause' : '▶ Start'}</button>
        <button id="tp-rewind" class="btn">⏮ Top</button>
        <button id="tp-back" class="btn">↑ Back</button>
        <button id="tp-forward" class="btn">↓ Forward</button>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;align-items:center">
        <button id="tp-slower" class="btn">Speed −</button>
        <span id="tp-speed" class="field-label" style="margin:0;min-width:96px">${p.speed} px/sec</span>
        <button id="tp-faster" class="btn">Speed +</button>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;align-items:center">
        <button id="tp-font-out" class="btn">Font −</button>
        <span id="tp-font" class="field-label" style="margin:0;min-width:96px">${p.fontSize} px</span>
        <button id="tp-font-in" class="btn">Font +</button>
      </div>
    </div>

    <div class="card">
      <div class="card-title">Display settings</div>
      <div class="field">
        <div class="field-label">Line height</div>
        <select id="tp-line-height" class="input" style="max-width:200px">
          ${[1, 1.2, 1.4, 1.6, 2, 2.5].map((v) => `<option value="${v}" ${Number(p.lineHeight) === v ? 'selected' : ''}>${v.toFixed(1)}×</option>`).join('')}
        </select>
      </div>
      <label class="field" style="display:flex;align-items:center;gap:8px;cursor:pointer">
        <input id="tp-mirror-x" type="checkbox" style="width:auto" ${p.mirrorX ? 'checked' : ''} />
        <span class="field-label" style="margin:0">Mirror horizontally (beam-splitter glass)</span>
      </label>
      <label class="field" style="display:flex;align-items:center;gap:8px;cursor:pointer">
        <input id="tp-mirror-y" type="checkbox" style="width:auto" ${p.mirrorY ? 'checked' : ''} />
        <span class="field-label" style="margin:0">Mirror vertically (ceiling mount)</span>
      </label>
      <div class="field">
        <div class="field-label">Text alignment</div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          ${['left', 'center', 'right', 'justify'].map((a) =>
            `<button class="btn tp-align${(p.textAlign || 'left') === a ? ' btn-primary' : ''}" data-align="${a}">${a[0].toUpperCase()}${a.slice(1)}</button>`
          ).join('')}
        </div>
      </div>
      <div class="field">
        <div class="field-label">Side margin</div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <button id="tp-margin-narrower" class="btn">Margin −</button>
          <span id="tp-margin" class="field-label" style="margin:0;min-width:64px">${Number(p.sidePadding)}vw</span>
          <button id="tp-margin-wider" class="btn">Margin +</button>
          <span class="field-label" style="margin:0">gap at each side, as % of screen width</span>
        </div>
      </div>
      <div class="field">
        <div class="field-label">Reading marker</div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <button id="tp-marker-up" class="btn">↑ Up</button>
          <span id="tp-marker-pos" class="field-label" style="margin:0;min-width:64px">${Math.round(Number(p.markerPosition))}%</span>
          <button id="tp-marker-down" class="btn">↓ Down</button>
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;margin-left:8px">
            <input id="tp-marker-visible" type="checkbox" style="width:auto" ${p.markerVisible === false ? '' : 'checked'} />
            <span class="field-label" style="margin:0">Show marker</span>
          </label>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-title">Third-party prompter service (optional)</div>
      <p style="font-size:12px;color:var(--text-dim);margin-bottom:12px;line-height:1.5;">
        Leave this empty unless you also run a separate prompter box. When it is on, every command
        above is mirrored to that service as well; the built-in display keeps working either way.
      </p>
      <p style="margin-bottom:12px">${extLabel}</p>
      <div class="field">
        <div class="field-label">Service URL</div>
        <input id="tp-host" type="text" class="input" value="${escHtml(p.host || '')}" placeholder="http://192.168.1.245:8082" style="width:100%;max-width:360px" />
      </div>
      <label class="field" style="display:flex;align-items:center;gap:8px;cursor:pointer">
        <input id="tp-enabled" type="checkbox" style="width:auto" ${p.enabled ? 'checked' : ''} />
        <span class="field-label" style="margin:0">Forward commands to this service</span>
      </label>
      <button id="tp-save-cfg" class="btn btn-primary" style="margin-top:12px">Save</button>
    </div>
  `;

  function applyPrompter(body: Record<string, unknown> | null): void {
    if (!body || !body.prompter) return;
    const next = body.prompter as PrompterState;
    must('tp-speed').textContent = next.speed + ' px/sec';
    must('tp-font').textContent = next.fontSize + ' px';
    must('tp-toggle').textContent = next.scrolling ? '⏸ Pause' : '▶ Start';
    must('tp-marker-pos').textContent = Math.round(next.markerPosition) + '%';
    must<HTMLInputElement>('tp-marker-visible').checked = next.markerVisible !== false;
    must('tp-margin').textContent = next.sidePadding + 'vw';
    document.querySelectorAll<HTMLElement>('.tp-align').forEach((b) =>
      b.classList.toggle('btn-primary', b.dataset.align === (next.textAlign || 'left'))
    );
  }

  async function post(path: string, body?: unknown): Promise<void> {
    try {
      applyPrompter(await api('POST', path, body));
    } catch { /* showError handled in api() */ }
  }

  mountScriptSource(status.prompter);

  must('tp-copy-url').addEventListener('click', async () => {
    const field = must<HTMLInputElement>('tp-url');
    try {
      await navigator.clipboard.writeText(field.value);
      showSuccess('Prompter address copied');
    } catch {
      // Clipboard access is blocked over plain http on some browsers — fall
      // back to selecting the text so it can still be copied by hand.
      field.select();
    }
  });

  must('tp-window-open').addEventListener('click', async () => {
    const displayId = must<HTMLSelectElement>('tp-display').value;
    try {
      await api('POST', '/api/prompter/window', { open: true, displayId: displayId || null });
      showSuccess('Prompter output opened');
      void renderPrompter();
    } catch { /* showError handled in api() */ }
  });
  must('tp-window-close').addEventListener('click', async () => {
    try {
      await api('POST', '/api/prompter/window', { open: false });
      void renderPrompter();
    } catch { /* showError handled in api() */ }
  });

  const scriptField = must<HTMLTextAreaElement>('tp-script');
  scriptField.addEventListener('input', () => {
    must('tp-script-meta').textContent = prompterReadTime(scriptField.value);
  });
  must('tp-set-script').addEventListener('click', async () => {
    await post('/api/prompter/script', { text: scriptField.value });
    showSuccess('Script loaded — parked at the top');
  });

  must('tp-toggle').addEventListener('click', () => void post('/api/prompter/toggle'));
  must('tp-rewind').addEventListener('click', () => void post('/api/prompter/rewind'));
  must('tp-back').addEventListener('click', () => void post('/api/prompter/position', { delta: -200 }));
  must('tp-forward').addEventListener('click', () => void post('/api/prompter/position', { delta: 200 }));
  must('tp-faster').addEventListener('click', () => void post('/api/prompter/scroll', { direction: 'faster' }));
  must('tp-slower').addEventListener('click', () => void post('/api/prompter/scroll', { direction: 'slower' }));
  must('tp-font-in').addEventListener('click', () => void post('/api/prompter/font-size', { direction: 'in' }));
  must('tp-font-out').addEventListener('click', () => void post('/api/prompter/font-size', { direction: 'out' }));

  must('tp-line-height').addEventListener('change', (ev) =>
    void post('/api/prompter/line-height', { lineHeight: parseFloat((ev.target as HTMLSelectElement).value) })
  );
  must('tp-mirror-x').addEventListener('change', (ev) =>
    void post('/api/prompter/mirror', { x: (ev.target as HTMLInputElement).checked })
  );
  must('tp-mirror-y').addEventListener('change', (ev) =>
    void post('/api/prompter/mirror', { y: (ev.target as HTMLInputElement).checked })
  );

  // Up is towards the top of the screen, so it steps the percentage down.
  must('tp-marker-up').addEventListener('click', () =>
    void post('/api/prompter/marker', { delta: -2 })
  );
  must('tp-marker-down').addEventListener('click', () =>
    void post('/api/prompter/marker', { delta: 2 })
  );
  must('tp-marker-visible').addEventListener('change', (ev) =>
    void post('/api/prompter/marker', { visible: (ev.target as HTMLInputElement).checked })
  );
  document.querySelectorAll<HTMLElement>('.tp-align').forEach((btn) =>
    btn.addEventListener('click', () => void post('/api/prompter/text-align', { align: btn.dataset.align }))
  );
  must('tp-margin-narrower').addEventListener('click', () =>
    void post('/api/prompter/side-padding', { delta: -1 })
  );
  must('tp-margin-wider').addEventListener('click', () =>
    void post('/api/prompter/side-padding', { delta: 1 })
  );

  must('tp-save-cfg').addEventListener('click', async () => {
    await api('POST', '/api/prompter/config', {
      host: must<HTMLInputElement>('tp-host').value.trim(),
      enabled: must<HTMLInputElement>('tp-enabled').checked,
    });
    showSuccess('Prompter service settings saved');
    void renderPrompter();
  });
}

// ── Registration ─────────────────────────────────────────────────────────────

const sections: Record<string, () => void> = w.__pconairAdminSections ?? {};
sections.prompter = (): void => {
  void renderPrompter().catch((e: unknown) => {
    showError(e instanceof Error ? e.message : 'Prompter section failed to render');
  });
};
w.__pconairAdminSections = sections;
