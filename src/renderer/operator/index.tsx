import * as React from 'react';
import * as ReactDOMBase from 'react-dom';
import { createClientStore } from './state';
import type { AppState, WsServerMessage, Mode, ABInstance } from '../../shared/types';
import * as api from './api';
import { StatusHeader, LiveControlPanels } from './components/LiveControl';

const store = createClientStore();

// ── React roots (Slate-based status header + Live Control panels) ─
//
// `@types/react-dom`'s `createRoot` only exists on the `react-dom/client`
// subpath's types, but importing that subpath would make webpack resolve
// and bundle the real npm `react-dom` package for it, while our bare
// `import * as ReactDOMBase from 'react-dom'` above is externalized to the
// vendored UMD global (see forge.config.ts `externals`) — two different
// React-DOM instances in one page. So this stays a single import of bare
// 'react-dom' with a local type widening for `createRoot`, which IS present
// on the vendored UMD global at runtime (verified: `exports.createRoot =
// createRoot$1;` in react-dom.development.js) — see task report for the
// createRoot-vs-render investigation.
const ReactDOM = ReactDOMBase as typeof ReactDOMBase & {
  createRoot: (container: Element) => { render: (el: React.ReactElement) => void };
};

// Two independent roots, not one root + a Portal: the status header and the
// dashboard-tab panels live in non-adjacent parts of the static shell DOM
// (header vs. `.content`), and keeping them as two small, directly-mounted
// trees is more obvious to a reader unfamiliar with this codebase's React
// usage than reaching for `createPortal`. Both are re-rendered together by
// `renderReactRoots()` below, called from the store subscription and from
// `setWsStatus()` (WS connection status isn't part of `AppState`).
const statusHeaderRoot = ReactDOM.createRoot(document.getElementById('status-header-root')!);
const liveControlPanelsRoot = ReactDOM.createRoot(document.getElementById('live-control-panels-root')!);

let wsConnected = false;

async function handlePanicClick(): Promise<void> {
  try {
    await api.panicAction('toggle');
  } catch (e) {
    showError((e as Error).message);
  }
}

async function handleSwitchAB(instance: ABInstance): Promise<void> {
  try {
    await api.switchAB(instance);
  } catch (e) {
    showError((e as Error).message);
  }
}

async function handleSetMode(mode: Mode): Promise<void> {
  try {
    await api.setMode(mode);
  } catch (e) {
    showError((e as Error).message);
  }
}

function renderReactRoots(state: AppState): void {
  statusHeaderRoot.render(
    <StatusHeader state={state} wsConnected={wsConnected} onPanic={handlePanicClick} />
  );
  liveControlPanelsRoot.render(
    <LiveControlPanels state={state} onSwitchAB={handleSwitchAB} onSetMode={handleSetMode} />
  );
}

// ── Keyboard shortcut presets ─────────────────────────────────────

type KbdPreset = 'google' | 'powerpoint' | 'keynote';

interface PresetMap {
  next: string[];
  prev: string[];
}

const KBD_PRESETS: Record<KbdPreset, PresetMap> = {
  google: {
    next: ['ArrowRight', ' ', 'PageDown'],
    prev: ['ArrowLeft', 'PageUp'],
  },
  powerpoint: {
    next: ['ArrowRight', 'Enter', 'PageDown', 'n', 'N'],
    prev: ['ArrowLeft', 'Backspace', 'PageUp', 'p', 'P'],
  },
  keynote: {
    next: ['ArrowRight', ' ', 'Enter'],
    prev: ['ArrowLeft', 'Delete'],
  },
};

const KBD_PRESET_KEY = 'pconair-kbd-preset';

function getSavedPreset(): KbdPreset {
  const v = localStorage.getItem(KBD_PRESET_KEY);
  if (v === 'google' || v === 'powerpoint' || v === 'keynote') return v;
  return 'google';
}

let activeKbdPreset: KbdPreset = getSavedPreset();

function setKbdPreset(preset: KbdPreset): void {
  activeKbdPreset = preset;
  localStorage.setItem(KBD_PRESET_KEY, preset);
  renderKbdPresetButtons();
}

function renderKbdPresetButtons(): void {
  document.querySelectorAll<HTMLButtonElement>('[data-kbd-preset]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.kbdPreset === activeKbdPreset);
  });
}

let notesPollingInterval: ReturnType<typeof setInterval> | null = null;
/** Cached cue list for the Lower Thirds prefill selects (name/title lookup only). */
let ltCuesCache: api.L3CueListItem[] = [];
/** Cached logo list for the Lower Thirds logo-picker selects. */
let ltLogosCache: api.L3LogoAsset[] = [];

async function refreshMediaSelect(): Promise<void> {
  const { items } = await api.mediaLibraryList();
  const sel = document.getElementById('ml-item-select') as HTMLSelectElement;
  const prev = sel.value;
  sel.replaceChildren();
  const opt0 = document.createElement('option');
  opt0.value = '';
  opt0.textContent = '— Select an item —';
  sel.appendChild(opt0);
  for (const it of items) {
    const o = document.createElement('option');
    o.value = it.id;
    o.textContent = it.displayName;
    sel.appendChild(o);
  }
  if (prev && items.some((x) => x.id === prev)) sel.value = prev;
}

