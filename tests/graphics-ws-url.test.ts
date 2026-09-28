// Regression: the two WS-driven built-in graphics pages must derive their
// WebSocket URL from `location.host` (which carries the port only when it is
// non-default) and take the scheme from `location.protocol`.
//
// They used to build it as `location.hostname + ':' + (location.port || '8080')`
// with a hardcoded `ws://`. On a server listening on port 80, `location.port`
// is the empty string, so the fallback fired and the page dialled
// `ws://<host>:8080/ws?graphics=1` — nothing listening, a silent 2s-backoff
// reconnect loop, and an output stuck on its black backdrop indefinitely with
// no on-screen hint why. The same expression broke every TLS deployment (the
// Cloudflare tunnel) by hardcoding `ws://`.
//
// This asserts the URL the page actually dials rather than grepping the source
// for the old spelling. Each case builds its own JSDOM because the thing under
// test *is* the page URL, and `new JSDOM(html, { url })` is the only way to
// control `location` — so this file runs in the default node environment
// rather than vitest's shared jsdom one.
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { JSDOM, VirtualConsole } from 'jsdom';

const PAGES = ['lower-third-live', 'scoreboard-basketball'] as const;

/** Every URL the page passes to `new WebSocket(...)` when served from `url`. */
function wsUrlsDialledFrom(pageId: string, url: string): string[] {
  const html = fs.readFileSync(
    path.resolve(__dirname, '..', 'graphics', pageId, 'index.html'),
    'utf8'
  );
  const dialled: string[] = [];

  // These pages reach for fonts and rAF on boot; their noise is not the
  // subject and would drown the run.
  const virtualConsole = new VirtualConsole();

  new JSDOM(html, {
    runScripts: 'dangerously',
    url,
    virtualConsole,
    // scoreboard-basketball drives its ticker off requestAnimationFrame at
    // boot, before the WS block; without this JSDOM has no rAF and the script
    // dies there, opening no socket at all.
    pretendToBeVisual: true,
    beforeParse(window) {
      (window as unknown as Record<string, unknown>).WebSocket = class {
        constructor(socketUrl: string) {
          dialled.push(socketUrl);
        }
        send(): void {}
        close(): void {}
        addEventListener(): void {}
      };
    },
  });

  return dialled;
}

describe.each(PAGES)('graphics/%s WebSocket URL', (pageId) => {
  const pageAt = (url: string) => {
    const dialled = wsUrlsDialledFrom(pageId, url);
    expect(dialled, `${pageId} opened no WebSocket when served from ${url}`).not.toHaveLength(0);
    return dialled[0];
  };

  it('omits the port when served from the default HTTP port', () => {
    expect(pageAt(`http://localhost/graphics/${pageId}/index.html`)).toBe(
      'ws://localhost/ws?graphics=1'
    );
  });

  it('keeps an explicit non-default port', () => {
    expect(pageAt(`http://10.0.24.139:8080/graphics/${pageId}/index.html`)).toBe(
      'ws://10.0.24.139:8080/ws?graphics=1'
    );
  });

  it('upgrades to wss:// when served over TLS (the tunnel)', () => {
    expect(pageAt(`https://show.example.com/graphics/${pageId}/index.html`)).toBe(
      'wss://show.example.com/ws?graphics=1'
    );
  });

  it('never hardcodes a port number', () => {
    expect(pageAt(`http://localhost/graphics/${pageId}/index.html`)).not.toMatch(/:\d+/);
  });
});
