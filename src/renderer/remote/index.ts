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
  ($('thumb-current') as HTMLImageElement).src = slides?.thumbnailCurrent ?? '';
  ($('thumb-next') as HTMLImageElement).src = slides?.thumbnailNext ?? '';

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
        renderStills((msg.payload.mediaLibrary as StillsSlice | null) ?? null);
        renderOutputCards((msg.payload.renderOutputs as RenderOutputs | undefined) ?? null);
        renderLiveStatus(msg.payload);
        renderUrlState(msg.payload);
        renderStageTimer((msg.payload.stageTimer as StageTimerSlice | undefined) ?? null);
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
        if ('mediaLibrary' in msg.payload) {
          renderStills((msg.payload.mediaLibrary as StillsSlice | null) ?? null);
        }
        if ('renderOutputs' in msg.payload) {
          renderOutputCards((msg.payload.renderOutputs as RenderOutputs | undefined) ?? null);
        }
        if ('currentMode' in msg.payload || 'l3' in msg.payload) {
          renderLiveStatus(msg.payload);
        }
        if (
          'currentMode' in msg.payload ||
          'currentUrl' in msg.payload ||
          'currentPreset' in msg.payload ||
          'abState' in msg.payload
        ) {
          renderUrlState(msg.payload);
        }
        if ('stageTimer' in msg.payload) {
          renderStageTimer((msg.payload.stageTimer as StageTimerSlice | undefined) ?? null);
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

// ---- Still store page ----

interface StillsSlice {
  activeItemId: string | null;
  activeItemName: string | null;
  slideshow: {
    running: boolean;
    paused: boolean;
    itemIds: string[];
    position: number;
    intervalSec: number;
    transition: 'cut' | 'fade';
  } | null;
}

interface MediaItem {
  id: string;
  displayName: string;
}

let mediaItems: MediaItem[] = [];
let stillSelectedId: string | null = null;
let ssSelection: string[] = [];
let lastStills: StillsSlice | null = null;

function renderStills(m: StillsSlice | null): void {
  lastStills = m;
  const onAir = Boolean(m?.activeItemId);
  $('stills-onair').hidden = !onAir;
  $('stills-active-name').textContent = onAir ? m?.activeItemName ?? '' : 'Nothing on air';
  const show = m?.slideshow ?? null;
  $('ss-status').hidden = !(show?.running && !show.paused);
  $('ss-pos').textContent = show ? `${show.position + 1} / ${show.itemIds.length}` : '';
  ($('ss-pause') as HTMLButtonElement).textContent = show?.paused ? 'Resume' : 'Pause';
  renderStillsGallery();
}

function renderStillsGallery(): void {
  const gallery = $('stills-gallery');
  gallery.innerHTML = '';
  for (const item of mediaItems) {
    const card = document.createElement('button');
    card.className = 'still-card';
    if (item.id === stillSelectedId) card.classList.add('selected');
    if (item.id === lastStills?.activeItemId) card.classList.add('live');
    const img = document.createElement('img');
    img.loading = 'lazy';
    img.src = `/api/media-library/${encodeURIComponent(item.id)}/download`;
    img.alt = item.displayName;
    card.appendChild(img);
    const ssIdx = ssSelection.indexOf(item.id);
    if (ssIdx !== -1) {
      const badge = document.createElement('span');
      badge.className = 'ss-badge';
      badge.textContent = String(ssIdx + 1);
      card.appendChild(badge);
    }
    const nameEl = document.createElement('span');
    nameEl.className = 'still-name';
    nameEl.textContent = item.displayName;
    card.appendChild(nameEl);
    card.addEventListener('click', () => {
      stillSelectedId = item.id;
      const idx = ssSelection.indexOf(item.id);
      if (idx === -1) {
        ssSelection.push(item.id);
      } else {
        ssSelection.splice(idx, 1);
      }
      $('ss-count').textContent = String(ssSelection.length);
      renderStillsGallery();
    });
    card.addEventListener('dblclick', () => {
      haptic();
      void api('/api/media-library/take', { itemId: item.id });
    });
    gallery.appendChild(card);
  }
}

async function refreshStillsData(): Promise<void> {
  try {
    const res = await fetch('/api/media-library');
    if (res.ok) {
      const data = (await res.json()) as { items: MediaItem[] };
      mediaItems = data.items ?? [];
      renderStillsGallery();
    }
  } catch {
    /* server unreachable */
  }
}

function wireStillsPage(): void {
  $('stills-take').addEventListener('click', () => {
    if (!stillSelectedId) {
      $('stills-msg').textContent = 'Select an image first.';
      return;
    }
    haptic();
    void api('/api/media-library/take', { itemId: stillSelectedId });
  });
  $('stills-clear').addEventListener('click', () => {
    haptic();
    void api('/api/media-library/clear');
  });

  const ssAction = (action: string, extra?: Record<string, unknown>) => async () => {
    const r = await api('/api/media-library/slideshow', { action, ...extra });
    $('stills-msg').textContent = r.ok ? '' : r.error ?? `${action} failed`;
  };
  $('ss-play').addEventListener('click', () => {
    const intervalSec = parseInt(($('ss-interval') as HTMLInputElement).value, 10) || 5;
    const transition = ($('ss-transition') as HTMLSelectElement).value;
    if (ssSelection.length === 0) {
      $('stills-msg').textContent = 'Tap images to add them to the slideshow first.';
      return;
    }
    void ssAction('play', { itemIds: ssSelection, intervalSec, transition })();
  });
  $('ss-pause').addEventListener('click', () => {
    void ssAction(lastStills?.slideshow?.paused ? 'resume' : 'pause')();
  });
  $('ss-stop').addEventListener('click', () => void ssAction('stop')());
  $('ss-next').addEventListener('click', () => void ssAction('next')());
  $('ss-prev').addEventListener('click', () => void ssAction('prev')());

  $('stills-upload').addEventListener('change', async () => {
    const input = $('stills-upload') as HTMLInputElement;
    if (!input.files?.length) return;
    const form = new FormData();
    for (const f of Array.from(input.files)) form.append('files[]', f);
    try {
      const res = await fetch('/api/media-library/upload', { method: 'POST', body: form });
      const data = (await res.json().catch(() => null)) as { imported?: number } | null;
      $('stills-upload-msg').textContent = res.ok
        ? `Imported ${data?.imported ?? 0} image(s).`
        : res.status === 401 || res.status === 403
          ? 'Admin session required.'
          : 'Upload failed.';
      if (res.ok) void refreshStillsData();
    } catch {
      $('stills-upload-msg').textContent = 'Upload failed.';
    }
    input.value = '';
  });
}

// ---- Packages page ----

interface PackageInfo {
  id: string;
  name: string;
  version: string;
  description: string;
  renders: Array<{ id: string; label: string }>;
  hasControl: boolean;
  live: boolean;
}

async function refreshPackages(): Promise<void> {
  try {
    const res = await fetch('/api/packages');
    if (!res.ok) return;
    const data = (await res.json()) as { packages: PackageInfo[]; errors: Array<{ dir: string; error: string }> };
    const list = $('pkg-list');
    list.innerHTML = '';
    if (data.packages.length === 0) {
      list.innerHTML = '<div class="card"><p>No packages installed. Drop a package folder into the packages/ directory and rescan.</p></div>';
    }
    for (const pkg of data.packages) {
      const card = document.createElement('div');
      card.className = 'card';
      const h = document.createElement('h3');
      h.textContent = `${pkg.name} `;
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.textContent = pkg.live ? 'LIVE' : 'OFFLINE';
      if (!pkg.live) chip.style.borderColor = chip.style.color = 'var(--text-dim)';
      h.appendChild(chip);
      card.appendChild(h);
      const desc = document.createElement('p');
      desc.textContent = `${pkg.description} (v${pkg.version})`;
      card.appendChild(desc);
      const row = document.createElement('div');
      row.className = 'loader-buttons';
      if (pkg.hasControl) {
        const open = document.createElement('a');
        open.className = 'small-btn primary';
        open.style.textDecoration = 'none';
        open.href = `/packages/${encodeURIComponent(pkg.id)}/control`;
        open.target = '_blank';
        open.textContent = 'Open Control UI';
        row.appendChild(open);
      }
      for (const r of pkg.renders) {
        const copy = document.createElement('button');
        copy.className = 'small-btn';
        copy.textContent = pkg.renders.length > 1 ? `Copy OBS URL — ${r.label}` : 'Copy OBS URL';
        copy.addEventListener('click', () => {
          const url = `${location.origin}/packages/${encodeURIComponent(pkg.id)}/render/${encodeURIComponent(r.id)}`;
          void navigator.clipboard.writeText(url).then(
            () => {
              $('pkg-msg').textContent = `Copied ${url}`;
            },
            () => {
              $('pkg-msg').textContent = url;
            }
          );
        });
        row.appendChild(copy);
      }
      card.appendChild(row);
      list.appendChild(card);
    }
    if (data.errors.length > 0) {
      const err = document.createElement('div');
      err.className = 'card';
      err.innerHTML = `<h3>Load errors</h3><p>${data.errors.map((e) => `${e.dir}: ${e.error}`).join('<br>')}</p>`;
      list.appendChild(err);
    }
  } catch {
    /* server unreachable */
  }
}

function wirePackagesPage(): void {
  $('pkg-rescan').addEventListener('click', async () => {
    await fetch('/api/packages/rescan', { method: 'POST' });
    void refreshPackages();
  });
}

// ---- Per-page output controls (software output path) ----

interface RenderOutput {
  bg: 'transparent' | 'black' | 'white' | 'chroma' | 'opaque';
  chromaColor: string;
  claimedOutput: string | null;
}

type RenderOutputs = Record<'slides' | 'l3' | 'stills' | 'url', RenderOutput>;

let lastOutputs: RenderOutputs | null = null;
const OUTPUT_PAGES: Array<{ type: keyof RenderOutputs; page: string }> = [
  { type: 'slides', page: 'page-slides' },
  { type: 'l3', page: 'page-l3' },
  { type: 'stills', page: 'page-stills' },
  { type: 'url', page: 'page-urls' },
];

function renderOutputCards(outputs: RenderOutputs | null): void {
  lastOutputs = outputs;
  if (!outputs) return;
  for (const { type } of OUTPUT_PAGES) {
    const bgSel = document.getElementById(`out-bg-${type}`) as HTMLSelectElement | null;
    const chroma = document.getElementById(`out-chroma-${type}`) as HTMLInputElement | null;
    const claimed = document.getElementById(`out-claimed-${type}`);
    if (bgSel && document.activeElement !== bgSel) bgSel.value = outputs[type].bg;
    if (chroma && document.activeElement !== chroma) chroma.value = outputs[type].chromaColor;
    if (claimed) claimed.textContent = outputs[type].claimedOutput ?? 'unassigned';
  }
}

function wireOutputCards(): void {
  for (const { type, page } of OUTPUT_PAGES) {
    const section = document.getElementById(page);
    if (!section) continue;
    const card = document.createElement('details');
    card.className = 'card loader-card';
    card.innerHTML = `
      <summary>Output &amp; key mode</summary>
      <div class="goto-row" style="margin-top:10px;">
        <select id="out-bg-${type}" class="settings-input" style="max-width:140px;">
          <option value="transparent">Transparent</option>
          <option value="black">Black (luma)</option>
          <option value="white">White (luma)</option>
          <option value="chroma">Chroma color</option>
          <option value="opaque">Opaque</option>
        </select>
        <input id="out-chroma-${type}" type="color" value="#00b140" style="width:44px;height:36px;border:1px solid var(--border);border-radius:6px;background:var(--surface);" />
        <button id="out-copy-${type}" class="small-btn">Copy OBS URL</button>
      </div>
      <p class="hint-line" style="color:var(--text-dim)">Live status: <span id="out-status-${type}">—</span> · Claimed output: <span id="out-claimed-${type}">unassigned</span></p>
      <p class="hint-line" id="out-msg-${type}"></p>`;
    section.appendChild(card);

    document.getElementById(`out-bg-${type}`)!.addEventListener('change', async () => {
      const bg = (document.getElementById(`out-bg-${type}`) as HTMLSelectElement).value;
      const r = await api(`/api/render/${type}/background`, { bg });
      (document.getElementById(`out-msg-${type}`) as HTMLElement).textContent = r.ok ? '' : r.error ?? 'Failed';
    });
    document.getElementById(`out-chroma-${type}`)!.addEventListener('change', async () => {
      const chromaColor = (document.getElementById(`out-chroma-${type}`) as HTMLInputElement).value;
      await api(`/api/render/${type}/background`, { chromaColor });
    });
    document.getElementById(`out-copy-${type}`)!.addEventListener('click', () => {
      const url = `${location.origin}/render/${type}`;
      void navigator.clipboard.writeText(url).then(
        () => {
          (document.getElementById(`out-msg-${type}`) as HTMLElement).textContent = `Copied ${url}`;
        },
        () => {
          (document.getElementById(`out-msg-${type}`) as HTMLElement).textContent = url;
        }
      );
    });
  }
}

function renderLiveStatus(state: Record<string, unknown>): void {
  const mode = state.currentMode as string;
  const liveMap: Record<string, boolean> = {
    slides: mode === 'slides',
    l3: mode === 'l3' || Boolean((state.l3 as { activeCueId?: string } | null)?.activeCueId),
    stills: mode === 'media-library',
    url: mode === 'url',
  };
  for (const { type } of OUTPUT_PAGES) {
    const el = document.getElementById(`out-status-${type}`);
    if (el) el.textContent = liveMap[type] ? 'LIVE' : 'off';
  }
}

// ---- URLs page ----

interface UrlPresetLike {
  id: string;
  name: string;
  url: string;
}

interface UrlPageState {
  currentMode: string;
  currentUrl: string | null;
  currentPresetName: string | null;
  activeInstance: 'A' | 'B';
}

const urlPage: UrlPageState = { currentMode: 'idle', currentUrl: null, currentPresetName: null, activeInstance: 'A' };
let urlPresets: UrlPresetLike[] = [];

function renderUrlState(patch: Record<string, unknown>): void {
  if ('currentMode' in patch) urlPage.currentMode = String(patch.currentMode);
  if ('currentUrl' in patch) urlPage.currentUrl = (patch.currentUrl as string | null) ?? null;
  if ('currentPreset' in patch) {
    urlPage.currentPresetName = (patch.currentPreset as { name?: string } | null)?.name ?? null;
  }
  if ('abState' in patch) {
    urlPage.activeInstance = ((patch.abState as { activeInstance?: 'A' | 'B' } | null)?.activeInstance ?? 'A');
  }

  const onAir = urlPage.currentMode === 'url';
  $('url-onair').hidden = !onAir;
  $('url-current').textContent = urlPage.currentUrl
    ? (urlPage.currentPresetName ? `${urlPage.currentPresetName} — ` : '') + urlPage.currentUrl
    : 'No URL loaded';
  $('url-ab-status').textContent = `Active: ${urlPage.activeInstance}`;
}

function renderUrlPresetList(): void {
  const list = $('url-preset-list');
  list.innerHTML = '';
  if (urlPresets.length === 0) {
    list.innerHTML = '<p class="hint-line" style="color:var(--text-dim)">No presets yet.</p>';
    return;
  }
  for (const p of urlPresets) {
    const row = document.createElement('div');
    row.className = 'goto-row';
    const open = document.createElement('button');
    open.className = 'small-btn primary';
    open.textContent = p.name;
    open.style.flex = '1';
    open.title = p.url;
    open.addEventListener('click', async () => {
      haptic();
      const r = await api('/api/action', { action_id: 'load_url_preset', params: { preset: p.id } });
      $('url-preset-msg').textContent = r.ok ? '' : r.error ?? 'Failed';
    });
    const del = document.createElement('button');
    del.className = 'small-btn';
    del.textContent = '✕';
    del.title = 'Delete preset (admin)';
    del.addEventListener('click', async () => {
      const res = await fetch(`/api/presets/${encodeURIComponent(p.id)}`, { method: 'DELETE' });
      $('url-preset-msg').textContent = res.ok ? '' : res.status === 401 || res.status === 403 ? 'Admin session required.' : 'Delete failed.';
      void refreshUrlPresets();
    });
    row.append(open, del);
    list.appendChild(row);
  }
}

async function refreshUrlPresets(): Promise<void> {
  try {
    const res = await fetch('/api/presets');
    if (!res.ok) return;
    const data = (await res.json()) as { presets: UrlPresetLike[] };
    urlPresets = data.presets;
    renderUrlPresetList();
  } catch {
    /* server unreachable */
  }
}

function wireUrlsPage(): void {
  $('url-open').addEventListener('click', async () => {
    haptic();
    const url = ($('url-input') as HTMLInputElement).value.trim();
    if (!url) return;
    const r = await api('/api/url', { url });
    $('url-msg').textContent = r.ok ? '' : r.error ?? 'Failed';
  });
  $('url-reload').addEventListener('click', async () => {
    haptic();
    const r = await api('/api/url/reload');
    $('url-msg').textContent = r.ok ? '' : r.error ?? 'Failed';
  });
  $('url-ab-switch').addEventListener('click', async () => {
    haptic();
    const r = await api('/api/ab/switch', {});
    $('url-msg').textContent = r.ok ? '' : r.error ?? 'Failed';
  });
  $('url-preset-add').addEventListener('click', async () => {
    const name = ($('url-new-name') as HTMLInputElement).value.trim();
    const url = ($('url-new-url') as HTMLInputElement).value.trim();
    if (!name || !url) {
      $('url-add-msg').textContent = 'Name and URL are required.';
      return;
    }
    const res = await fetch('/api/presets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, url }),
    });
    $('url-add-msg').textContent = res.ok
      ? 'Added.'
      : res.status === 401 || res.status === 403
        ? 'Admin session required.'
        : 'Add failed.';
    if (res.ok) {
      ($('url-new-name') as HTMLInputElement).value = '';
      ($('url-new-url') as HTMLInputElement).value = '';
      void refreshUrlPresets();
    }
  });
}