const DISPLAY_SELECT_IDS = ['lt3-output-display-select'] as const;

async function refreshDisplaySelect(): Promise<void> {
  const { displays } = await api.listDisplays();
  for (const id of DISPLAY_SELECT_IDS) {
    const sel = document.getElementById(id) as HTMLSelectElement | null;
    if (!sel) continue;
    const prev = sel.value;
    sel.replaceChildren();
    const opt0 = document.createElement('option');
    opt0.value = '';
    opt0.textContent = 'Primary display (default)';
    sel.appendChild(opt0);
    for (const d of displays) {
      const o = document.createElement('option');
      // Value is the display *id* — window-manager matches on id, never on name.
      o.value = d.id;
      o.textContent = d.isPrimary ? `${d.name} (primary)` : d.name;
      sel.appendChild(o);
    }
    if (prev && displays.some((x) => x.id === prev)) sel.value = prev;
  }
}

async function refreshGoogleAuth(): Promise<void> {
  const statusEl = document.getElementById('google-auth-status');
  const signinBtn = document.getElementById('google-signin-btn') as HTMLButtonElement | null;
  if (!statusEl) return;
  try {
    const auth = await api.getGoogleAuthState();
    if (auth.loggedIn) {
      statusEl.textContent = auth.email ? `Signed in as ${auth.email}` : 'Signed in to Google ✓';
      if (signinBtn) signinBtn.textContent = 'Sign in again';
    } else {
      statusEl.textContent = 'Not signed in — private slides will not load';
      if (signinBtn) signinBtn.textContent = 'Sign in to Google';
    }
  } catch {
    statusEl.textContent = 'Could not check Google auth status';
  }
}

const LT3_SIDES = ['left', 'right'] as const;

function fillCueSelect(sel: HTMLSelectElement, cues: api.L3CueListItem[]): void {
  const prev = sel.value;
  sel.replaceChildren();
  const opt0 = document.createElement('option');
  opt0.value = '';
  opt0.textContent = '— Manual entry below —';
  sel.appendChild(opt0);
  for (const c of cues) {
    const o = document.createElement('option');
    o.value = c.id;
    o.textContent = `${c.name} — ${c.title}`;
    sel.appendChild(o);
  }
  if (prev && cues.some((x) => x.id === prev)) sel.value = prev;
}

async function refreshL3CuesCache(): Promise<void> {
  const { cues } = await api.l3ListCues();
  ltCuesCache = cues;
  for (const side of LT3_SIDES) {
    const sel = document.getElementById(`lt3-${side}-cue-select`) as HTMLSelectElement | null;
    if (sel) fillCueSelect(sel, cues);
  }
}

function fillLogoSelect(sel: HTMLSelectElement, logos: api.L3LogoAsset[]): void {
  const prev = sel.value;
  sel.replaceChildren();
  const opt0 = document.createElement('option');
  opt0.value = '';
  opt0.textContent = '— No logo uploaded —';
  sel.appendChild(opt0);
  for (const l of logos) {
    const o = document.createElement('option');
    o.value = l.id;
    o.textContent = l.filename;
    sel.appendChild(o);
  }
  if (prev && logos.some((x) => x.id === prev)) sel.value = prev;
}

async function refreshL3LogosCache(): Promise<void> {
  const { logos } = await api.l3ListLogos();
  ltLogosCache = logos;
  for (const side of LT3_SIDES) {
    const sel = document.getElementById(`lt3-${side}-logo-select`) as HTMLSelectElement | null;
    if (sel) fillLogoSelect(sel, logos);
  }
}

// ── Lower Thirds tab (left/right independent live-fire panels) ────

const LT3_THEME_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'default', label: 'Default' },
  { value: 'dark', label: 'Dark' },
  { value: 'dark_alt', label: 'Dark Alt' },
  { value: 'bright', label: 'Bright' },
  { value: 'bright_insider', label: 'Bright — Insider' },
  { value: 'bright_warm', label: 'Bright — Warm' },
  { value: 'bright_info', label: 'Bright — Info' },
  { value: 'palette_olive', label: 'Palette — Olive' },
  { value: 'palette_teal', label: 'Palette — Teal' },
  { value: 'palette_terracotta', label: 'Palette — Terracotta' },
  { value: 'palette_plum', label: 'Palette — Plum' },
  { value: 'palette_copper', label: 'Palette — Copper' },
  { value: 'palette_sage', label: 'Palette — Sage' },
];

const LT3_ANIMATION_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'fade', label: 'Fade / Slide' },
  { value: 'wipe', label: 'Wipe' },
  { value: 'grow', label: 'Grow' },
  { value: 'slide-up', label: 'Slide Up' },
  { value: 'slide-down', label: 'Slide Down' },
  { value: 'zoom', label: 'Zoom' },
  { value: 'flip', label: 'Flip' },
];

