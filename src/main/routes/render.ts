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
  #stage img.full { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; }
  .fade-layer { position: absolute; inset: 0; opacity: 0; transition: opacity 0.5s ease; }
  .fade-layer.visible { opacity: 1; }
  .fade-layer.cut { transition: none; }
  #l3-style {}
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
    var transition = (m && m.slideshow && m.slideshow.transition) || 'cut';
    var key = 'stills:' + (id || '');
    if (key === lastKey) return;
    lastKey = key;
    if (!id) { stage.innerHTML = ''; return; }
    var img = document.createElement('img');
    img.className = 'full fade-layer' + (transition === 'cut' ? ' cut' : '');
    img.src = '/api/media-library/' + encodeURIComponent(id) + '/download';
    img.onload = function () {
      requestAnimationFrame(function () { img.classList.add('visible'); });
      Array.prototype.slice.call(stage.children).forEach(function (c) {
        if (c !== img) setTimeout(function () { c.remove(); }, transition === 'cut' ? 0 : 600);
      });
    };
    stage.appendChild(img);
  }

  var themeCssLoaded = null;
  function renderL3() {
    var l3 = state.l3;
    var key = 'l3:' + (l3 ? (l3.activeCueId || '') + ':' + (l3.activeCueName || '') + ':' + (l3.activeTheme || '') : '');
    if (key === lastKey) return;
    lastKey = key;
    if (!l3 || !l3.activeCueName) { stage.innerHTML = ''; return; }
    var theme = l3.activeTheme || 'default';
    if (themeCssLoaded !== theme) {
      var old = document.getElementById('l3-theme-css');
      if (old) old.remove();
      var link = document.createElement('link');
      link.id = 'l3-theme-css';
      link.rel = 'stylesheet';
      link.href = '/api/l3/themes/' + encodeURIComponent(theme) + '/css';
      document.head.appendChild(link);
      themeCssLoaded = theme;
    }
    stage.innerHTML = '';
    var lt = document.createElement('div');
    lt.className = 'lower-third';
    var name = document.createElement('p');
    name.className = 'name';
    name.textContent = l3.activeCueName;
    lt.appendChild(name);
    if (l3.activeTitle) {
      var title = document.createElement('p');
      title.className = 'title';
      title.textContent = l3.activeTitle;
      lt.appendChild(title);
    }
    stage.appendChild(lt);
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
