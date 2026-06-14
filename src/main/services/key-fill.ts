import { BrowserWindow, screen, session } from 'electron';

/**
 * Key/Fill dual-output display mode (ported from GSC).
 *
 * - Fill window  — color content, fullscreen on the presentation display
 * - Key window   — same or different URL, fullscreen on the notes display
 *                  with `filter:grayscale(1)` CSS injected (luminance key
 *                  signal for downstream CG gear)
 *
 * Both windows use the dedicated `persist:keyfill` session partition,
 * isolated from the Google Slides and URL partitions.
 */

export const KEY_FILL_SESSION_PARTITION = 'persist:keyfill';
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const ALLOWED_URL_RE = /^https?:\/\/.+/;

/** Validate that a URL is http or https. Returns an error message or null if valid. */
export function validateKeyFillUrl(url: unknown): string | null {
  if (typeof url !== 'string' || !ALLOWED_URL_RE.test(url.trim())) {
    return 'URL must be a valid http or https URL';
  }
  return null;
}

/** Resolve a hex color, falling back to #000000 if invalid. */
function resolveHexColor(color: unknown, fallback = '#000000'): string {
  if (typeof color === 'string' && HEX_COLOR_RE.test(color.trim())) {
    return color.trim();
  }
  return fallback;
}

let keyFillFillWindow: BrowserWindow | null = null;
let keyFillKeyWindow: BrowserWindow | null = null;

function getKeyFillFillWindowOptions(
  bounds: Electron.Rectangle,
  backgroundColor: string
): Electron.BrowserWindowConstructorOptions {
  return {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    fullscreen: false,
    backgroundColor,
    frame: false,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      session: session.fromPartition(KEY_FILL_SESSION_PARTITION),
    },
  };
}

function getKeyFillKeyWindowOptions(
  bounds: Electron.Rectangle,
  backgroundColor: string
): Electron.BrowserWindowConstructorOptions {
  return {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    fullscreen: false,
    backgroundColor,
    frame: false,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      session: session.fromPartition(KEY_FILL_SESSION_PARTITION),
    },
  };
}

export interface KeyFillOpenOptions {
  fillUrl: string;
  keyUrl: string;
  fillBgColor?: string;
  keyBgColor?: string;
  /** Electron numeric display id for the fill (presentation) window. Falls back to primary. */
  presentationDisplayId?: number | string | null;
  /** Electron numeric display id for the key (notes) window. Falls back to primary. */
  notesDisplayId?: number | string | null;
}

export async function openKeyFillDisplays(opts: KeyFillOpenOptions): Promise<void> {
  const { fillUrl, keyUrl } = opts;
  const fillErr = validateKeyFillUrl(fillUrl);
  if (fillErr) throw new Error(`fillUrl: ${fillErr}`);
  const keyErr = validateKeyFillUrl(keyUrl);
  if (keyErr) throw new Error(`keyUrl: ${keyErr}`);

  const resolvedFillBg = resolveHexColor(opts.fillBgColor);
  const resolvedKeyBg = resolveHexColor(opts.keyBgColor);

  // Close any existing key/fill windows before opening new ones.
  try {
    for (const win of [keyFillFillWindow, keyFillKeyWindow]) {
      if (win && !win.isDestroyed()) {
        win.removeAllListeners('closed');
        win.close();
      }
    }
  } catch (e) {
    console.error('[KeyFill] Error closing existing windows:', (e as Error).message);
  }
  keyFillFillWindow = null;
  keyFillKeyWindow = null;

  const displays = screen.getAllDisplays();

  const presentationIdNum = opts.presentationDisplayId != null ? Number(opts.presentationDisplayId) : NaN;
  const notesIdNum = opts.notesDisplayId != null ? Number(opts.notesDisplayId) : NaN;

  const presentationDisplay =
    (!isNaN(presentationIdNum) && displays.find((d) => d.id === presentationIdNum)) || displays[0];
  const notesDisplay =
    (!isNaN(notesIdNum) && displays.find((d) => d.id === notesIdNum)) || displays[0];

  // Fill window — color content on the presentation (slides) display.
  keyFillFillWindow = new BrowserWindow(getKeyFillFillWindowOptions(presentationDisplay.bounds, resolvedFillBg));
  keyFillFillWindow.on('closed', () => {
    keyFillFillWindow = null;
  });
  keyFillFillWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'Escape' && input.type === 'keyDown') {
      event.preventDefault();
      closeKeyFillDisplays();
    }
  });
  console.log('[KeyFill] Loading fill URL:', fillUrl, 'bg:', resolvedFillBg);
  void keyFillFillWindow.loadURL(fillUrl);
  keyFillFillWindow.show();

  // Key window — grayscale luminance key on the notes display.
  keyFillKeyWindow = new BrowserWindow(getKeyFillKeyWindowOptions(notesDisplay.bounds, resolvedKeyBg));
  keyFillKeyWindow.on('closed', () => {
    keyFillKeyWindow = null;
  });
  keyFillKeyWindow.webContents.on('did-finish-load', () => {
    if (!keyFillKeyWindow || keyFillKeyWindow.isDestroyed()) return;
    void keyFillKeyWindow.webContents.insertCSS(
      `html,body,*{filter:grayscale(1)!important}html,body{background:${resolvedKeyBg}!important}`
    );
  });
  console.log('[KeyFill] Loading key URL:', keyUrl, 'bg:', resolvedKeyBg);
  void keyFillKeyWindow.loadURL(keyUrl);
  keyFillKeyWindow.show();
}

export function closeKeyFillDisplays(): void {
  try {
    if (keyFillFillWindow && !keyFillFillWindow.isDestroyed()) {
      keyFillFillWindow.removeAllListeners('closed');
      keyFillFillWindow.close();
    }
    if (keyFillKeyWindow && !keyFillKeyWindow.isDestroyed()) {
      keyFillKeyWindow.removeAllListeners('closed');
      keyFillKeyWindow.close();
    }
  } catch (e) {
    console.error('[KeyFill] Error closing windows:', (e as Error).message);
  }
  keyFillFillWindow = null;
  keyFillKeyWindow = null;
}
