import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';
import { mountRoutes, type RouteServices } from './routes/index';
import type { StateStore } from './state';
import type { AuthManager } from './auth';
import type { PresetsStore } from './presets';
import type { L3CueStore } from './l3/cue-store';
import type { L3PlaylistStore } from './l3/playlist-store';
import type { MediaLibraryStore } from './media-library/item-store';
import type { ActionDispatcher } from './action-dispatch';
import type { WsServerMessage } from '../shared/types';

import type { ProfilePaths } from './profiles/paths';

export interface ServerDeps {
  store: StateStore;
  auth: AuthManager;
  presets: PresetsStore;
  l3Cues: L3CueStore;
  l3Playlists: L3PlaylistStore;
  mediaLibrary: MediaLibraryStore;
  dispatchAction: ActionDispatcher;
  port?: number;
  profilePaths: ProfilePaths;
  getActiveProfileId: () => string;
  onProfileActivate?: () => void;
}

export function createServer(deps: ServerDeps) {
  const {
    store,
    auth,
    presets,
    l3Cues,
    l3Playlists,
    mediaLibrary,
    dispatchAction,
    port = 8080,
    profilePaths,
    getActiveProfileId,
    onProfileActivate,
  } = deps;

  const routeServices: RouteServices = {
    store,
    auth,
    presets,
    l3Cues,
    l3Playlists,
    mediaLibrary,
    dispatchAction,
    profilePaths,
    getActiveProfileId,
    onProfileActivate,
  };

  const app = express();
  app.use(express.json());

  // Security headers on all responses
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  mountRoutes(app, routeServices);

  const httpServer = http.createServer(app);
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  const companionClients = new Set<WebSocket>();

  function setCompanionConnected(connected: boolean): void {
    store.setState({
      connectionStatus: {
        ...store.getState().connectionStatus,
        companionConnected: connected,
      },
    });
  }

  function broadcast(msg: WsServerMessage): void {
    const data = JSON.stringify(msg);
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    });
  }

  store.subscribe((patch) => {
    broadcast({ type: 'state_patch', payload: patch });
  });

  wss.on('connection', (ws, req) => {
    let isCompanion = false;
    try {
      const u = new URL(req.url || '/', 'http://localhost');
      isCompanion = u.searchParams.get('companion') === '1';
    } catch {
      /* ignore */
    }
    if (isCompanion) {
      companionClients.add(ws);
      setCompanionConnected(companionClients.size > 0);
    }

    ws.send(JSON.stringify({ type: 'state', payload: store.getState() } satisfies WsServerMessage));

    store.setState({
      connectionStatus: {
        ...store.getState().connectionStatus,
        webSocketClients: wss.clients.size,
      },
    });

    ws.on('message', async (raw) => {
      try {
        const msg = JSON.parse(String(raw)) as {
          type?: string;
          action_id?: string;
          params?: Record<string, unknown>;
          pin?: string;
        };
        if (msg.type !== 'action' || !msg.action_id) return;

        const pin = typeof msg.pin === 'string' ? msg.pin : undefined;
        let authed = false;
        if (pin) authed = await auth.verifyOperatorPin(pin);
        if (!authed) {
          ws.send(JSON.stringify({ type: 'error', payload: { code: 'AUTH_REQUIRED', message: 'PIN required for actions' } }));
          return;
        }
        const r = await dispatchAction(msg.action_id, msg.params ?? {});
        if (!r.ok) {
          ws.send(JSON.stringify({ type: 'error', payload: r.error }));
          return;
        }
        ws.send(JSON.stringify({ type: 'action_result', payload: r.body }));
      } catch {
        ws.send(JSON.stringify({ type: 'error', payload: { code: 'INVALID_MODE', message: 'Invalid message' } }));
      }
    });

    ws.on('close', () => {
      if (isCompanion) {
        companionClients.delete(ws);
        setCompanionConnected(companionClients.size > 0);
      }
      store.setState({
        connectionStatus: {
          ...store.getState().connectionStatus,
          webSocketClients: wss.clients.size,
        },
      });
    });
  });

  function listen(): Promise<void> {
    return new Promise((resolve) => {
      httpServer.listen(port, resolve);
    });
  }

  function close(): Promise<void> {
    return new Promise((resolve, reject) => {
      wss.clients.forEach((client) => client.terminate());
      wss.close(() => {
        httpServer.close((err) => (err ? reject(err) : resolve()));
      });
    });
  }

  return { app, httpServer, wss, listen, close };
}
