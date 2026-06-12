import type { StageTimerOverlayPosition } from '../../shared/types';

/**
 * Electron-free stagetimer overlay pieces, ported from GSC main.js
 * (feature/stagetimer-overlay-notes-monitor): corner-bounds math and the
 * overlay page HTML. The Electron window itself lives in ./overlay.ts.
 */

export interface DisplayBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Overlay rectangle for a corner of the notes display, sized as a percent of it. */
export function getOverlayBounds(
  display: DisplayBounds,
  position: StageTimerOverlayPosition,
  sizePercent: number
): DisplayBounds {
  const width = Math.round((display.width * sizePercent) / 100);
  const height = Math.round((display.height * sizePercent) / 100);
  const margin = sizePercent === 100 ? 0 : 12;
  const positions: Record<StageTimerOverlayPosition, { x: number; y: number }> = {
    'bottom-left': { x: display.x + margin, y: display.y + display.height - height - margin },
    'bottom-right': { x: display.x + display.width - width - margin, y: display.y + display.height - height - margin },
    'top-left': { x: display.x + margin, y: display.y + margin },
    'top-right': { x: display.x + display.width - width - margin, y: display.y + margin },
  };
  const { x, y } = positions[position] ?? positions['bottom-left'];
  return { x, y, width, height };
}

/**
 * Self-contained overlay page: connects to the stagetimer.io socket API and
 * renders the running timer. Loaded as a data: URL by the Electron window, so
 * room id and API key are interpolated here and never leave the machine.
 */
export function buildOverlayHtml(roomId: string, apiKey: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      background: transparent;
      overflow: hidden;
      width: 100vw;
      height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: 'Courier New', 'Lucida Console', monospace;
    }

    #clock {
      background: rgba(0, 0, 0, 0.75);
      border-radius: 8px;
      width: 100%;
      height: 100%;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 2%;
      padding: 4%;
    }

    #time {
      font-size: 22vw;
      font-weight: bold;
      line-height: 1;
      color: #ffffff;
      letter-spacing: -0.02em;
      transition: color 0.3s ease;
      text-align: center;
      width: 100%;
    }

    #label {
      font-size: 4.5vw;
      color: rgba(255,255,255,0.65);
      text-align: center;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      width: 100%;
      line-height: 1.2;
    }

    #status-dot {
      width: 2vw;
      height: 2vw;
      min-width: 6px;
      min-height: 6px;
      max-width: 14px;
      max-height: 14px;
      border-radius: 50%;
      background: rgba(255,255,255,0.3);
      transition: background 0.3s ease;
    }

    /* State colors */
    .state-running  #time { color: #4ade80; }
    .state-warning  #time { color: #facc15; }
    .state-critical #time { color: #f87171; }
    .state-overtime #time { color: #ef4444; }
    .state-error    #time { color: rgba(255,255,255,0.35); }

    .state-running  #status-dot { background: #4ade80; }
    .state-warning  #status-dot { background: #facc15; }
    .state-critical #status-dot { background: #f87171; }
    .state-overtime #status-dot { background: #ef4444; }
  </style>
</head>
<body>
  <div id="clock">
    <div id="time">--:--</div>
    <div id="label">Connecting…</div>
    <div id="status-dot"></div>
  </div>

  <script src="https://cdn.socket.io/4.7.5/socket.io.min.js"></script>
  <script>
    const roomId = ${JSON.stringify(roomId)};
    const apiKey = ${JSON.stringify(apiKey)};

    const clockEl = document.getElementById('clock');
    const timeEl  = document.getElementById('time');
    const labelEl = document.getElementById('label');

    let state = null;
    let currentTimer = null;
    let tickInterval = null;

    function setState(cls, timeStr, lbl) {
      clockEl.className = cls ? 'state-' + cls : '';
      timeEl.textContent  = timeStr;
      labelEl.textContent = lbl;
    }

    function formatMs(ms) {
      const neg = ms < 0;
      const abs = Math.abs(ms);
      const s = Math.floor(abs / 1000);
      const m = Math.floor(s / 60);
      const h = Math.floor(m / 60);
      const ss = String(s % 60).padStart(2, '0');
      const mm = String(m % 60).padStart(2, '0');
      const prefix = neg ? '-' : '';
      if (h > 0) return prefix + h + ':' + mm + ':' + ss;
      return prefix + mm + ':' + ss;
    }

    function tick() {
      if (!state) return;

      const { running, start, finish, pause, serverTime, lastSyncTime } = state;

      if (!running) {
        if (pause && finish) {
          const remainMs = new Date(finish).getTime() - new Date(pause).getTime();
          const lbl = currentTimer ? (currentTimer.name || 'Paused') : 'Paused';
          setState('', formatMs(remainMs), lbl);
        }
        return;
      }

      const elapsed = Date.now() - lastSyncTime;
      const serverNow = serverTime + elapsed;
      const finishMs  = finish ? new Date(finish).getTime() : null;
      const startMs   = start  ? new Date(start).getTime()  : null;

      let remainMs = finishMs ? (finishMs - serverNow) : null;
      const lbl = currentTimer ? (currentTimer.name || 'Running') : 'Running';

      if (remainMs === null) {
        if (startMs) {
          const elapsedSec = Math.floor((serverNow - startMs) / 1000);
          setState('running', formatMs(elapsedSec * 1000), lbl);
        }
        return;
      }

      let cls;
      if (remainMs < 0)           cls = 'overtime';
      else if (remainMs < 60000)  cls = 'critical';
      else if (remainMs < 300000) cls = 'warning';
      else                        cls = 'running';

      setState(cls, formatMs(remainMs), lbl);
    }

    function startTick() {
      if (!tickInterval) tickInterval = setInterval(tick, 500);
    }

    function stopTick() {
      if (tickInterval) { clearInterval(tickInterval); tickInterval = null; }
    }

    if (!roomId || !apiKey) {
      setState('error', '--:--', 'Not configured');
    } else {
      setState('', '--:--', 'Connecting…');

      const socket = io('https://api.stagetimer.io', {
        path: '/v1/socket.io',
        auth: { room_id: roomId, api_key: apiKey },
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000
      });

      socket.on('connect', () => {
        setState('', '--:--', 'Connected');
        startTick();
      });

      socket.on('connect_error', () => {
        stopTick();
        setState('error', '--:--', 'Connection error');
      });

      socket.on('disconnect', () => {
        stopTick();
        setState('error', '--:--', 'Disconnected');
      });

      socket.on('playback_status', (data) => {
        if (!data || data._model !== 'playback_status') return;
        const serverNow = data.server_time || (data._updated_at ? new Date(data._updated_at).getTime() : Date.now());
        state = {
          running: data.running || false,
          start:   data.start,
          finish:  data.finish,
          pause:   data.pause,
          serverTime: serverNow,
          lastSyncTime: Date.now()
        };
        if (state.running) startTick(); else stopTick();
        tick();
      });

      socket.on('current_timer', (data) => {
        if (!data || data._model !== 'timer') return;
        currentTimer = { name: data.name || '', speaker: data.speaker || '' };
        tick();
      });
    }
  </script>
</body>
</html>`;
}
