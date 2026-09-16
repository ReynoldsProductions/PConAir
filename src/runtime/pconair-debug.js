/* PConAir debug overlay — loaded conditionally by pconair.js when ?debug=1,
   ?scale=contain, or ?bg=... is present. ES5-safe, no modules, no build step.
   Renders registered _diagSource samplers, FPS measurement, keyboard verbs. */
window.PConAir = (function (Base) {
  'use strict';

  var param = Base.param;
  var isDebug = Base.isDebug;
  
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
  
  setupStage();
  
  return Base;
})(window.PConAir);
