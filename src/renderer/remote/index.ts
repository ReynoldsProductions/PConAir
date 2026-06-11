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
connectWs();
