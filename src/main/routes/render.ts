import { Router, Request, Response } from 'express';
import type { StateStore } from '../state';
import type { AuthManager } from '../auth';
import type { RenderBg, RenderContentType } from '../../shared/types';
import { requireOperator } from './middleware';

const RENDER_TYPES: RenderContentType[] = ['slides', 'l3', 'stills', 'url'];
const BG_MODES: RenderBg[] = ['transparent', 'black', 'white', 'chroma', 'opaque'];

function isRenderType(t: string): t is RenderContentType {
  return (RENDER_TYPES as string[]).includes(t);
}

/**
 * Generic transparent render page for OBS/vMix browser sources. Stateless:
 * hydrates from the full state snapshot on WS connect (so a source reload is
 * harmless) and re-renders on every patch. Background mode comes from ?bg=
 * and is live-overridden by AppState.renderOutputs[type] via WebSocket.
 */
function renderPageHtml(type: RenderContentType): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>PConAir render — ${type}</title>
<style>
  html, body { margin: 0; padding: 0; width: 1920px; height: 1080px; overflow: hidden; background: transparent; }
  #stage { position: fixed; inset: 0; }
  #stage img.full, #stage video.full { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; }
  .fade-layer { position: absolute; inset: 0; opacity: 0; transition: opacity 0.5s ease; }
  .fade-layer.visible { opacity: 1; }
  .fade-layer.cut { transition: none; }
  /* Layout is pinned here (not left to the loaded theme stylesheet, which only
     styles one full-width .lower-third bar) so left/right never collide —
     !important guards against a theme CSS file also declaring position/left/right. */
  .lower-third.l3-side-left { position: absolute !important; left: 96px !important; right: auto !important; bottom: 96px !important; width: auto !important; max-width: 820px; }
  .lower-third.l3-side-right { position: absolute !important; right: 96px !important; left: auto !important; bottom: 96px !important; width: auto !important; max-width: 820px; text-align: right; }
  .lower-third .logo { height: 80px; max-width: 200px; object-fit: contain; display: block; margin-bottom: 8px; }
  .lower-third.l3-side-right .logo { margin-left: auto; }
  #url-banner { position: absolute; left: 40px; bottom: 40px; font-family: system-ui, sans-serif; font-size: 28px; color: #fff; background: rgba(0,0,0,0.6); padding: 12px 20px; border-radius: 8px; }
