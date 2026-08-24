import { BrowserWindow, screen, session } from 'electron';
import type { StateStore } from '../state';
import type { ABInstance } from '../../shared/types';
import { scheduleFullscreenChrome } from '../fullscreen-chrome';
import { hideCursorOnLoad } from '../output-cursor';

interface UrlWindowConfig {
  store: StateStore;
  /**
   * Profile-wide default display from Admin -> Monitors. URL windows used to
   * ignore it entirely and always open on the primary display, so the setting
   * every other output honours silently did nothing here.
   */
  getDisplayPreference?: () => string | null;
}

export function createUrlWindowManager(config: UrlWindowConfig) {
  const { store, getDisplayPreference } = config;
  let windowA: BrowserWindow | null = null;
  let windowB: BrowserWindow | null = null;
  let unsubscribe: (() => void) | null = null;

  function getTargetDisplay(displayId: string | null): Electron.Display {
    // The instance's own target wins; the profile preference from
    // Admin -> Monitors is the fallback, primary the last resort.
    const pref = displayId ?? getDisplayPreference?.() ?? null;
    if (pref) {
      const found = screen.getAllDisplays().find((d) => String(d.id) === pref);
      if (found) return found;
      console.warn(`[url-window-manager] display "${pref}" not found in Electron screen list`);
    }
    return screen.getPrimaryDisplay();
  }

  /** Move an already-open window when the target changes mid-show. */
  function applyDisplayTarget(win: BrowserWindow | null, displayId: string | null): void {
    if (!win || win.isDestroyed()) return;
    const b = getTargetDisplay(displayId).bounds;
    const cur = win.getBounds();
    if (cur.x === b.x && cur.y === b.y && cur.width === b.width && cur.height === b.height) return;
    win.setBounds({ x: b.x, y: b.y, width: b.width, height: b.height });
    scheduleFullscreenChrome(win);
  }

  function createUrlWindow(instance: ABInstance): BrowserWindow {
    const display = getTargetDisplay(null);
    const sess = session.fromPartition(`persist:pconair-url-${instance}`);
    const win = new BrowserWindow({
      x: display.bounds.x,
      y: display.bounds.y,
      width: display.bounds.width,
      height: display.bounds.height,
      fullscreen: false,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        session: sess,
      },
      backgroundColor: '#000000',
      frame: false,
      show: false,
    });
    hideCursorOnLoad(win);
    return win;
  }

  async function loadUrl(url: string, instance: ABInstance): Promise<void> {
    const win = instance === 'A' ? windowA : windowB;
    if (!win || win.isDestroyed()) return;
    const instKey = instance === 'A' ? 'instanceA' : 'instanceB';
    try {
      await win.loadURL(url);
      const state = store.getState();
      if (state.abState[instKey].url === url) {
        store.setState({
          abState: { ...state.abState, [instKey]: { ...state.abState[instKey], isLoading: false, isReady: true } },
        });
      }
    } catch (err) {
      console.error(`[url-window-manager] loadURL failed for instance ${instance}:`, err);
      const state = store.getState();
      store.setState({
        abState: { ...state.abState, [instKey]: { ...state.abState[instKey], isLoading: false, isReady: false } },
      });
    }
  }

  function showInstance(instance: ABInstance): void {
    const toShow = instance === 'A' ? windowA : windowB;
    const toHide = instance === 'A' ? windowB : windowA;
    if (toHide && !toHide.isDestroyed()) toHide.hide();
    if (toShow && !toShow.isDestroyed()) {
      toShow.show();
      scheduleFullscreenChrome(toShow);
    }
  }

  function initialize(): void {
    windowA = createUrlWindow('A');
    windowB = createUrlWindow('B');

    unsubscribe = store.subscribe((patch) => {
      // Drive all URL loads through isLoading on each instance — avoids double-load
      // when currentUrl and abState.instanceX.isLoading are both set in the same patch.
      if (patch.abState) {
        const { instanceA, instanceB, activeInstance } = store.getState().abState;
        if (patch.abState.instanceA?.isLoading && instanceA.url) {
          void loadUrl(instanceA.url, 'A');
        }
        if (patch.abState.instanceB?.isLoading && instanceB.url) {
          void loadUrl(instanceB.url, 'B');
        }
        // Only switch visibility when in url mode to avoid clobbering slides windows
        if (patch.abState.activeInstance && store.getState().currentMode === 'url') {
          showInstance(activeInstance);
        }
        // Move windows when displayTarget changes
        if (patch.abState.instanceA?.displayTarget !== undefined) {
          applyDisplayTarget(windowA, store.getState().abState.instanceA.displayTarget);
        }
        if (patch.abState.instanceB?.displayTarget !== undefined) {
          applyDisplayTarget(windowB, store.getState().abState.instanceB.displayTarget);
        }
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

  function getActiveWindow(): BrowserWindow | null {
    const state = store.getState();
    const activeInstance = state.abState.activeInstance;
    const win = activeInstance === 'A' ? windowA : windowB;
    return win && !win.isDestroyed() ? win : null;
  }

  return { initialize, loadUrl, showInstance, getActiveWindow, destroy };
}

export type UrlWindowManager = ReturnType<typeof createUrlWindowManager>;