function buildLowerThirdPanelHtml(side: api.LowerThirdSide): string {
  const label = side === 'left' ? 'Left' : 'Right';
  const themeOpts = LT3_THEME_OPTIONS.map((o) => `<option value="${o.value}">${o.label}</option>`).join('');
  const animOpts = LT3_ANIMATION_OPTIONS.map((o) => `<option value="${o.value}">${o.label}</option>`).join('');
  return `
    <div class="panel-title">${label} <span id="lt3-${side}-onair" class="field-hint" hidden style="color:#c0392b;font-weight:700;">ON AIR</span></div>
    <div id="lt3-${side}-active-line" class="field-hint" style="margin-bottom:12px;">Off air</div>
    <div class="form-group">
      <label for="lt3-${side}-cue-select">Load from library (optional)</label>
      <div class="ml-l3-select-wrap">
        <select id="lt3-${side}-cue-select" class="select-input">
          <option value="">— Manual entry below —</option>
        </select>
        <button type="button" class="btn btn-secondary" id="lt3-${side}-cues-refresh-btn" title="Reload cue list">Refresh</button>
      </div>
    </div>
    <div class="form-group">
      <label for="lt3-${side}-name-input">Name</label>
      <input type="text" id="lt3-${side}-name-input" class="input-field" placeholder="Speaker name" autocomplete="off" />
    </div>
    <div class="form-group">
      <label for="lt3-${side}-title-input">Title</label>
      <input type="text" id="lt3-${side}-title-input" class="input-field" placeholder="Role or second line" autocomplete="off" />
    </div>
    <div class="form-group">
      <label for="lt3-${side}-subtitle-input">Subtitle (optional)</label>
      <input type="text" id="lt3-${side}-subtitle-input" class="input-field" placeholder="Leave blank for none" autocomplete="off" />
    </div>
    <div class="form-group">
      <label for="lt3-${side}-theme-select">Theme</label>
      <select id="lt3-${side}-theme-select" class="select-input">${themeOpts}</select>
    </div>
    <label class="form-group" style="display:flex;flex-direction:row;align-items:center;gap:8px;cursor:pointer;user-select:none;">
      <input type="checkbox" id="lt3-${side}-logo-enabled-checkbox" />
      <span>Show logo</span>
    </label>
    <div class="form-group">
      <label for="lt3-${side}-logo-select">Logo image</label>
      <select id="lt3-${side}-logo-select" class="select-input">
        <option value="">— No logo uploaded —</option>
      </select>
    </div>
    <div class="form-group">
      <label for="lt3-${side}-fade-enabled-checkbox">
        <input type="checkbox" id="lt3-${side}-fade-enabled-checkbox" checked />
        Fade in/out
      </label>
    </div>
    <div class="form-group">
      <label for="lt3-${side}-fade-ms-slider">Fade duration (ms)</label>
      <input type="range" id="lt3-${side}-fade-ms-slider" min="0" max="5000" step="50" value="550" style="width:100%;margin-bottom:8px;" />
      <input type="number" id="lt3-${side}-fade-ms-input" class="input-field" min="0" step="50" value="550"
        title="Slider tops out at 5000ms — type a larger value here for a longer custom fade" />
    </div>
    <div class="form-group">
      <label for="lt3-${side}-animation-style-select">Animation style</label>
      <select id="lt3-${side}-animation-style-select" class="select-input">${animOpts}</select>
    </div>
    <div class="btn-row" style="margin-top:16px;flex-wrap:wrap;">
      <button type="button" class="btn btn-primary" id="lt3-${side}-apply-btn">Apply</button>
      <button type="button" class="btn btn-secondary" id="lt3-${side}-hide-btn">Hide</button>
    </div>
    <div class="btn-row" style="margin-top:8px;flex-wrap:wrap;">
      <button type="button" class="btn btn-secondary" id="lt3-${side}-save-btn">Save to library</button>
      <button type="button" class="btn btn-secondary" id="lt3-${side}-export-btn">Export PNG</button>
    </div>
    <p id="lt3-${side}-msg" class="field-hint" style="margin-top:8px;"></p>
  `;
}

interface Lt3Fields {
  cueId?: string;
  name: string;
  title: string;
  subtitle: string;
  theme: string;
  logoEnabled: boolean;
  logoAssetId: string | null;
  fadeEnabled: boolean;
  fadeMs: number;
  animationStyle: string;
}

