import { spawn, type ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';
import type { StateStore } from '../state';

/** Parse the quick-tunnel URL out of cloudflared's log output (ported from GSC). */
export function extractTrycloudflareUrl(chunk: unknown): string | null {
  const text = String(chunk ?? '');
  const strict = /https:\/\/[a-z0-9-]+\.trycloudflare\.com\b/;
  const loose = /https:\/\/[^\s"'<>]+\.trycloudflare\.com\b/i;
  const m = text.match(strict) ?? text.match(loose);
  return m ? m[0] : null;
}

/**
 * Locate the cloudflared binary: explicit env override, bundled resources
 * (GSC layout), then PATH.
 */
export function resolveCloudflaredBinary(resourcesPath: string | null): string {
  const envPath = process.env.PCONAIR_CLOUDFLARED_PATH;
  if (envPath && fs.existsSync(envPath)) return envPath;
  if (resourcesPath) {
    const arch = process.arch === 'arm64' ? 'arm64' : 'amd64';
    const candidates =
      process.platform === 'win32'
        ? [path.join(resourcesPath, 'cloudflared', 'cloudflared-windows-amd64.exe')]
        : process.platform === 'darwin'
          ? [path.join(resourcesPath, 'cloudflared', `cloudflared-darwin-${arch}`)]
          : [path.join(resourcesPath, 'cloudflared', `cloudflared-linux-${arch}`)];
    for (const c of candidates) {
      if (fs.existsSync(c)) return c;
    }
  }
  return 'cloudflared'; // hope it's on PATH
}

export interface TunnelManagerDeps {
  store: StateStore;
  /** Local origin to expose, e.g. http://127.0.0.1:8080 */
  getLocalOrigin: () => string;
  /** Electron resourcesPath (null in tests). */
  resourcesPath: string | null;
}

export interface TunnelStartOptions {
  /** Token-based named tunnel (custom domain). */
  token?: string | null;
  /** Public domain to report as the URL when using a token. */
  domain?: string | null;
}

export function createTunnelManager(deps: TunnelManagerDeps) {
  const { store, getLocalOrigin, resourcesPath } = deps;
  let proc: ChildProcess | null = null;
  let stopping = false;

  function patchTunnel(patch: Partial<ReturnType<StateStore['getState']>['tunnel']>): void {
    const s = store.getState();
    store.setState({ tunnel: { ...s.tunnel, ...patch } });
  }

  function start(opts: TunnelStartOptions = {}): void {
    if (proc) return;
    const bin = resolveCloudflaredBinary(resourcesPath);
    const origin = getLocalOrigin();

    const args = opts.token
      ? ['tunnel', 'run', '--token', opts.token]
      : ['tunnel', '--url', origin];
    if (!opts.token && origin.startsWith('https://')) {
      args.push('--no-tls-verify');
    }

    patchTunnel({ enabled: true, status: 'starting', url: opts.token ? (opts.domain ? `https://${opts.domain.replace(/^https?:\/\//, '')}` : null) : null, lastError: null });

    try {
      proc = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      proc = null;
      patchTunnel({ status: 'error', lastError: (err as Error).message });
      return;
    }

    const onData = (data: unknown): void => {
      const s = store.getState();
      if (opts.token) {
        // Token tunnels report registered connections; treat first output after spawn as active.
        if (s.tunnel.status === 'starting' && /Registered tunnel connection|INF/.test(String(data))) {
          patchTunnel({ status: 'active' });
        }
        return;
      }
      const found = extractTrycloudflareUrl(data);
      if (found && s.tunnel.url !== found) {
        patchTunnel({ status: 'active', url: found });
      }
    };

    proc.stdout?.on('data', onData);
    proc.stderr?.on('data', onData);

    proc.on('error', (err) => {
      proc = null;
      patchTunnel({
        status: 'error',
        url: null,
        lastError: err.message.includes('ENOENT')
          ? 'cloudflared binary not found (set PCONAIR_CLOUDFLARED_PATH or install cloudflared)'
          : err.message,
      });
    });

    proc.on('exit', (code) => {
      proc = null;
      if (stopping) {
        stopping = false;
        patchTunnel({ enabled: false, status: 'inactive', url: null });
      } else {
        patchTunnel({ status: 'error', url: null, lastError: `cloudflared exited with code ${code}` });
      }
    });
  }

  function stop(): void {
    if (!proc) {
      patchTunnel({ enabled: false, status: 'inactive', url: null, lastError: null });
      return;
    }
    stopping = true;
    proc.kill('SIGTERM');
    const p = proc;
    setTimeout(() => {
      if (p && !p.killed) {
        try {
          p.kill('SIGKILL');
        } catch {
          /* already gone */
        }
      }
    }, 5000);
  }

  function isRunning(): boolean {
    return proc !== null;
  }

  return { start, stop, isRunning };
}

export type TunnelManager = ReturnType<typeof createTunnelManager>;
