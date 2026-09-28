// Regression: Admin -> System must report the port the server is actually
// listening on.
//
// It used to compute `location.port || '8080'`, so every install running on
// port 80 — where `location.port` is the empty string — was told "Current
// port: 8080". The same number is offered as the default for backup machine
// IPs. It is a display-only bug, but a load-bearing one: it sent a real
// debugging session after the wrong port while the actual fault was a graphics
// page dialling 8080 (see tests/graphics-ws-url.test.ts).
//
// `/api/server-info` reports the live listening port, which is the only
// trustworthy source: PCONAIR_PORT can override app-settings at startup, so
// the configured port and the bound port disagree.
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { JSDOM, VirtualConsole } from 'jsdom';

const INDEX_HTML_PATH = path.resolve(__dirname, '../src/renderer/admin/index.html');

interface StubResponse {
  status: number;
  ok: boolean;
  text(): Promise<string>;
}

function jsonResponse(body: unknown): StubResponse {
  return { status: 200, ok: true, text: () => Promise.resolve(JSON.stringify(body)) };
}

function errorResponse(): StubResponse {
  return {
    status: 500,
    ok: false,
    text: () => Promise.resolve(JSON.stringify({ error: { message: 'unavailable' } })),
  };
}

/**
 * Boot the admin page at `url`, render the System section, and return the
 * rendered text. `serverInfoPort: null` simulates /api/server-info failing.
 */
async function systemSectionText(opts: {
  url: string;
  serverInfoPort: number | null;
  appSettingsPort: number;
}): Promise<string> {
  const html = fs.readFileSync(INDEX_HTML_PATH, 'utf8');

  const routes: Record<string, unknown> = {
    '/api/status': { abState: {} },
    '/api/displays': { displays: [] },
    '/api/profiles/active': { id: 'profile-1' },
    '/api/profiles/profile-1': { appPreferences: {} },
    '/api/app-settings': {
      port: opts.appSettingsPort,
      operationMode: 'standalone',
      backupIps: [],
      launchAtLogin: false,
    },
  };
  if (opts.serverInfoPort !== null) {
    routes['/api/server-info'] = { port: opts.serverInfoPort, networkAddresses: [] };
  }

  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    url: opts.url,
    // The page's own boot (dashboard render, WS connect) is not the subject and
    // logs into this console; keep the run readable.
    virtualConsole: new VirtualConsole(),
    beforeParse(window) {
      (window as unknown as Record<string, unknown>).WebSocket = class {
        close(): void {}
        addEventListener(): void {}
      };
      (window as unknown as Record<string, unknown>).fetch = (reqPath: string) =>
        Promise.resolve(
          Object.prototype.hasOwnProperty.call(routes, reqPath)
            ? jsonResponse(routes[reqPath])
            : errorResponse()
        );
    },
  });

  const win = dom.window as unknown as Record<string, unknown> & {
    document: Document;
    renderSystem: () => Promise<void>;
  };

  await win.renderSystem();
  return win.document.getElementById('content')?.textContent ?? '';
}

describe('Admin -> System reported port', () => {
  it('reports 80, not 8080, when the server listens on the default HTTP port', async () => {
    const text = await systemSectionText({
      url: 'http://localhost/admin/',
      serverInfoPort: 80,
      appSettingsPort: 80,
    });
    expect(text).toMatch(/Current port:\s*80\b/);
    expect(text).not.toMatch(/Current port:\s*8080\b/);
  });

  it('prefers the live listening port over the configured one', async () => {
    // PCONAIR_PORT=80 against an app-settings.json still saying 8080.
    const text = await systemSectionText({
      url: 'http://localhost/admin/',
      serverInfoPort: 80,
      appSettingsPort: 8080,
    });
    expect(text).toMatch(/Current port:\s*80\b/);
    expect(text).not.toMatch(/Current port:\s*8080\b/);
  });

  it('falls back to the scheme default, not 8080, when server-info is unavailable', async () => {
    const text = await systemSectionText({
      url: 'http://localhost/admin/',
      serverInfoPort: null,
      appSettingsPort: 8080,
    });
    expect(text).toMatch(/Current port:\s*80\b/);
    expect(text).not.toMatch(/Current port:\s*8080\b/);
  });

  it('still reports an explicit non-default port', async () => {
    const text = await systemSectionText({
      url: 'http://10.0.24.139:8080/admin/',
      serverInfoPort: 8080,
      appSettingsPort: 8080,
    });
    expect(text).toMatch(/Current port:\s*8080\b/);
  });
});
