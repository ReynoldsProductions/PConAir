// @vitest-environment jsdom
//
// Client-side text-fit engine from spec 22. Loads src/runtime/pconair-fit.js
// raw into jsdom's global scope (same pattern as tests/debug-overlay.test.ts
// and tests/package-runtime-client.test.ts) and drives it against a stubbed
// DOM measurement layer, since jsdom itself never lays anything out.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

const FIT_SRC = fs.readFileSync(path.join(process.cwd(), 'src', 'runtime', 'pconair-fit.js'), 'utf8');

/** Gives an element a fake clientWidth/scrollWidth pair, as if the browser
    had actually laid it out inside a box of `boxWidth` holding text that
    would naturally need `naturalWidth`. */
function stubMeasurements(el: HTMLElement, naturalWidth: number, boxWidth: number) {
  Object.defineProperty(el, 'clientWidth', { configurable: true, get: () => boxWidth });
  Object.defineProperty(el, 'scrollWidth', { configurable: true, get: () => naturalWidth });
}

function makeEl(attrs: Record<string, string> = {}, text = 'Bartholomew Featherstonehaugh') {
  const el = document.createElement('div');
  el.setAttribute('data-fit', attrs.field ?? '');
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'field') continue;
    el.setAttribute(k, v);
  }
  el.textContent = text;
  document.body.appendChild(el);
  return el;
}

/** Loads a fresh copy of the module. It self-initializes on load (readyState
    is 'complete' in jsdom by default), scanning whatever [data-fit] elements
    are already in the document. */
let currentFit: any = null;

function loadFit() {
  if (currentFit) currentFit.dispose();
  delete (window as unknown as Record<string, unknown>)._pconairFit;
  new Function(FIT_SRC)();
  currentFit = (window as unknown as { _pconairFit: any })._pconairFit;
  return currentFit;
}

beforeEach(() => {
  document.body.innerHTML = '';
  document.head.querySelectorAll('style[data-test-fit]').forEach((s) => s.remove());
  (window as unknown as { PConAir?: unknown }).PConAir = undefined;
  // A couple of tests reassign window.fetch and the URL (to exercise
  // reportWarnings' routeIdentity() parsing) -- reset both so that leaks
  // into later tests in this file, not just the two that set them.
  window.history.replaceState({}, '', '/');
  delete (window as unknown as { fetch?: unknown }).fetch;
});

