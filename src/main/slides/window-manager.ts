import { app, BrowserWindow, screen, session } from 'electron';
import type { StateStore } from '../state';
import type { ABInstance } from '../../shared/types';

interface SlidesWindowConfig {
  store: StateStore;
  getDisplayPreference?: () => string | null;
}

const NOTES_POLL_MS = 1000;
const THUMBNAIL_REFRESH_MS = 5000;
const CACHE_WARM_DELAY_MS = 30_000;

/** Normalize speaker-notes text (ported from GSC): fix line breaks, strip U+FFFD corruption. */
export function normalizeSpeakerNotes(text: unknown): string {
  if (text == null || typeof text !== 'string') return '';
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\u2028/g, '\n')
    .replace(/\u2029/g, '\n')
    .replace(/\uFFFD+/g, '\n')
    .replace(/\u0000/g, '');
}

/** Runs inside the Google presenter-notes popup; returns slide position, title, notes. */
const PRESENTER_DOM_PROBE = `
(function () {
  var result = {};
  var el = document.querySelector('[aria-posinset]');
  if (el) {
    var cur = parseInt(el.getAttribute('aria-posinset'), 10);
    var tot = parseInt(el.getAttribute('aria-setsize'), 10);
    if (!isNaN(cur)) result.current = cur;
    if (!isNaN(tot)) result.total = tot;
  }
  var titleEl = document.querySelector('title');
  if (titleEl) {
    var m = (titleEl.textContent || '').match(/Presenter view - (.+?) - Google Slides/);
    result.title = m ? m[1] : (titleEl.textContent || '');
  }
  var notesEl = document.querySelector('div.punch-viewer-speakernotes-text-body-scrollable');
  result.notes = notesEl ? (notesEl.innerText || notesEl.textContent || '').trim() : '';
  var nextImg = document.querySelector('[aria-label*="Next"] img');
  result.nextThumb = nextImg && nextImg.src && nextImg.src.indexOf('data:') !== 0 ? nextImg.src : null;
  return result;
})()`;