// ---- Timer page (stagetimer.io) ----

interface StageTimerSlice {
  overlayEnabled: boolean;
  overlayPosition: string;
  overlaySize: number;
  roomId: string | null;
  configured: boolean;
}

let lastStageTimer: StageTimerSlice | null = null;

function renderStageTimer(st: StageTimerSlice | null): void {
  lastStageTimer = st;
  $('st-overlay-chip').hidden = !st?.overlayEnabled;
  $('st-overlay-toggle').textContent = st?.overlayEnabled ? 'Hide overlay' : 'Show overlay';
  $('st-configured').textContent = st?.configured ? `Room ${st.roomId} configured` : 'Not configured';
  const pos = $('st-position') as HTMLSelectElement;
  const size = $('st-size') as HTMLInputElement;
  if (st && document.activeElement !== pos) pos.value = st.overlayPosition;
  if (st && document.activeElement !== size) size.value = String(st.overlaySize);
  if (st && document.activeElement !== $('st-room')) ($('st-room') as HTMLInputElement).value = st.roomId ?? '';

  // Embed the configured room's viewer; the stagetimer.io home page otherwise.
  const frame = $('st-frame') as HTMLIFrameElement;
  const want = st?.roomId ? `https://stagetimer.io/r/${encodeURIComponent(st.roomId)}/` : 'https://stagetimer.io/';
  if (frame.getAttribute('src') !== want) frame.src = want;
}

