import { createClientStore } from './state';
import type { AppState, WsServerMessage } from '../../shared/types';
import * as api from './api';

const store = createClientStore();

/** Ignore checkbox `change` while syncing from server state. */
let l3StackingUiLock = false;

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

async function refreshL3CueSelect(): Promise<void> {
  const { cues } = await api.l3ListCues();
  const sel = document.getElementById('l3-cue-select') as HTMLSelectElement;
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

async function refreshActiveProfile(): Promise<void> {
  try {
    const p = await api.fetchActiveProfile();
    const el = document.getElementById('active-profile');
    if (el) el.textContent = `Profile: ${p.name}`;
  } catch {
    const el = document.getElementById('active-profile');
    if (el) el.textContent = '';
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
  document.getElementById('ws-dot')!.classList.toggle('connected', connected);
  document.getElementById('ws-label')!.textContent = connected ? 'Connected' : 'Disconnected';
}

function renderState(state: AppState): void {
  const badge = document.getElementById('mode-badge')!;
  badge.textContent = state.currentMode.toUpperCase();
  badge.className = `mode-badge ${state.currentMode}`;

  const lockBadge = document.getElementById('show-lock-badge');
  if (lockBadge) {
    lockBadge.classList.toggle('visible', state.connectionStatus.adminShowLocked);
  }

  const panicBanner = document.getElementById('panic-banner');
  const panicBtn = document.getElementById('panic-btn');
  if (panicBanner && panicBtn) {
    panicBanner.classList.toggle('visible', state.reliability.panicActive);
    panicBtn.textContent = state.reliability.panicActive ? 'UN-PANIC' : 'PANIC';
  }

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

  const l3Line = document.getElementById('l3-active-line')!;
  const l3s = state.l3;
  if (l3s?.activeCueName != null || l3s?.activeTitle != null) {
    const parts = [l3s.activeCueName, l3s.activeTitle].filter(
      (x): x is string => typeof x === 'string' && x.length > 0
    );
    l3Line.textContent = parts.length ? `Active: ${parts.join(' — ')}` : 'Active: —';
  } else {
    l3Line.textContent = 'Active: —';
  }

  const stackCb = document.getElementById('l3-stacking-checkbox') as HTMLInputElement;
  l3StackingUiLock = true;
  stackCb.checked = Boolean(l3s?.isStacking);
  l3StackingUiLock = false;

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

  document.getElementById('l3-cues-refresh-btn')!.addEventListener('click', async () => {
    try {
      await refreshL3CueSelect();
    } catch (e) {
      showError((e as Error).message);
    }
  });

  on('l3-take-btn', async () => {
    const sel = document.getElementById('l3-cue-select') as HTMLSelectElement;
    if (sel.value) {
      await api.l3Take({ cueId: sel.value });
      return;
    }
    const name = (document.getElementById('l3-name-input') as HTMLInputElement).value.trim();
    const title = (document.getElementById('l3-title-input') as HTMLInputElement).value.trim();
    await api.l3Take({ name, title });
  });
  on('l3-clear-btn', () => api.l3Clear());

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

  on('panic-btn', () => api.panicAction('toggle'));

  document.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (e.key !== 'p' && e.key !== 'P') return;
    void api.panicAction('toggle').catch((err) => showError((err as Error).message));
  });

  (document.getElementById('l3-stacking-checkbox') as HTMLInputElement).addEventListener(
    'change',
    async () => {
      if (l3StackingUiLock) return;
      const cb = document.getElementById('l3-stacking-checkbox') as HTMLInputElement;
      try {
        await api.l3Stacking(cb.checked);
      } catch (e) {
        showError((e as Error).message);
        l3StackingUiLock = true;
        cb.checked = !cb.checked;
        l3StackingUiLock = false;
      }
    }
  );

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
void refreshL3CueSelect().catch(() => { /* no session yet */ });
void refreshMediaSelect().catch(() => { /* no session yet */ });
void refreshActiveProfile().catch(() => { /* public endpoint */ });
setInterval(() => {
  void refreshActiveProfile().catch(() => {});
}, 60000);
connectWs();
