// @vitest-environment jsdom
//
// Regression test for admin nav items whose render function does not exist.
//
// `renderSection()` dispatches each nav item's `data-section` to a
// `renderX()` function. When one of those functions is missing (PR #23's
// merge silently dropped `renderNetwork` and `renderAppearance`), clicking
// the nav item throws a ReferenceError inside the click handler: the nav
// highlight moves, the content pane keeps whatever the previous section
// left behind — usually its "Loading…" placeholder — and nothing in the UI
// says why. Unit-testing individual render functions can't catch that, so
// this test executes the real inline script and asserts every section the
// nav can reach actually has a handler.
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { JSDOM } from 'jsdom';

const INDEX_HTML_PATH = path.resolve(__dirname, '../src/renderer/admin/index.html');

function bootAdminPage(): { win: Window & typeof globalThis & Record<string, unknown> } {
  const html = fs.readFileSync(INDEX_HTML_PATH, 'utf8');
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    url: 'http://127.0.0.1:8080/admin/',
    beforeParse(window) {
      // The inline script opens a WebSocket and fetches on boot; neither is
      // this test's subject.
      (window as unknown as Record<string, unknown>).WebSocket = class {
        close(): void {}
        addEventListener(): void {}
      };
      (window as unknown as Record<string, unknown>).fetch = () =>
        new Promise(() => {}); // never settles — nothing here awaits a response
    },
  });
  return { win: dom.window as unknown as Window & typeof globalThis & Record<string, unknown> };
}

/** Section ids the sidebar can actually navigate to. */
function navSections(win: Window): string[] {
  return [...win.document.querySelectorAll<HTMLElement>('.nav-item')]
    .map((el) => el.dataset.section ?? '')
    .filter(Boolean);
}

/** `case 'network': renderNetwork(); break;` -> { network: 'renderNetwork' } */
function renderSectionHandlers(): Record<string, string> {
  const src = fs.readFileSync(INDEX_HTML_PATH, 'utf8');
  const body = /function renderSection\(\)\s*\{([\s\S]*?)\n\}/.exec(src)?.[1] ?? '';
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/case\s+'([^']+)':\s*(\w+)\(\)/g)) out[m[1]] = m[2];
  return out;
}

describe('admin SPA section handlers', () => {
  it('defines a render function for every section renderSection dispatches', () => {
    const { win } = bootAdminPage();
    const handlers = renderSectionHandlers();
    expect(Object.keys(handlers).length).toBeGreaterThan(10);

    const missing = Object.entries(handlers)
      .filter(([, fn]) => typeof win[fn] !== 'function')
      .map(([sectionId, fn]) => `${sectionId} -> ${fn}()`);
    expect(missing).toEqual([]);
  });

  it('routes every sidebar nav item to a section renderSection handles', () => {
    const { win } = bootAdminPage();
    const handlers = renderSectionHandlers();
    const unrouted = navSections(win).filter((s) => !handlers[s]);
    expect(unrouted).toEqual([]);
  });
});
