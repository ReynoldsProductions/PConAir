/**
 * The talent-facing prompter display. Read-only: it hydrates from
 * `GET /api/prompter/view` (which also hands it the server clock, so a device
 * with a skewed clock still lands on the right line) and then follows live
 * state over the public `?graphics=1` WebSocket, exactly like the render pages.
 *
 * Scroll position is derived from the state anchor every frame rather than
 * accumulated locally, so a reload, a dropped Wi-Fi link, or a second display
 * joining halfway through all land on the same line.
 *
 * Per-display overrides come from the query string, because one rig's glass
 * needs mirroring while the confidence monitor beside it does not:
 *   ?mirror=x|y|xy|none  ?font=<px>  ?line=<0-100>  ?theme=white|amber|green
 *   ?width=<px>          ?indicator=0
 */
export const PROMPTER_PAGE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="color-scheme" content="dark" />
<title>PConAir prompter</title>
<style>
  :root {
    --ink: #ffffff;
    --note: rgba(255,255,255,0.45);
    --rule: rgba(255,140,0,0.85);
  }
  html, body {
    margin: 0; padding: 0; height: 100%; background: #000; overflow: hidden;
    -webkit-text-size-adjust: none; touch-action: none; cursor: none;
  }
  #flip { position: fixed; inset: 0; overflow: hidden; }
  #script {
    position: absolute; left: 0; right: 0; top: 0;
    margin: 0 auto; padding: 0 6vw;
    color: var(--ink);
    font-family: 'Helvetica Neue', Helvetica, Arial, system-ui, sans-serif;
    font-weight: 600;
    letter-spacing: 0.005em;
    text-align: left;
    will-change: transform;
  }
  #script p { margin: 0 0 0.55em 0; white-space: pre-wrap; overflow-wrap: break-word; }
  #script p.note { color: var(--note); font-style: italic; font-weight: 500; }
  #empty {
    position: fixed; inset: 0; display: flex; align-items: center; justify-content: center;
    color: rgba(255,255,255,0.35); font-family: system-ui, sans-serif; font-size: 24px;
    text-align: center; padding: 0 10vw;
  }
  #empty.hidden { display: none; }
  #rule {
    position: fixed; left: 0; right: 0; height: 0;
    border-top: 3px solid var(--rule); opacity: 0.7; pointer-events: none;
  }
  #rule.hidden { display: none; }
  #rule::before, #rule::after {
    content: ''; position: absolute; top: -9px; border: 8px solid transparent;
  }
  #rule::before { left: 0; border-left-color: var(--rule); }
  #rule::after { right: 0; border-right-color: var(--rule); }
  #fade-top, #fade-bottom { position: fixed; left: 0; right: 0; height: 12vh; pointer-events: none; }
  #fade-top { top: 0; background: linear-gradient(#000, rgba(0,0,0,0)); }
  #fade-bottom { bottom: 0; background: linear-gradient(rgba(0,0,0,0), #000); }
  #status {
    position: fixed; left: 12px; bottom: 10px; padding: 4px 10px; border-radius: 999px;
    background: rgba(220,38,38,0.9); color: #fff; font: 600 13px/1.2 system-ui, sans-serif;
  }
  #status.hidden { display: none; }
