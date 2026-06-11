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
      } else if (msg.type === 'state_patch' && msg.payload) {
        if ('slides' in msg.payload) {
          renderSlides((msg.payload.slides as SlidesSlice | null) ?? null);
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

renderNav();
showPage(currentPageId());
window.addEventListener('hashchange', () => showPage(currentPageId()));
wireSlidesPage();
connectWs();
