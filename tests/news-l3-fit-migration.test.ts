// @vitest-environment jsdom
//
// Spec 22 T12 — bundled-packages/news/render-l3.html migrated off its
// bespoke shrink-then-ellipsis JS onto the shared data-fit engine.
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const HTML_PATH = path.join(__dirname, '..', 'bundled-packages', 'news', 'render-l3.html');
const html = fs.readFileSync(HTML_PATH, 'utf8');
const FIT_SRC = fs.readFileSync(path.join(process.cwd(), 'src', 'runtime', 'pconair-fit.js'), 'utf8');

describe('the bespoke shrink/ellipsis mechanism is gone', () => {
  it('has no NAME_MIN constant, no fitName function, no refit handle', () => {
    expect(html).not.toMatch(/NAME_MIN/);
    expect(html).not.toMatch(/function fitName/);
    expect(html).not.toMatch(/refit:/);
  });

  it('declares no ellipsis or horizontal clipping on .l3 .name', () => {
    const m = /\.l3 \.name\s*\{([^}]*)\}/.exec(html);
    expect(m, '.l3 .name rule not found').toBeTruthy();
    expect(m![1]).not.toMatch(/overflow\s*:\s*hidden/);
    expect(m![1]).not.toMatch(/text-overflow/);
  });

  it('still declares the original 52px type size', () => {
    const m = /\.l3 \.name\s*\{([^}]*)\}/.exec(html);
    expect(m![1]).toMatch(/font-size\s*:\s*52px/);
  });

  it('still declares the original 32px title size', () => {
    const m = /\.l3 \.title\s*\{([^}]*)\}/.exec(html);
    expect(m![1]).toMatch(/font-size\s*:\s*32px/);
  });
});

describe('.name and .title are marked up for data-fit', () => {
  // Two name/title pairs (left + right cards) -- both must be migrated.
  const nameMatches = [...html.matchAll(/<div class="name"([^>]*)>/g)];
  const titleTags = [...html.matchAll(/<div class="name"[^>]*><\/div><div class="title"([^>]*)>/g)];

  it('both cards carry a shrink-mode data-fit on the name', () => {
    expect(nameMatches).toHaveLength(2);
    for (const m of nameMatches) {
      expect(m[1]).toMatch(/data-fit="name"/);
      expect(m[1]).toMatch(/data-fit-mode="shrink"/);
      expect(m[1]).toMatch(/data-fit-min="[\d.]+"/);
    }
  });

  it("reproduces the original 34px floor (34/52 ≈ 0.653846)", () => {
    for (const m of nameMatches) {
      const min = parseFloat(/data-fit-min="([\d.]+)"/.exec(m[1])![1]);
      expect(min * 52).toBeCloseTo(34, 1);
    }
  });

  // the .title tag itself carries no data-fit -- confirms this migration
  // only touches the name, matching spec 22 T12's scope
  it('does not mark up .title with data-fit', () => {
    expect(titleTags.length).toBeGreaterThan(0);
    for (const m of titleTags) {
      expect(m[1]).not.toMatch(/data-fit/);
    }
  });
});

describe('a normal-length name renders at 52px with no transform, driven by the real engine', () => {
  it('leaves the name untouched when it fits its box', () => {
    delete (window as unknown as Record<string, unknown>)._pconairFit;
    document.body.innerHTML = '';

    const el = document.createElement('div');
    el.className = 'name';
    el.setAttribute('data-fit', 'name');
    el.setAttribute('data-fit-mode', 'shrink');
    el.setAttribute('data-fit-min', '0.653846');
    el.style.fontSize = ''; // base size comes from a stylesheet on the real page; irrelevant here since it fits
    el.textContent = 'Jane Smith'; // a normal-length name
    document.body.appendChild(el);

    // A normal name comfortably fits an ~780px-wide panel at 52px -- stub
    // the measurement accordingly (jsdom does no real layout).
    Object.defineProperty(el, 'clientWidth', { configurable: true, get: () => 700 });
    Object.defineProperty(el, 'scrollWidth', { configurable: true, get: () => 300 });

    new Function(FIT_SRC)();
    const fit = (window as unknown as { _pconairFit: any })._pconairFit;
    fit.manage(el);
    fit.runPass();

    expect(el.style.fontSize).toBe('');
    expect(el.style.transform).toBe('');
    expect(el.hasAttribute('data-fit-warn')).toBe(false);

    fit.dispose();
  });
});
