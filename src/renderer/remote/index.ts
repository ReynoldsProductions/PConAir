/**
 * PConAir web remote — SPA shell (Phase 1).
 * Hash-routed pages with a bottom nav; content pages are filled in by later phases.
 * Connects to the server WebSocket for live state and shows connection status.
 */

// ── Theme ────────────────────────────────────────────────────────────────────
// Light is the CSS default. A per-device override wins over the show-wide
// default set in Admin → Appearance. Applied at module top-level rather than
// from an inline <script> because the remote's CSP is `script-src 'self'`.
function applyTheme(): void {
  let local: string | null = null;
  try {
    local = localStorage.getItem('pconair-operator-theme');
  } catch {
    /* storage disabled — fall back to the profile default */
  }
  if (local === 'light' || local === 'dark') {
    document.documentElement.setAttribute('data-theme', local);
    return;
  }
  void fetch('/api/profiles/active')
    .then((r) => (r.ok ? r.json() : null))
    .then((p: { appPreferences?: { operatorTheme?: string } } | null) => {
      const theme = p?.appPreferences?.operatorTheme === 'dark' ? 'dark' : 'light';
      document.documentElement.setAttribute('data-theme', theme);
    })
    .catch(() => {
      /* keep the light default */
    });
}
applyTheme();

interface NavPage {
  id: string;
  label: string;
  glyph: string;
}

const PAGES: NavPage[] = [
  { id: 'slides', label: 'Slides', glyph: '▦' },
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
  // Monitors get plugged and unplugged mid-show, so re-pull the list whenever
  // the page that targets them comes into view.
  if (id === 'urls') void refreshUrlDisplays();
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
        if ('mediaLibrary' in msg.payload) {
          renderStills((msg.payload.mediaLibrary as StillsSlice | null) ?? null);
        }
        if ('renderOutputs' in msg.payload) {
          renderOutputCards((msg.payload.renderOutputs as RenderOutputs | undefined) ?? null);
        }
        if ('currentMode' in msg.payload) {
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
    shuffle: boolean;
  } | null;
}

function formatClipLength(ms: number): string {
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const sec = total % 60;
  return m > 0 ? `${m}:${String(sec).padStart(2, '0')}` : `${sec}s`;
}

interface MediaItem {
  id: string;
  displayName: string;
  mimeType?: string;
  durationMs?: number;
  updatedAt?: number;
}

let mediaItems: MediaItem[] = [];
let stillSelectedId: string | null = null;
let ssSelection: string[] = [];
let lastStills: StillsSlice | null = null;
let shuffleOn = false;

function renderShuffleButton(): void {
  const btn = $('ss-shuffle');
  btn.textContent = `Shuffle: ${shuffleOn ? 'on' : 'off'}`;
  btn.setAttribute('aria-pressed', shuffleOn ? 'true' : 'false');
}

