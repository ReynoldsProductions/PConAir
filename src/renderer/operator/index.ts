import { createClientStore } from './state';
import type { AppState, WsServerMessage } from '../../shared/types';
import * as api from './api';

const store = createClientStore();

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
  document.getElementById('ws-dot')!.classList.toggle('connected', connected);
  document.getElementById('ws-label')!.textContent = connected ? 'Connected' : 'Disconnected';
}

function renderState(state: AppState): void {
  const badge = document.getElementById('mode-badge')!;
  badge.textContent = state.currentMode.toUpperCase();
  badge.className = `mode-badge ${state.currentMode}`;

  document.getElementById('companion-dot')!.classList.toggle(
    'connected', state.connectionStatus.companionConnected
  );

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

  const active = state.abState.activeInstance;
  document.getElementById('ab-a-btn')!.classList.toggle('active', active === 'A');
  document.getElementById('ab-b-btn')!.classList.toggle('active', active === 'B');

  document.getElementById('state-dump')!.textContent = JSON.stringify(state, null, 2);
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

  document.querySelectorAll<HTMLButtonElement>('.ab-btn').forEach((btn) =>
    btn.addEventListener('click', async () => {
      try { await api.switchAB(btn.dataset.instance as 'A' | 'B'); }
      catch (e) { showError((e as Error).message); }
    })
  );

  document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      try { await api.setMode(btn.dataset.mode!); }
      catch (e) { showError((e as Error).message); }
    })
  );
}

// ── Boot ──────────────────────────────────────────────────────────

store.subscribe(renderState);
bindEvents();
connectWs();