function bindLowerThirdSide(side: api.LowerThirdSide): void {
  const g = (suffix: string) => document.getElementById(`lt3-${side}-${suffix}`);

  g('cues-refresh-btn')!.addEventListener('click', async () => {
    try {
      await refreshL3CuesCache();
    } catch (e) {
      showError((e as Error).message);
    }
  });

  (g('cue-select') as HTMLSelectElement).addEventListener('change', () => {
    const sel = g('cue-select') as HTMLSelectElement;
    if (!sel.value) return;
    const cue = ltCuesCache.find((c) => c.id === sel.value);
    if (!cue) return;
    (g('name-input') as HTMLInputElement).value = cue.name;
    (g('title-input') as HTMLInputElement).value = cue.title;
    (g('subtitle-input') as HTMLInputElement).value = cue.subtitle ?? '';
  });

  g('fade-ms-slider')!.addEventListener('input', () => {
    const slider = g('fade-ms-slider') as HTMLInputElement;
    (g('fade-ms-input') as HTMLInputElement).value = slider.value;
  });
  g('fade-ms-input')!.addEventListener('input', () => {
    const input = g('fade-ms-input') as HTMLInputElement;
    const slider = g('fade-ms-slider') as HTMLInputElement;
    const v = Number(input.value);
    // Slider visually clamps to its own 0-5000 range; the number field is the
    // source of truth and keeps whatever custom value the user typed.
    if (Number.isFinite(v)) slider.value = String(Math.min(5000, Math.max(0, v)));
  });

  function readFields(): Lt3Fields {
    return {
      cueId: (g('cue-select') as HTMLSelectElement).value || undefined,
      name: (g('name-input') as HTMLInputElement).value.trim(),
      title: (g('title-input') as HTMLInputElement).value.trim(),
      subtitle: (g('subtitle-input') as HTMLInputElement).value.trim(),
      theme: (g('theme-select') as HTMLSelectElement).value,
      logoEnabled: (g('logo-enabled-checkbox') as HTMLInputElement).checked,
      logoAssetId: (g('logo-select') as HTMLSelectElement).value || null,
      fadeEnabled: (g('fade-enabled-checkbox') as HTMLInputElement).checked,
      fadeMs: Number((g('fade-ms-input') as HTMLInputElement).value),
      animationStyle: (g('animation-style-select') as HTMLSelectElement).value,
    };
  }

  g('apply-btn')!.addEventListener('click', async () => {
    const f = readFields();
    if (!f.name) {
      showError('Enter a name');
      return;
    }
    try {
      await api.lowerThirdApply({
        side,
        ...(f.cueId ? { cueId: f.cueId } : {}),
        name: f.name,
        title: f.title,
        // Always send subtitle explicitly (even '') so the server can tell
        // "leave blank on purpose" apart from "field wasn't included at all".
        subtitle: f.subtitle,
        theme: f.theme,
        fadeEnabled: f.fadeEnabled,
        fadeMs: Number.isFinite(f.fadeMs) ? f.fadeMs : undefined,
        animationStyle: f.animationStyle,
        logoEnabled: f.logoEnabled,
        logoAssetId: f.logoEnabled ? (f.logoAssetId ?? undefined) : null,
      });
    } catch (e) {
      showError((e as Error).message);
    }
  });

  g('hide-btn')!.addEventListener('click', async () => {
    try {
      await api.lowerThirdHide(side);
    } catch (e) {
      showError((e as Error).message);
    }
  });

  g('save-btn')!.addEventListener('click', async () => {
    const f = readFields();
    if (!f.name) {
      showError('Enter a name');
      return;
    }
    const msgEl = g('msg')!;
    try {
      if (f.cueId) {
        await api.l3UpdateCue(f.cueId, { name: f.name, title: f.title, subtitle: f.subtitle, themeId: f.theme });
        msgEl.textContent = 'Cue updated in library.';
      } else {
        await api.l3CreateCue({ name: f.name, title: f.title, subtitle: f.subtitle, themeId: f.theme });
        msgEl.textContent = 'Saved as a new cue.';
      }
      await refreshL3CuesCache();
    } catch (e) {
      msgEl.textContent = (e as Error).message;
    }
  });

  g('export-btn')!.addEventListener('click', async () => {
    const f = readFields();
    if (!f.name) {
      showError('Enter a name');
      return;
    }
    const msgEl = g('msg')!;
    try {
      await api.l3ExportPng({
        name: f.name,
        title: f.title,
        subtitle: f.subtitle,
        theme: f.theme,
        logoAssetId: f.logoEnabled ? f.logoAssetId : null,
      });
      msgEl.textContent = 'PNG exported.';
    } catch (e) {
      msgEl.textContent = (e as Error).message;
    }
  });
}

function initLowerThirdsTab(): void {
  for (const side of LT3_SIDES) {
    const container = document.getElementById(`lt3-panel-${side}`);
    if (!container) continue;
    container.innerHTML = buildLowerThirdPanelHtml(side);
    bindLowerThirdSide(side);
  }
}

// ── Manage Lower Thirds tab (CSV import + logo library) ───────────

function formatLogoRow(logo: api.L3LogoAsset): string {
  return `<div class="item-row" data-id="${logo.id}">
    <img class="item-thumb" src="/api/l3/logos/${encodeURIComponent(logo.id)}/file" alt="" />
    <span class="item-name">${logo.filename}</span>
    <button type="button" class="btn btn-secondary" data-l3-logo-delete="${logo.id}">Delete</button>
  </div>`;
}

async function refreshL3LogoList(): Promise<void> {
  const { logos } = await api.l3ListLogos();
  ltLogosCache = logos;
  const list = document.getElementById('l3mgmt-logo-list');
  if (!list) return;
  list.innerHTML = logos.length
    ? logos.map(formatLogoRow).join('')
    : '<span class="field-hint">No logos uploaded yet.</span>';
  list.querySelectorAll<HTMLButtonElement>('[data-l3-logo-delete]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.l3LogoDelete;
      if (!id) return;
      try {
        await api.l3DeleteLogo(id);
        await refreshL3LogoList();
        await refreshL3LogosCache();
      } catch (e) {
        showError((e as Error).message);
      }
    });
  });
}

