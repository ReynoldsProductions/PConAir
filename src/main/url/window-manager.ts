import { BrowserWindow, screen, session } from 'electron';
import type { StateStore } from '../state';
import type { ABInstance } from '../../shared/types';

interface UrlWindowConfig {
  store: StateStore;
}

export function createUrlWindowManager(config: UrlWindowConfig) {
  const { store } = config;
  let windowA: BrowserWindow | null = null;
  let windowB: BrowserWindow | null = null;
  let unsubscribe: (() => void) | null = null;

  function createUrlWindow(instance: ABInstance): BrowserWindow {
    const display = screen.getPrimaryDisplay();
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
    return win;
  }

  async function loadUrl(url: string, instance: ABInstance): Promise<void> {
    const win = instance === 'A' ? windowA : windowB;
    if (!win || win.isDestroyed()) return;
    await win.loadURL(url);
    const state = store.getState();
    const instKey = instance === 'A' ? 'instanceA' : 'instanceB';
    if (state.abState[instKey].url === url) {
      store.setState({
        abState: {
          ...state.abState,
          [instKey]: { ...state.abState[instKey], isLoading: false, isReady: true },
        },
      });
    }
  }

  function showInstance(instance: ABInstance): void {
    const toShow = instance === 'A' ? windowA : windowB;
    const toHide = instance === 'A' ? windowB : windowA;
    if (toHide && !toHide.isDestroyed()) toHide.hide();
    if (toShow && !toShow.isDestroyed()) toShow.show();
  }

  function initialize(): void {
    windowA = createUrlWindow('A');
    windowB = createUrlWindow('B');

    unsubscribe = store.subscribe((patch) => {
      const state = store.getState();
      // Load URL when currentUrl changes and we're in url mode
      if (patch.currentUrl && state.currentMode === 'url') {
        const active = state.abState.activeInstance;
        void loadUrl(patch.currentUrl, active);
      }
      // Handle per-instance reload: isLoading flips to true on an instance that has a URL
      if (patch.abState) {
        const fullState = store.getState();
        const { instanceA, instanceB } = patch.abState;
        if (instanceA?.isLoading && fullState.abState.instanceA.url) {
          void loadUrl(fullState.abState.instanceA.url, 'A');
        }
        if (instanceB?.isLoading && fullState.abState.instanceB.url) {
          void loadUrl(fullState.abState.instanceB.url, 'B');
        }
        if (patch.abState.activeInstance) {
          showInstance(patch.abState.activeInstance);
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

  return { initialize, loadUrl, showInstance, destroy };
}

export type UrlWindowManager = ReturnType<typeof createUrlWindowManager>;
