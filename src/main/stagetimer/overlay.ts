import { BrowserWindow, screen } from 'electron';
import type { StageTimerOverlayPosition } from '../../shared/types';
import { buildOverlayHtml, getOverlayBounds } from './overlay-content';

export interface StageTimerOverlayConfig {
  /** Room id + API key from app settings (read fresh on every show). */
  getCredentials: () => { roomId: string | null; apiKey: string | null };
  /**
   * Bounds of the speaker-notes window when one is open; the overlay goes on
   * whichever display contains it. Falls back to the primary display.
   */
  getNotesWindowBounds?: () => { x: number; y: number; width: number; height: number } | null;
}

/**
 * Always-on-top stagetimer.io overlay floating over a corner of the notes
 * display (ported from GSC). One window at most; show() repositions an
 * existing one instead of recreating it.
 */
export function createStageTimerOverlay(config: StageTimerOverlayConfig) {
  let overlayWindow: BrowserWindow | null = null;

  function targetDisplayBounds(): { x: number; y: number; width: number; height: number } {
    const notesBounds = config.getNotesWindowBounds?.() ?? null;
    const display = notesBounds ? screen.getDisplayMatching(notesBounds) : screen.getPrimaryDisplay();
    return display.bounds;
  }

  function show(position: StageTimerOverlayPosition, sizePercent: number): void {
    const bounds = getOverlayBounds(targetDisplayBounds(), position, sizePercent);

    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.setBounds(bounds);
      overlayWindow.show();
      return;
    }

    overlayWindow = new BrowserWindow({
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      focusable: false,
      resizable: false,
      webPreferences: { nodeIntegration: false, contextIsolation: true },
    });
    const { roomId, apiKey } = config.getCredentials();
    const html = buildOverlayHtml(roomId ?? '', apiKey ?? '');
    void overlayWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    overlayWindow.on('closed', () => {
      overlayWindow = null;
    });
  }

  function hide(): void {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.close();
    }
    overlayWindow = null;
  }

  /** Re-position/resize a visible overlay; no-op when hidden. */
  function updateSettings(position: StageTimerOverlayPosition, sizePercent: number): void {
    if (!overlayWindow || overlayWindow.isDestroyed()) return;
    overlayWindow.setBounds(getOverlayBounds(targetDisplayBounds(), position, sizePercent));
  }

  function destroy(): void {
    overlayWindow?.destroy();
    overlayWindow = null;
  }

  return { show, hide, updateSettings, destroy };
}

export type StageTimerOverlay = ReturnType<typeof createStageTimerOverlay>;
