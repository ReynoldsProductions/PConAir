/* PConAir debug overlay — loaded conditionally by pconair.js when ?debug=1,
   ?scale=contain, or ?bg=... is present. ES5-safe, no modules, no build step.
   Renders registered _diagSource samplers, FPS measurement, keyboard verbs. */
window.PConAir = (function (Base) {
  'use strict';

  var param = Base.param;
  var isDebug = Base.isDebug;
  var diagSources = Base._diagSources;
  
  /* Setup: create wrapper for scaling and background. */
  function setupStage() {
    var scaleMode = param('scale');
    var bgParam = param('bg');
    
    if (!scaleMode && !bgParam) {
      return; /* Nothing to do */
    }
    
    /* Create a wrapper around document.body's children. The render page
       stays pixel-exact; we apply transform at wrapper level. */
    var wrapper = document.createElement('div');
    wrapper.className = 'pc-stage-wrapper';
    if (scaleMode === 'contain') {
      wrapper.classList.add('pc-stage-scale');
    }
    
    /* Move all body children into the wrapper */
    while (document.body.firstChild) {
      wrapper.appendChild(document.body.firstChild);
    }
    document.body.appendChild(wrapper);
    
    /* Handle background */
    if (bgParam === 'checker') {
      wrapper.classList.add('pc-bg-checker');
    } else if (bgParam) {
      /* Treat as a hex color */
      try {
        /* Validate it looks vaguely like a color before setting it */
        if (/^#[0-9a-fA-F]+$/.test(bgParam) || /^[0-9a-fA-F]+$/.test(bgParam)) {
          wrapper.style.backgroundColor = bgParam.startsWith('#') ? bgParam : '#' + bgParam;
        }
      } catch (e) { /* ignore */ }
    }
    
    /* Compute and apply scale */
    function updateScale() {
      if (scaleMode === 'contain') {
        var sx = window.innerWidth / 1920;
        var sy = window.innerHeight / 1080;
        var s = Math.min(sx, sy);
        wrapper.style.transform = 'scale(' + s + ')';
        wrapper.style.transformOrigin = 'top left';
      }
    }
    
    updateScale();
    window.addEventListener('resize', updateScale);
  }
  
  /* FPS measurement using requestAnimationFrame over a rolling 1-second window */
  function setupFPSCounter() {
    var frameTimes = [];
    var lastFPS = 60;
    
    function countFrame(now) {
      frameTimes.push(now);
      /* Keep only the last second of frames */
      while (frameTimes.length > 0 && frameTimes[0] < now - 1000) {
        frameTimes.shift();
      }
      /* Update FPS every frame count or once per second */
      lastFPS = frameTimes.length;
      window.requestAnimationFrame(countFrame);
    }
    
    window.requestAnimationFrame(countFrame);
    
    return function() { return lastFPS; };
  }
  
  var getFPS = setupFPSCounter();
  
  /* Debug overlay — shows sampled diagnostics at 4 Hz. */
  function setupDebugOverlay() {
    if (!isDebug()) {
      return;
    }
    
    /* Create the overlay container */
    var overlay = document.createElement('div');
    overlay.className = 'pc-debug';
    document.body.appendChild(overlay);
    
    /* Create the content area */
    var content = document.createElement('div');
    content.className = 'pc-debug-content';
    overlay.appendChild(content);
    
    /* Sample at 4 Hz */
    var lastSample = {};
    function sample() {
      var rows = [];
      
      /* Always include these base rows */
      rows.push({ label: 'package', value: 'p' });
      rows.push({ label: 'render', value: 'main' });
      
      /* Socket status */
      var connected = Base.connect && Base.connect._client ? Base.connect._client.connected : false;
      rows.push({ label: 'socket', value: connected ? 'connected' : 'disconnected' });
      
      /* Add sampled values from registered sources */
      for (var name in diagSources) {
        if (diagSources.hasOwnProperty(name)) {
          try {
            var value = diagSources[name]();
            if (value) {
              var valueStr = typeof value === 'object' ? JSON.stringify(value) : String(value);
              rows.push({ label: name, value: valueStr });
            }
          } catch (e) { /* ignore */ }
        }
      }
      
      /* FPS */
      var fps = getFPS();
      var fpsLabel = 'fps';
      var fpsClass = '';
      if (fps < 50) {
        fpsClass = ' pc-debug-danger';
        fpsLabel += ' ⚠';
      }
      rows.push({ label: fpsLabel, value: String(fps), class: fpsClass });
      
      /* Viewport */
      rows.push({ label: 'viewport', value: window.innerWidth + '×' + window.innerHeight });
      
      /* Render the rows */
      content.innerHTML = '';
      for (var i = 0; i < rows.length; i++) {
        var row = rows[i];
        var div = document.createElement('div');
        div.className = 'pc-debug-row' + (row.class || '');
        div.innerHTML = '<span class="pc-debug-label">' + row.label + '</span> <span class="pc-debug-value">' + row.value + '</span>';
        content.appendChild(div);
      }
    }
    
    /* Sample on interval */
    setInterval(sample, 250); /* 4 Hz = 250ms */
    sample(); /* Initial sample */
  }
  
  setupStage();
  setupDebugOverlay();
  
  return Base;
})(window.PConAir);