function initManageLowerThirdsTab(): void {
  document.getElementById('l3mgmt-csv-import-btn')!.addEventListener('click', async () => {
    const input = document.getElementById('l3mgmt-csv-input') as HTMLInputElement;
    const msg = document.getElementById('l3mgmt-csv-msg')!;
    const file = input.files?.[0];
    if (!file) {
      msg.textContent = 'Choose a CSV file first.';
      return;
    }
    try {
      const r = await api.l3ImportCsv(file);
      msg.textContent = `Imported ${r.imported}, skipped ${r.skipped}.${r.warnings.length ? ' See console for details.' : ''}`;
      if (r.warnings.length) console.warn('CSV import warnings:', r.warnings);
      input.value = '';
      await refreshL3CuesCache();
    } catch (e) {
      msg.textContent = (e as Error).message;
    }
  });

  document.getElementById('l3mgmt-logo-upload-btn')!.addEventListener('click', async () => {
    const input = document.getElementById('l3mgmt-logo-input') as HTMLInputElement;
    const msg = document.getElementById('l3mgmt-logo-msg')!;
    const file = input.files?.[0];
    if (!file) {
      msg.textContent = 'Choose an image file first.';
      return;
    }
    try {
      await api.l3UploadLogo(file);
      msg.textContent = 'Logo uploaded.';
      input.value = '';
      await refreshL3LogoList();
      await refreshL3LogosCache();
    } catch (e) {
      msg.textContent = (e as Error).message;
    }
  });

  void refreshL3LogoList().catch(() => { /* no session yet */ });
}

async function refreshActiveProfile(): Promise<void> {
  try {
    const p = await api.fetchActiveProfile();
    const el = document.getElementById('active-profile');
    if (el) el.textContent = `Profile: ${p.name}`;
    const nameLabel = document.getElementById('machine-name-label');
    if (nameLabel) nameLabel.textContent = p.name;
  } catch {
    const el = document.getElementById('active-profile');
    if (el) el.textContent = '';
  }
}

// ── Speaker Notes polling ─────────────────────────────────────────

function startNotesPolling(): void {
  if (notesPollingInterval) return;
  void pollNotes();
  notesPollingInterval = setInterval(() => void pollNotes(), 2000);
}

function stopNotesPolling(): void {
  if (notesPollingInterval) {
    clearInterval(notesPollingInterval);
    notesPollingInterval = null;
  }
}

async function pollNotes(): Promise<void> {
  const content = document.getElementById('notes-content');
  const indicator = document.getElementById('notes-slide-indicator');
  if (!content) return;
  const state = store.getState();
  if (state.currentMode !== 'slides') {
    content.textContent = 'Notes are only available in Slides mode.';
    if (indicator) indicator.textContent = '';
    return;
  }
  try {
    const data = await api.fetchSlidesNotes();
    content.textContent = data.notes ?? '(no notes for this slide)';
    if (indicator && data.slideIndex !== null) {
      indicator.textContent = `Slide ${data.slideIndex + 1}`;
    }
  } catch {
    content.textContent = 'Could not load notes.';
  }
}

async function refreshSlidePresets(): Promise<void> {
  const container = document.getElementById('slide-presets-list');
  if (!container) return;
  try {
    const { presets } = await api.fetchPresets();
    if (!presets.length) {
      container.innerHTML = '<span>No presets saved. Add presets in Admin → URL Presets.</span>';
      return;
    }
    container.innerHTML = '';
    for (const p of presets) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-secondary';
      btn.style.width = '100%';
      btn.style.marginBottom = '6px';
      btn.style.justifyContent = 'flex-start';
      btn.textContent = p.name;
      btn.title = p.url;
      btn.addEventListener('click', async () => {
        try {
          await api.loadDeck(p.url);
        } catch (e) {
          showError((e as Error).message);
        }
      });
      container.appendChild(btn);
    }
  } catch {
    container.innerHTML = '<span>Could not load presets.</span>';
  }
}

async function refreshUrlPresets(): Promise<void> {
  const container = document.getElementById('url-presets-list');
  if (!container) return;
  try {
    const { presets } = await api.fetchPresets();
    if (!presets.length) {
      container.innerHTML = '<span>No presets saved. Add them in Admin → URL Presets.</span>';
      return;
    }
    container.innerHTML = '';
    for (const p of presets) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-secondary';
      btn.style.width = '100%';
      btn.style.marginBottom = '6px';
      btn.style.justifyContent = 'flex-start';
      btn.textContent = p.name;
      btn.title = p.url;
      btn.addEventListener('click', async () => {
        try {
          await api.loadUrl(p.url);
        } catch (e) {
          showError((e as Error).message);
        }
      });
      container.appendChild(btn);
    }
  } catch {
    container.innerHTML = '<span>Could not load presets.</span>';
  }
}

// ── WebSocket connection ──────────────────────────────────────────

function connectWs(delay = 1000): void {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(`${protocol}//${location.host}/ws`);

  ws.addEventListener('open', () => setWsStatus(true));

  ws.addEventListener('close', () => {
    setWsStatus(false);
    setTimeout(() => connectWs(Math.min(delay * 2, 30000)), delay);
  });

  ws.addEventListener('message', (event: MessageEvent<string>) => {
    const msg = JSON.parse(event.data) as WsServerMessage;
    if (msg.type === 'state')       store.applyFullState(msg.payload);
    else if (msg.type === 'state_patch') store.applyPatch(msg.payload);
  });
}