export function createSlidesWindowManager(config: SlidesWindowConfig) {
  const { store, getDisplayPreference } = config;
  let windowA: BrowserWindow | null = null;
  let windowB: BrowserWindow | null = null;
  let notesWindow: BrowserWindow | null = null;
  let unsubscribe: (() => void) | null = null;
  let notesPollTimer: ReturnType<typeof setInterval> | null = null;
  let thumbTimer: ReturnType<typeof setInterval> | null = null;
  let cacheWarmTimer: ReturnType<typeof setTimeout> | null = null;
  /** Last slide index confirmed from the presenter DOM — used to tell API intent from echo. */
  let domSlideIndex: number | null = null;
  let notesFontSizePx = 16;

  function getTargetDisplay(): Electron.Display {
    const pref = getDisplayPreference?.() ?? null;
    if (pref) {
      const found = screen.getAllDisplays().find((d) => String(d.id) === pref);
      if (found) return found;
    }
    return screen.getPrimaryDisplay();
  }

  function createSlidesWindow(): BrowserWindow {
    const display = getTargetDisplay();
    const win = new BrowserWindow({
      x: display.bounds.x,
      y: display.bounds.y,
      width: display.bounds.width,
      height: display.bounds.height,
      fullscreen: false,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false, // Needed for Google Slides JS interactions
        // Persist Google auth cookies across app restarts so sign-in survives relaunches.
        session: session.fromPartition('persist:google-slides'),
      },
      backgroundColor: '#000000',
      frame: false,
      show: false,
      // Windows are shown explicitly via showInstance(); do not auto-show on ready-to-show
    });
    return win;
  }

  function getSlidesUrl(deckId: string, slideNumber?: number): string {
    let url = `https://docs.google.com/presentation/d/${deckId}/present`;
    if (typeof slideNumber === 'number' && slideNumber > 0) {
      url += `#slide=id.p${slideNumber}`;
    }
    return url;
  }

  function activeWindow(): BrowserWindow | null {
    const active = store.getState().abState.activeInstance;
    return active === 'A' ? windowA : windowB;
  }

  function sendKey(win: BrowserWindow, keyCode: string): void {
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode });
  }

  /**
   * Open Google's own presenter-notes popup by sending the 'S' shortcut to the
   * present window (GSC technique). The popup is our capture source for notes,
   * slide position, and deck title; it stays hidden — operators read notes in
   * the web GUI.
   */
  function openNotesCaptureWindow(win: BrowserWindow): void {
    if (notesWindow && !notesWindow.isDestroyed()) return;
    const onCreated = (_e: unknown, newWin: BrowserWindow): void => {
      if (newWin === windowA || newWin === windowB) return;
      app.removeListener('browser-window-created', onCreated);
      notesWindow = newWin;
      newWin.hide();
      newWin.on('closed', () => {
        notesWindow = null;
        const s = store.getState();
        if (s.slides) store.setState({ slides: { ...s.slides, notesOpen: false } });
      });
      const s = store.getState();
      if (s.slides) store.setState({ slides: { ...s.slides, notesOpen: true } });
    };
    app.on('browser-window-created', onCreated);
    // Give up listening if Google never opens the popup (e.g. not signed in).
    setTimeout(() => app.removeListener('browser-window-created', onCreated), 5000);
    win.focus();
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'S' });
    win.webContents.sendInputEvent({ type: 'char', keyCode: 's' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'S' });
  }

  /** Poll the presenter DOM and sync actuals (slide pos, total, title, notes) into state. */
  async function pollPresenterDom(): Promise<void> {
    if (!notesWindow || notesWindow.isDestroyed()) return;
    let info: { current?: number; total?: number; title?: string; notes?: string; nextThumb?: string | null };
    try {
      info = await notesWindow.webContents.executeJavaScript(PRESENTER_DOM_PROBE);
    } catch {
      return;
    }
    const s = store.getState();
    if (!s.slides || !info) return;

    const patch: Partial<typeof s.slides> = {};
    if (typeof info.current === 'number' && info.current >= 1) {
      domSlideIndex = info.current - 1;
      if (s.slides.slideIndex !== domSlideIndex) patch.slideIndex = domSlideIndex;
    }
    if (typeof info.total === 'number' && info.total >= 1 && s.slides.slideCount !== info.total) {
      patch.slideCount = info.total;
    }
    if (info.title && s.slides.deckTitle !== info.title) {
      patch.deckTitle = info.title;
    }
    const notes = normalizeSpeakerNotes(info.notes);
    if (notes !== s.slides.notes) {
      patch.notes = notes;
    }
    if (info.nextThumb !== undefined && info.nextThumb !== s.slides.thumbnailNext) {
      patch.thumbnailNext = info.nextThumb;
    }
    if (Object.keys(patch).length > 0) {
      store.setState({ slides: { ...s.slides, ...patch } });
    }
  }

  /** Capture the live present window as the current-slide thumbnail (data URL). */
  async function captureCurrentThumbnail(): Promise<void> {
    const win = activeWindow();
    const s = store.getState();
    if (!win || win.isDestroyed() || !s.slides || s.slides.isLoading) return;
    try {
      const image = await win.webContents.capturePage();
      // 1280 wide: high enough for /render/slides as an OBS source, small enough to broadcast.
      const resized = image.resize({ width: 1280 });
      const dataUrl = resized.toDataURL();
      const latest = store.getState();
      if (latest.slides && latest.slides.thumbnailCurrent !== dataUrl) {
        store.setState({ slides: { ...latest.slides, thumbnailCurrent: dataUrl } });
      }
    } catch {
      /* capture is best-effort */
    }
  }

  async function loadDeck(deckId: string, instance: ABInstance): Promise<void> {
    const win = instance === 'A' ? windowA : windowB;
    if (!win || win.isDestroyed()) return;

    await win.loadURL(getSlidesUrl(deckId));
    domSlideIndex = 0;

    const state = store.getState();
    if (state.slides && state.slides.deckId === deckId) {
      store.setState({
        slides: { ...state.slides, isLoading: false },
      });
      if (instance === state.abState.activeInstance) {
        win.show();
        if (process.platform === 'darwin') win.setSimpleFullScreen(true);
        openNotesCaptureWindow(win);
        scheduleCacheWarm();
      }
    }
  }

  async function loadBackupDeck(deckId: string): Promise<void> {
    const state = store.getState();
    const backupInstance: ABInstance = state.abState.activeInstance === 'A' ? 'B' : 'A';
    const win = backupInstance === 'A' ? windowA : windowB;
    if (!win || win.isDestroyed()) return;
    await win.loadURL(getSlidesUrl(deckId));
    const latest = store.getState();
    if (latest.slides && latest.slides.backupDeckId === deckId) {
      store.setState({ slides: { ...latest.slides, backupLoaded: true } });
    }
  }

  function scheduleCacheWarm(): void {
    if (cacheWarmTimer) clearTimeout(cacheWarmTimer);
    const s = store.getState();
    if (!s.slides?.offlineMode) return;
    cacheWarmTimer = setTimeout(() => {
      const latest = store.getState();
      if (latest.slides?.offlineMode) {
        store.setState({ slides: { ...latest.slides, cacheWarmed: true } });
      }
    }, CACHE_WARM_DELAY_MS);
  }

  /** Drive the present window to match a state-initiated slide change. */
  function navigateToSlide(slideIndex: number): void {
    const win = activeWindow();
    const s = store.getState();
    if (!win || win.isDestroyed() || !s.slides) return;
    const from = domSlideIndex ?? s.slides.slideIndex;
    if (slideIndex === from + 1) {
      sendKey(win, 'Right');
    } else if (slideIndex === from - 1) {
      sendKey(win, 'Left');
    } else {
      // Jump: present mode follows location.hash without a reload.
      void win.webContents.executeJavaScript(`window.location.hash = 'slide=id.p${slideIndex + 1}'`).catch(() => {});
    }
    domSlideIndex = slideIndex;
    void captureCurrentThumbnail();
  }

  function showInstance(instance: ABInstance): void {
    const toShow = instance === 'A' ? windowA : windowB;
    const toHide = instance === 'A' ? windowB : windowA;
    if (toHide && !toHide.isDestroyed()) toHide.hide();
    if (toShow && !toShow.isDestroyed()) {
      toShow.show();
      if (process.platform === 'darwin') toShow.setSimpleFullScreen(true);
    }
  }

  function closeAll(): void {
    if (notesWindow && !notesWindow.isDestroyed()) {
      notesWindow.removeAllListeners('closed');
      notesWindow.close();
    }
    notesWindow = null;
    for (const win of [windowA, windowB]) {
      if (win && !win.isDestroyed()) {
        void win.loadURL('about:blank');
        win.hide();
      }
    }
    domSlideIndex = null;
  }

  function initialize(): void {
    windowA = createSlidesWindow();
    windowB = createSlidesWindow();

    unsubscribe = store.subscribe((patch) => {
      if (patch.slides === null) {
        closeAll();
        return;
      }
      // Trigger deck load whenever isLoading is set to true (covers both /load and /reload)
      if (patch.slides?.isLoading && patch.slides.deckId) {
        void loadDeck(patch.slides.deckId, store.getState().abState.activeInstance);
        if (patch.slides.backupDeckId) {
          void loadBackupDeck(patch.slides.backupDeckId);
        }
      }
      // State-initiated navigation (API/Companion/web GUI) vs presenter-DOM echo
      if (
        patch.slides?.slideIndex !== undefined &&
        patch.slides.slideIndex !== domSlideIndex &&
        !patch.slides.isLoading
      ) {
        navigateToSlide(patch.slides.slideIndex);
      }
      if (patch.abState?.activeInstance) {
        showInstance(patch.abState.activeInstance);
      }
      if (patch.slides?.offlineMode) {
        scheduleCacheWarm();
      }
    });

    notesPollTimer = setInterval(() => void pollPresenterDom(), NOTES_POLL_MS);
    thumbTimer = setInterval(() => void captureCurrentThumbnail(), THUMBNAIL_REFRESH_MS);
  }

  async function getGoogleAuthState(): Promise<{ loggedIn: boolean; email: string | null }> {
    const googleSession = session.fromPartition('persist:google-slides');
    const cookies = await googleSession.cookies.get({ domain: '.google.com' });
    const loggedIn = cookies.some(
      (c) => c.name === 'SID' || c.name === 'SSID' || c.name === 'SAPISID'
    );
    return { loggedIn, email: null };
  }

  function openGoogleAuthWindow(): void {
    const win = new BrowserWindow({
      width: 920,
      height: 720,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        session: session.fromPartition('persist:google-slides'),
      },
      title: 'Sign in to Google',
    });
    win.loadURL('https://accounts.google.com/');
    win.once('ready-to-show', () => win.show());
  }

  function destroy(): void {
    unsubscribe?.();
    unsubscribe = null;
    if (notesPollTimer) clearInterval(notesPollTimer);
    if (thumbTimer) clearInterval(thumbTimer);
    if (cacheWarmTimer) clearTimeout(cacheWarmTimer);
    notesWindow?.destroy();
    windowA?.destroy();
    windowB?.destroy();
    notesWindow = null;
    windowA = null;
    windowB = null;
  }

  /** Bounds of the presenter-notes popup when open (stagetimer overlay targets its display). */
  function getNotesWindowBounds(): { x: number; y: number; width: number; height: number } | null {
    if (!notesWindow || notesWindow.isDestroyed()) return null;
    return notesWindow.getBounds();
  }

  function getActiveWindow(): BrowserWindow | null {
    const state = store.getState();
    const activeInstance = state.abState.activeInstance;
    const win = activeInstance === 'A' ? windowA : windowB;
    return win && !win.isDestroyed() ? win : null;
  }

  function getNotesWin(): BrowserWindow | null {
    return notesWindow && !notesWindow.isDestroyed() ? notesWindow : null;
  }

  function scrollNotesUp(): void {
    const win = getNotesWin();
    if (!win) return;
    void win.webContents.executeJavaScript(
      `(function(){var el=document.querySelector('div.punch-viewer-speakernotes-text-body-scrollable');if(el)el.scrollTop=Math.max(0,el.scrollTop-80);})()`
    ).catch(() => {});
  }

  function scrollNotesDown(): void {
    const win = getNotesWin();
    if (!win) return;
    void win.webContents.executeJavaScript(
      `(function(){var el=document.querySelector('div.punch-viewer-speakernotes-text-body-scrollable');if(el)el.scrollTop+=80;})()`
    ).catch(() => {});
  }

  function zoomInNotes(): void {
    const win = getNotesWin();
    if (!win) return;
    notesFontSizePx += 2;
    const px = notesFontSizePx;
    void win.webContents.executeJavaScript(
      `(function(){var el=document.querySelector('div.punch-viewer-speakernotes-text-body-scrollable');if(el)el.style.fontSize='${px}px';})()`
    ).catch(() => {});
  }

  function zoomOutNotes(): void {
    const win = getNotesWin();
    if (!win) return;
    notesFontSizePx = Math.max(12, notesFontSizePx - 2);
    const px = notesFontSizePx;
    void win.webContents.executeJavaScript(
      `(function(){var el=document.querySelector('div.punch-viewer-speakernotes-text-body-scrollable');if(el)el.style.fontSize='${px}px';})()`
    ).catch(() => {});
  }

  return {
    initialize, loadDeck, navigateToSlide, showInstance,
    getNotesWindowBounds, destroy, openGoogleAuthWindow, getGoogleAuthState,
    getSpeakerNotes, getActiveWindow,
    scrollNotesUp, scrollNotesDown, zoomInNotes, zoomOutNotes,
  };
}

export type SlidesWindowManager = ReturnType<typeof createSlidesWindowManager>;
