/* PConAir shared package runtime — served at /packages/_runtime/pconair.js.
   See specs/14-package-control-runtime.md for the contract; specs 15-23 are
   written against it, so treat the public surface as stable.

   Replaces the per-package assets/state.js that every graphics package used to
   ship a byte-identical copy of. ES5-safe, no modules, no build step: these
   pages are loaded by OBS/vMix browser sources and by plain BrowserWindows. */
window.PConAir = (function () {
  'use strict';

  /* Reconnect delays, in ms. A stopped server used to get one attempt every
     2s forever (~1,800/hour from a control page left open overnight); this
     widens out and holds at 15s. Reset to the head of the list on a
     successful open, so a brief blip still recovers fast. */
  var BACKOFF = [1000, 2000, 4000, 8000, 15000];

  var diagSources = {};

  function param(key, fallback) {
    var dflt = fallback === undefined ? null : fallback;
    try {
      var v = new URLSearchParams(window.location.search).get(key);
      return v === null ? dflt : v;
    } catch (e) {
      return dflt;
    }
  }

  function isDebug() {
    return param('debug') === '1';
  }

  function warn(message) {
    /* Spec 21: push a message into the debug overlay's warnings row.
       No-op when overlay is not active. */
    if (typeof window !== 'undefined' && window._pconairWarn) {
      window._pconairWarn(message);
    }
  }


  /* Registered by other specs, sampled by spec 21's debug overlay. Underscore-
     prefixed: not part of the page-author API. */
  function _diagSource(name, fn) {
    diagSources[name] = fn;
  }

  /* ── Dotted paths (spec 18 §3.5) ──────────────────────────────────────
     One implementation of the convention Companion field paths, transient
     fields and now control fields all share. Array indices work because a
     numeric key indexes an array in JS anyway: getPath(s, 'scores.0'). */
  function getPath(obj, dotted) {
    if (obj === null || obj === undefined) return undefined;
    var parts = String(dotted).split('.');
    var cur = obj;
    for (var i = 0; i < parts.length; i++) {
      if (cur === null || cur === undefined) return undefined;
      cur = cur[parts[i]];
    }
    return cur;
  }

  /* Copy-on-write set along a dotted path. Returns a new value for `base`. */
  function setPathIn(base, parts, value) {
    if (parts.length === 0) return value;
    var key = parts[0];
    var rest = parts.slice(1);
    var next;
    if (/^\d+$/.test(key)) {
      next = Object.prototype.toString.call(base) === '[object Array]' ? base.slice() : [];
      next[Number(key)] = setPathIn(next[Number(key)], rest, value);
      return next;
    }
    next = {};
    if (base && typeof base === 'object' && Object.prototype.toString.call(base) !== '[object Array]') {
      for (var k in base) {
        if (Object.prototype.hasOwnProperty.call(base, k)) next[k] = base[k];
      }
    }
    next[key] = setPathIn(next[key], rest, value);
    return next;
  }

  /* Build a patch for POST /api/packages/:id/state, which SHALLOW-merges at
     the top level. So a change to "home.score" has to carry `home`'s other
     keys with it or they are dropped — read them out of `state`. */
  function buildPatch(state, dotted, value) {
    var parts = String(dotted).split('.');
    var patch = {};
    var top = parts[0];
    patch[top] = parts.length === 1 ? value : setPathIn(state ? state[top] : undefined, parts.slice(1), value);
    return patch;
  }

  /* Several dotted paths in one patch, siblings preserved throughout. Used by
     spec 18's `action` fields, whose declared patch may touch more than one
     path under the same top-level key. */
  function buildPatchMulti(state, entries) {
    var patch = {};
    for (var i = 0; i < entries.length; i++) {
      var parts = String(entries[i].path).split('.');
      var top = parts[0];
      var base = Object.prototype.hasOwnProperty.call(patch, top) ? patch[top] : (state ? state[top] : undefined);
      patch[top] =
        parts.length === 1 ? entries[i].value : setPathIn(base, parts.slice(1), entries[i].value);
    }
    return patch;
  }

  /* ── CSS value safety (spec 18 §3.3) ─────────────────────────────────
     A control's value reaches a CSS custom property on a live render's
     <html style="...">. Anything that can terminate a declaration or open a
     function call is refused, so a value cannot become a CSS injection into
     every connected output. Mirrors isSafeStyleValue/isValidColorValue in
     src/main/packages/controls-validate.ts, which enforces the same rules
     server-side before a value ever enters state. Both halves exist on
     purpose: the server is the gate, this is the last line of defence. */
  var UNSAFE_STYLE_FRAGMENTS = [';', '}', '{', '/*', '*/', 'url(', '\\'];

  var NAMED_COLORS = [
    'transparent', 'currentcolor', 'black', 'white', 'red', 'green', 'blue',
    'yellow', 'orange', 'purple', 'pink', 'brown', 'gray', 'grey', 'cyan',
    'magenta', 'silver', 'gold', 'navy', 'teal', 'olive', 'maroon', 'lime',
    'aqua', 'fuchsia',
  ];

  function isSafeStyleValue(v) {
    if (typeof v === 'number') return isFinite(v);
    if (typeof v === 'boolean') return true;
    if (typeof v !== 'string') return false;
    var lower = v.toLowerCase();
    for (var i = 0; i < UNSAFE_STYLE_FRAGMENTS.length; i++) {
      if (lower.indexOf(UNSAFE_STYLE_FRAGMENTS[i]) !== -1) return false;
    }
    if (lower.indexOf('(') !== -1 || lower.indexOf(')') !== -1) return false;
    return true;
  }

  function isValidColorValue(v) {
    if (typeof v !== 'string' || v.length === 0) return false;
    if (!isSafeStyleValue(v)) return false;
    if (/^#[0-9a-fA-F]{3,8}$/.test(v)) return true;
    for (var i = 0; i < NAMED_COLORS.length; i++) {
      if (NAMED_COLORS[i] === v.toLowerCase()) return true;
    }
    return false;
  }

  /* camelCase -> kebab-case, for state key -> custom property name. */
  function kebab(key) {
    return String(key).replace(/[A-Z]/g, function (m) {
      return '-' + m.toLowerCase();
    });
  }

  /* ── The generated control panel (spec 18 §3.4) ───────────────────────
     The renderer itself lives in pconair-controls.js, which registers here.
     Kept out of this file so a render page — which never needs a panel —
     does not download it. The generated shell loads both scripts; a
     hand-written control.html that wants to call controlPanel() for part of
     its page must do the same (docs/designing-packages.md). */
  var controlPanelImpl = null;

  function _registerControlPanel(fn) {
    controlPanelImpl = fn;
  }

  function controlPanel(el, opts) {
    if (!controlPanelImpl) {
      throw new Error(
        'PConAir.controlPanel requires the panel renderer — add ' +
          '<script src="/packages/_runtime/pconair-controls.js"></script> after pconair.js'
      );
    }
    return controlPanelImpl(el, opts);
  }

  function connect(packageId, opts) {
    opts = opts || {};

    var namespace = 'package:' + packageId;
    var role = opts.role === 'control' ? 'control' : 'render';
    /* Which render this page is. Explicit opts wins; otherwise read it off
       <html data-render-id="...">. The attribute exists because ffg-common.js
       and pconair-kit.js are shared by several renders apiece and cannot
       hardcode one id — so each render page declares its identity once,
       declaratively, the same way specs 15 and 22 use data-* attributes. */
    var renderId =
      opts.renderId ||
      (document.documentElement && document.documentElement.getAttribute('data-render-id')) ||
      null;

    var ws = null;
    var closed = false;
    var timer = null;
    var attempt = 0; /* index into BACKOFF for the NEXT retry */
    var stateSubs = [];
    var connSubs = [];
    var presenceSubs = [];
    var warningsSubs = [];
    var transportSubs = [];
    /* Whether a transport frame (one where this renderId has a _transport
       entry) has been applied yet — gates the once-per-page-load late-join
       correction below (spec 15 section 3.6). */
    var sawTransportFrame = false;

    var client = {
      state: null,
      connected: false,
      /* PackagePresence for this package | null before the first frame
         arrives (spec 16). Narrowed to this page's own render by nothing —
         presenceIndicator's opts.renderId does that narrowing, not this
         field, which always carries the whole-package counts. */
      presence: null,
      /* Map of renderId -> FitWarning[] for this package (spec 22). Starts
         empty, not null -- "no warnings yet" and "nothing has ever been
         checked" look the same from a page that just connected, and
         warningsPanel needs an object it can iterate immediately. */
      warnings: {},
      transport: null,
      patch: patch,
      on: on,
      onPresence: onPresence,
      onWarnings: onWarnings,
      onConnection: onConnection,
      onTransport: onTransport,
      verb: verb,
      applyStyle: applyStyle,
      close: close,
    };

    /* Mirror a state subtree onto :root as CSS custom properties, on every
       frame (spec 18 §3.3). This is what makes the "Look" group actually
       restyle a live render:

         { accent: '#c8a24a', panelOpacity: 0.9 }
           -> --pc-accent: #c8a24a; --pc-panel-opacity: 0.9

       camelCase becomes kebab-case and numbers pass through unitless, so a
       render authors against `rgb(0 0 0 / var(--pc-panel-opacity))` and
       `calc(var(--pc-corner) * 1px)` and never touches JS.

       Values are filtered through isSafeStyleValue: these land in a style
       attribute, so an unvalidated one is a CSS injection into every output.
       An unsafe value is DROPPED — the previously-applied value stays, which
       is a stale graphic rather than a broken one. Nested objects are
       skipped; only scalar leaves become properties. */
    function applyStyle(subtree, prefix) {
      var key = subtree === undefined ? 'style' : subtree;
      var pfx = prefix === undefined ? '--pc-' : prefix;

      function apply(s) {
        var tree = key ? getPath(s, key) : s;
        if (!tree || typeof tree !== 'object') return;
        var root = document.documentElement;
        if (!root.style || !root.style.setProperty) return;
        for (var k in tree) {
          if (!Object.prototype.hasOwnProperty.call(tree, k)) continue;
          var v = tree[k];
          if (v === null || v === undefined) continue;
          if (typeof v === 'object') continue; /* only scalar leaves */
          if (!/^[A-Za-z0-9_-]+$/.test(k)) {
            warn('applyStyle: skipped unsafe property name ' + JSON.stringify(k));
            continue;
          }
          if (!isSafeStyleValue(v)) {
            warn('applyStyle: dropped unsafe value for ' + k + ': ' + JSON.stringify(v));
            continue;
          }
          root.style.setProperty(pfx + kebab(k), String(v));
        }
      }

      var off = on(apply);
      return {
        destroy: function () { off(); },
      };
    }

    function wsUrl() {
      var proto = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
      /* A control page must NOT claim ?render=1 — spec 16 counts render
         subscriptions as live outputs, and a panel masquerading as one would
         make `delivered` report an output that does not exist. */
      var qs = role === 'control' ? '?control=1' : '?render=1';
      if (renderId) qs += '&renderId=' + encodeURIComponent(renderId);
      /* Spec 17 §3.3: a control page's live preview iframe loads this same
         render page with ?preview=1 in its own URL. Forwarding that onto the
         WS URL lets the server exclude this one socket from presence/
         `delivered` while it still subscribes and renders normally — a
         preview must be genuinely live, just never counted as an output. */
      if (param('preview') === '1') qs += '&preview=1';
      return proto + window.location.host + '/ws' + qs;
    }

    function setConnected(next) {
      if (client.connected === next) return;
      client.connected = next;
      for (var i = 0; i < connSubs.length; i++) {
        try { connSubs[i](next); } catch (e) { /* a bad subscriber must not stop the rest */ }
      }
    }

    function emitState(s) {
      client.state = s;
      for (var i = 0; i < stateSubs.length; i++) {
        try { stateSubs[i](s); } catch (e) { /* as above */ }
      }
      applyTransportFrame(s);
    }

    /* Drives <html data-phase data-step> and --pc-phase-ms from this page's
       renderId slice of state._transport, and emits to onTransport()
       subscribers. A render with no _transport entry for this renderId is
       not transport-managed (or has not been dispatched yet): client.transport
       is null and the attributes are removed rather than left stale. */
    function applyTransportFrame(s) {
      var map = s && s._transport;
      var t = (map && renderId && typeof map === 'object') ? map[renderId] : null;
      var html = document.documentElement;

      if (t) {
        var isLateJoin = !sawTransportFrame && (Date.now() - t.phaseStartedAt > 120);
        sawTransportFrame = true;
        if (isLateJoin && html.setAttribute) {
          /* Suppress CSS transitions for one frame so a browser source that
             opened mid-show snaps straight to the correct state instead of
             animating in from idle. */
          html.setAttribute('data-phase-jump', '');
          void html.offsetHeight; /* force reflow */
          html.removeAttribute('data-phase-jump');
        }
        html.setAttribute('data-phase', t.phase);
        html.setAttribute('data-step', String(t.step));
        if (html.style && html.style.setProperty) {
          html.style.setProperty('--pc-phase-ms', String(t.phaseMs));
        }
      } else {
        html.removeAttribute('data-phase');
        html.removeAttribute('data-step');
        if (html.style && html.style.removeProperty) {
          html.style.removeProperty('--pc-phase-ms');
        }
      }

      client.transport = t || null;
      for (var i = 0; i < transportSubs.length; i++) {
        try { transportSubs[i](client.transport); } catch (e) { /* a bad subscriber must not stop the rest */ }
      }
    }

    function onTransport(fn) {
      transportSubs.push(fn);
      if (client.state) {
        try { fn(client.transport); } catch (e) { /* ignore */ }
      }
      return function () {
        var i = transportSubs.indexOf(fn);
        if (i >= 0) transportSubs.splice(i, 1);
      };
    }

    /* POST a transport verb ('play'|'next'|'stop'|'clear') for this page's
       renderId. Resolves to the parsed response body, same contract as
       patch().

       `forRenderId` overrides this page's own renderId. A control page's
       client has no renderId of its own (it is not a render), so spec 18's
       `transport` control field — which names the render it drives in the
       manifest — passes it explicitly. Omitting the argument is unchanged
       spec 15 behaviour. */
    function verb(name, forRenderId) {
      var target = forRenderId === undefined || forRenderId === null ? renderId : forRenderId;
      var url =
        '/api/packages/' + encodeURIComponent(packageId) +
        '/transport/' + encodeURIComponent(target || '') +
        '/' + encodeURIComponent(name);
      return window
        .fetch(url, { method: 'POST' })
        .then(function (res) {
          return res.text().then(function (text) {
            var body = null;
            try { body = text ? JSON.parse(text) : null; } catch (e) { body = null; }
            if (!res.ok) {
              var msg =
                (body && body.error && body.error.message) ||
                (body && body.message) ||
                'verb failed with status ' + res.status;
              var err = new Error(msg);
              err.status = res.status;
              err.body = body;
              throw err;
            }
            return body;
          });
        });
    }

    function emitPresence(p) {
      client.presence = p;
      for (var i = 0; i < presenceSubs.length; i++) {
        try { presenceSubs[i](p); } catch (e) { /* as above */ }
      }
    }

    /* One renderId's slot at a time (spec 22): an empty list clears that
       render's entry entirely rather than leaving a stale `[]` around, so
       warningsPanel's "any warnings at all?" check stays a plain key count. */
    function emitWarnings(renderId, warnings) {
      if (warnings && warnings.length > 0) {
        client.warnings[renderId] = warnings;
      } else {
        delete client.warnings[renderId];
      }
      for (var i = 0; i < warningsSubs.length; i++) {
        try { warningsSubs[i](client.warnings); } catch (e) { /* as above */ }
      }
    }

    function open() {
      if (closed) return;
      timer = null;
      ws = new window.WebSocket(wsUrl());
      ws.onopen = function () {
        attempt = 0;
        setConnected(true);
        /* Re-subscribing on every open is what makes a reload harmless: the
           server answers with a full namespace snapshot, so the page rehydrates
           rather than waiting for the next change. */
        ws.send(JSON.stringify({ type: 'subscribe', namespace: namespace }));
      };
      ws.onmessage = function (e) {
        var msg;
        try { msg = JSON.parse(e.data); } catch (err) { return; }
        /* Namespace frames carry `state`. The server also pushes the whole
           AppState as `payload` on some channels — not ours, ignore it. */
        if (msg && msg.type === 'state' && msg.namespace === namespace && msg.state) {
          emitState(msg.state);
        }
        /* Output presence (spec 16): pushed whenever a render/control page
           joins or leaves this package's namespace. */
        if (msg && msg.type === 'presence' && msg.namespace === namespace && msg.presence) {
          emitPresence(msg.presence);
        }
        if (msg && msg.type === 'warnings' && msg.namespace === namespace && typeof msg.renderId === 'string') {
          emitWarnings(msg.renderId, msg.warnings);
        }
      };
      ws.onclose = function () {
        setConnected(false);
        if (closed) return;
        var delay = BACKOFF[attempt < BACKOFF.length ? attempt : BACKOFF.length - 1];
        attempt++;
        timer = window.setTimeout(open, delay);
      };
      ws.onerror = function () {
        try { ws.close(); } catch (e) { /* onclose handles the retry */ }
      };
    }

    /* Shallow-merge patch. Resolves to the parsed body (which from spec 16
       onward carries `delivered`), not the raw Response — callers need to read
       it, and every caller having to .json() it was a trap. */
    function patch(partial) {
      return window
        .fetch('/api/packages/' + encodeURIComponent(packageId) + '/state', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(partial),
        })
        .then(function (res) {
          return res.text().then(function (text) {
            var body = null;
            try { body = text ? JSON.parse(text) : null; } catch (e) { body = null; }
            if (!res.ok) {
              var msg =
                (body && body.error && body.error.message) ||
                (body && body.message) ||
                'patch failed with status ' + res.status;
              var err = new Error(msg);
              err.status = res.status;
              err.body = body;
              throw err;
            }
            return body;
          });
        });
    }

    function on(fn) {
      stateSubs.push(fn);
      /* Fire immediately when state is already known, so a subscriber added
         after the first frame is not left blank until the next change. */
      if (client.state) {
        try { fn(client.state); } catch (e) { /* ignore */ }
      }
      return function () {
        var i = stateSubs.indexOf(fn);
        if (i >= 0) stateSubs.splice(i, 1);
      };
    }

    function onPresence(fn) {
      presenceSubs.push(fn);
      if (client.presence) {
        try { fn(client.presence); } catch (e) { /* ignore */ }
      }
      return function () {
        var i = presenceSubs.indexOf(fn);
        if (i >= 0) presenceSubs.splice(i, 1);
      };
    }

    function onWarnings(fn) {
      warningsSubs.push(fn);
      /* Fire immediately, same reasoning as on()/onPresence: a subscriber
         added after the first frame should not be blank until the next
         change. An empty {} the first time through is still meaningful --
         it says "no warnings reported yet", which is the correct initial
         render for a panel that mounts before anything has misbehaved. */
      try { fn(client.warnings); } catch (e) { /* ignore */ }
      return function () {
        var i = warningsSubs.indexOf(fn);
        if (i >= 0) warningsSubs.splice(i, 1);
      };
    }

    function onConnection(fn) {
      connSubs.push(fn);
      return function () {
        var i = connSubs.indexOf(fn);
        if (i >= 0) connSubs.splice(i, 1);
      };
    }

    function close() {
      closed = true;
      if (timer) {
        window.clearTimeout(timer);
        timer = null;
      }
      try { if (ws) ws.close(); } catch (e) { /* ignore */ }
    }

    if (opts.onState) on(opts.onState);
    open();
    return client;
  }

  /* Drop-in presence LED + label (spec 16), so no control page hand-rolls
     one. `opts.renderId` narrows the count to a single render; otherwise it
     reports the whole package's render count. The element gets
     data-presence="none"|"ok" — pconair.css supplies the red/green dot. */
  function presenceIndicator(el, client, opts) {
    opts = opts || {};
    var renderId = opts.renderId || null;

    function countFor(p) {
      if (!p) return 0;
      if (renderId) return (p.byRender && p.byRender[renderId]) || 0;
      return p.renders || 0;
    }

    function render(p) {
      var n = countFor(p);
      el.setAttribute('data-presence', n > 0 ? 'ok' : 'none');
      el.textContent = n === 0 ? 'no output connected' : n === 1 ? '1 output' : n + ' outputs';
    }

    render(client.presence);
    var off = client.onPresence(render);
    return {
      destroy: function () { off(); },
    };
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* One warning's sentence, per spec 22 s3.3: matches the format
     window.PConAir.warn() uses on the render side, so an operator reading
     the control page sees the identical wording a ?debug=1 render would. */
  function formatFitWarning(w) {
    return w.field + ' \u2014 "' + w.text + '" is ' + w.naturalWidth + 'px in a ' +
      w.maxWidth + 'px box (min scale ' + w.min + ')';
  }

  /* Live overflow-warnings list (spec 22). Renders nothing when there are
     none -- opts.renderId narrows to one render's warnings; omitted, every
     render this package has reported shows up, newest-registered render
     first isn't guaranteed (object key order), which is fine: there is
     rarely more than one live warning at a time. */
  function warningsPanel(el, client, opts) {
    opts = opts || {};
    var renderId = opts.renderId || null;

    function flatten(map) {
      var out = [];
      for (var rid in map) {
        if (Object.prototype.hasOwnProperty.call(map, rid) === false) continue;
        if (renderId && rid !== renderId) continue;
        var list = map[rid] || [];
        for (var i = 0; i < list.length; i++) out.push(list[i]);
      }
      return out;
    }

    function render(map) {
      var list = flatten(map);
      if (list.length === 0) {
        el.innerHTML = '';
        el.hidden = true;
        return;
      }
      el.hidden = false;
      var html = '';
      for (var i = 0; i < list.length; i++) {
        html += '<div class="pc-warning">' + escapeHtml(formatFitWarning(list[i])) + '</div>';
      }
      el.innerHTML = html;
    }

    render(client.warnings);
    var off = client.onWarnings(render);
    return {
      destroy: function () { off(); },
    };
  }

  var PREVIEW_BACKDROPS = ['checker', 'black', 'white', 'green'];
  var PREVIEW_BACKDROP_KEY = 'pconair.preview.backdrop';

  function readStoredBackdrop() {
    try {
      var v = window.localStorage.getItem(PREVIEW_BACKDROP_KEY);
      return v && indexOfStr(PREVIEW_BACKDROPS, v) >= 0 ? v : null;
    } catch (e) {
      return null;
    }
  }

  function writeStoredBackdrop(name) {
    try {
      window.localStorage.setItem(PREVIEW_BACKDROP_KEY, name);
    } catch (e) { /* per-viewer convenience only — a throwing store is not fatal */ }
  }

  function indexOfStr(arr, v) {
    for (var i = 0; i < arr.length; i++) {
      if (arr[i] === v) return i;
    }
    return -1;
  }

  /* Live preview of one render, mounted into `el` (spec 17). The iframe loads
     the render's own page with ?scale=contain&bg=<backdrop>&preview=1 — no
     second scaling path, no canvas capture, genuinely the same render pages
     an output uses. See specs/17-control-preview.md §3.1-3.3. */
  function preview(el, opts) {
    opts = opts || {};
    var packageId = opts.packageId;
    var curRenderId = opts.renderId;
    var width = opts.width || 480;
    var height = Math.round((width * 9) / 16);
    var curBackdrop = opts.backdrop || readStoredBackdrop() || 'checker';
    var bust = 0;

    var root = document.createElement('div');
    root.className = 'pc-preview';
    root.setAttribute('data-backdrop', curBackdrop);

    var viewport = document.createElement('div');
    viewport.className = 'pc-preview-viewport';
    viewport.style.width = width + 'px';
    viewport.style.height = height + 'px';

    var iframe = document.createElement('iframe');
    iframe.className = 'pc-preview-frame';
    iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin');
    iframe.title = 'Preview';
    iframe.style.width = '1920px';
    iframe.style.height = '1080px';
    iframe.style.transformOrigin = 'top left';
    iframe.style.transform = 'scale(' + width / 1920 + ')';

    function frameSrc() {
      var src =
        '/packages/' + encodeURIComponent(packageId) +
        '/render/' + encodeURIComponent(curRenderId) +
        '?scale=contain&bg=' + encodeURIComponent(curBackdrop) + '&preview=1';
      if (bust) src += '&_=' + bust;
      return src;
    }

    function updateSrc() {
      iframe.src = frameSrc();
    }
    updateSrc();
    viewport.appendChild(iframe);

    var bar = document.createElement('div');
    bar.className = 'pc-preview-bar';

    var presenceEl = document.createElement('span');
    presenceEl.className = 'pc-preview-presence';
    bar.appendChild(presenceEl);

    var backdropsWrap = document.createElement('div');
    backdropsWrap.className = 'pc-preview-backdrops';

    var backdropButtons = [];
    function updateBackdropButtons() {
      for (var i = 0; i < backdropButtons.length; i++) {
        var btn = backdropButtons[i];
        var active = btn.getAttribute('data-backdrop-option') === curBackdrop;
        if (btn.classList) btn.classList.toggle('pc-preview-backdrop-active', active);
      }
    }

    (function buildBackdropButtons() {
      for (var i = 0; i < PREVIEW_BACKDROPS.length; i++) {
        var name = PREVIEW_BACKDROPS[i];
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'pc-preview-backdrop-btn';
        btn.setAttribute('data-backdrop-option', name);
        btn.title = name;
        /* title alone is not a reliable accessible name (inconsistent
           screen-reader support, absent on touch) -- these are otherwise
           unlabelled color swatches, so aria-label is the real fix. */
        btn.setAttribute('aria-label', name + ' backdrop');
        btn.addEventListener('click', (function (n) {
          return function () { setBackdrop(n); };
        })(name));
        backdropButtons.push(btn);
        backdropsWrap.appendChild(btn);
      }
    })();
    bar.appendChild(backdropsWrap);

    var reloadBtn = document.createElement('button');
    reloadBtn.type = 'button';
    reloadBtn.className = 'pc-preview-reload';
    reloadBtn.title = 'Reload preview';
    reloadBtn.setAttribute('aria-label', 'Reload preview');
    reloadBtn.textContent = '↻';
    reloadBtn.addEventListener('click', function () { reload(); });
    bar.appendChild(reloadBtn);

    root.appendChild(viewport);
    root.appendChild(bar);
    el.appendChild(root);

    /* A lightweight control-role connection, used only to read presence for
       the previewed render — never a render subscription, so it never adds
       to the count it exists to display (spec 16 semantics apply as-is). */
    var client = connect(packageId, { role: 'control' });
    var presenceHandle = presenceIndicator(presenceEl, client, { renderId: curRenderId });

    updateBackdropButtons();

    function setRender(renderId) {
      curRenderId = renderId;
      updateSrc();
      /* Re-narrow the presence indicator to the newly previewed render. */
      presenceHandle.destroy();
      presenceHandle = presenceIndicator(presenceEl, client, { renderId: curRenderId });
    }

    function setBackdrop(name) {
      if (indexOfStr(PREVIEW_BACKDROPS, name) < 0) return;
      curBackdrop = name;
      root.setAttribute('data-backdrop', name);
      updateSrc();
      updateBackdropButtons();
      writeStoredBackdrop(name);
    }

    function reload() {
      bust = Date.now();
      updateSrc();
    }

    function destroy() {
      presenceHandle.destroy();
      client.close();
      if (root.parentNode) root.parentNode.removeChild(root);
    }

    return {
      setRender: setRender,
      setBackdrop: setBackdrop,
      reload: reload,
      destroy: destroy,
    };
  }

  return {
    version: '1',
    connect: connect,
    param: param,
    isDebug: isDebug,
    presenceIndicator: presenceIndicator,
    warningsPanel: warningsPanel,
    preview: preview,
    /* Spec 18: the generated operator panel. controlPanel throws a message
       naming the missing script when pconair-controls.js has not loaded. */
    controlPanel: controlPanel,
    _registerControlPanel: _registerControlPanel,
    /* Dotted-path and patch helpers — public because packages, the kit and
       the panel all need the same convention. */
    getPath: getPath,
    buildPatch: buildPatch,
    buildPatchMulti: buildPatchMulti,
    /* CSS value safety, shared with the panel renderer. */
    isSafeStyleValue: isSafeStyleValue,
    isValidColorValue: isValidColorValue,
    _diagSource: _diagSource,
    _diagSources: diagSources,
    warn: warn,
    /* Test-only: lets tests assert this stays byte-identical to
       pconair-fit.js's own formatWarning, so a render-side ?debug=1 warning
       and a control-side warningsPanel entry read as the same sentence. */
    _formatFitWarningForTest: formatFitWarning,
  };
})();

/* Conditionally load the debug overlay when query params are present.
   Spec 21's overlay is loaded only when needed (debug=1, scale=contain, or bg=...)
   so production browser sources with no debug params pay zero cost. */
(function () {
  'use strict';
  var debug = window.PConAir.param('debug') === '1';
  var scale = window.PConAir.param('scale');
  var bg = window.PConAir.param('bg');
  if (debug || scale || bg) {
    var script = document.createElement('script');
    script.src = '/packages/_runtime/pconair-debug.js';
    document.head.appendChild(script);
  }
})();

/* Conditionally load the text-fit engine (spec 22) when the page has, or
   later gains, a [data-fit] element. A page with none never fetches it. The
   MutationObserver here is a one-shot trigger only -- once pconair-fit.js
   loads it takes over its own ongoing observation; this one disconnects
   itself the moment it has done its job. */
(function () {
  'use strict';
  function hasFit(root) {
    return !!(root && root.querySelector && root.querySelector('[data-fit]'));
  }
  function load() {
    var script = document.createElement('script');
    script.src = '/packages/_runtime/pconair-fit.js';
    document.head.appendChild(script);
  }
  if (typeof document === 'undefined') return;
  if (hasFit(document)) {
    load();
    return;
  }
  if (typeof window.MutationObserver === 'function') {
    var loaded = false;
    /* Guarded defensively, not just for the one-shot case above: a test
       harness that re-evaluates this whole file many times against one
       shared document (every spec's own runtime tests do exactly this, via
       `new Function(source)()`) leaves one of these observers alive per
       load with no way to reach in and disconnect it, since it is anonymous
       and never exposed. If a *later* reload's DOM churn fires an *earlier*
       instance's callback after that instance's own module scope is
       otherwise done with, an uncaught ReferenceError here does not just
       fail silently -- thrown from inside a MutationObserver callback, it
       can interrupt whatever microtask queue jsdom dispatches it on in the
       same tick, corrupting unrelated assertions elsewhere in the same test
       file (this is exactly what broke several of specs 18's tests once
       merged next to this file). try/catch plus an explicit typeof guard is
       the fix: this loader's only job is a best-effort trigger, so silently
       giving up beats throwing into code that has nothing to do with it. */
    var mo = new window.MutationObserver(function () {
      try {
        if (loaded || typeof document === 'undefined' || !hasFit(document)) return;
        loaded = true;
        mo.disconnect();
        load();
      } catch (e) {
        try { mo.disconnect(); } catch (e2) { /* ignore */ }
      }
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });
  }
})();

/* Compatibility shim for packages installed from outside this repo that still
   call the old API. The old *path* (/packages/<id>/assets/state.js) is gone and
   will 404 — see docs/designing-packages.md. Keep until a major version. */
window.PConAirPackage = {
  connect: function (packageId, onState) {
    var c = window.PConAir.connect(packageId, { onState: onState });
    return { patch: c.patch, close: c.close };
  },
};
