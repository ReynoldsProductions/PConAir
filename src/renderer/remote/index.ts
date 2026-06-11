/**
 * PConAir web remote — SPA shell (Phase 1).
 * Hash-routed pages with a bottom nav; content pages are filled in by later phases.
 * Connects to the server WebSocket for live state and shows connection status.
 */

interface NavPage {
  id: string;
  label: string;
  glyph: string;
}

const PAGES: NavPage[] = [
  { id: 'slides', label: 'Slides', glyph: '▦' },
  { id: 'l3', label: 'L3', glyph: '▬' },
  { id: 'stills', label: 'Stills', glyph: '▣' },
  { id: 'packages', label: 'Packages', glyph: '◳' },
  { id: 'urls', label: 'URLs', glyph: '⌘' },
  { id: 'timer', label: 'Timer', glyph: '◷' },
  { id: 'settings', label: 'Settings', glyph: '⚙' },
];

function currentPageId(): string {
  const id = location.hash.replace(/^#\/?/, '');
  return PAGES.some((p) => p.id === id) ? id : 'slides';
}

function renderNav(): void {
  const nav = document.getElementById('nav')!;
  nav.innerHTML = '';
  for (const p of PAGES) {
    const btn = document.createElement('button');
    btn.dataset.page = p.id;
    btn.innerHTML = `<span class="glyph">${p.glyph}</span><span>${p.label}</span>`;
    btn.addEventListener('click', () => {
      location.hash = `#/${p.id}`;
    });
    nav.appendChild(btn);
  }
}

function showPage(id: string): void {
  document.querySelectorAll<HTMLElement>('.page').forEach((el) => {
    el.classList.toggle('active', el.id === `page-${id}`);
  });
  document.querySelectorAll<HTMLButtonElement>('nav button').forEach((b) => {
    b.classList.toggle('active', b.dataset.page === id);
  });
}

function setConn(connected: boolean, label: string): void {
  document.getElementById('conn-dot')!.classList.toggle('connected', connected);
  document.getElementById('conn-label')!.textContent = label;
}

function renderStatusGrid(state: Record<string, unknown>): void {
  const grid = document.getElementById('status-grid');
  if (!grid) return;
  const conn = (state.connectionStatus ?? {}) as Record<string, unknown>;
  const rows: Array<[string, string]> = [
    ['Mode', String(state.mode ?? '—')],
    ['WS clients', String(conn.webSocketClients ?? '—')],
    ['Companion', conn.companionConnected ? 'connected' : 'not connected'],
  ];
  grid.innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
}

// ---- Slides page ----

interface SlidesSlice {
  deckId: string;
  deckTitle: string;
  slideIndex: number;
  slideCount: number;
  isLoading: boolean;
  deckUrl: string | null;
  backupLoaded: boolean;
  notes: string;
  thumbnailCurrent: string | null;
  thumbnailNext: string | null;
  offlineMode: boolean;
  cacheWarmed: boolean;
}

let lastSlides: SlidesSlice | null = null;
let notesFontPx = 19;

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

function haptic(): void {
  if (($('haptic-toggle') as HTMLInputElement).checked && 'vibrate' in navigator) {
    navigator.vibrate(20);
  }
}

async function api(path: string, body?: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      return { ok: false, error: data?.error?.message ?? `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

function setMsg(text: string): void {
  $('slides-msg').textContent = text;
}

function renderSlides(slides: SlidesSlice | null): void {
  lastSlides = slides;
  const loaded = slides !== null && !slides.isLoading;

  $('deck-title').textContent = slides
    ? slides.isLoading
      ? 'Loading deck…'
      : slides.deckTitle
    : 'No deck loaded';
  $('slide-counter').textContent = loaded ? `${slides.slideIndex + 1} / ${slides.slideCount}` : '– / –';
  $('speaker-notes-content').textContent = loaded
    ? slides.notes || 'No notes for this slide.'
    : 'Load a deck to see speaker notes.';

  ($('btn-prev') as HTMLButtonElement).disabled = !loaded || slides.slideIndex <= 0;
  ($('btn-next') as HTMLButtonElement).disabled = !loaded || slides.slideIndex >= slides.slideCount - 1;

  const strip = $('slide-strip');
  const hasThumb = Boolean(slides?.thumbnailCurrent || slides?.thumbnailNext);
  strip.hidden = !hasThumb;
  if (slides?.thumbnailCurrent) ($('thumb-current') as HTMLImageElement).src = slides.thumbnailCurrent;
  if (slides?.thumbnailNext) ($('thumb-next') as HTMLImageElement).src = slides.thumbnailNext;

  $('offline-chip').hidden = !(slides?.offlineMode && slides.cacheWarmed);
  $('backup-chip').hidden = !slides?.backupLoaded;
  ($('offline-toggle') as HTMLInputElement).checked = slides?.offlineMode ?? false;
}

function wireSlidesPage(): void {
  $('btn-next').addEventListener('click', () => {
    haptic();
    void api('/api/slides/next');
  });
  $('btn-prev').addEventListener('click', () => {
    haptic();
    void api('/api/slides/prev');
  });
  $('btn-goto').addEventListener('click', () => {
    const n = parseInt(($('goto-input') as HTMLInputElement).value, 10);
    if (Number.isInteger(n) && n >= 1) {
      haptic();
      void api('/api/slides/goto', { slideIndex: n - 1 });
    }
  });
  $('btn-load').addEventListener('click', async () => {
    const deckUrl = ($('deck-url') as HTMLInputElement).value.trim();
    const backupUrl = ($('backup-url') as HTMLInputElement).value.trim();
    if (!deckUrl) {
      setMsg('Enter a deck URL.');
      return;
    }
    setMsg('Loading…');
    const r = await api('/api/slides/load', backupUrl ? { deckUrl, backupUrl } : { deckUrl });
    setMsg(r.ok ? '' : r.error ?? 'Load failed');
  });
  $('btn-reload').addEventListener('click', async () => {
    const r = await api('/api/slides/reload');
    setMsg(r.ok ? '' : r.error ?? 'Reload failed');
  });
  $('btn-ab-switch').addEventListener('click', async () => {
    const r = await api('/api/ab/switch', {});
    setMsg(r.ok ? '' : r.error ?? 'Switch failed');
  });
  $('offline-toggle').addEventListener('change', () => {
    void api('/api/slides/offline-mode', { enabled: ($('offline-toggle') as HTMLInputElement).checked });
  });

  const applyZoom = (): void => {
    $('speaker-notes-content').style.fontSize = `${notesFontPx}px`;
    $('speaker-notes-content').style.lineHeight = `${Math.round(notesFontPx * 1.58)}px`;
    $('notes-zoom-readout').textContent = `${notesFontPx}px`;
    localStorage.setItem('pconair-notes-zoom', String(notesFontPx));
  };
  $('notes-zoom-in').addEventListener('click', () => {
    notesFontPx = Math.min(40, notesFontPx + 2);
    applyZoom();
  });
  $('notes-zoom-out').addEventListener('click', () => {
    notesFontPx = Math.max(12, notesFontPx - 2);
    applyZoom();
  });
  const saved = parseInt(localStorage.getItem('pconair-notes-zoom') ?? '', 10);
  if (Number.isInteger(saved) && saved >= 12 && saved <= 40) notesFontPx = saved;
  applyZoom();

  // Keyboard shortcuts: arrows / space navigate when not typing in a field.
  document.addEventListener('keydown', (e) => {
    if (currentPageId() !== 'slides') return;
    const target = e.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
    if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') {
      e.preventDefault();
      void api('/api/slides/next');
    } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
      e.preventDefault();
      void api('/api/slides/prev');
    }
  });
}

let ws: WebSocket | null = null;
let reconnectDelayMs = 1000;

function connectWs(): void {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws`);

  ws.onopen = () => {
    reconnectDelayMs = 1000;
    setConn(true, 'live');
  };
  ws.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data as string) as { type: string; payload?: Record<string, unknown> };
      if (msg.type === 'state' && msg.payload) {
        renderStatusGrid(msg.payload);
        renderSlides((msg.payload.slides as SlidesSlice | null) ?? null);
        renderTunnel((msg.payload.tunnel as TunnelSlice | undefined) ?? null);
        renderL3((msg.payload.l3 as L3Slice | null) ?? null);
      } else if (msg.type === 'state_patch' && msg.payload) {
        if ('slides' in msg.payload) {
          renderSlides((msg.payload.slides as SlidesSlice | null) ?? null);
        }
        if ('tunnel' in msg.payload) {
          renderTunnel((msg.payload.tunnel as TunnelSlice | undefined) ?? null);
        }
        if ('l3' in msg.payload) {
          renderL3((msg.payload.l3 as L3Slice | null) ?? null);
        }
      }
    } catch {
      /* ignore malformed frames */
    }
  };
  ws.onclose = () => {
    setConn(false, 'reconnecting…');
    setTimeout(connectWs, reconnectDelayMs);
    reconnectDelayMs = Math.min(reconnectDelayMs * 2, 15000);
  };
}

