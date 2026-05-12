import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';
import { mountRoutes } from './routes/index';
import type { StateStore } from './state';
import type { AuthManager } from './auth';
import type { WsServerMessage } from '../shared/types';

export interface ServerDeps {
  store: StateStore;
  auth: AuthManager;
  port?: number;
}

export function createServer(deps: ServerDeps) {
  const { store, auth, port = 8080 } = deps;

  const app = express();
  app.use(express.json());

  // Security headers on all responses
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  mountRoutes(app, store, auth);

  const httpServer = http.createServer(app);
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  function broadcast(msg: WsServerMessage): void {
    const data = JSON.stringify(msg);
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    });
  }

  // Broadcast state patches to all WebSocket clients
  store.subscribe((patch) => {
    broadcast({ type: 'state_patch', payload: patch });
  });

  wss.on('connection', (ws) => {
    // Send full state on connect
    ws.send(JSON.stringify({ type: 'state', payload: store.getState() } satisfies WsServerMessage));

    // Update client count
    store.setState({
      connectionStatus: {
        ...store.getState().connectionStatus,
        webSocketClients: wss.clients.size,
      },
    });

    ws.on('close', () => {
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
      // Close all active WebSocket connections first so httpServer.close() doesn't hang
      wss.clients.forEach((client) => client.terminate());
      wss.close(() => {
        httpServer.close((err) => (err ? reject(err) : resolve()));
      });
    });
  }

  return { app, httpServer, wss, listen, close };
}
