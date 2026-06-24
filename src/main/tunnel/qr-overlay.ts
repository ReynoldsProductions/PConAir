import { BrowserWindow, screen } from 'electron';
import QRCode from 'qrcode';

let qrWindow: BrowserWindow | null = null;
let hideTimer: ReturnType<typeof setTimeout> | null = null;

/** Centered always-on-top QR overlay on the primary display (ported from GSC). */
export async function showQrOverlay(url: string, durationMs: number): Promise<void> {
  hideQrOverlay();

  const display = screen.getPrimaryDisplay();
  const b = display.bounds;
  const QR_PX = 280;
  const PAD = 20;
  const W = QR_PX + PAD * 2;
  const H = QR_PX + PAD * 2;

  qrWindow = new BrowserWindow({
    x: b.x + Math.floor((b.width - W) / 2),
    y: b.y + Math.floor((b.height - H) / 2),
    width: W,
    height: H,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    focusable: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });

  const qrDataUrl = await QRCode.toDataURL(url, { width: QR_PX, margin: 1 });
  const html = `<!DOCTYPE html><html><body style="margin:0;background:rgba(0,0,0,0.82);border-radius:12px;display:flex;align-items:center;justify-content:center;box-sizing:border-box;width:100%;height:100vh;">
    <img src="${qrDataUrl}" alt="" style="width:${QR_PX}px;height:${QR_PX}px;border-radius:8px;display:block;" />
  </body></html>`;

  void qrWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  qrWindow.on('closed', () => {
    qrWindow = null;
  });

  hideTimer = setTimeout(hideQrOverlay, durationMs);
}

export function hideQrOverlay(): void {
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
  if (qrWindow && !qrWindow.isDestroyed()) {
    qrWindow.close();
  }
  qrWindow = null;
}