// ---- Lower thirds page ----

interface L3Slice {
  activeCueId: string | null;
  activeCueName: string | null;
  activeTitle: string | null;
  isStacking: boolean;
  currentPlaylistId: string | null;
}

interface L3Cue {
  id: string;
  name: string;
  title: string;
  theme: string;
}

let l3Cues: L3Cue[] = [];
let l3SelectedCueId: string | null = null;
let lastL3: L3Slice | null = null;

function renderL3(l3: L3Slice | null): void {
  lastL3 = l3;
  const onAir = Boolean(l3?.activeCueId || l3?.activeCueName);
  $('l3-onair').hidden = !onAir;
  $('l3-active-name').textContent = onAir
    ? `${l3?.activeCueName ?? ''}${l3?.activeTitle ? ' — ' + l3.activeTitle : ''}`
    : 'Nothing on air';
  ($('l3-stacking') as HTMLInputElement).checked = l3?.isStacking ?? false;
  const playlistSel = $('l3-playlist') as HTMLSelectElement;
  if (l3?.currentPlaylistId && playlistSel.value !== l3.currentPlaylistId) {
    playlistSel.value = l3.currentPlaylistId;
  }
  renderL3Gallery();
}

function renderL3Gallery(): void {
  const gallery = $('l3-gallery');
  gallery.innerHTML = '';
  for (const cue of l3Cues) {
    const btn = document.createElement('button');
    btn.className = 'l3-cue';
    if (cue.id === l3SelectedCueId) btn.classList.add('selected');
    if (cue.id === lastL3?.activeCueId) btn.classList.add('live');
    btn.innerHTML = `<p class="cue-name"></p><p class="cue-title"></p><div class="cue-theme"></div>`;
    (btn.querySelector('.cue-name') as HTMLElement).textContent = cue.name;
    (btn.querySelector('.cue-title') as HTMLElement).textContent = cue.title;
    (btn.querySelector('.cue-theme') as HTMLElement).textContent = cue.theme;
    btn.addEventListener('click', () => {
      l3SelectedCueId = cue.id;
      renderL3Gallery();
    });
    btn.addEventListener('dblclick', () => {
      haptic();
      void api('/api/l3/take', { cueId: cue.id });
    });
    gallery.appendChild(btn);
  }
}

