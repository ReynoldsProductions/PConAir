/* PConAir Kit — designer helper library for package render pages.
   Wrap the common patterns (state-to-DOM binding, deadline clocks, ticker)
   so you can focus on design rather than plumbing.

   Load AFTER state.js:
     <script src="/packages/YOUR-ID/assets/state.js"></script>
     <script src="/packages/YOUR-ID/assets/pconair-kit.js"></script>

   Usage:
     const kit = PConAirKit.init('your-package-id');
     kit.text('#score', 'scores.0')
        .show('#winner', 'winner')
        .gameClock({ deadline: 'clock.deadline', value: 'clock.value', el: '#clock' })
        .shotClock({ deadline: 'shotEndsAt', value: 'shotClock', el: '#shot', dangerAt: 5 })
        .ticker({ messages: 'ticker.messages', speed: 'ticker.speed', track: '#track' })
        .onState(s => { /* custom logic */ });

   All methods are chainable. */

window.PConAirKit = (function () {
  'use strict';

  // Resolve dot-paths: getPath(state, 'scores.0') → state.scores[0]
  function getPath(obj, path) {
    return String(path).split('.').reduce(function (cur, key) {
      return cur != null ? cur[key] : undefined;
    }, obj);
  }

  // Parse "MM:SS" or "S" string to seconds (also accepts numbers)
  function parseClockStr(str) {
    if (typeof str === 'number') return Math.max(0, str);
    var p = String(str || '0:00').split(':');
    return p.length === 2 ? (+p[0] || 0) * 60 + (+p[1] || 0) : (+p[0] || 0);
  }

  function fmtMMSS(s) {
    if (s === null || s === undefined || isNaN(s)) return '--:--';
    var m = Math.floor(s / 60);
    var ss = Math.floor(s % 60);
    return String(m).padStart(2, '0') + ':' + String(ss).padStart(2, '0');
  }

  // ── Init ─────────────────────────────────────────────────────────────────────

  function init(packageId) {
    var state = null;
    var client = null;
    var bindings = [];      // run on every state update, for simple field→DOM mappings
    var stateHandlers = []; // run on every state update, for custom logic + ticker

    function applyAll(s) {
      var i;
      for (i = 0; i < bindings.length; i++) bindings[i](s);
      for (i = 0; i < stateHandlers.length; i++) stateHandlers[i](s);
    }

    client = window.PConAirPackage.connect(packageId, function (s) {
      state = s;
      applyAll(s);
    });

    var kit = {};

    // ── DOM bindings ──────────────────────────────────────────────────────────

    /* kit.text('#el', 'state.path') — sets element's textContent to state value. */
    kit.text = function (selector, path) {
      var el = document.querySelector(selector);
      if (el) {
        var fn = function (s) {
          var v = getPath(s, path);
          el.textContent = (v != null) ? v : '';
        };
        bindings.push(fn);
        if (state) fn(state);
      }
      return kit;
    };

    /* kit.show('#el', 'state.path') — shows element when value is truthy, hides when falsy. */
    kit.show = function (selector, path) {
      var el = document.querySelector(selector);
      if (el) {
        var fn = function (s) { el.style.display = getPath(s, path) ? '' : 'none'; };
        bindings.push(fn);
        if (state) fn(state);
      }
      return kit;
    };

    /* kit.cls('#el', 'active', 'state.path') — toggles a CSS class when value is truthy.
       Useful for driving CSS transitions: kit.cls('#l3', 'in', 'l3.visible') */
    kit.cls = function (selector, className, path) {
      var el = document.querySelector(selector);
      if (el) {
        var fn = function (s) { el.classList.toggle(className, !!getPath(s, path)); };
        bindings.push(fn);
        if (state) fn(state);
      }
      return kit;
    };

    /* kit.onState(fn) — escape hatch for custom logic that doesn't fit the above. */
    kit.onState = function (fn) {
      stateHandlers.push(fn);
      if (state) fn(state);
      return kit;
    };

    /* kit.patch({ field: value }) — shallow-merge state patch. */
    kit.patch = function (obj) { return client.patch(obj); };

    // ── Game Clock ────────────────────────────────────────────────────────────

    /* kit.gameClock({ deadline, value, el, [format] })
       Deadline-based clock: survives page reloads because the remaining time is
       computed from Date.now() vs the stored deadline epoch (ms). Falls back to
       the static `value` field when not running.
         deadline — state path to epoch-ms deadline (e.g. 'clock.deadline')
         value    — state path to seconds or "MM:SS" string (e.g. 'clock.value')
         el       — CSS selector for the display element */
    kit.gameClock = function (opts) {
      var el = document.querySelector(opts.el);
      if (!el) return kit;
      var deadlinePath = opts.deadline;
      var valuePath = opts.value;

      function remainingS() {
        if (!state) return null;
        var d = +getPath(state, deadlinePath) || 0;
        var v = getPath(state, valuePath);
        if (d > 0) return Math.max(0, (d - Date.now()) / 1000);
        return (typeof v === 'number') ? Math.max(0, v) : parseClockStr(v);
      }

      setInterval(function () { if (state) el.textContent = fmtMMSS(remainingS()); }, 250);
      return kit;
    };

    // ── Shot Clock ────────────────────────────────────────────────────────────

    /* kit.shotClock({ deadline, value, el, [dangerAt], [dangerClass] })
       Like gameClock but shows tenths of a second below dangerAt, and toggles
       a CSS class on the element for red/pulse styling.
         deadline   — state path to epoch-ms deadline (e.g. 'shotEndsAt')
         value      — state path to seconds remaining (e.g. 'shotClock')
         el         — CSS selector for the display element
         dangerAt   — seconds threshold for danger class (default: 5)
         dangerClass — CSS class to toggle when ≤ dangerAt (default: 'danger') */
    kit.shotClock = function (opts) {
      var el = document.querySelector(opts.el);
      if (!el) return kit;
      var deadlinePath = opts.deadline;
      var valuePath = opts.value;
      var dangerAt = (opts.dangerAt != null) ? opts.dangerAt : 5;
      var dangerClass = opts.dangerClass || 'danger';

      function remainingS() {
        if (!state) return null;
        var d = +getPath(state, deadlinePath) || 0;
        var v = +getPath(state, valuePath) || 0;
        if (d > 0) return Math.max(0, (d - Date.now()) / 1000);
        return Math.max(0, v);
      }

      setInterval(function () {
        if (!state) return;
        var s = remainingS();
        el.textContent = (s !== null && s <= 9.95) ? s.toFixed(1) : String(Math.ceil(s || 0));
        el.classList.toggle(dangerClass, s !== null && s <= dangerAt);
      }, 100);
      return kit;
    };

    // ── Ticker ────────────────────────────────────────────────────────────────

    /* kit.ticker({ messages, [speed], track, [defaultSpeed], [sep] })
       Builds a seamlessly looping ticker crawl. Uses pixel-per-second speed so
       all content lengths crawl at the same visual rate.
         messages     — state path to messages array (e.g. 'ticker.messages')
         speed        — state path to speed value in px/s (optional; uses defaultSpeed)
         track        — CSS selector for the crawl track element
         defaultSpeed — fallback speed in px/s (default: 80)
         sep          — separator glyph between items (default: '◆')

       Items support "lead::rest" syntax — text before "::" renders bold. */
    kit.ticker = function (opts) {
      var track = document.querySelector(opts.track);
      if (!track) return kit;
      var messagesPath = opts.messages;
      var speedPath = opts.speed;
      var defaultSpeed = opts.defaultSpeed || 80;
      var sepChar = opts.sep || '◆';

      // Inject keyframe once per page
      if (!document.getElementById('_pck_crawl_kf')) {
        var s = document.createElement('style');
        s.id = '_pck_crawl_kf';
        s.textContent = '@keyframes _pck_crawl{from{transform:translateX(0);}to{transform:translateX(-50%);}}';
        document.head.appendChild(s);
      }

      var lastKey = '';

      function buildRun(items) {
        var frag = document.createDocumentFragment();
        (items || []).forEach(function (raw) {
          var sepIdx = String(raw).indexOf('::');
          var item = document.createElement('span');
          item.className = 'ticker-item';
          if (sepIdx >= 0) {
            var b = document.createElement('b');
            b.textContent = raw.slice(0, sepIdx);
            item.appendChild(b);
            item.appendChild(document.createTextNode(raw.slice(sepIdx + 2)));
          } else {
            item.textContent = raw;
          }
          var dot = document.createElement('span');
          dot.className = 'ticker-sep';
          dot.textContent = ' ' + sepChar + ' ';
          frag.appendChild(item);
          frag.appendChild(dot);
        });
        return frag;
      }

      function rebuild(items, speed) {
        track.style.animation = 'none';
        track.innerHTML = '';
        if (!items || items.length === 0) return;
        track.appendChild(buildRun(items));
        track.appendChild(buildRun(items)); // duplicate → seamless -50% loop
        // Two rAFs: first flushes layout, second measures painted width
        requestAnimationFrame(function () {
          requestAnimationFrame(function () {
            var w = track.scrollWidth / 2; // one run's pixel width
            var spd = Math.max(10, +speed || defaultSpeed);
            var dur = (w / spd).toFixed(2);
            track.style.animation = '_pck_crawl ' + dur + 's linear infinite';
          });
        });
      }

      stateHandlers.push(function (s) {
        var items = getPath(s, messagesPath) || [];
        var speed = speedPath ? (getPath(s, speedPath) || defaultSpeed) : defaultSpeed;
        var key = JSON.stringify([items, speed]);
        if (key !== lastKey) {
          lastKey = key;
          rebuild(items, speed);
        }
      });
      return kit;
    };

    return kit;
  }

  return { init: init };
})();
