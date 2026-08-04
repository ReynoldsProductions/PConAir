/*
  Shared lower-third behaviour for the side-specific L3 scenes
  (graphics/lower-third-left, graphics/lower-third-right).

  Each scene's index.html sets body[data-side] and then loads this file, which
  reads URL params, fills the card, and runs the animation timeline:

      delay ──▶ animate in ──▶ hold ──▶ animate out

  The card is non-persistent by design: it plays itself once on load, so the
  scene can be brought up over a recorded spot and will clear itself. Set
  `hold=inf` to make it stay up until hidden manually.

  URL params
  ----------
    name      headline text (falls back to the placeholder in the markup)
    title     second line
    subtitle  optional third line — omitted when empty
    theme     default | dark | dark_alt | bright | bright_info | bright_insider |
              bright_warm | palette_copper | palette_olive | palette_plum |
              palette_sage | palette_teal | palette_terracotta
    delay     wait before animating in         (default 0.4)
    in        animate-in duration              (default 0.55)
    hold      time fully on screen             (default 6)
              use `inf` / `hold` / a negative number to stay up indefinitely
    out       animate-out duration             (default 0.4)
    w         panel width in px                (default 780)
    bottom    distance from frame bottom in px (default 124 — clears the ticker)

  Durations are in SECONDS by default; suffix with `ms` for milliseconds
  (`in=550ms` === `in=0.55`).

  Manual control, for previewing or for driving from a parent page:
    window.l3.play()   replay from the top (also bound to the R key)
    window.l3.hide()   animate out now      (also bound to the H key)
    window.l3.set({name, title, subtitle, theme})
*/
(function () {
  var q = new URLSearchParams(location.search);
  var body = document.body;
  var card = document.getElementById('l3');

  var DEFAULTS = { delay: 0.4, in: 0.55, hold: 6, out: 0.4 };

  // "1.5" / "1.5s" → 1500 ; "550ms" → 550 ; "inf" / negative → Infinity
  function ms(raw, fallback) {
    if (raw == null || raw === '') return fallback * 1000;
    var s = String(raw).trim().toLowerCase();
    if (s === 'inf' || s === 'infinite' || s === 'forever' || s === 'hold') return Infinity;
    var m = /^(-?\d*\.?\d+)(ms|s)?$/.exec(s);
    if (!m) return fallback * 1000;
    var n = parseFloat(m[1]);
    if (!isFinite(n)) return fallback * 1000;
    if (n < 0) return Infinity;
    return m[2] === 'ms' ? n : n * 1000;
  }

  function px(raw, prop) {
    var n = parseFloat(raw);
    if (isFinite(n)) document.documentElement.style.setProperty(prop, n + 'px');
  }

  function setText(id, value) {
    var el = document.getElementById(id);
    if (!el || value == null) return;
    el.textContent = value;
  }

  // ── static setup: geometry + timings as CSS custom properties ──
  var timing = {
    delay: ms(q.get('delay'), DEFAULTS.delay),
    in: ms(q.get('in'), DEFAULTS.in),
    hold: ms(q.get('hold'), DEFAULTS.hold),
    out: ms(q.get('out'), DEFAULTS.out),
  };
  // an infinite enter/exit duration is meaningless — fall back rather than freeze
  if (!isFinite(timing.in)) timing.in = DEFAULTS.in * 1000;
  if (!isFinite(timing.out)) timing.out = DEFAULTS.out * 1000;
  if (!isFinite(timing.delay)) timing.delay = DEFAULTS.delay * 1000;

  document.documentElement.style.setProperty('--in-dur', timing.in + 'ms');
  document.documentElement.style.setProperty('--out-dur', timing.out + 'ms');
  px(q.get('w'), '--panel-w');
  px(q.get('bottom'), '--panel-bottom');

  // The name is nowrap, so a long one would otherwise run past the panel edge
  // once the panel has grown to its max width. Step the size down until it fits
  // (or bottoms out, where CSS text-overflow takes over).
  var NAME_MIN = 34;
  function fitName() {
    var el = document.getElementById('l3name');
    if (!el) return;
    el.style.fontSize = '';
    for (var i = 0; i < 3; i++) {
      var avail = el.clientWidth;
      if (!avail || el.scrollWidth <= avail + 1) return;
      var size = parseFloat(getComputedStyle(el).fontSize) * (avail / el.scrollWidth);
      size = Math.max(NAME_MIN, Math.floor(size));
      el.style.fontSize = size + 'px';
      if (size === NAME_MIN) return;
    }
  }

  function set(fields) {
    if (!fields) return;
    if (fields.theme) body.dataset.theme = fields.theme;
    setText('l3name', fields.name);
    setText('l3title', fields.title);
    var sub = document.getElementById('l3subtitle');
    if (sub && 'subtitle' in fields) {
      sub.textContent = fields.subtitle || '';
      sub.style.display = fields.subtitle ? '' : 'none';
    }
    fitName();
  }

  set({
    theme: q.get('theme') || undefined,
    name: q.get('name') || undefined,
    title: q.get('title') || undefined,
    subtitle: q.get('subtitle') || '',
  });

  // web-font metrics differ from the fallback — re-measure once they settle
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitName);

  // ── timeline ──
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
    // force a reflow so re-adding "in" after "out" reliably re-triggers the
    // transition instead of being coalesced into one style recalculation
    card.classList.remove('out');
    card.classList.remove('in');
    void card.offsetWidth;
    card.classList.add('in');
  }

  function exit() {
    card.classList.remove('in');
    void card.offsetWidth;
    card.classList.add('out');
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

  window.l3 = { play: play, hide: hide, set: set };

  document.addEventListener('keydown', function (e) {
    if (e.key === 'r' || e.key === 'R') play();
    if (e.key === 'h' || e.key === 'H') hide();
  });

  play();
})();
