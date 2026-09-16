/* PConAir declarative text fitting — served at /packages/_runtime/pconair-fit.js.
   See specs/22-text-fit-overflow.md. Loaded by pconair.js only when the
   document has (or later gains) a [data-fit] element, so a page with none
   pays zero cost.

   A marked element condenses (or shrinks) to fit its box down to a floor
   ratio, and — the point of this module — NEVER falls back to an ellipsis
   below that floor. A visible overflow is a problem an operator sees and
   fixes before air; a clean ellipsis is one that ships silently. */
(function () {
  'use strict';

  var DEFAULT_MIN = 0.5;
  var managed = []; // elements currently carrying [data-fit]
  var dirty = []; // elements queued for the next batched pass
  var rafScheduled = false;
  var lastWarnings = null; // last posted warning set, for change detection
  var resizeObserver = null;

  function fieldName(el) {
    var v = el.getAttribute('data-fit');
    if (v) return v;
    if (el.id) return el.id;
    if (el.classList && el.classList.length) return el.classList[0];
    return '(unnamed)';
  }

  function readOpts(el) {
    var maxAttr = el.getAttribute('data-fit-max');
    var minAttr = el.getAttribute('data-fit-min');
    var mode = el.getAttribute('data-fit-mode') === 'shrink' ? 'shrink' : 'condense';
    return {
      max: maxAttr !== null && maxAttr !== '' ? parseFloat(maxAttr) : null,
      min: minAttr !== null && minAttr !== '' ? parseFloat(minAttr) : DEFAULT_MIN,
      mode: mode,
    };
  }

  function originFor(el) {
    var align = '';
    try {
      align = window.getComputedStyle(el).textAlign;
    } catch (e) {
      align = '';
    }
    if (align === 'right' || align === 'end') return 'right center';
    if (align === 'center') return 'center';
    return 'left center';
  }

  /**
   * Pure ratio math, exported for direct unit testing. `box`/`natural` are
   * px widths already measured by the caller; `min` is the floor ratio.
   * Returns `{fits:true}` when nothing needs to change, otherwise the ratio
   * actually applied and whether it hit the floor (a warning-worthy state).
   */
  function computeFit(natural, box, min) {
    if (!box || !natural || natural <= box + 0.5) {
      return { fits: true };
    }
    var ratio = box / natural;
    if (ratio >= min) {
      return { fits: false, ratio: ratio, warn: false };
    }
    return { fits: false, ratio: min, warn: true };
  }

  function clearApplied(el) {
    el.style.transform = '';
    el.style.transformOrigin = '';
    el.style.fontSize = '';
  }

  /** Measure and (re)apply fit for one element. Returns a FitWarning, or null. */
  function measureOne(el) {
    var opts = readOpts(el);
    clearApplied(el); // reset before measuring, or a prior fit skews the reading
    var box = opts.max !== null ? opts.max : el.clientWidth;
    var natural = el.scrollWidth;
    var result = computeFit(natural, box, opts.min);

    el.removeAttribute('data-fit-warn');

    if (result.fits) return null;

    if (opts.mode === 'shrink') {
      var baseSize = parseFloat(window.getComputedStyle(el).fontSize) || 0;
      el.style.fontSize = baseSize * result.ratio + 'px';
    } else {
      el.style.transform = 'scaleX(' + result.ratio + ')';
      el.style.transformOrigin = originFor(el);
    }

    if (!result.warn) return null;

    var text = el.textContent || '';
    el.setAttribute('data-fit-warn', '');
    return {
      field: fieldName(el),
      text: text,
      naturalWidth: Math.round(natural),
      maxWidth: Math.round(box),
      min: opts.min,
    };
  }

  function formatWarning(w) {
    return w.field + ' — "' + w.text + '" is ' + w.naturalWidth + 'px in a ' +
      w.maxWidth + 'px box (min scale ' + w.min + ')';
  }

  /** Where to report: the render route is /packages/<id>/render/<renderId>,
      so packageId/renderId come straight from the URL rather than needing a
      second DOM attribute — a render page's identity is exactly its path. */
  function routeIdentity() {
    var m = /^\/packages\/([^/]+)\/render\/([^/]+)/.exec(window.location.pathname);
    if (!m) return null;
    return { packageId: decodeURIComponent(m[1]), renderId: decodeURIComponent(m[2]) };
  }

  function reportWarnings(warnings) {
    var stripped = warnings.map(function (w) {
      return { field: w.field, text: w.text, naturalWidth: w.naturalWidth, maxWidth: w.maxWidth, min: w.min };
    });
    var serialized = JSON.stringify(stripped);
    if (serialized === lastWarnings) return;
    lastWarnings = serialized;

    var id = routeIdentity();
    if (!id) return;
    try {
      window.fetch('/api/packages/' + encodeURIComponent(id.packageId) + '/warnings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ renderId: id.renderId, warnings: stripped }),
      });
    } catch (e) {
      /* best effort -- a render page cannot afford to throw over reporting */
    }
  }

  function runPass() {
    rafScheduled = false;
    var toProcess = dirty.slice();
    dirty = [];

    var warnings = [];
    for (var i = 0; i < managed.length; i++) {
      var el = managed[i];
      if (!el.isConnected) continue;
      var w = measureOne(el);
      if (w) warnings.push(w);
    }

    reportWarnings(warnings);

    if (typeof window.PConAir !== 'undefined' && typeof window.PConAir.warn === 'function') {
      for (var j = 0; j < warnings.length; j++) {
        window.PConAir.warn(formatWarning(warnings[j]));
      }
    }
  }

  function scheduleAll() {
    // The batched pass always re-measures every managed element (not just the
    // one that changed) -- a resize of one card can change how much room its
    // sibling has, and the pass is cheap relative to a per-mutation layout
    // thrash, which is the thing T7 exists to prevent.
    if (rafScheduled) return;
    rafScheduled = true;
    window.requestAnimationFrame(runPass);
  }

  function manage(el) {
    if (managed.indexOf(el) !== -1) return;
    managed.push(el);
    if (resizeObserver) {
      try {
        resizeObserver.observe(el);
      } catch (e) {
        /* ResizeObserver unavailable or el not observable -- fit still runs
           on mutation and font-load triggers, just not on a bare resize */
      }
    }
  }

  function scanFor(root) {
    if (root.nodeType !== 1) return;
    if (root.matches && root.matches('[data-fit]')) manage(root);
    if (root.querySelectorAll) {
      var found = root.querySelectorAll('[data-fit]');
      for (var i = 0; i < found.length; i++) manage(found[i]);
    }
  }

  var mutationObserver = null;
  var disposed = false;

  function init() {
    scanFor(document.documentElement);
    scheduleAll();

    if (typeof window.ResizeObserver === 'function') {
      resizeObserver = new window.ResizeObserver(scheduleAll);
      for (var i = 0; i < managed.length; i++) {
        try {
          resizeObserver.observe(managed[i]);
        } catch (e) { /* ignore */ }
      }
    }

    if (typeof window.MutationObserver === 'function') {
      mutationObserver = new window.MutationObserver(function (records) {
        if (disposed) return;
        for (var i = 0; i < records.length; i++) {
          var r = records[i];
          if (r.type === 'childList') {
            for (var j = 0; j < r.addedNodes.length; j++) scanFor(r.addedNodes[j]);
          }
        }
        scheduleAll();
      });
      mutationObserver.observe(document.documentElement, { characterData: true, childList: true, subtree: true });
    }

    if (typeof document.fonts !== 'undefined' && document.fonts) {
      try {
        if (document.fonts.ready && typeof document.fonts.ready.then === 'function') {
          document.fonts.ready.then(function () {
            if (!disposed) scheduleAll();
          });
        }
      } catch (e) { /* ignore */ }
      try {
        if (typeof document.fonts.addEventListener === 'function') {
          document.fonts.addEventListener('loadingdone', function () {
            if (!disposed) scheduleAll();
          });
        }
      } catch (e) { /* ignore */ }
    }
  }

  /** Test-only teardown: disconnects observers so a reloaded module copy in
      the same jsdom document does not keep reacting to later mutations. A
      real page only ever loads this module once, so production never calls
      this -- it exists purely because tests re-evaluate the whole IIFE per
      case against one shared `document`. */
  function dispose() {
    disposed = true;
    if (mutationObserver) mutationObserver.disconnect();
    if (resizeObserver) resizeObserver.disconnect();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  /* Exposed for tests only -- not part of the page-author API. */
  window._pconairFit = {
    computeFit: computeFit,
    formatWarning: formatWarning,
    runPass: runPass,
    manage: manage,
    dispose: dispose,
  };
})();
