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

  /* Registered by other specs, sampled by spec 21's debug overlay. Underscore-
     prefixed: not part of the page-author API. */
  function _diagSource(name, fn) {
    diagSources[name] = fn;
  }

  function connect(packageId, opts) {
    opts = opts || {};

    var namespace = 'package:' + packageId;
    var role = opts.role === 'control' ? 'control' : 'render';
    var renderId = opts.renderId || null;

    var ws = null;
    var closed = false;
    var timer = null;
    var attempt = 0; /* index into BACKOFF for the NEXT retry */
    var stateSubs = [];
    var connSubs = [];

    var client = {
      state: null,
      connected: false,
      patch: patch,
      on: on,
      onConnection: onConnection,
      close: close,
    };

    function wsUrl() {
      var proto = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
      /* A control page must NOT claim ?render=1 — spec 16 counts render
         subscriptions as live outputs, and a panel masquerading as one would
         make `delivered` report an output that does not exist. */
      var qs = role === 'control' ? '?control=1' : '?render=1';
      if (renderId) qs += '&renderId=' + encodeURIComponent(renderId);
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

  return {
    version: '1',
    connect: connect,
    param: param,
    isDebug: isDebug,
    _diagSource: _diagSource,
    _diagSources: diagSources,
  };
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
