// @vitest-environment jsdom
//
// T13 — the news ticker's data-source fallback and loop-seam swap. Loads the
// real render-ticker.html markup + inline script into jsdom (same technique
// as package-runtime-client.test.ts) and drives it directly via a stubbed
// `window.PConAir.connect`, instead of standing up a server + WS round trip.
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';

const HTML = fs.readFileSync(path.join(process.cwd(), 'bundled-packages', 'news', 'render-ticker.html'), 'utf8');

const bodyMatch = /<body>([\s\S]*?)<script src="\/packages\/_runtime\/pconair\.js"><\/script>/.exec(HTML);
const scriptMatch = /<script>\n([\s\S]*?)<\/script>\s*<\/body>/.exec(HTML);
if (!bodyMatch || !scriptMatch) {
  throw new Error('could not extract markup/script from render-ticker.html — did the file structure change?');
}
const STAGE_HTML = bodyMatch[1];
const SCRIPT = scriptMatch[1];

function trackItemTexts(): string[] {
  const track = document.getElementById('track')!;
  return Array.from(track.querySelectorAll('.item')).map((el) => el.textContent ?? '');
}

function load(): { onState: (s: Record<string, unknown>) => void } {
  document.body.innerHTML = STAGE_HTML;
  let onState: ((s: Record<string, unknown>) => void) | null = null;
  (window as unknown as { PConAir: unknown }).PConAir = {
    connect: (_id: string, opts: { onState: (s: Record<string, unknown>) => void }) => {
      onState = opts.onState;
    },
  };
  new Function(SCRIPT)();
  if (!onState) throw new Error('render-ticker.html did not call PConAir.connect');
  return { onState };
}

describe('news ticker — data source fallback and loop-seam swap (T13)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('falls back to manually-typed items when no source is configured (_data absent)', () => {
    const { onState } = load();
    onState({ tickerItems: ['KW:: hello world'], tickerVisible: true });
    // First application has nothing on screen yet, so it applies immediately
    // (no loop seam to respect for the very first paint).
    expect(trackItemTexts().some((t) => t.includes('hello world'))).toBe(true);
  });

  it('uses the data source rows when enabled and fetched', () => {
    const { onState } = load();
    onState({
      tickerItems: ['fallback item'],
      tickerVisible: true,
      _data: {
        headlines: {
          enabled: true,
          rows: [{ title: 'Breaking: feed headline' }, { title: 'Second headline' }],
          columns: ['title'],
          fetchedAt: Date.now(),
          error: null,
          rawCount: 2,
        },
      },
    });
    const texts = trackItemTexts();
    expect(texts.some((t) => t.includes('Breaking: feed headline'))).toBe(true);
    expect(texts.some((t) => t.includes('fallback item'))).toBe(false);
  });

  it('falls back to manual items when the source is disabled, even with rows present', () => {
    const { onState } = load();
    onState({
      tickerItems: ['fallback item'],
      tickerVisible: true,
      _data: {
        headlines: {
          enabled: false,
          rows: [{ title: 'stale feed row' }],
          columns: ['title'],
          fetchedAt: Date.now(),
          error: null,
          rawCount: 1,
        },
      },
    });
    const texts = trackItemTexts();
    expect(texts.some((t) => t.includes('fallback item'))).toBe(true);
    expect(texts.some((t) => t.includes('stale feed row'))).toBe(false);
  });

  it('falls back to manual items when the source has never fetched (empty rows)', () => {
    const { onState } = load();
    onState({
      tickerItems: ['fallback item'],
      tickerVisible: true,
      _data: { headlines: { enabled: true, rows: [], columns: [], fetchedAt: 0, error: null, rawCount: 0 } },
    });
    expect(trackItemTexts().some((t) => t.includes('fallback item'))).toBe(true);
  });

  it('new copy joins the crawl only at the loop seam (animationiteration), never mid-scroll', () => {
    const { onState } = load();
    onState({ tickerItems: ['first batch'], tickerVisible: true });
    expect(trackItemTexts().some((t) => t.includes('first batch'))).toBe(true);

    // Change the copy — must NOT appear yet; the current pass keeps running.
    onState({ tickerItems: ['second batch'], tickerVisible: true });
    expect(trackItemTexts().some((t) => t.includes('first batch'))).toBe(true);
    expect(trackItemTexts().some((t) => t.includes('second batch'))).toBe(false);

    // Simulate the crawl completing one loop.
    document.getElementById('track')!.dispatchEvent(new Event('animationiteration'));
    expect(trackItemTexts().some((t) => t.includes('second batch'))).toBe(true);
  });
});