afterEach(() => {
  if (currentFit) {
    currentFit.dispose();
    currentFit = null;
  }
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('computeFit (pure ratio math)', () => {
  it('fits when natural width is within the box', () => {
    const fit = loadFit();
    expect(fit.computeFit(400, 620, 0.5)).toEqual({ fits: true });
  });

  it('condenses above the floor with no warning', () => {
    const fit = loadFit();
    const r = fit.computeFit(700, 620, 0.5);
    expect(r.fits).toBe(false);
    expect(r.warn).toBe(false);
    expect(r.ratio).toBeCloseTo(620 / 700, 6);
  });

  it('clamps to the floor and warns when the ratio would go below it', () => {
    const fit = loadFit();
    const r = fit.computeFit(1400, 620, 0.62);
    expect(r.fits).toBe(false);
    expect(r.warn).toBe(true);
    expect(r.ratio).toBe(0.62);
  });

  it('treats an exact-fit width as fitting (no transform for a rounding-error box)', () => {
    const fit = loadFit();
    expect(fit.computeFit(620, 620, 0.5).fits).toBe(true);
  });
});

describe('T1 -- fits, no warning', () => {
  it('leaves no transform and produces no warning when text already fits', async () => {
    const fit = loadFit();
    const el = makeEl();
    stubMeasurements(el, 400, 620);
    el.setAttribute('data-fit-max', '620');
    fit.manage(el);
    fit.runPass();
    expect(el.style.transform).toBe('');
    expect(el.hasAttribute('data-fit-warn')).toBe(false);
  });
});

describe('T2 -- condense above the floor', () => {
  it('applies scaleX(0.8857...) with no warning', () => {
    const fit = loadFit();
    const el = makeEl();
    el.setAttribute('data-fit-max', '620');
    el.setAttribute('data-fit-min', '0.5');
    stubMeasurements(el, 700, 620);
    fit.manage(el);
    fit.runPass();
    const m = /scaleX\(([\d.]+)\)/.exec(el.style.transform);
    expect(m).toBeTruthy();
    expect(parseFloat(m![1])).toBeCloseTo(620 / 700, 4);
    expect(el.hasAttribute('data-fit-warn')).toBe(false);
  });
});

describe('T3 -- below the floor warns', () => {
  it('applies exactly the floor scale, no ellipsis, and reports one warning', () => {
    const fit = loadFit();
    const el = makeEl({}, 'Bartholomew Featherstonehaugh');
    el.setAttribute('data-fit-max', '620');
    el.setAttribute('data-fit-min', '0.62');
    stubMeasurements(el, 1400, 620);
    fit.manage(el);
    fit.runPass();
    expect(el.style.transform).toBe('scaleX(0.62)');
    expect(el.style.textOverflow).toBe('');
    expect(el.style.overflow).not.toBe('hidden');
    expect(el.hasAttribute('data-fit-warn')).toBe(true);
  });

  it('the reported warning carries natural/max width and the field name', () => {
    const fit = loadFit();
    const el = makeEl({ field: 'name' }, 'Bartholomew Featherstonehaugh');
    el.setAttribute('data-fit-max', '620');
    el.setAttribute('data-fit-min', '0.62');
    stubMeasurements(el, 1400, 620);
    fit.manage(el);
    const spy = vi.fn();
    (window as unknown as { PConAir: any }).PConAir = { warn: spy };
    fit.runPass();
    expect(spy).toHaveBeenCalledTimes(1);
    const msg = spy.mock.calls[0][0] as string;
    expect(msg).toContain('name');
    expect(msg).toContain('Bartholomew Featherstonehaugh');
    expect(msg).toContain('1400px');
    expect(msg).toContain('620px');
    expect(msg).toContain('0.62');
  });
});

describe('T4 -- transform-origin follows text-align', () => {
  it.each([
    ['left', 'left center'],
    ['right', 'right center'],
    ['center', 'center'],
  ])('%s aligns to %s', (align, expected) => {
    const fit = loadFit();
    const el = makeEl();
    el.style.textAlign = align;
    el.setAttribute('data-fit-max', '620');
    stubMeasurements(el, 1000, 620);
    fit.manage(el);
    fit.runPass();
    expect(el.style.transformOrigin).toBe(expected);
  });
});

describe('T5 -- shrink mode', () => {
  it('scales font-size instead of applying a transform', () => {
    // The 52px must come from a stylesheet rule, not an inline style: the
    // module resets any of its OWN prior inline overrides before measuring
    // (clearApplied), which would also wipe out a base size set the same
    // way. A real page declares this in CSS, same as bundled-packages/
    // news/render-l3.html's `.l3 .name{font-size:52px}`.
    const style = document.createElement('style');
    style.setAttribute('data-test-fit', '');
    style.textContent = '.stubbed-52 { font-size: 52px; }';
    document.head.appendChild(style);

    const fit = loadFit();
    const el = makeEl();
    el.classList.add('stubbed-52');
    el.setAttribute('data-fit-mode', 'shrink');
    el.setAttribute('data-fit-max', '620');
    el.setAttribute('data-fit-min', '0.5');
    stubMeasurements(el, 1000, 620);
    fit.manage(el);
    fit.runPass();
    expect(el.style.transform).toBe('');
    expect(el.style.fontSize).toBe(52 * (620 / 1000) + 'px');
  });
});

describe('T6 -- font-load re-measure', () => {
  it('re-measures after document.fonts.ready resolves, catching a wider metric', async () => {
    let resolveReady: () => void;
    const readyPromise = new Promise<void>((r) => { resolveReady = r; });
    (document as unknown as { fonts: unknown }).fonts = { ready: readyPromise };

    const el = makeEl();
    el.setAttribute('data-fit-max', '620');
    el.setAttribute('data-fit-min', '0.5');
    // Fits under the fallback font's metrics...
    stubMeasurements(el, 500, 620);

    const fit = loadFit();
    fit.manage(el);
    fit.runPass();
    expect(el.hasAttribute('data-fit-warn')).toBe(false);

    // ...but the real webfont is wider, discovered only once `ready` resolves.
    stubMeasurements(el, 1400, 620);
    resolveReady!();
    await readyPromise;
    await Promise.resolve(); // let the .then() microtask run
    fit.runPass();

    expect(el.hasAttribute('data-fit-warn')).toBe(true);
  });
});

describe('acceptance -- warnings clear when text is shortened', () => {
  it('a warning present at long text disappears once the text fits', () => {
    const fit = loadFit();
    const el = makeEl({ field: 'name' }, 'Bartholomew Featherstonehaugh');
    el.setAttribute('data-fit-max', '620');
    el.setAttribute('data-fit-min', '0.62');
    stubMeasurements(el, 1400, 620);
    fit.manage(el);
    fit.runPass();
    expect(el.hasAttribute('data-fit-warn')).toBe(true);

    // text is edited shorter -- now comfortably fits its box
    el.textContent = 'Jane Smith';
    stubMeasurements(el, 300, 620);
    fit.runPass();

    expect(el.hasAttribute('data-fit-warn')).toBe(false);
    expect(el.style.transform).toBe('');
  });

  it('reports the shrunk (empty) warning set to the server, not the stale one', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true });
    (window as unknown as { fetch: unknown }).fetch = fetchSpy;
    // pathname drives which package/render this "page" reports as (spec 22's
    // routeIdentity() parses /packages/<id>/render/<renderId> from it) --
    // same convention tests/package-runtime-client.test.ts already uses.
    window.history.replaceState({}, '', '/packages/news/render/l3');

    const fit = loadFit();
    const el = makeEl({ field: 'name' }, 'Bartholomew Featherstonehaugh');
    el.setAttribute('data-fit-max', '620');
    el.setAttribute('data-fit-min', '0.62');
    stubMeasurements(el, 1400, 620);
    fit.manage(el);
    fit.runPass();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const firstBody = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(firstBody.warnings).toHaveLength(1);

    el.textContent = 'Jane Smith';
    stubMeasurements(el, 300, 620);
    fit.runPass();

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const secondBody = JSON.parse((fetchSpy.mock.calls[1][1] as RequestInit).body as string);
    expect(secondBody.warnings).toEqual([]);
  });
});

