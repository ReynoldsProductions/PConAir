/* Shared markup helpers for the FFG overlays. Vanilla JS — no build step.
   Ported from FaireFulfillmentGames/obs/overlay-kit.js; team/H2H config now
   comes from PConAir package state (see ffg-common.js), not localStorage. */

(function () {
  'use strict';

  // Computed once at script load, before any makeFrame() calls, so the check
  // is reliable regardless of when applyObsMode() runs.
  const _obsParam = new URLSearchParams(window.location.search).get('obs');
  const IS_OBS = _obsParam === '1' || _obsParam === 'true' || _obsParam === '2';

  function el(tag, opts = {}, children = []) {
    const n = document.createElement(tag);
    if (opts.cls)   n.className = opts.cls;
    if (opts.style) Object.assign(n.style, opts.style);
    if (opts.attrs) for (const k in opts.attrs) n.setAttribute(k, opts.attrs[k]);
    if (opts.text !== undefined) n.textContent = opts.text;
    if (opts.html !== undefined) n.innerHTML = opts.html;
    for (const c of children) if (c) n.appendChild(c);
    return n;
  }

  /* Build a cardboard frame with cam cutout + bottom shipping label.
     opts: { width, height, top, side, bottom, title, sub, tape, corner, resW, resH, resLabel, placeholderLabel } */
  function makeFrame(opts) {
    const o = Object.assign({
      top: 36, side: 24, bottom: 140,
      tape: null, corner: null,
      resLabel: 'CAM',
      placeholderLabel: 'CAM',
      clipW: 0, clipH: 0,
    }, opts);

    const frame = el('div', {
      cls: 'frame cardboard',
      style: {
        width:  typeof o.width  === 'number' ? o.width  + 'px' : o.width,
        height: typeof o.height === 'number' ? o.height + 'px' : o.height,
      },
    });

    // In transparent OBS mode, clip the frame to a picture-frame shape so
    // the cam area is never rendered — the transparent body shows through.
    if (IS_OBS) {
      const fw = typeof o.width  === 'number' ? o.width  : o.clipW;
      const fh = typeof o.height === 'number' ? o.height : o.clipH;
      if (fw && fh) {
        const rx = 6; // matches .cardboard border-radius
        const cL = o.side, cT = o.top, cR = fw - o.side, cB = fh - o.bottom;
        const outer =
          `M${rx},0 H${fw-rx} A${rx},${rx} 0 0 1 ${fw},${rx}` +
          ` V${fh-rx} A${rx},${rx} 0 0 1 ${fw-rx},${fh}` +
          ` H${rx} A${rx},${rx} 0 0 1 0,${fh-rx}` +
          ` V${rx} A${rx},${rx} 0 0 1 ${rx},0 Z`;
        const hole = `M${cR},${cT} H${cL} V${cB} H${cR} Z`;
        frame.style.clipPath = `path('${outer} ${hole}')`;
        frame.style.borderRadius = '0';
      }
    }

    // Corner creases
    ['tl','tr','bl','br'].forEach(p => frame.appendChild(el('div', { cls: 'corner-crease ' + p })));

    // Tape
    if (o.tape === 'tr' || o.tape === 'both') frame.appendChild(el('div', { cls: 'tape tr' }));
    if (o.tape === 'bl' || o.tape === 'both') frame.appendChild(el('div', { cls: 'tape bl' }));

    // Corner label
    if (o.corner) frame.appendChild(el('div', { cls: 'corner-label', text: o.corner }));

    // Cam cutout
    const cam = el('div', {
      cls: 'cam',
      style: {
        top:    o.top + 'px',
        left:   o.side + 'px',
        right:  o.side + 'px',
        bottom: o.bottom + 'px',
      },
    });

    // Placeholder content (hidden in body.obs)
    const ph = el('div', { cls: 'cam-placeholder' });
    ph.appendChild(el('div', { cls: 'icon' }));
    ph.appendChild(el('div', { text: o.placeholderLabel }));
    if (o.resW && o.resH) ph.appendChild(el('div', { cls: 'sub', text: `crop to ${o.resW} × ${o.resH}` }));
    cam.appendChild(ph);

    // Resolution chip (hidden in body.obs)
    if (o.resW && o.resH) {
      const chip = el('div', { cls: 'res-chip', style: { top: '8px', left: '8px' } });
      chip.appendChild(el('span', { cls: 'lab', text: o.resLabel }));
      chip.appendChild(el('span', { cls: 'dim', text: `${o.resW} × ${o.resH}` }));
      chip.appendChild(el('span', { cls: 'ar',  text: '16:9' }));
      cam.appendChild(chip);
    }
    frame.appendChild(cam);

    // Bottom shipping label
    if (o.title || o.sub) {
      const labelH = o.bottom - 48;
      const banner = el('div', {
        cls: 'label-banner',
        style: {
          left:   o.side + 'px',
          right:  o.side + 'px',
          bottom: '24px',
          height: labelH + 'px',
        },
      });

      // Barcode
      const bc = el('div', { cls: 'barcode' });
      [2,1,3,1,2,1,1,3,1,2,1,2,1,3,1,1,2,1,3,1,2,1].forEach(w => {
        bc.appendChild(el('i', { style: { width: w + 'px' } }));
      });
      banner.appendChild(bc);

      // Text block
      const tx = el('div', { style: { flex: '1', minWidth: '0' } });
      const titleSize = o.titleSize ?? Math.min(labelH - 28, 32);
      tx.appendChild(el('div', { cls: 'label-title', style: { fontSize: titleSize + 'px' }, text: o.title || '' }));
      if (o.sub) tx.appendChild(el('div', { cls: 'label-sub', text: o.sub }));
      banner.appendChild(tx);

      // Fragile mini-stamp
      if (!o.hideMiniStamp) {
        const fs = el('div', {
          cls: 'stamp',
          style: {
            padding: '3px 7px', borderWidth: '1.5px', borderRadius: '2px',
            transform: 'rotate(-4deg)', opacity: '0.85',
          },
        });
        const fsTop = el('div', { style: { fontSize: '9px', letterSpacing: '0.2em', fontWeight: '700' }, text: 'HANDLE WITH CARE' });
        fs.appendChild(fsTop);
        banner.appendChild(fs);
      }

      frame.appendChild(banner);
    }

    return frame;
  }

  /* Title banner across the top of the stage. */
  function makeTitleBanner(primary, secondary, stampVariant) {
    const tb = el('div', { cls: 'title-banner paper' });
    ['tl','tr','bl','br'].forEach(p => tb.appendChild(el('div', { cls: 'corner-dot ' + p })));

    // Left mark
    const left = el('div', { style: { display: 'flex', alignItems: 'center', gap: '14px' } });
    left.appendChild(el('div', { cls: 'f-mark', text: 'F' }));
    const txt = el('div', { style: { display: 'flex', flexDirection: 'column' } });
    txt.appendChild(el('div', { cls: 'from-mark', text: 'FROM · FAIRE · WAREHOUSE' }));
    txt.appendChild(el('div', { cls: 'from-sub',  text: 'SHIPMENT №2026-FFG-001' }));
    left.appendChild(txt);
    tb.appendChild(left);

    // Center
    const ct = el('div', { cls: 'center-title' });
    ct.appendChild(el('div', { cls: 'primary', text: primary || 'FAIRE FULFILLMENT GAMES' }));
    ct.appendChild(el('div', { cls: 'secondary', text: secondary || '2026 · PICK · PACK · SHIP' }));
    tb.appendChild(ct);

    // Stamp
    tb.appendChild(makeStamp(stampVariant || 'fragile', 4));
    return tb;
  }

  function makeStamp(variant, rotate, size) {
    const variants = {
      fragile:  { top: '· STAMP ·',    main: 'FRAGILE',     cls: '' },
      ground:   { top: '· SHIP VIA ·', main: 'GROUND ONLY', cls: 'ground' },
      priority: { top: '· SERVICE ·',  main: 'PRIORITY',    cls: '' },
      rush:     { top: '· SHIP VIA ·', main: 'RUSH',        cls: '' },
    };
    const v = variants[variant] || variants.fragile;
    const cls = 'stamp ' + (v.cls) + (size === 'sm' ? ' sm' : '');
    const s = el('div', { cls, style: { transform: `rotate(${rotate || 4}deg)` } });
    s.appendChild(el('div', { cls: 'top',  text: v.top }));
    s.appendChild(el('div', { cls: 'main', text: v.main }));
    return s;
  }

  /* Live timer chip — pairs with FFG.bindTimer() in ffg-common.js */
  function makeTimerChip(label) {
    const chip = el('div', { cls: 'timer-chip' });
    chip.appendChild(el('div', { cls: 'label', attrs: { 'data-st-label': '' }, text: label || 'SHIP-BY' }));
    chip.appendChild(el('div', { cls: 'time',  attrs: { 'data-st-time':  '' }, text: '--:--' }));
    return chip;
  }

  /* Auto-scale the .stage element to the viewport (preserves 16:9). */
  function autoScale() {
    const stage = document.querySelector('.stage');
    if (!stage) return;
    function fit() {
      const sx = window.innerWidth  / 1920;
      const sy = window.innerHeight / 1080;
      const s = Math.min(sx, sy);
      stage.style.transform = `scale(${s})`;
      // center
      const left = (window.innerWidth  - 1920 * s) / 2;
      const top  = (window.innerHeight - 1080 * s) / 2;
      stage.style.left = left + 'px';
      stage.style.top  = top + 'px';
      stage.style.position = 'absolute';
    }
    fit();
    window.addEventListener('resize', fit);
  }

  /* OBS mode toggle.
     ?obs=1      → transparent cam windows + transparent bg (composite in OBS)
     ?obs=2      → opaque cardboard bg everywhere except cam windows (transparent cam holes)
     ?obs=green  → green (#00ff00) cam windows, transparent bg
     ?obs=green2 → green cam windows + green bg (full green field)
     ?obs=blue   → blue (#0000ff) cam windows, transparent bg
     ?obs=blue2  → blue cam windows + blue bg (full blue field) */
  function applyObsMode() {
    const p = new URLSearchParams(window.location.search);
    const obs = p.get('obs');
    const map = { '1': 'obs', 'true': 'obs', '2': 'obs-2', green: 'obs-green', green2: 'obs-green2', blue: 'obs-blue', blue2: 'obs-blue2' };
    let cls = map[obs] || (p.get('preview') === '0' ? 'obs' : null);
    if (!cls && (p.get('key') === '1' || obs === 'key')) cls = 'key';
    if (cls) document.body.classList.add(cls);
    if (obs === '2') requestAnimationFrame(buildObsBg);
  }

  /* Build full-page opaque cardboard background with transparent camera holes.
     Called automatically by applyObsMode() when ?obs=2. Reads camera positions
     from the live DOM so works for every overlay layout without per-file changes. */
  function buildObsBg() {
    const stage = document.querySelector('.stage');
    if (!stage) return;

    // Collect every camera window's position in stage-local coordinates.
    // getBoundingClientRect gives viewport pixels; divide by the stage's
    // CSS scale factor to recover the unscaled 1920×1080 coordinate space.
    const stageRect = stage.getBoundingClientRect();
    const scale = stageRect.width / 1920;
    const holes = [];
    document.querySelectorAll('.frame.cardboard').forEach(frame => {
      const camEl = frame.querySelector('.cam');
      if (!camEl) return;
      const r = camEl.getBoundingClientRect();
      holes.push({
        x: (r.left   - stageRect.left) / scale,
        y: (r.top    - stageRect.top)  / scale,
        w: r.width  / scale,
        h: r.height / scale,
      });
    });

    // Build even-odd clip-path: outer full-canvas rect minus each camera hole.
    // Holes are wound in the opposite direction so they subtract (even-odd rule).
    const outer = 'M0,0 H1920 V1080 H0 Z';
    const holePaths = holes.map(h =>
      `M${h.x + h.w},${h.y} H${h.x} V${h.y + h.h} H${h.x + h.w} Z`
    ).join(' ');

    const layer = document.createElement('div');
    layer.className = 'obs-bg-layer';
    layer.style.clipPath = `path('${outer} ${holePaths}')`;

    addObsDecorations(layer);

    // Insert behind all overlay content
    stage.insertBefore(layer, stage.firstChild);
  }

  const _CORE_VALUES = [
    { file: 'one-faire.gif',            label: 'One Faire' },
    { file: 'make-it-happen-fast.gif',  label: 'Make It Happen (Fast)' },
    { file: 'seek-the-truth.gif',       label: 'Seek the Truth' },
    { file: 'raise-the-bar.gif',        label: 'Raise the Bar' },
    { file: 'serve-our-community.gif',  label: 'Serve Our Community' },
  ];

  // Sticker positions chosen to fall in the safe zones that are never
  // covered by camera windows in any of the five overlay layouts.
  // Safe zones: left strip (x<56), right strip (x>1864), top band (y<140),
  // bottom band (y>965).
  const _STICKER_PLACEMENTS = [
    { x: 28,   y: 22,  rot:  6 },   // top-left corner
    { x: 1798, y: 18,  rot: -5 },   // top-right corner
    { x: 8,    y: 340, rot: 90 },   // left edge, upper-mid
    { x: 1836, y: 490, rot: -90 },  // right edge, mid
    { x: 28,   y: 972, rot: -7 },   // bottom-left corner
  ];

  function addObsDecorations(layer) {
    // Served by the PConAir package assets route.
    const iconsBase = '/packages/ffg/assets/icons/';

    // ── Core Values stickers ────────────────────────────────────────
    _CORE_VALUES.forEach((cv, i) => {
      const pl = _STICKER_PLACEMENTS[i];
      const sticker = document.createElement('div');
      sticker.className = 'obs-sticker';
      sticker.style.cssText = `left:${pl.x}px;top:${pl.y}px;transform:rotate(${pl.rot}deg);`;
      const img = document.createElement('img');
      img.src = iconsBase + cv.file;
      img.alt = cv.label;
      sticker.appendChild(img);
      layer.appendChild(sticker);
    });

    // ── FRAGILE stamp — left edge, vertical ─────────────────────────
    const fragile = document.createElement('div');
    fragile.className = 'obs-stamp';
    fragile.style.cssText = 'left:6px;top:600px;transform:rotate(90deg);transform-origin:left center;';
    fragile.innerHTML = '⚠ FRAGILE ⚠';
    layer.appendChild(fragile);

    // ── THIS SIDE UP — right edge, vertical ─────────────────────────
    const sideUp = document.createElement('div');
    sideUp.className = 'obs-stamp';
    sideUp.style.cssText = 'right:6px;top:250px;transform:rotate(-90deg);transform-origin:right center;';
    sideUp.innerHTML = '↑ THIS SIDE UP ↑';
    layer.appendChild(sideUp);

    // ── HANDLE WITH CARE — lower-left ───────────────────────────────
    const handle = document.createElement('div');
    handle.className = 'obs-stamp obs-stamp--faded';
    handle.style.cssText = 'left:18px;top:820px;transform:rotate(-12deg);font-size:10px;';
    handle.innerHTML = 'HANDLE<br>WITH CARE';
    layer.appendChild(handle);

    // ── Torn shipping label — top centre ───────────────────────────
    const label = document.createElement('div');
    label.className = 'obs-shipping-label';
    label.innerHTML = _buildShippingLabelHTML();
    layer.appendChild(label);

    // ── Tracking barcode — bottom right ─────────────────────────────
    const trackWrap = document.createElement('div');
    trackWrap.className = 'obs-tracking';
    trackWrap.innerHTML = _buildTrackingHTML();
    layer.appendChild(trackWrap);
  }

  function _buildShippingLabelHTML() {
    const bars = [2,1,3,1,2,1,1,3,1,2,1,2,1,3,1,1,2,1,3,1,2,1,1,2,3,1];
    const barSvg = bars.map(w =>
      `<rect width="${w}" height="28" fill="#2b2622"/>`
    ).reduce((acc, r, i) => {
      const x = bars.slice(0, i).reduce((s, w) => s + w + 1, 0);
      return acc + r.replace('rect', `rect x="${x}"`);
    }, '');
    const totalW = bars.reduce((s, w) => s + w + 1, 0);

    return `
      <div class="obs-shipping-label__header">
        <svg width="${totalW}" height="28" viewBox="0 0 ${totalW} 28">${barSvg}</svg>
        <span class="obs-shipping-label__track">1Z9F4A0R3E574I52</span>
      </div>
      <div class="obs-shipping-label__from">
        <span class="obs-shipping-label__key">FROM:</span>
        FAIRE INC · 100 FIRST ST<br>
        SAN FRANCISCO CA 94105
      </div>
      <div class="obs-shipping-label__to">
        <span class="obs-shipping-label__key">TO:</span>
        FULFILLMENT GAMES 2026<br>
        OPERATIONS · STAGE FLOOR
      </div>`;
  }

  function _buildTrackingHTML() {
    const bars = [3,1,2,1,1,3,2,1,1,2,3,1,2,1,1,3,1,2,1,3,2,1,1,2];
    let x = 0;
    const rects = bars.map(w => {
      const r = `<rect x="${x}" y="0" width="${w}" height="44" fill="#2b2622"/>`;
      x += w + 1;
      return r;
    }).join('');
    return `
      <svg width="${x}" height="44" viewBox="0 0 ${x} 44">${rects}</svg>
      <div class="obs-tracking__label">FFG-2026-TRACK</div>`;
  }

  window.OverlayKit = {
    el, makeFrame, makeTitleBanner, makeStamp, makeTimerChip, autoScale, applyObsMode, buildObsBg,
  };
})();
