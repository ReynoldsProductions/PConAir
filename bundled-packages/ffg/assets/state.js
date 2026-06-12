/* PConAir package state client.
   Subscribes to this package's namespace over the PConAir WebSocket and
   re-hydrates on every (re)connect, so a browser-source reload is harmless.
   Mutations go through POST /api/packages/<id>/state (shallow merge). */
window.PConAirPackage = (function () {
  'use strict';

  function connect(packageId, onState) {
    var namespace = 'package:' + packageId;
    var ws = null;
    var closed = false;

    function open() {
      if (closed) return;
      var proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
      ws = new WebSocket(proto + location.host + '/ws?render=1');
      ws.onopen = function () {
        ws.send(JSON.stringify({ type: 'subscribe', namespace: namespace }));
      };
      ws.onmessage = function (e) {
        var msg;
        try { msg = JSON.parse(e.data); } catch (err) { return; }
        // The initial AppState snapshot uses `payload`; namespace frames carry `state`.
        if (msg && msg.type === 'state' && msg.namespace === namespace && msg.state) onState(msg.state);
      };
      ws.onclose = function () { setTimeout(open, 2000); };
      ws.onerror = function () { try { ws.close(); } catch (err) { /* ignore */ } };
    }
    open();

    return {
      patch: function (p) {
        return fetch('/api/packages/' + packageId + '/state', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(p),
        });
      },
      close: function () {
        closed = true;
        try { if (ws) ws.close(); } catch (err) { /* ignore */ }
      },
    };
  }

  return { connect: connect };
})();
