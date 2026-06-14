import net from 'net';
import { createPerfectCueParser } from './perfectcue-parser';
import { getPerfectCueAdapterPreset, normalizeAdapterId } from './perfectcue-adapter-presets';
import type { PerfectCuePortConfig } from '../app-settings';

/**
 * TCP listener for PerfectCue network extenders (DSAN and WaveShare families).
 * Ported from Google-Slides-Controller/src/perfectcue-server.js.
 *
 * One net.Server is opened per configured port; they all start and stop
 * together. Each accepted socket:
 *   - is dropped immediately if the client IP is not allowlisted;
 *   - is kept open even when its port is disabled (a dispatch gate suppresses
 *     commands instead, so hardware never sees a disconnect);
 *   - receives adapter-specific keep-alive pings (0xFF) and is destroyed on
 *     idle timeout so the converter reconnects;
 *   - feeds incoming bytes through a per-port debouncing parser, dispatching
 *     'next-slide' / 'previous-slide' on recognised cues.
 */

export interface PerfectCueServerSettings {
  perfectcueEnabled: boolean;
  perfectcuePorts: PerfectCuePortConfig[];
}

export interface PerfectCueServerDeps {
  /** Read the current PerfectCue settings (global enable + port configs). */
  getSettings: () => PerfectCueServerSettings;
  /** Dispatch a slide action. Mirrors the GSC-compat verbs. */
  dispatch: (action: 'next-slide' | 'previous-slide') => void;
  /** True if the remote IP may send commands. Unlisted IPs are dropped. */
  isAllowed?: (remoteIp: string | undefined) => boolean;
  /** Optional structured logger. */
  log?: (msg: string) => void;
}

export interface PerfectCueServer {
  /** Open one TCP listener per configured port. Idempotent restart. */
  start: () => void;
  /** Close all listeners and active sockets. */
  stop: () => void;
  /** True if any listener is currently open. */
  isRunning: () => boolean;
}

interface RunningPort {
  server: net.Server;
  config: PerfectCuePortConfig;
  sockets: Set<net.Socket>;
}

export function createPerfectCueServer(deps: PerfectCueServerDeps): PerfectCueServer {
  const log = deps.log ?? (() => {});
  const isAllowed = deps.isAllowed ?? (() => true);

  let running: RunningPort[] = [];

  function gateAllows(portId: string): boolean {
    const s = deps.getSettings();
    if (s.perfectcueEnabled !== true) return false;
    const cfg = s.perfectcuePorts.find((p) => p.id === portId);
    // Port stays open when disabled; this gate suppresses its dispatches.
    return cfg ? cfg.enabled !== false : false;
  }

  function listenOne(config: PerfectCuePortConfig): RunningPort {
    const adapterId = normalizeAdapterId(config.adapterType);
    const { pingIntervalMs, idleTimeoutMs } = getPerfectCueAdapterPreset(adapterId);
    const sockets = new Set<net.Socket>();

    const server = net.createServer((socket) => {
      const remoteIp = socket.remoteAddress;
      if (!isAllowed(remoteIp)) {
        log(`port ${config.port}: connection from ${remoteIp} rejected (not allowlisted)`);
        socket.destroy();
        return;
      }
      sockets.add(socket);
      log(`port ${config.port}: client connected (${adapterId}) from ${remoteIp}`);

      // OS-default probe timing; short initial delays upset some DSAN links after idle.
      socket.setKeepAlive(true, 0);

      // 0xFF on an adapter-specific interval keeps the converter's idle timer at bay.
      const pingTimer = setInterval(() => {
        if (!socket.destroyed) socket.write(Buffer.from([0xff]));
      }, pingIntervalMs);

      // No data for idleTimeoutMs ⇒ dead link; destroy so the converter reconnects.
      socket.setTimeout(idleTimeoutMs);
      socket.on('timeout', () => {
        log(`port ${config.port}: idle timeout — closing socket to force reconnect`);
        socket.destroy();
      });

      const parser = createPerfectCueParser();

      socket.on('data', (chunk: Buffer) => {
        for (const byte of chunk) {
          const cmd = parser.parseByte(byte);
          if (cmd !== 'next' && cmd !== 'prev') continue; // null / keepalive ignored
          if (!gateAllows(config.id)) {
            log(`port ${config.port}: ${cmd} suppressed (port or global disabled)`);
            continue;
          }
          deps.dispatch(cmd === 'next' ? 'next-slide' : 'previous-slide');
        }
      });

      const cleanup = () => {
        clearInterval(pingTimer);
        sockets.delete(socket);
      };
      socket.on('close', () => {
        cleanup();
        log(`port ${config.port}: disconnected (${adapterId}), waiting for reconnect`);
      });
      socket.on('error', (err) => {
        cleanup();
        log(`port ${config.port}: socket error: ${err.message}`);
      });
    });

    server.on('error', (err) => {
      log(`port ${config.port}: listen error: ${err.message}`);
    });
    server.listen(config.port, () => {
      log(`port ${config.port}: listening (${adapterId})`);
    });

    return { server, config, sockets };
  }

  function start(): void {
    stop();
    const { perfectcuePorts } = deps.getSettings();
    running = perfectcuePorts.filter((p) => p.port > 0).map((p) => listenOne(p));
  }

  function stop(): void {
    for (const r of running) {
      for (const s of r.sockets) s.destroy();
      r.sockets.clear();
      r.server.close();
    }
    running = [];
  }

  return {
    start,
    stop,
    isRunning: () => running.length > 0,
  };
}