// ── UI updates ────────────────────────────────────────────────────

function setWsStatus(connected: boolean): void {
  wsConnected = connected;
  renderReactRoots(store.getState());
}

function renderState(state: AppState): void {
  // Status header (mode Tag, show-lock badge, companion dot, PANIC button
  // text) + Live Control tab panels (A/B active state) are now rendered by
  // React — see renderReactRoots(). The panic banner overlay itself
  // (#panic-banner) stays vanilla-DOM; it's out of this task's scope.
  renderReactRoots(state);

  const panicBanner = document.getElementById('panic-banner');
  if (panicBanner) {
    panicBanner.classList.toggle('visible', state.reliability.panicActive);
  }

  const slides = state.slides;
  const hasSlides = state.currentMode === 'slides' && slides !== null;
  const navEnabled = hasSlides && slides !== null && !slides.isLoading;

  document.getElementById('slide-counter')!.textContent =
    hasSlides && slides ? `${slides.slideIndex + 1} / ${slides.slideCount}` : '— / —';
  document.getElementById('deck-title')!.textContent =
    hasSlides && slides
      ? (slides.deckTitle !== slides.deckId ? slides.deckTitle : 'Loading…')
      : 'No deck loaded';

  (document.getElementById('prev-btn') as HTMLButtonElement).disabled =
    !navEnabled || slides!.slideIndex === 0;
  (document.getElementById('next-btn') as HTMLButtonElement).disabled =
    !navEnabled || slides!.slideIndex >= slides!.slideCount - 1;
  (document.getElementById('goto-btn') as HTMLButtonElement).disabled = !navEnabled;
  (document.getElementById('reload-btn') as HTMLButtonElement).disabled = !hasSlides;

  const activeKey = state.abState.activeInstance === 'A' ? 'instanceA' : 'instanceB';
  const activeUrlInst = state.abState[activeKey];
  const urlReloadOk =
    state.currentMode === 'url' && Boolean(activeUrlInst.url) && !activeUrlInst.isLoading;
  (document.getElementById('url-reload-btn') as HTMLButtonElement).disabled = !urlReloadOk;
  const urlStatusEl = document.getElementById('url-status')!;
  if (state.currentMode === 'url' && state.currentUrl) {
    const tgt = activeUrlInst.displayTarget ? ` → ${activeUrlInst.displayTarget}` : '';
    const load = activeUrlInst.isLoading ? ' (loading)' : activeUrlInst.isReady ? '' : ' (not ready)';
    urlStatusEl.textContent = `Active (${state.abState.activeInstance}): ${state.currentUrl}${tgt}${load}`;
  } else if (state.currentMode === 'url') {
    urlStatusEl.textContent = 'URL mode — no URL on active instance yet';
  } else {
    urlStatusEl.textContent = '';
  }

  for (const side of LT3_SIDES) {
    const line = document.getElementById(`lt3-${side}-active-line`);
    if (!line) continue;
    const lt = state.graphics?.lowerThirds?.[side];
    if (lt?.visible) {
      const parts = [lt.name, lt.title].filter((x) => Boolean(x));
      line.textContent = parts.length ? `On air: ${parts.join(' — ')}` : 'On air: —';
    } else {
      line.textContent = 'Off air';
    }
    const badge = document.getElementById(`lt3-${side}-onair`);
    if (badge) badge.hidden = !lt?.visible;
  }

  const mlLine = document.getElementById('ml-active-line')!;
  const ml = state.mediaLibrary;
  if (state.currentMode === 'media-library' && ml?.activeItemName) {
    mlLine.textContent = `On air: ${ml.activeItemName}`;
  } else if (state.currentMode === 'media-library') {
    mlLine.textContent = 'On air: (no item)';
  } else {
    mlLine.textContent = 'On air: —';
  }

  document.getElementById('state-dump')!.textContent = JSON.stringify(state, null, 2);

  // ── Watchdog banners (spec 09 §6.2, §6.3, §6.5) ─────────────────
  const wd = state.watchdog;

  // §6.2/§6.3 are suppressed in this UI: none of the program-output windows
  // (slides/url/l3/media-library) have a preload script wired up to answer the
  // watchdog's ping, so `programUnresponsive` is a guaranteed false positive
  // the moment any content mode is active — not a real signal. Memory pressure
  // is also too noisy right after boot (tiny main-process heap) to show live
  // during a show. Showing either to an operator mid-broadcast does more harm
  // than good. Leave the underlying state/computation intact (still visible in
  // the Status tab's state dump) for debugging; just don't surface it as an
  // alarming banner until the ping/pong plumbing is actually implemented.
  const SUPPRESS_UNRELIABLE_WATCHDOG_BANNERS = true;

  // §6.2 Unresponsive banner
  const unrespBanner = document.getElementById('wd-unresponsive-banner');
  const unrespText = document.getElementById('wd-unresponsive-text');
  if (unrespBanner && unrespText) {
    const show = !SUPPRESS_UNRELIABLE_WATCHDOG_BANNERS && (wd?.programUnresponsive ?? false);
    unrespBanner.classList.toggle('visible', show);
    if (show) {
      const secs = wd?.programUnresponsiveSecs ?? 0;
      if (secs >= 15) {
        unrespText.textContent = '⚠ Program output not responding. Force reload strongly recommended.';
      } else {
        unrespText.textContent = '⚠ Program Output Unresponsive';
      }
    }
  }

  // §6.3 Memory pressure banner
  const memBanner = document.getElementById('wd-memory-banner');
  const memText = document.getElementById('wd-memory-text');
  if (memBanner && memText) {
    const show = !SUPPRESS_UNRELIABLE_WATCHDOG_BANNERS && (wd?.memoryPressure ?? false);
    memBanner.classList.toggle('visible', show);
    if (show) {
      memText.textContent =
        `⚠ Memory Usage High — ${wd.memoryPressurePct}% (${wd.memoryHeapUsedGb} GB / ${wd.memoryHeapTotalGb} GB)`;
    }
  }

  // §6.5 Renderer-restart banner (auto-dismiss after 8 s)
  const restartBanner = document.getElementById('wd-restart-banner');
  if (restartBanner) {
    const crashed = wd?.lastRendererCrashAt ?? null;
    if (crashed) {
      const age = Date.now() - new Date(crashed).getTime();
      // Show for up to 8 seconds after crash
      if (age < 8_000) {
        restartBanner.classList.add('visible');
        setTimeout(() => restartBanner.classList.remove('visible'), 8_000 - age);
      }
    }
  }
}

