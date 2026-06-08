import { BrowserWindow, screen, session } from 'electron';
import type { StateStore } from '../state';
import type { ABInstance } from '../../shared/types';

interface UrlWindowConfig {
  store: StateStore;
}

function applyDisplayTarget(win: BrowserWindow | null, displayId: string | null): void {
  if (!win || win.isDestroyed()) return;
  const target = displayId
    ? screen.getAllDisplays().find((d) => String(d.id) === displayId)
    : screen.getPrimaryDisplay();
  if (!target) {
    console.warn(`[window-manager] applyDisplayTarget: display "${displayId}" not found in Electron screen list`);
    return;
  }
  win.setBounds({
    x: target.bounds.x,
    y: target.bounds.y,
    width: target.bounds.width,
    height: target.bounds.height,
  });
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
    if (toShow && !toShow.isDestroyed()) toShow.show();
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