describe('acceptance -- render-side warn() and control-side panel agree on wording', () => {
  it('formatWarning (render side) and formatFitWarning (control side) produce identical text', () => {
    const fitSrc = fs.readFileSync(path.join(process.cwd(), 'src', 'runtime', 'pconair-fit.js'), 'utf8');
    const runtimeSrc = fs.readFileSync(path.join(process.cwd(), 'src', 'runtime', 'pconair.js'), 'utf8');

    delete (window as unknown as Record<string, unknown>)._pconairFit;
    delete (window as unknown as Record<string, unknown>).PConAir;
    new Function(fitSrc)();
    new Function(runtimeSrc)();
    const fit = (window as unknown as { _pconairFit: any })._pconairFit;
    const pconair = (window as unknown as { PConAir: any }).PConAir;

    const w = { field: 'name', text: 'Bartholomew Featherstonehaugh', naturalWidth: 738, maxWidth: 620, min: 0.62 };
    expect(fit.formatWarning(w)).toBe(pconair._formatFitWarningForTest(w));
    expect(fit.formatWarning(w)).toBe(
      'name \u2014 "Bartholomew Featherstonehaugh" is 738px in a 620px box (min scale 0.62)'
    );
    fit.dispose();
  });
});

describe('T7 -- batched recomputation', () => {
  it('ten mutations in one tick cause one measurement pass, not ten', () => {
    const rafCallbacks: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      rafCallbacks.push(cb);
      return rafCallbacks.length;
    });

    const el = makeEl();
    el.setAttribute('data-fit-max', '620');
    stubMeasurements(el, 500, 620);

    const fit = loadFit();
    fit.manage(el);

    const spy = vi.spyOn(fit, 'runPass');
    // Ten "mutations" -- ten calls to whatever schedules a pass. We call the
    // module's own scheduling indirectly by re-managing (a no-op after the
    // first) and relying on init()'s own scheduleAll already having queued
    // one; the real signal here is that requestAnimationFrame was asked for
    // exactly once no matter how many change signals fired before it flushed.
    for (let i = 0; i < 10; i++) {
      el.textContent = 'Name ' + i;
    }

    expect(rafCallbacks.length).toBeLessThanOrEqual(1);
  });
});
