/**
 * Electron-specific wiring for the watchdog (spec 09 §6.2, §6.3, §6.5).
 *
 * This module is NOT unit-tested because it depends on Electron IPC and
 * BrowserWindow lifecycle events.  Pure logic lives in watchdog.ts.
 */

import { ipcMain } from 'electron';
import type { BrowserWindow } from 'electron';
import type { StateStore } from './state';
import type { WatchdogState } from '../shared/types';
import {
  createWatchdogState as _createState,
  checkUnresponsiveness,
  computeMemoryPressure,
  shouldWarnAboutMemory,
} from './watchdog';

// IPC channel names
export const PING_CHANNEL = 'watchdog:ping';
export const PONG_CHANNEL = 'watchdog:pong';

// Config (mirrors Appendix A defaults)
const PING_INTERVAL_MS = 2_000;
const PONG_TIMEOUT_MS = 5_000;
const ESCALATION_THRESHOLD_MS = 15_000;
const MEM_CHECK_INTERVAL_MS = 10_000;
const MEM_WARN_THROTTLE_MS = 60_000;
const RENDERER_RESTART_DELAY_MS = 1_000;

export interface WatchdogElectronOpts {
  store: StateStore;
  /** Returns the currently on-air program-output window (URL or Slides). */
  getProgramWindow: () => BrowserWindow | null;
  /** Recreates the program-output window and loads from last known state. */
  recreateProgramWindow: () => void;
}

export function startWatchdog(opts: WatchdogElectronOpts): () => void {
  const { store, getProgramWindow, recreateProgramWindow } = opts;
  const ws = _createState();

  // -------------------------------------------------------------------------
  // §6.2  Ping / pong
  // -------------------------------------------------------------------------
  let pingTimestamp = 0;

  // Initialise lastPongAt so the first timeout window starts from now.
  ws.lastPongAt = Date.now();

  ipcMain.on(PONG_CHANNEL, (_event, msg: { type: string; timestamp: number }) => {
    if (msg?.type === 'pong') {
      ws.lastPongAt = Date.now();
    }
  });

  const pingIntervalId = setInterval(() => {
    const win = getProgramWindow();
    if (!win || win.isDestroyed()) return;
    pingTimestamp = Date.now();
    try {
      win.webContents.send(PING_CHANNEL, { type: 'ping', timestamp: pingTimestamp });
    } catch {
      // Window may be navigating; ignore.
    }

    // Check responsiveness after sending
    const now = Date.now();
    const { unresponsive, secondsUnresponsive } = checkUnresponsiveness(
      ws.lastPongAt,
      now,
      PONG_TIMEOUT_MS
    );

    if (unresponsive) {
      const secs = secondsUnresponsive >= 0 ? secondsUnresponsive : PONG_TIMEOUT_MS / 1000;
      if (secs >= ESCALATION_THRESHOLD_MS / 1000) {
        console.warn(
          `[WARN] Program output not responding for ${secs}s — force reload strongly recommended`
        );
      } else {
        console.warn(`[WARN] Program output unresponsive for ${secs}s — renderer may be frozen`);
      }
    }

    patchWatchdog({
      programUnresponsive: unresponsive,
      programUnresponsiveSecs: unresponsive
        ? secondsUnresponsive >= 0
          ? secondsUnresponsive
          : Math.floor(PONG_TIMEOUT_MS / 1000)
        : 0,
    });
  }, PING_INTERVAL_MS);

  // -------------------------------------------------------------------------
  // §6.3  Memory pressure
  // -------------------------------------------------------------------------
  const memIntervalId = setInterval(() => {
    const mem = process.memoryUsage();
    const result = computeMemoryPressure(mem);

    if (result.pressure && shouldWarnAboutMemory(ws.lastMemWarnAt, Date.now(), MEM_WARN_THROTTLE_MS)) {
      ws.lastMemWarnAt = Date.now();
      console.warn(
        `[WARN] Memory pressure: heap at ${result.pct}% (${result.usedGb} GB / ${result.totalGb} GB)`
      );
    }

    patchWatchdog({
      memoryPressure: result.pressure,
      memoryPressurePct: result.pct,
      memoryHeapUsedGb: result.usedGb,
      memoryHeapTotalGb: result.totalGb,
    });
  }, MEM_CHECK_INTERVAL_MS);

  // -------------------------------------------------------------------------
  // §6.5  Auto-recovery for renderer crash
  // -------------------------------------------------------------------------
  function watchWindow(win: BrowserWindow): void {
    win.webContents.on('crashed' as Parameters<typeof win.webContents.on>[0], () => {
      console.error('[ERROR] Program output crashed — restarting renderer with last known state');
      patchWatchdog({ lastRendererCrashAt: new Date().toISOString() });
      setTimeout(() => {
        recreateProgramWindow();
      }, RENDERER_RESTART_DELAY_MS);
    });

    win.webContents.on('unresponsive' as Parameters<typeof win.webContents.on>[0], () => {
      console.warn('[WARN] Program output renderer unresponsive (OS-level)');
      patchWatchdog({ programUnresponsive: true });
    });

    win.webContents.on('responsive' as Parameters<typeof win.webContents.on>[0], () => {
      patchWatchdog({ programUnresponsive: false, programUnresponsiveSecs: 0 });
      ws.lastPongAt = Date.now();
    });

    win.on('closed', () => {
      // Unexpected close (not triggered by our code) — attempt restart.
      const current = getProgramWindow();
      if (!current || current.isDestroyed()) {
        console.error('[ERROR] Program output window closed unexpectedly — restarting renderer with last known state');
        patchWatchdog({ lastRendererCrashAt: new Date().toISOString() });
        setTimeout(() => {
          recreateProgramWindow();
        }, RENDERER_RESTART_DELAY_MS);
      }
    });
  }

  // Watch whatever window is current, and any future window passed in.
  const initial = getProgramWindow();
  if (initial && !initial.isDestroyed()) watchWindow(initial);

  // -------------------------------------------------------------------------
  // Helper to patch only the watchdog slice
  // -------------------------------------------------------------------------
  function patchWatchdog(partial: Partial<WatchdogState>): void {
    const current = store.getState().watchdog;
    store.setState({ watchdog: { ...current, ...partial } });
  }

  // Return a teardown function so tests / hot-reload can clean up.
  return function stopWatchdog() {
    clearInterval(pingIntervalId);
    clearInterval(memIntervalId);
    ipcMain.removeAllListeners(PONG_CHANNEL);
  };
}

// Export so callers can attach the watcher to a freshly-created window.
export { watchWindow_ as attachWindowWatcher };

// Internal alias used by recreate flow (not exported in normal usage, but handy).
function watchWindow_(win: BrowserWindow, store: StateStore, recreate: () => void): void {
  win.webContents.on('crashed' as Parameters<typeof win.webContents.on>[0], () => {
    console.error('[ERROR] Program output crashed — restarting renderer with last known state');
    const current = store.getState().watchdog;
    store.setState({ watchdog: { ...current, lastRendererCrashAt: new Date().toISOString() } });
    setTimeout(recreate, RENDERER_RESTART_DELAY_MS);
  });
}