</style>
</head>
<body>
<div id="stage"></div>
<script>
(function () {
  var TYPE = ${JSON.stringify(type)};
  var qs = new URLSearchParams(location.search);
  var bgParam = qs.get('bg');
  var chromaParam = qs.get('chroma');
  var state = null;

  function applyBg() {
    var out = state && state.renderOutputs && state.renderOutputs[TYPE];
    var bg = bgParam || (out ? out.bg : 'transparent');
    var chroma = chromaParam || (out ? out.chromaColor : '#00b140');
    var map = {
      transparent: 'transparent',
      black: '#000000',
      white: '#ffffff',
      chroma: chroma,
      opaque: '#000000'
    };
    document.body.style.background = map[bg] !== undefined ? map[bg] : 'transparent';
  }

  var stage = document.getElementById('stage');
  var lastKey = null;

  function renderStills() {
    var m = state.mediaLibrary;
    var id = m && m.activeItemId;
    var mime = (m && m.activeItemMime) || '';
    var show = m && m.slideshow;
    // Top-level transition first: a plain take has no slideshow, and reading it
    // only from there made every manual take a hard cut.
    var transition = (m && m.transition) || (show && show.transition) || 'cut';
    // Version is part of the key: replacing an item keeps its id, so without
    // this the early-return below would leave the old bytes on screen.
    var version = (m && m.activeItemVersion) || 0;
    var key = 'stills:' + (id || '') + ':' + version;
    if (key === lastKey) return;
    lastKey = key;
    if (!id) { stage.innerHTML = ''; return; }

    var isVideo = mime.indexOf('video/') === 0;
    var el;
    if (isVideo) {
      el = document.createElement('video');
      // Muted is what makes autoplay actually start — an unmuted video is
      // blocked with no user gesture on the render page. A lone clip loops so
      // the output never goes black; inside a running slideshow it plays once
      // and the engine advances on the clip's own duration.
      el.muted = true;
      el.defaultMuted = true;
      el.autoplay = true;
      el.playsInline = true;
      el.loop = !(show && show.running);
      el.setAttribute('muted', '');
      el.setAttribute('disablepictureinpicture', '');
    } else {
      el = document.createElement('img');
    }
    el.className = 'full fade-layer' + (transition === 'cut' ? ' cut' : '');

    function reveal() {
      requestAnimationFrame(function () { el.classList.add('visible'); });
      Array.prototype.slice.call(stage.children).forEach(function (c) {
        if (c !== el) setTimeout(function () { c.remove(); }, transition === 'cut' ? 0 : 600);
      });
    }

    if (isVideo) {
      // Swap on first decoded frame, not on 'ended' — waiting for load would
      // hold the outgoing item on screen for the whole clip.
      el.addEventListener('loadeddata', reveal);
      // Autoplay can still be refused; reveal anyway so the poster frame shows.
      el.addEventListener('error', reveal);
    } else {
      el.onload = reveal;
    }

    el.src = '/api/media-library/' + encodeURIComponent(id) + '/download?v=' + version;
    stage.appendChild(el);
    if (isVideo && el.play) {
      var p = el.play();
      if (p && p.catch) p.catch(function () { /* blocked autoplay — poster frame stands */ });
    }
  }

  // Two independent cards (left/right) — mirrors graphics/lower-third-live's
  // model. This page stays fully transparent (unlike lower-third-live's solid
  // black), for OBS/vMix browser-source compositing over camera.
  var l3ThemeCssLoaded = { left: null, right: null };
  var l3Els = { left: null, right: null };
  var l3Clearing = { left: false, right: false };

  function renderL3Side(side, lt) {
    var elIdPrefix = 'l3-' + side + '-';
    if (!lt || !lt.visible) {
      if (l3Els[side] && !l3Clearing[side]) {
        l3Clearing[side] = true;
        l3Els[side].classList.add('l3-exiting');
        var elToRemove = l3Els[side];
        setTimeout(function () {
          if (elToRemove.parentNode) elToRemove.parentNode.removeChild(elToRemove);
          l3Els[side] = null;
          l3Clearing[side] = false;
        }, 500);
      }
      return;
    }

    var theme = lt.theme || 'default';
    if (l3ThemeCssLoaded[side] !== theme) {
      var old = document.getElementById(elIdPrefix + 'theme-css');
      if (old) old.remove();
      var link = document.createElement('link');
      link.id = elIdPrefix + 'theme-css';
      link.rel = 'stylesheet';
      link.href = '/api/l3/themes/' + encodeURIComponent(theme) + '/css';
      document.head.appendChild(link);
      l3ThemeCssLoaded[side] = theme;
    }

    if (l3Els[side] && l3Els[side].parentNode) {
      l3Els[side].parentNode.removeChild(l3Els[side]);
    }
    l3Clearing[side] = false;

    var card = document.createElement('div');
    card.className = 'lower-third l3-entering l3-side-' + side;
    if (lt.logoEnabled && lt.logoAssetId) {
      var logo = document.createElement('img');
      logo.className = 'logo';
      logo.src = '/api/l3/logos/' + encodeURIComponent(lt.logoAssetId) + '/file';
      card.appendChild(logo);
    }
    var name = document.createElement('p');
    name.className = 'name';
    name.textContent = lt.name;
    card.appendChild(name);
    if (lt.title) {
      var title = document.createElement('p');
      title.className = 'title';
      title.textContent = lt.title;
      card.appendChild(title);
    }
    if (lt.subtitle) {
      var subtitle = document.createElement('p');
      subtitle.className = 'subtitle';
      subtitle.textContent = lt.subtitle;
      card.appendChild(subtitle);
    }
    stage.appendChild(card);
    l3Els[side] = card;

    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        if (card.parentNode) card.classList.remove('l3-entering');
      });
    });
  }

  function renderL3() {
    var lts = (state.graphics && state.graphics.lowerThirds) || {};
    var key = 'l3:left:' + JSON.stringify(lts.left) + ':right:' + JSON.stringify(lts.right);
    if (key === lastKey) return;
    lastKey = key;
    renderL3Side('left', lts.left);
    renderL3Side('right', lts.right);
  }

  function renderSlides() {
    var slides = state.slides;
    var thumb = slides && slides.thumbnailCurrent;
    var key = 'slides:' + (slides ? slides.slideIndex + ':' + (thumb ? thumb.length : 0) : '');
    if (key === lastKey) return;
    lastKey = key;
    if (!thumb) { stage.innerHTML = ''; return; }
    var img = stage.querySelector('img.full');
    if (!img) {
      img = document.createElement('img');
      img.className = 'full';
      stage.innerHTML = '';
      stage.appendChild(img);
    }
    img.src = thumb;
  }

  function renderUrl() {
    var url = state.currentUrl;
    var key = 'url:' + (url || '');
    if (key === lastKey) return;
    lastKey = key;
    stage.innerHTML = '';
    if (url && state.currentMode === 'url') {
      var banner = document.createElement('div');
      banner.id = 'url-banner';
      banner.textContent = url;
      stage.appendChild(banner);
    }
  }

  function render() {
    if (!state) return;
    applyBg();
    if (TYPE === 'stills') renderStills();
    else if (TYPE === 'l3') renderL3();
    else if (TYPE === 'slides') renderSlides();
    else renderUrl();
  }

  var delay = 1000;
  function connect() {
    var proto = location.protocol === 'https:' ? 'wss' : 'ws';
    var ws = new WebSocket(proto + '://' + location.host + '/ws?render=1');
    ws.onopen = function () { delay = 1000; };
    ws.onmessage = function (e) {
      try {
        var msg = JSON.parse(e.data);
        if (msg.type === 'state') { state = msg.payload; render(); }
        else if (msg.type === 'state_patch' && state) {
          Object.keys(msg.payload).forEach(function (k) { state[k] = msg.payload[k]; });
          render();
        }
      } catch (err) { /* ignore */ }
    };
    ws.onclose = function () {
      setTimeout(connect, delay);
      delay = Math.min(delay * 2, 15000);
    };
  }
  connect();
})();
</script>
</body>
</html>`;
}

export function createRenderRouter(store: StateStore, auth: AuthManager): Router {
  const router = Router();
  const opGuard = requireOperator(auth);

  // Render pages are consumed by OBS/vMix — no cookies, LAN-only via IP allowlist.
  router.get('/render/:type', (req: Request, res: Response) => {
    const type = req.params.type;
    if (!isRenderType(type)) {
      res.status(404).type('text/plain').send(`Unknown render type '${type}' (valid: ${RENDER_TYPES.join(', ')})`);
      return;
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(renderPageHtml(type));
  });

  router.get('/api/render/outputs', (_req: Request, res: Response) => {
    res.json({ renderOutputs: store.getState().renderOutputs });
  });

  router.post('/api/render/:type/background', opGuard, (req: Request, res: Response) => {
    const type = req.params.type;
    if (!isRenderType(type)) {
      res.status(404).json({ error: { code: 'INVALID_MODE', message: `Unknown render type '${type}'` } });
      return;
    }
    const { bg, chromaColor } = req.body as { bg?: string; chromaColor?: string };
    if (bg !== undefined && !(BG_MODES as string[]).includes(bg)) {
      res.status(400).json({ error: { code: 'INVALID_MODE', message: `bg must be one of: ${BG_MODES.join(', ')}` } });
      return;
    }
    if (chromaColor !== undefined && !/^#[0-9a-fA-F]{6}$/.test(chromaColor)) {
      res.status(400).json({ error: { code: 'INVALID_MODE', message: 'chromaColor must be a #rrggbb hex color' } });
      return;
    }
    const s = store.getState();
    const current = s.renderOutputs[type];
    store.setState({
      renderOutputs: {
        ...s.renderOutputs,
        [type]: {
          ...current,
          bg: (bg as RenderBg | undefined) ?? current.bg,
          chromaColor: chromaColor ?? current.chromaColor,
        },
      },
    });
    res.json({ renderOutputs: store.getState().renderOutputs });
  });

  // Claim an output for a content type. Warns (does not block) on conflicts.
  router.post('/api/render/:type/output', opGuard, (req: Request, res: Response) => {
    const type = req.params.type;
    if (!isRenderType(type)) {
      res.status(404).json({ error: { code: 'INVALID_MODE', message: `Unknown render type '${type}'` } });
      return;
    }
    const { output } = req.body as { output?: string | null };
    const normalized = output === undefined || output === null || output === '' ? null : String(output);
    const s = store.getState();
    const conflicts = RENDER_TYPES.filter(
      (t) => t !== type && normalized !== null && s.renderOutputs[t].claimedOutput === normalized
    );
    store.setState({
      renderOutputs: {
        ...s.renderOutputs,
        [type]: { ...s.renderOutputs[type], claimedOutput: normalized },
      },
    });
    res.json({
      renderOutputs: store.getState().renderOutputs,
      warning:
        conflicts.length > 0
          ? `Output '${normalized}' is already in use by: ${conflicts.join(', ')} — proceeding anyway`
          : null,
    });
  });

  return router;
}
