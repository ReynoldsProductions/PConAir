import { BrowserWindow, screen } from 'electron';
import type { StateStore } from '../state';
import type { ABInstance } from '../../shared/types';

interface SlidesWindowConfig {
  store: StateStore;
  getDisplayPreference?: () => string | null;
}

export function createSlidesWindowManager(config: SlidesWindowConfig) {
  const { store, getDisplayPreference } = config;
  let windowA: BrowserWindow | null = null;
  let windowB: BrowserWindow | null = null;
  let unsubscribe: (() => void) | null = null;

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
      },
      backgroundColor: '#000000',
      frame: false,
      show: false,
      // Windows are shown explicitly via showInstance(); do not auto-show on ready-to-show
    });
    return win;
  }

  function getSlidesUrl(deckId: string): string {
    return `https://docs.google.com/presentation/d/${deckId}/present`;
  }

  async function loadDeck(deckId: string, instance: ABInstance): Promise<void> {
    const win = instance === 'A' ? windowA : windowB;
    if (!win || win.isDestroyed()) return;

    const url = getSlidesUrl(deckId);
    await win.loadURL(url);

    const state = store.getState();
    if (state.slides && state.slides.deckId === deckId) {
      store.setState({
        slides: { ...state.slides, isLoading: false },
      });
    }
  }

  async function navigateToSlide(slideIndex: number): Promise<void> {
    const state = store.getState();
    const activeInstance = state.abState.activeInstance;
    const win = activeInstance === 'A' ? windowA : windowB;
    if (!win || win.isDestroyed() || !state.slides) return;

    // Inject navigation via Google Slides keyboard shortcut simulation
    // slideIndex is 0-based; Google Slides uses 1-based slide numbers in the DOM
    await win.webContents.executeJavaScript(
      `document.querySelector('[aria-label="Slide ${slideIndex + 1} of ${state.slides.slideCount}"]')?.click()`
    );
  }

  function showInstance(instance: ABInstance): void {
    const toShow = instance === 'A' ? windowA : windowB;
    const toHide = instance === 'A' ? windowB : windowA;
    if (toHide && !toHide.isDestroyed()) toHide.hide();
    if (toShow && !toShow.isDestroyed()) toShow.show();
  }

  function initialize(): void {
    windowA = createSlidesWindow();
    windowB = createSlidesWindow();

    unsubscribe = store.subscribe((patch) => {
      // Trigger deck load whenever isLoading is set to true (covers both /load and /reload)
      if (patch.slides?.isLoading && patch.slides.deckId) {
        void loadDeck(patch.slides.deckId, store.getState().abState.activeInstance);
      }
      if (patch.abState?.activeInstance) {
        showInstance(patch.abState.activeInstance);
      }
    });
  }

  function destroy(): void {
    unsubscribe?.();
    unsubscribe = null;
    windowA?.destroy();
    windowB?.destroy();
    windowA = null;
    windowB = null;
  }

  async function getSpeakerNotes(): Promise<string | null> {
    const state = store.getState();
    if (state.currentMode !== 'slides') return null;
    const activeInstance = state.abState.activeInstance;
    const win = activeInstance === 'A' ? windowA : windowB;
    if (!win || win.isDestroyed()) return null;
    try {
      const notes = await win.webContents.executeJavaScript(`
        (() => {
          const el = document.querySelector('.punch-viewer-speakernotes-text') ||
                     document.querySelector('[data-font-loaded] .punch-viewer-speakernotes') ||
                     document.querySelector('.IZ65Hb-YPqjbf');
          return el ? el.innerText.trim() : null;
        })()
      `, true);
      return typeof notes === 'string' ? notes : null;
    } catch {
      return null;
    }
  }

  function getActiveWindow(): BrowserWindow | null {
    const state = store.getState();
    const activeInstance = state.abState.activeInstance;
    const win = activeInstance === 'A' ? windowA : windowB;
    return win && !win.isDestroyed() ? win : null;
  }

  return { initialize, loadDeck, navigateToSlide, showInstance, getSpeakerNotes, getActiveWindow, destroy };
}

export type SlidesWindowManager = ReturnType<typeof createSlidesWindowManager>;