</style>
</head>
<body>
<div id="flip"><div id="script"></div></div>
<div id="rule"></div>
<div id="fade-top"></div>
<div id="fade-bottom"></div>
<div id="empty">No script loaded yet.</div>
<div id="status" class="hidden">Reconnecting…</div>
<script>
(function () {
  var qs = new URLSearchParams(location.search);
  var scriptEl = document.getElementById('script');
  var flipEl = document.getElementById('flip');
  var ruleEl = document.getElementById('rule');
  var emptyEl = document.getElementById('empty');
  var statusEl = document.getElementById('status');

  var THEMES = { white: '#ffffff', amber: '#ffb547', green: '#7cf59a' };
  var theme = THEMES[qs.get('theme')];
  if (theme) document.documentElement.style.setProperty('--ink', theme);

  var linePct = clampNum(qs.get('line'), 0, 100, 38);
  if (qs.get('line') === '0' || qs.get('indicator') === '0') {
    ruleEl.classList.add('hidden');
  } else {
    ruleEl.style.top = linePct + '%';
  }

  var fontOverride = clampNum(qs.get('font'), 24, 200, null);
  var widthOverride = clampNum(qs.get('width'), 320, 10000, null);
  var mirrorParam = qs.get('mirror');

  function clampNum(raw, min, max, fallback) {
    var n = parseFloat(raw);
    if (!isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
  }

  // ---- state ----------------------------------------------------------
  var prompter = null;
  var clockSkewMs = 0;   // serverNow - localNow, so a device with a wrong clock still agrees
  var lastRendered = '';
  var lastTransform = null;

  function serverNow() { return Date.now() + clockSkewMs; }

  function positionAt(s, now) {
    if (!s) return 0;
    if (s.startedAt === null || s.startedAt === undefined) return Math.max(0, s.offset || 0);
    return Math.max(0, (s.offset || 0) + ((now - s.startedAt) / 1000) * (s.speed || 0));
  }

  function applyLayout() {
    if (!prompter) return;
    var size = fontOverride !== null ? fontOverride : prompter.fontSize;
    scriptEl.style.fontSize = size + 'px';
    scriptEl.style.lineHeight = String(prompter.lineHeight || 1.4);
    scriptEl.style.maxWidth = widthOverride !== null ? widthOverride + 'px' : 'none';
    // Blank leader/trailer so the first line can sit on the reading rule and
    // the last line can still scroll past it.
    scriptEl.style.paddingTop = linePct + 'vh';
    scriptEl.style.paddingBottom = '90vh';

    var flips = [];
    var mirrorX = mirrorParam === null ? prompter.mirrorX : (mirrorParam === 'x' || mirrorParam === 'xy');
    var mirrorY = mirrorParam === null ? prompter.mirrorY : (mirrorParam === 'y' || mirrorParam === 'xy');
    if (mirrorX) flips.push('scaleX(-1)');
    if (mirrorY) flips.push('scaleY(-1)');
    flipEl.style.transform = flips.join(' ');
  }

  function renderScript() {
    var text = prompter && typeof prompter.script === 'string' ? prompter.script : '';
    if (text === lastRendered) return;
    lastRendered = text;
    scriptEl.textContent = '';
    var paragraphs = text.split(/\\n{2,}/);
    for (var i = 0; i < paragraphs.length; i++) {
      var block = paragraphs[i];
      if (block.trim() === '') continue;
      var p = document.createElement('p');
      // Bracketed blocks are stage directions, not copy to read aloud.
      if (/^\\s*[\\[(]/.test(block)) p.className = 'note';
      p.textContent = block;
      scriptEl.appendChild(p);
    }
    emptyEl.classList.toggle('hidden', text.trim() !== '');
    lastTransform = null;
  }

  function frame() {
    if (prompter) {
      var maxScroll = Math.max(0, scriptEl.scrollHeight - window.innerHeight);
      var pos = Math.min(positionAt(prompter, serverNow()), maxScroll);
      var transform = 'translate3d(0,' + (-pos).toFixed(1) + 'px,0)';
      if (transform !== lastTransform) {
        scriptEl.style.transform = transform;
        lastTransform = transform;
      }
    }
    requestAnimationFrame(frame);
  }

  function applyState(next) {
    if (!next) return;
    prompter = next;
    applyLayout();
    renderScript();
  }

  // ---- hydration ------------------------------------------------------
  function hydrate() {
    var sentAt = Date.now();
    return fetch('/api/prompter/view', { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        // Half the round trip is the best estimate of "when the server read its clock".
        var rttHalf = (Date.now() - sentAt) / 2;
        clockSkewMs = data.serverNow - (Date.now() - rttHalf);
        applyState(data.prompter);
        statusEl.classList.add('hidden');
      })
      .catch(function () {
        statusEl.classList.remove('hidden');
      });
  }

  // ---- live updates ---------------------------------------------------
  var ws = null;
  var retryMs = 500;

  function connect() {
    var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    try {
      ws = new WebSocket(proto + '//' + location.host + '/ws?graphics=1');
    } catch (e) {
      scheduleReconnect();
      return;
    }
    ws.onopen = function () {
      retryMs = 500;
      statusEl.classList.add('hidden');
      // Re-read the clock on every reconnect: the device may have slept.
      hydrate();
    };
    ws.onmessage = function (ev) {
      var msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      if (msg.type !== 'state' && msg.type !== 'state_patch') return;
      var payload = msg.payload;
      if (!payload || !payload.prompter) return;
      applyState(payload.prompter);
    };
    ws.onclose = function () { scheduleReconnect(); };
    ws.onerror = function () { try { ws.close(); } catch (e) { /* already closing */ } };
  }

  function scheduleReconnect() {
    statusEl.classList.remove('hidden');
    setTimeout(connect, retryMs);
    retryMs = Math.min(retryMs * 2, 10000);
  }

  window.addEventListener('resize', function () { lastTransform = null; });

  hydrate().then(connect);
  requestAnimationFrame(frame);
})();
</script>
</body>
</html>`;

/**
 * Inline styles and one inline script, same as the render pages — the page is
 * a single self-contained file with no bundle to fetch, so it survives a
 * flaky network on a talent tablet.
 */
export const PROMPTER_CSP =
  "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' ws: wss:";