// ── Error toast ───────────────────────────────────────────────────

function showError(msg: string): void {
  const toast = document.getElementById('error-toast')!;
  toast.textContent = msg;
  toast.style.display = 'block';
  setTimeout(() => { toast.style.display = 'none'; }, 4000);
}

// ── Event bindings ────────────────────────────────────────────────

function bindEvents(): void {
  const on = (id: string, fn: () => Promise<unknown>) => {
    document.getElementById(id)!.addEventListener('click', async () => {
      try { await fn(); } catch (e) { showError((e as Error).message); }
    });
  };

  document.getElementById('google-signin-btn')?.addEventListener('click', async () => {
    try {
      await api.openGoogleAuth();
    } catch (e) {
      showError((e as Error).message);
    }
  });

  document.getElementById('google-auth-refresh-btn')?.addEventListener('click', () => {
    void refreshGoogleAuth().catch(() => {});
  });

  on('load-btn', () => api.loadDeck(
    (document.getElementById('deck-url-input') as HTMLInputElement).value.trim()
  ));
  on('next-btn',   () => api.slideNext());
  on('prev-btn',   () => api.slidePrev());
  on('goto-btn', async () => {
    const n = parseInt((document.getElementById('goto-input') as HTMLInputElement).value, 10);
    if (!isNaN(n) && n >= 1) await api.slideGoto(n - 1);
  });
  on('reload-btn', () => api.slideReload());

  on('url-load-btn', async () => {
    const url = (document.getElementById('url-input') as HTMLInputElement).value.trim();
    const displayRaw = (document.getElementById('url-display-input') as HTMLInputElement).value.trim();
    if (!url) {
      showError('Enter a URL');
      return;
    }
    await api.loadUrl(url, displayRaw || undefined);
  });
  on('url-reload-btn', () => api.urlReload());

  on('lt3-open-output-btn', async () => {
    const sel = document.getElementById('lt3-output-display-select') as HTMLSelectElement;
    const displayId = sel.value;
    const displayLabel = displayId ? sel.options[sel.selectedIndex].textContent : 'primary display';
    const url = `${location.origin}/graphics/lower-third-live/index.html`;
    const statusEl = document.getElementById('lt3-output-status');
    await api.loadUrl(url, displayId || undefined);
    if (statusEl) statusEl.textContent = `Output opened: ${url} → ${displayLabel}`;
  });

  document.getElementById('lt3-displays-refresh-btn')!.addEventListener('click', () => {
    void refreshDisplaySelect().catch((e: Error) => showError(e.message));
  });

  document.getElementById('ml-refresh-btn')!.addEventListener('click', async () => {
    try {
      await refreshMediaSelect();
    } catch (e) {
      showError((e as Error).message);
    }
  });

  on('ml-take-btn', async () => {
    const sel = document.getElementById('ml-item-select') as HTMLSelectElement;
    if (!sel.value) {
      showError('Select a media item');
      return;
    }
    await api.mediaLibraryTake(sel.value);
  });
  on('ml-clear-btn', () => api.mediaLibraryClear());

  // §6.2 Force-reload the on-air program output window
  document.getElementById('wd-force-reload-btn')?.addEventListener('click', async () => {
    try {
      const state = store.getState();
      // Reload the active (on-air) instance
      const activeInst = state.abState.activeInstance;
      await api.reloadInstance(activeInst === 'A' ? 'B' : 'A'); // reload off-air as fallback
      // Best-effort: also try a hard URL reload on the active instance via urlReload
      await api.urlReload();
    } catch (e) {
      showError((e as Error).message);
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    const preset = KBD_PRESETS[activeKbdPreset];
    if (preset.next.includes(e.key)) {
      // Space/Enter can scroll the page — prevent default only for slide nav
      if (e.key === ' ' || e.key === 'Enter') e.preventDefault();
      const btn = document.getElementById('next-btn') as HTMLButtonElement | null;
      if (btn && !btn.disabled) void api.slideNext().catch((err) => showError((err as Error).message));
    } else if (preset.prev.includes(e.key)) {
      if (e.key === 'Backspace') e.preventDefault();
      const btn = document.getElementById('prev-btn') as HTMLButtonElement | null;
      if (btn && !btn.disabled) void api.slidePrev().catch((err) => showError((err as Error).message));
    } else if (e.key === 'p' || e.key === 'P') {
      // Only trigger panic if 'P'/'p' is NOT already claimed by the active prev set
      if (!preset.prev.includes(e.key)) {
        void api.panicAction('toggle').catch((err) => showError((err as Error).message));
      }
    }
  });

  // Keyboard preset toggle buttons
  document.querySelectorAll<HTMLButtonElement>('[data-kbd-preset]').forEach((btn) => {
    btn.addEventListener('click', () => {
      setKbdPreset(btn.dataset.kbdPreset as KbdPreset);
    });
  });


  // A/B instance buttons and [data-mode] buttons are now Slate `Button`s in
  // the Live Control React tree (see handleSwitchAB/handleSetMode above) —
  // no vanilla click listeners needed for them here.

  // Tab switching — same pattern as GSC renderer.js
  document.querySelectorAll<HTMLElement>('.nav-item').forEach((item) => {
    item.addEventListener('click', (ev) => {
      ev.preventDefault();
      document.querySelectorAll('.nav-item').forEach((n) => n.classList.remove('active'));
      document.querySelectorAll<HTMLElement>('section[data-tab]').forEach((s) => {
        s.hidden = true;
      });
      item.classList.add('active');
      const target = item.dataset.target;
      if (target) {
        const section = document.querySelector<HTMLElement>(`section[data-tab="${target}"]`);
        if (section) section.hidden = false;
      }
      if (target === 'notes') {
        startNotesPolling();
      } else {
        stopNotesPolling();
      }
      // Displays change when monitors are plugged/unplugged, and the boot fetch
      // 401s before login — so re-pull the list whenever the tab is opened.
      if (target === 'lower-third-live') {
        void refreshDisplaySelect().catch(() => {});
        void refreshL3CuesCache().catch(() => {});
        void refreshL3LogosCache().catch(() => {});
      }
      if (target === 'l3') {
        void refreshL3LogoList().catch(() => {});
      }
    });
  });
}

// ── Boot ──────────────────────────────────────────────────────────

// `store.subscribe` only fires on future updates (see state.ts) — do one
// synchronous initial render so the status header / Live Control panels
// aren't blank before the first WS message arrives, mirroring how the old
// static HTML had default content ("IDLE", hidden show-lock badge, etc.)
// visible immediately on load.
renderReactRoots(store.getState());
store.subscribe(renderState);
bindEvents();
renderKbdPresetButtons();
initLowerThirdsTab();
initManageLowerThirdsTab();
void refreshL3CuesCache().catch(() => { /* no session yet */ });
void refreshL3LogosCache().catch(() => { /* no session yet */ });
void refreshMediaSelect().catch(() => { /* no session yet */ });
void refreshActiveProfile().catch(() => { /* public endpoint */ });
void refreshGoogleAuth().catch(() => { /* non-critical */ });
setInterval(() => {
  void refreshActiveProfile().catch(() => {});
}, 60000);
connectWs();

// Settings tab theme wiring
function initSettingsTab(): void {
  const current = document.documentElement.getAttribute('data-theme') ?? 'light';
  const radio = document.querySelector<HTMLInputElement>(`input[name="theme-radio"][value="${current}"]`);
  if (radio) radio.checked = true;

  document.querySelectorAll<HTMLInputElement>('input[name="theme-radio"]').forEach((r) => {
    r.addEventListener('change', () => {
      const theme = r.value as 'light' | 'dark';
      document.documentElement.setAttribute('data-theme', theme);
      localStorage.setItem('pconair-operator-theme', theme);
    });
  });
}
initSettingsTab();

// Per-device override, applied synchronously so there's no flash of the wrong
// theme before the profile default arrives over the network.
const localTheme = localStorage.getItem('pconair-operator-theme');
if (localTheme === 'light' || localTheme === 'dark') {
  document.documentElement.setAttribute('data-theme', localTheme);
}

void refreshSlidePresets().catch(() => {});
void refreshUrlPresets().catch(() => {});
void refreshDisplaySelect().catch(() => { /* no session yet */ });

// The profile supplies the show-wide *default*. A per-device override always
// wins — this used to overwrite it unconditionally, so the Settings toggle
// silently reverted on every reload.
void api.fetchActiveProfile().then((p) => {
  if (localTheme === 'light' || localTheme === 'dark') return;
  const theme = p.appPreferences?.operatorTheme === 'dark' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', theme);
  const radio = document.querySelector<HTMLInputElement>(`input[name="theme-radio"][value="${theme}"]`);
  if (radio) radio.checked = true;
}).catch(() => {});
