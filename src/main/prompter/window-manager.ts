import { BrowserWindow, screen } from 'electron';
import { scheduleFullscreenChrome } from '../fullscreen-chrome';
import { hideCursorOnLoad } from '../output-cursor';

export interface PrompterWindowConfig {
  /** Port this app's own Express server is listening on. */
  getPort: () => number;
  /** Profile-wide default display from Admin → Monitors. */
  getDisplayPreference?: () => string | null;
}

/**
 * Drives a fullscreen prompter output window on a chosen monitor — the wired
 * confidence monitor or glass rig, as opposed to a tablet pointed at
 * `/prompter` over the LAN. It loads the very same page, so both surfaces
 * scroll in lockstep off the same state.
 */
export function createPrompterWindowManager(config: PrompterWindowConfig) {
  const { getPort, getDisplayPreference } = config;
  let win: BrowserWindow | null = null;
  let currentDisplayId: string | null = null;

  function targetDisplay(displayId: string | null): Electron.Display {
    const pref = displayId ?? getDisplayPreference?.() ?? null;
    if (pref) {
      const found = screen.getAllDisplays().find((d) => String(d.id) === pref);
      if (found) return found;
      console.warn(`[prompter-window] display "${pref}" not found in Electron screen list`);
    }
    return screen.getPrimaryDisplay();
  }

  function pageUrl(): string {
    return `http://127.0.0.1:${getPort()}/prompter/`;
  }

  function isOpen(): boolean {
    return win !== null && !win.isDestroyed();
  }

  async function open(displayId: string | null): Promise<void> {
    const bounds = targetDisplay(displayId).bounds;
    currentDisplayId = displayId;

    if (isOpen()) {
      win!.setBounds(bounds);
      scheduleFullscreenChrome(win);
      win!.show();
      return;
    }

    win = new BrowserWindow({
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      backgroundColor: '#000000',
      frame: false,
      show: false,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    hideCursorOnLoad(win);
    win.on('closed', () => {
      win = null;
    });

    try {
      await win.loadURL(pageUrl());
    } catch (err) {
      console.error('[prompter-window] failed to load the prompter page:', err);
      close();
      throw err;
    }
    if (!isOpen()) return;
    win.show();
    scheduleFullscreenChrome(win);
  }

  function close(): void {
    if (!isOpen()) return;
    win!.destroy();
    win = null;
  }

  function status(): { open: boolean; displayId: string | null } {
    return { open: isOpen(), displayId: currentDisplayId };
  }

  return { open, close, isOpen, status };
}

export type PrompterWindowManager = ReturnType<typeof createPrompterWindowManager>;