async function refreshL3Data(): Promise<void> {
  try {
    const cuesRes = await fetch('/api/l3/cues');
    if (cuesRes.ok) {
      const data = (await cuesRes.json()) as { cues: L3Cue[] };
      l3Cues = data.cues ?? [];
      renderL3Gallery();
    }
    const plRes = await fetch('/api/l3/playlists');
    if (plRes.ok) {
      const data = (await plRes.json()) as { playlists: Array<{ id: string; name: string }> };
      const sel = $('l3-playlist') as HTMLSelectElement;
      const current = lastL3?.currentPlaylistId ?? '';
      sel.innerHTML = '<option value="">No playlist</option>';
      for (const pl of data.playlists ?? []) {
        const opt = document.createElement('option');
        opt.value = pl.id;
        opt.textContent = pl.name;
        sel.appendChild(opt);
      }
      sel.value = current;
    }
    const themesRes = await fetch('/api/l3/themes');
    if (themesRes.ok) {
      const data = (await themesRes.json()) as { themes: Array<{ name: string; displayName: string }> };
      const sel = $('l3-new-theme') as HTMLSelectElement;
      sel.innerHTML = '';
      for (const t of data.themes ?? []) {
        const opt = document.createElement('option');
        opt.value = t.name;
        opt.textContent = t.displayName;
        sel.appendChild(opt);
      }
    }
  } catch {
    /* server unreachable */
  }
}