function renderStills(m: StillsSlice | null): void {
  lastStills = m;
  const onAir = Boolean(m?.activeItemId);
  $('stills-onair').hidden = !onAir;
  $('stills-active-name').textContent = onAir ? m?.activeItemName ?? '' : 'Nothing on air';
  const show = m?.slideshow ?? null;
  $('ss-status').hidden = !(show?.running && !show.paused);
  $('ss-pos').textContent = show ? `${show.position + 1} / ${show.itemIds.length}` : '';
  ($('ss-pause') as HTMLButtonElement).textContent = show?.paused ? 'Resume' : 'Pause';
  // Follow the server for a running show so the button survives a reload and
  // stays right when another operator toggles it.
  if (show) {
    shuffleOn = show.shuffle === true;
  }
  renderShuffleButton();
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
    // ?v= busts the browser cache when an item is replaced in place — the id
    // stays the same, so the URL would otherwise be unchanged.
    const src = `/api/media-library/${encodeURIComponent(item.id)}/download?v=${item.updatedAt ?? 0}`;
    const isVideo = (item.mimeType ?? '').startsWith('video/');
    if (isVideo) {
      // <img> can't decode a video, so the thumbnail is a muted video element
      // holding its first frame — metadata-only so the gallery stays cheap.
      const vid = document.createElement('video');
      vid.muted = true;
      vid.playsInline = true;
      vid.preload = 'metadata';
      vid.src = src;
      card.appendChild(vid);
      const tag = document.createElement('span');
      tag.className = 'vid-badge';
      tag.textContent = item.durationMs ? `▶ ${formatClipLength(item.durationMs)}` : '▶';
      card.appendChild(tag);
    } else {
      const img = document.createElement('img');
      img.loading = 'lazy';
      img.src = src;
      img.alt = item.displayName;
      card.appendChild(img);
    }
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
  const chosenTransition = (): string => ($('ss-transition') as HTMLSelectElement).value;

  $('stills-take').addEventListener('click', () => {
    if (!stillSelectedId) {
      $('stills-msg').textContent = 'Select an item first.';
      return;
    }
    haptic();
    // Send the transition: takes have no slideshow, so without this the render
    // page had nothing to read and always hard-cut.
    void api('/api/media-library/take', { itemId: stillSelectedId, transition: chosenTransition() });
  });
  $('stills-clear').addEventListener('click', () => {
    haptic();
    void api('/api/media-library/clear');
  });

  // Select-all covers video too — a clip in a slideshow plays once and the show
  // advances on its own length, so mixing them needs no special handling.
  $('ss-select-all').addEventListener('click', () => {
    haptic();
    ssSelection = mediaItems.map((it) => it.id);
    $('ss-count').textContent = String(ssSelection.length);
    $('stills-msg').textContent = ssSelection.length
      ? `Selected all ${ssSelection.length} item${ssSelection.length === 1 ? '' : 's'}.`
      : 'Nothing in the still store to select.';
    renderStillsGallery();
  });
  $('ss-select-none').addEventListener('click', () => {
    haptic();
    ssSelection = [];
    $('ss-count').textContent = '0';
    $('stills-msg').textContent = '';
    renderStillsGallery();
  });

  // Wiping is unrecoverable, so the button arms on first press and only fires on
  // a second press, disarming itself after a few seconds.
  let wipeArmTimer: ReturnType<typeof setTimeout> | null = null;
  const wipeBtn = $('stills-wipe') as HTMLButtonElement;
  const disarmWipe = (): void => {
    if (wipeArmTimer) {
      clearTimeout(wipeArmTimer);
      wipeArmTimer = null;
    }
    wipeBtn.classList.remove('armed');
    wipeBtn.textContent = 'Wipe still store';
  };
  wipeBtn.addEventListener('click', async () => {
    haptic();
    if (!wipeBtn.classList.contains('armed')) {
      if (mediaItems.length === 0) {
        $('stills-wipe-msg').textContent = 'Still store is already empty.';
        return;
      }
      wipeBtn.classList.add('armed');
      wipeBtn.textContent = `Delete all ${mediaItems.length} — tap to confirm`;
      $('stills-wipe-msg').textContent = 'This cannot be undone.';
      wipeArmTimer = setTimeout(() => {
        disarmWipe();
        $('stills-wipe-msg').textContent = '';
      }, 5000);
      return;
    }
    disarmWipe();
    $('stills-wipe-msg').textContent = 'Wiping…';
    try {
      const res = await fetch('/api/media-library', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: true }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        $('stills-wipe-msg').textContent = data?.error?.message ?? `HTTP ${res.status}`;
        return;
      }
      const body = (await res.json()) as { removed?: number };
      ssSelection = [];
      stillSelectedId = null;
      $('ss-count').textContent = '0';
      $('stills-wipe-msg').textContent = `Removed ${body.removed ?? 0} item${body.removed === 1 ? '' : 's'}.`;
      await refreshStillsData();
    } catch {
      $('stills-wipe-msg').textContent = 'Wipe failed.';
    }
  });

  const ssAction = (action: string, extra?: Record<string, unknown>) => async () => {
    const r = await api('/api/media-library/slideshow', { action, ...extra });
    $('stills-msg').textContent = r.ok ? '' : r.error ?? `${action} failed`;
  };
  $('ss-play').addEventListener('click', () => {
    const intervalSec = parseInt(($('ss-interval') as HTMLInputElement).value, 10) || 5;
    if (ssSelection.length === 0) {
      $('stills-msg').textContent = 'Tap items to add them to the slideshow first.';
      return;
    }
    void ssAction('play', {
      itemIds: ssSelection,
      intervalSec,
      transition: chosenTransition(),
      shuffle: shuffleOn,
    })();
  });

  $('ss-shuffle').addEventListener('click', async () => {
    haptic();
    shuffleOn = !shuffleOn;
    renderShuffleButton();
    // If a show is already running, reorder it live; otherwise the flag just
    // applies to the next Play.
    if (lastStills?.slideshow?.running) {
      const r = await api('/api/media-library/slideshow', {
        action: 'shuffle',
        shuffle: shuffleOn,
        itemIds: ssSelection,
      });
      $('stills-msg').textContent = r.ok ? '' : r.error ?? 'Shuffle failed';
    }
  });
  $('ss-pause').addEventListener('click', () => {
    void ssAction(lastStills?.slideshow?.paused ? 'resume' : 'pause')();
  });
  $('ss-stop').addEventListener('click', () => void ssAction('stop')());
  $('ss-next').addEventListener('click', () => void ssAction('next')());
  $('ss-prev').addEventListener('click', () => void ssAction('prev')());

  $('stills-upload').addEventListener('change', () => {
    const input = $('stills-upload') as HTMLInputElement;
    if (!input.files?.length) return;
    void uploadStills(Array.from(input.files));
    input.value = '';
  });
}