function wireTimerPage(): void {
  $('st-overlay-toggle').addEventListener('click', async () => {
    haptic();
    const r = await api('/api/stagetimer/overlay', { enabled: !lastStageTimer?.overlayEnabled });
    $('st-msg').textContent = r.ok ? '' : r.error ?? 'Failed';
  });
  const applySettings = async (): Promise<void> => {
    const position = ($('st-position') as HTMLSelectElement).value;
    const size = parseInt(($('st-size') as HTMLInputElement).value, 10);
    const res = await fetch('/api/stagetimer/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ position, size: Number.isFinite(size) ? size : undefined }),
    });
    $('st-msg').textContent = res.ok
      ? ''
      : res.status === 401 || res.status === 403
        ? 'Admin session required.'
        : 'Update failed.';
  };
  $('st-position').addEventListener('change', () => void applySettings());
  $('st-size').addEventListener('change', () => void applySettings());
  $('st-save').addEventListener('click', async () => {
    const roomId = ($('st-room') as HTMLInputElement).value.trim();
    const apiKey = ($('st-key') as HTMLInputElement).value.trim();
    const res = await fetch('/api/stagetimer/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomId: roomId || null, ...(apiKey ? { apiKey } : {}) }),
    });
    $('st-config-msg').textContent = res.ok
      ? 'Saved.'
      : res.status === 401 || res.status === 403
        ? 'Admin session required.'
        : 'Save failed.';
    if (res.ok) ($('st-key') as HTMLInputElement).value = '';
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

// ── Custom branding logo ──────────────────────────────────────────────────────
// Check whether the server has a custom logo configured. The /branding/logo
// endpoint returns 404 when no logo is set; 200 when one exists.
(function initBrandingLogo() {
  const logoEl = document.getElementById('branding-logo') as HTMLImageElement | null;
  if (!logoEl) return;
  const img = new Image();
  img.onload = () => {
    logoEl.src = img.src;
    logoEl.hidden = false;
  };
  // Cache-bust so the logo refreshes if the user changes it without a full page reload.
  img.src = '/branding/logo?v=' + Date.now();
})();

renderNav();
showPage(currentPageId());
window.addEventListener('hashchange', () => showPage(currentPageId()));
wireSlidesPage();
wireL3Page();
wireStillsPage();
wirePackagesPage();
wireUrlsPage();
wireTimerPage();
wireOutputCards();
wireQrAndTunnel();
void refreshL3Data();
void refreshStillsData();
void refreshPackages();
void refreshUrlPresets();
connectWs();
