/*
  Shared lower-third behaviour for the L3 scenes:
    graphics/lower-third-left/   one left card
    graphics/lower-third-right/  one right card
    graphics/lower-third-duo/    both, in a single page/output

  Every `.l3` element on the page becomes a self-animating card, running:

      delay ──▶ animate in ──▶ hold ──▶ animate out

  Cards are non-persistent by design: they play once on load, so a scene can be
  brought up over a recorded spot and will clear itself. Use `hold=inf` to pin.

  Param names come from each card's `data-params` attribute, which is the suffix
  appended to every field: the duo page uses `L` and `R` (so `nameL`, `titleR`,
  `holdL`, …) while the single-card pages leave it empty (`name`, `title`, …).
  Any suffixed timing falls back to the unsuffixed one, so `?hold=8` sets both
  cards and `?delayR=1.5` staggers just the right-hand one.

  URL params (add the card's suffix on the duo page)
  -------------------------------------------------
    name      headline text
    title     second line
    subtitle  third line
    theme     default | dark | dark_alt | bright | bright_info | bright_insider |
              bright_warm | palette_copper | palette_olive | palette_plum |
              palette_sage | palette_teal | palette_terracotta
    delay     wait before animating in         (default 0.4)
    in        animate-in duration              (default 0.55)
    hold      time fully on screen             (default 6)
              use `inf` / `hold` / a negative number to stay up indefinitely
    out       animate-out duration             (default 0.4)
    w         panel max width in px            (default 780)
    bottom    distance from frame bottom in px (default 124 — clears the ticker)

  Durations are in SECONDS by default; suffix with `ms` for milliseconds
  (`in=550ms` === `in=0.55`).

  Passing a param EMPTY clears that line and collapses it — `?title=` removes the
  second row entirely (CSS `:empty` handles the layout). Omitting the param
  instead leaves whatever placeholder is in the markup. That distinction is why
  this reads params with `has()` rather than `||`.

  A duo card with no name, title or subtitle param at all is hidden outright, so
  the duo page also works for titling a single speaker.

  Manual control, for previewing or driving from a parent page:
    window.l3.play()   replay every card (also bound to the R key)
    window.l3.hide()   animate every card out (also bound to H)
    window.l3.cards    per-card controllers: [{el, side, play, hide, set}, …]
    window.l3.left / window.l3.right   the matching controller, when present
*/
(function () {
  var q = new URLSearchParams(location.search);
  var DEFAULTS = { delay: 0.4, in: 0.55, hold: 6, out: 0.4 };
  var NAME_MIN = 34;

  // present-but-empty is meaningful (it clears the line); absent is not
  function raw(key, suffix) {
    var k = key + (suffix || '');
    return q.has(k) ? q.get(k) : undefined;
  }

  // timings and geometry fall back from `holdR` to `hold`
  function shared(key, suffix) {
    var v = raw(key, suffix);
    return v === undefined && suffix ? raw(key, '') : v;
  }

  // "1.5" / "1.5s" → 1500 ; "550ms" → 550 ; "inf" / negative → Infinity
  function ms(value, fallback) {
    if (value === undefined || value === '') return fallback * 1000;
    var s = String(value).trim().toLowerCase();
    if (s === 'inf' || s === 'infinite' || s === 'forever' || s === 'hold') return Infinity;
    var m = /^(-?\d*\.?\d+)(ms|s)?$/.exec(s);
    if (!m) return fallback * 1000;
    var n = parseFloat(m[1]);
    if (!isFinite(n)) return fallback * 1000;
    if (n < 0) return Infinity;
    return m[2] === 'ms' ? n : n * 1000;
  }

  function setupCard(el) {
    var suffix = el.dataset.params || '';

    // ── geometry + timing, written as custom properties on the card itself so
    //    the two duo cards can differ ──
    var wRaw = parseFloat(shared('w', suffix));
    if (isFinite(wRaw)) el.style.setProperty('--panel-w', wRaw + 'px');
    var bRaw = parseFloat(shared('bottom', suffix));
    if (isFinite(bRaw)) el.style.setProperty('--panel-bottom', bRaw + 'px');

    var timing = {
      delay: ms(shared('delay', suffix), DEFAULTS.delay),
      in: ms(shared('in', suffix), DEFAULTS.in),
      hold: ms(shared('hold', suffix), DEFAULTS.hold),
      out: ms(shared('out', suffix), DEFAULTS.out),
    };
    // an infinite enter/exit/delay is meaningless — fall back rather than freeze
    if (!isFinite(timing.in)) timing.in = DEFAULTS.in * 1000;
    if (!isFinite(timing.out)) timing.out = DEFAULTS.out * 1000;
    if (!isFinite(timing.delay)) timing.delay = DEFAULTS.delay * 1000;
    el.style.setProperty('--in-dur', timing.in + 'ms');
    el.style.setProperty('--out-dur', timing.out + 'ms');

    var nameEl = el.querySelector('.name');
    var titleEl = el.querySelector('.title');
    var subEl = el.querySelector('.subtitle');

    // The name is nowrap, so a long one would otherwise run past the panel edge
    // once the panel has grown to its max width. Step it down until it fits (or
    // bottoms out, where CSS text-overflow takes over).
    function fitName() {
      if (!nameEl) return;
      nameEl.style.fontSize = '';
      for (var i = 0; i < 3; i++) {
        var avail = nameEl.clientWidth;
        if (!avail || nameEl.scrollWidth <= avail + 1) return;
        var size = parseFloat(getComputedStyle(nameEl).fontSize) * (avail / nameEl.scrollWidth);
        size = Math.max(NAME_MIN, Math.floor(size));
        nameEl.style.fontSize = size + 'px';
        if (size === NAME_MIN) return;
      }
    }

    function set(fields) {
      if (!fields) return;
      if (fields.theme) el.dataset.theme = fields.theme;
      if (nameEl && fields.name !== undefined) nameEl.textContent = fields.name;
      if (titleEl && fields.title !== undefined) titleEl.textContent = fields.title;
      if (subEl && fields.subtitle !== undefined) subEl.textContent = fields.subtitle;
      fitName();
    }

    var fromUrl = {
      theme: shared('theme', suffix) || undefined,
      name: raw('name', suffix),
      title: raw('title', suffix),
      subtitle: raw('subtitle', suffix),
    };
    // On the duo page a card nobody addressed is dropped entirely, so the same
    // page can title one speaker or two.
    var addressed = fromUrl.name !== undefined || fromUrl.title !== undefined ||
                    fromUrl.subtitle !== undefined;
    if (suffix && !addressed) {
      el.classList.add('off');
      return null;
    }
    set(fromUrl);

    var timers = [];
    function clearTimers() {
      timers.forEach(clearTimeout);
      timers = [];
    }
    function after(delay, fn) {
      if (!isFinite(delay)) return;
      timers.push(setTimeout(fn, delay));
    }

    function enter() {
      // Reflow between the classes so re-entering after an exit reliably
      // re-triggers the transition. Safe here: the intermediate state is the
      // base .l3 rule, which is where the card already sits visually (off
      // screen, opacity 0), so committing it is invisible.
      el.classList.remove('out');
      el.classList.remove('in');
      void el.offsetWidth;
      el.classList.add('in');
    }
    function exit() {
      // NO reflow between these two — that is what made the exit cut instead of
      // animate. Dropping .in falls back to the base .l3 rule, which is already
      // the off-screen/opacity-0 target AND declares no transition; forcing a
      // recalc there commits that jump instantly, leaving .out nothing to
      // animate. Mutating both classes in one task means a single style
      // recalculation, so the transition interpolates from the on-screen state.
      el.classList.remove('in');
      el.classList.add('out');
    }

    function play() {
      clearTimers();
      after(timing.delay, function () {
        enter();
        // hold starts once the card has finished sliding on
        after(timing.in + timing.hold, exit);
      });
    }
    function hide() {
      clearTimers();
      exit();
    }

    return {
      el: el, side: el.dataset.side || null,
      play: play, hide: hide, set: set, fitName: fitName,
    };
  }

  var cards = [];
  Array.prototype.forEach.call(document.querySelectorAll('.l3'), function (el) {
    var c = setupCard(el);
    if (c) cards.push(c);
  });

  function each(method) {
    return function () { cards.forEach(function (c) { c[method](); }); };
  }

  window.l3 = { cards: cards, play: each('play'), hide: each('hide') };
  cards.forEach(function (c) {
    if (c.side) window.l3[c.side] = c;
  });

  // web-font metrics differ from the fallback — re-measure once they settle
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(function () { cards.forEach(function (c) { c.fitName(); }); });
  }

  document.addEventListener('keydown', function (e) {
    if (e.key === 'r' || e.key === 'R') window.l3.play();
    if (e.key === 'h' || e.key === 'H') window.l3.hide();
  });

  window.l3.play();
})();