function formatBytes(n: number): string {
  if (n >= 1024 * 1024 * 1024) return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (n >= 1024 * 1024) return `${Math.round(n / (1024 * 1024))} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}

interface UploadResponse {
  imported?: number;
  failed?: number;
  failures?: string[];
  error?: { message?: string };
}

/**
 * Files per request. The server holds every file of a request in memory at once
 * (multer memoryStorage), so this is what bounds peak RAM — a 600-photo import
 * costs one batch of resident buffers, not six hundred. Kept under the server's
 * own 25-file cap, which stays in place as a backstop.
 */
const UPLOAD_BATCH_SIZE = 20;

/** How many example filenames to name per distinct reason. */
const MAX_FAILURE_EXAMPLES = 3;

/**
 * Collapses `name: reason` lines into one clause per distinct reason, naming a
 * few examples. Turns 38 identical rejections into something readable.
 */
function summariseFailures(failures: string[]): string {
  const byReason = new Map<string, string[]>();
  for (const line of failures) {
    const idx = line.indexOf(': ');
    const name = idx === -1 ? line : line.slice(0, idx);
    const reason = idx === -1 ? 'not usable' : line.slice(idx + 2);
    const names = byReason.get(reason) ?? [];
    names.push(name);
    byReason.set(reason, names);
  }
  return [...byReason.entries()]
    .map(([reason, names]) => {
      const examples = names.slice(0, MAX_FAILURE_EXAMPLES).join(', ');
      const more = names.length > MAX_FAILURE_EXAMPLES ? ` and ${names.length - MAX_FAILURE_EXAMPLES} more` : '';
      return `${names.length} × ${reason} (${examples}${more})`;
    })
    .join('; ');
}

interface BatchOutcome {
  imported: number;
  failed: number;
  failures: string[];
  /** Set when the whole request failed rather than individual files. */
  fatal?: string;
  /** True when the session is gone and continuing is pointless. */
  unauthorized?: boolean;
}

/**
 * One batch over XHR rather than fetch: fetch exposes no upload progress, and a
 * large import over Wi-Fi with no feedback is indistinguishable from a hang.
 */
function uploadBatch(files: File[], onBytes: (loaded: number) => void): Promise<BatchOutcome> {
  return new Promise<BatchOutcome>((resolve) => {
    const form = new FormData();
    for (const f of files) form.append('files[]', f);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/media-library/upload');

    xhr.upload.addEventListener('progress', (ev) => {
      if (ev.lengthComputable) onBytes(ev.loaded);
    });

    xhr.addEventListener('load', () => {
      let data: UploadResponse | null = null;
      try {
        data = JSON.parse(xhr.responseText) as UploadResponse;
      } catch {
        /* non-JSON body */
      }
      if (xhr.status === 401) {
        resolve({ imported: 0, failed: files.length, failures: [], unauthorized: true });
        return;
      }
      if (xhr.status < 200 || xhr.status >= 300) {
        resolve({
          imported: 0,
          failed: files.length,
          failures: [],
          fatal: data?.error?.message ?? `HTTP ${xhr.status}`,
        });
        return;
      }
      resolve({
        imported: data?.imported ?? 0,
        failed: data?.failed ?? 0,
        failures: data?.failures ?? [],
      });
    });

    xhr.addEventListener('error', () =>
      resolve({ imported: 0, failed: files.length, failures: [], fatal: 'network error' })
    );
    xhr.addEventListener('abort', () =>
      resolve({ imported: 0, failed: files.length, failures: [], fatal: 'cancelled' })
    );
    xhr.send(form);
  });
}

/**
 * Uploads any number of files by splitting them into sequential batches. A
 * failing batch does not abandon the rest — a single unreadable photo in a
 * 600-file import should not cost the other 599 — but a lost session stops
 * immediately, since every remaining request would fail the same way.
 */
async function uploadStills(files: File[]): Promise<void> {
  const msg = $('stills-upload-msg');
  const bar = $('stills-upload-bar');
  const fill = $('stills-upload-fill');
  const label = $('stills-upload-label');

  const totalBytes = files.reduce((sum, f) => sum + f.size, 0);
  const batches: File[][] = [];
  for (let i = 0; i < files.length; i += UPLOAD_BATCH_SIZE) {
    batches.push(files.slice(i, i + UPLOAD_BATCH_SIZE));
  }

  const setBusy = (busy: boolean): void => {
    label.classList.toggle('disabled', busy);
    bar.hidden = !busy;
    if (!busy) fill.style.width = '0%';
  };

  setBusy(true);
  const noun = files.length === 1 ? files[0].name : `${files.length} files`;
  msg.textContent = `Uploading ${noun} (${formatBytes(totalBytes)})…`;

  let imported = 0;
  let failed = 0;
  const failures: string[] = [];
  let fatal: string | null = null;
  let bytesDone = 0;

  for (let b = 0; b < batches.length; b += 1) {
    const batch = batches[b];
    const batchBytes = batch.reduce((sum, f) => sum + f.size, 0);
    const batchLabel = batches.length > 1 ? ` — batch ${b + 1} of ${batches.length}` : '';

    const outcome = await uploadBatch(batch, (loaded) => {
      const pct = totalBytes > 0 ? Math.round(((bytesDone + loaded) / totalBytes) * 100) : 0;
      fill.style.width = `${Math.min(pct, 100)}%`;
      msg.textContent =
        loaded < batchBytes
          ? `Uploading ${noun}${batchLabel} — ${Math.min(pct, 100)}% of ${formatBytes(totalBytes)}`
          : `Processing${batchLabel}…`;
    });

    bytesDone += batchBytes;
    imported += outcome.imported;
    failed += outcome.failed;
    failures.push(...outcome.failures);

    if (outcome.unauthorized) {
      fatal = 'session expired — sign in again to upload';
      break;
    }
    if (outcome.fatal) {
      failures.push(`batch ${b + 1}: ${outcome.fatal}`);
    }
    // Show items landing as they go rather than only at the very end.
    void refreshStillsData();
  }

  setBusy(false);

  if (fatal) {
    msg.textContent = imported > 0 ? `Added ${imported} before the ${fatal}.` : `Upload stopped — ${fatal}.`;
    return;
  }
  if (failed === 0) {
    // Report against what the picker actually handed us. If the browser capped
    // the selection, selected < what was chosen and the counts disagree —
    // which is the only way to tell a picker limit from a server one.
    const accounted = imported === files.length
      ? `✓ Added ${imported} item${imported === 1 ? '' : 's'} to the still store.`
      : `✓ Added ${imported} of ${files.length} selected — ${files.length - imported} unaccounted for.`;
    msg.textContent = accounted;
    return;
  }
  // Name what was skipped and why. Grouped by reason: a folder of camera
  // exports can reject dozens of sidecar files for the same cause, and listing
  // each one individually buries the reason the operator actually needs.
  const summary = summariseFailures(failures);
  msg.textContent =
    imported > 0
      ? `Added ${imported} of ${imported + failed}. Skipped — ${summary}`
      : `Nothing added — ${summary || 'files were not usable'}`;
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
  /** Active instance's display override; null means "follow the profile default". */
  displayTarget: string | null;
}

const urlPage: UrlPageState = {
  currentMode: 'idle',
  currentUrl: null,
  currentPresetName: null,
  activeInstance: 'A',
  displayTarget: null,
};
let urlPresets: UrlPresetLike[] = [];

function renderUrlState(patch: Record<string, unknown>): void {
  if ('currentMode' in patch) urlPage.currentMode = String(patch.currentMode);
  if ('currentUrl' in patch) urlPage.currentUrl = (patch.currentUrl as string | null) ?? null;
  if ('currentPreset' in patch) {
    urlPage.currentPresetName = (patch.currentPreset as { name?: string } | null)?.name ?? null;
  }
  if ('abState' in patch) {
    const ab = patch.abState as {
      activeInstance?: 'A' | 'B';
      instanceA?: { displayTarget?: string | null };
      instanceB?: { displayTarget?: string | null };
    } | null;
    urlPage.activeInstance = ab?.activeInstance ?? 'A';
    const inst = urlPage.activeInstance === 'A' ? ab?.instanceA : ab?.instanceB;
    urlPage.displayTarget = inst?.displayTarget ?? null;
    syncUrlDisplaySelect();
  }

  const onAir = urlPage.currentMode === 'url';
  $('url-onair').hidden = !onAir;
  $('url-current').textContent = urlPage.currentUrl
    ? (urlPage.currentPresetName ? `${urlPage.currentPresetName} — ` : '') + urlPage.currentUrl
    : 'No URL loaded';
  $('url-ab-status').textContent = `Active: ${urlPage.activeInstance}`;
}

// ---- URL output display picker ----

interface DisplayInfo {
  id: string;
  name: string;
  isPrimary: boolean;
}

/**
 * A selection made before anything is on air can't be pushed to the server
 * yet, so it lives only in the `<select>`. Unrelated state patches must not
 * reset it out from under the operator between picking a monitor and pressing
 * Open — this flag pauses the state→UI sync until the choice is committed.
 */
let urlDisplayPending = false;

/**
 * Empty value = "follow the Admin -> Monitors default"; every load and preset
 * take sends whatever is selected here, so the picker is the page's single
 * answer to "where does this URL go?".
 */
function selectedUrlDisplay(): string {
  return ($('url-display') as HTMLSelectElement).value;
}

/** Point the picker at the display the active instance is actually using. */
function syncUrlDisplaySelect(): void {
  if (urlDisplayPending) return;
  const sel = document.getElementById('url-display') as HTMLSelectElement | null;
  if (!sel || document.activeElement === sel) return;
  const target = urlPage.displayTarget ?? '';
  if (Array.from(sel.options).some((o) => o.value === target)) sel.value = target;
}

async function refreshUrlDisplays(): Promise<void> {
  const sel = $('url-display') as HTMLSelectElement;
  let displays: DisplayInfo[] = [];
  let defaultDisplayId: string | null = null;
  try {
    const res = await fetch('/api/displays');
    if (!res.ok) return;
    const data = (await res.json()) as { displays: DisplayInfo[]; defaultDisplayId?: string | null };
    displays = data.displays;
    defaultDisplayId = data.defaultDisplayId ?? null;
  } catch {
    return; /* server unreachable — leave the current options in place */
  }

  const prev = sel.value;
  sel.replaceChildren();
  const fallback = displays.find((d) => d.id === defaultDisplayId) ?? displays.find((d) => d.isPrimary);
  const opt0 = document.createElement('option');
  opt0.value = '';
  opt0.textContent = fallback ? `Default — ${fallback.name}` : 'Default (Admin → Monitors)';
  sel.appendChild(opt0);
  for (const d of displays) {
    const o = document.createElement('option');
    // Value is the display *id* — the window manager matches on id, never name.
    o.value = d.id;
    o.textContent = d.isPrimary ? `${d.name} (primary)` : d.name;
    sel.appendChild(o);
  }
  // An uncommitted choice outranks the live value; otherwise show what the
  // active instance is actually on.
  const wanted = urlDisplayPending ? prev : urlPage.displayTarget ?? prev;
  sel.value = wanted && displays.some((d) => d.id === wanted) ? wanted : '';
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
      const r = await api('/api/action', {
        action_id: 'load_url_preset',
        params: { preset: p.id, display: selectedUrlDisplay() },
      });
      if (r.ok) urlDisplayPending = false;
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
    const r = await api('/api/url', { url, display: selectedUrlDisplay() });
    if (r.ok) urlDisplayPending = false;
    $('url-msg').textContent = r.ok ? '' : r.error ?? 'Failed';
  });
  $('url-display').addEventListener('change', async () => {
    // Retarget a URL that's already on air; otherwise the choice just rides
    // along with the next Open or preset take.
    if (urlPage.currentMode !== 'url' || !urlPage.currentUrl) {
      urlDisplayPending = true;
      return;
    }
    const display = selectedUrlDisplay();
    const r = await api('/api/action', { action_id: 'set_display', params: { display: display || null } });
    urlDisplayPending = !r.ok;
    $('url-msg').textContent = r.ok ? '' : r.error ?? 'Failed';
  });
  $('url-display-refresh').addEventListener('click', () => {
    haptic();
    void refreshUrlDisplays();
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
      // sessionMode is required by POST /api/presets — omitting it made every
      // add from this page fail with 400 INVALID_MODE.
      body: JSON.stringify({ name, url, sessionMode: 'persistent' }),
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
wireStillsPage();
wirePackagesPage();
wireUrlsPage();
wireTimerPage();
wireOutputCards();
wireQrAndTunnel();
void refreshStillsData();
void refreshPackages();
void refreshUrlPresets();
void refreshUrlDisplays();
connectWs();