function wireL3Page(): void {
  $('l3-take').addEventListener('click', () => {
    if (!l3SelectedCueId) {
      $('l3-msg').textContent = 'Select a cue first.';
      return;
    }
    haptic();
    void api('/api/l3/take', { cueId: l3SelectedCueId });
  });
  $('l3-clear').addEventListener('click', () => {
    haptic();
    void api('/api/l3/clear');
  });
  $('l3-stacking').addEventListener('change', () => {
    void api('/api/l3/stacking', { enabled: ($('l3-stacking') as HTMLInputElement).checked });
  });
  $('l3-playlist').addEventListener('change', async () => {
    const id = ($('l3-playlist') as HTMLSelectElement).value;
    if (id) {
      const r = await api(`/api/l3/playlists/${encodeURIComponent(id)}/activate`);
      $('l3-msg').textContent = r.ok ? '' : r.error ?? 'Activate failed (admin required)';
    }
  });
  $('l3-pl-next').addEventListener('click', () => {
    haptic();
    void api('/api/l3/playlists/next');
  });
  $('l3-pl-prev').addEventListener('click', () => {
    haptic();
    void api('/api/l3/playlists/prev');
  });
  $('l3-add').addEventListener('click', async () => {
    const name = ($('l3-new-name') as HTMLInputElement).value.trim();
    const title = ($('l3-new-title') as HTMLInputElement).value.trim();
    const theme = ($('l3-new-theme') as HTMLSelectElement).value;
    if (!name) {
      $('l3-msg').textContent = 'Name is required.';
      return;
    }
    const r = await api('/api/l3/cues', { name, title, theme });
    $('l3-msg').textContent = r.ok ? 'Cue added.' : r.error ?? 'Add failed (admin session required)';
    if (r.ok) {
      ($('l3-new-name') as HTMLInputElement).value = '';
      ($('l3-new-title') as HTMLInputElement).value = '';
      void refreshL3Data();
    }
  });
  $('l3-csv').addEventListener('change', async () => {
    const input = $('l3-csv') as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const form = new FormData();
    form.append('file', file);
    try {
      const res = await fetch('/api/l3/cues/import', { method: 'POST', body: form });
      $('l3-msg').textContent = res.ok ? 'CSV imported.' : `Import failed (HTTP ${res.status})`;
      if (res.ok) void refreshL3Data();
    } catch {
      $('l3-msg').textContent = 'Import failed.';
    }
    input.value = '';
  });
}

// ---- QR modal + tunnel settings ----

interface TunnelSlice {
  enabled: boolean;
  status: 'inactive' | 'starting' | 'active' | 'error';
  url: string | null;
  pinRequired: boolean;
  lastError: string | null;
}

let lastTunnel: TunnelSlice | null = null;

function renderTunnel(t: TunnelSlice | null): void {
  lastTunnel = t;
  const dot = $('tunnel-dot');
  dot.className = `status-dot ${t?.status === 'active' ? 'active' : t?.status === 'error' ? 'error' : t?.status === 'starting' ? 'starting' : ''}`;
  $('tunnel-status-text').textContent = t
    ? t.status + (t.status === 'error' && t.lastError ? ` — ${t.lastError}` : '')
    : 'inactive';
  $('tunnel-url').textContent = t?.url ?? '';
  $('tunnel-toggle').textContent = t?.enabled && t.status !== 'inactive' ? 'Stop tunnel' : 'Start tunnel';
}

function wireQrAndTunnel(): void {
  $('qr-btn').addEventListener('click', async () => {
    try {
      const res = await fetch('/api/qr');
      const data = (await res.json()) as { url: string; qr: string };
      ($('qr-img') as HTMLImageElement).src = data.qr;
      $('qr-url').textContent = data.url;
      $('qr-modal').hidden = false;
    } catch {
      /* server unreachable */
    }
  });
  $('qr-close').addEventListener('click', () => {
    $('qr-modal').hidden = true;
  });
  $('qr-modal').addEventListener('click', (e) => {
    if (e.target === $('qr-modal')) $('qr-modal').hidden = true;
  });

  $('tunnel-save').addEventListener('click', async () => {
    const domain = ($('tunnel-domain') as HTMLInputElement).value.trim();
    const token = ($('tunnel-token') as HTMLInputElement).value.trim();
    const pin = ($('tunnel-pin') as HTMLInputElement).value.trim();
    const body: Record<string, string | null> = {};
    body.domain = domain || null;
    body.token = token || null;
    body.pin = pin || null;
    const res = await fetch('/api/tunnel/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    $('tunnel-msg').textContent = res.ok
      ? 'Saved.'
      : res.status === 401 || res.status === 403
        ? 'Admin session required.'
        : 'Save failed.';
  });

  $('tunnel-toggle').addEventListener('click', async () => {
    const enable = !(lastTunnel?.enabled && lastTunnel.status !== 'inactive');
    const res = await fetch('/api/tunnel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: enable }),
    });
    $('tunnel-msg').textContent = res.ok
      ? ''
      : res.status === 401 || res.status === 403
        ? 'Admin session required.'
        : 'Toggle failed.';
  });
}

renderNav();
showPage(currentPageId());
window.addEventListener('hashchange', () => showPage(currentPageId()));
wireSlidesPage();
wireL3Page();
wireQrAndTunnel();
void refreshL3Data();
connectWs();
