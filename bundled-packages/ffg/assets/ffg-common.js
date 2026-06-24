/* FFG package state bootstrap. Replaces the original localStorage + SSE relay:
   all state (teams, h2h, scores, winner, maxScore, clock) lives in PConAir's
   package state hub, and pages hydrate from it on every (re)connect.

   Usage in a render page:
     FFG.start(buildFn[, configKeyFn])
   buildFn(state) runs once on first state to build the DOM (frames bake team
   names in, like the original overlays). Afterwards, if the parts selected by
   configKeyFn change, the page reloads — same behavior as the original
   ffg.teams / ffg.h2h messages. Score/clock updates flow live via FFG.onUpdate. */

window.FFG = (function () {
  'use strict';

  let state = null;
  let built = false;
  let configKey = '';
  let keyFn = null;
  const updateHandlers = [];
  let client = null;

  const defaultKeyFn = (s) => JSON.stringify([s.teams, s.h2h]);

  function start(buildFn, configKeyFn) {
    keyFn = configKeyFn || defaultKeyFn;
    client = window.PConAirPackage.connect('ffg', (s) => {
      if (built && keyFn(s) !== configKey) {
        location.reload();
        return;
      }
      state = s;
      if (!built) {
        built = true;
        configKey = keyFn(s);
        buildFn(s);
        window.OverlayKit.applyObsMode();
        window.OverlayKit.autoScale();
      }
      for (const fn of updateHandlers) fn(s);
    });
  }

  function onUpdate(fn) {
    updateHandlers.push(fn);
    if (state) fn(state);
  }

  function getState() { return state; }
  function patch(p) { return client.patch(p); }

  function clampIdx(v) { return Math.max(0, Math.min(3, +v || 0)); }

  /* Resolve which team a ?team= page shows: URL param wins, else state.activeTeam. */
  function resolveTeamIdx(s) {
    const p = new URLSearchParams(location.search).get('team');
    return clampIdx(p !== null ? p : (s.activeTeam ?? 0));
  }

  /* Resolve an h2h slot pair: ?slot=a|b (else state.h2hSlot), ?l=/?r= override. */
  function resolveH2H(s) {
    const params = new URLSearchParams(location.search);
    const slot = (params.get('slot') || s.h2hSlot || 'a').toLowerCase();
    const slotCfg = (s.h2h && (slot === 'b' ? s.h2h.b : s.h2h.a)) || { left: 0, right: 1 };
    return {
      left:  clampIdx(params.get('l') !== null ? params.get('l') : slotCfg.left),
      right: clampIdx(params.get('r') !== null ? params.get('r') : slotCfg.right),
    };
  }

  /* Resolve the champion: ?winner= (index or team code) wins, else state.winner. */
  function resolveWinnerIdx(s) {
    const raw = new URLSearchParams(location.search).get('winner');
    if (raw !== null) {
      if (/^\d+$/.test(raw)) return clampIdx(raw);
      const codes = (s.teams || []).map((t) => String(t.code || '').toLowerCase());
      return Math.max(0, codes.indexOf(raw.toLowerCase()));
    }
    return clampIdx(s.winner ?? 0);
  }

  /* ── Ship-by clock ─────────────────────────────────────────────────
     state.clock = { running, value (seconds, when paused), deadline (epoch ms,
     when running) } — a deadline, so reloads hydrate to the right time. */
  function timerRemainingS(s) {
    const c = (s && s.clock) || {};
    if (c.running && c.deadline > 0) return Math.max(0, (c.deadline - Date.now()) / 1000);
    return typeof c.value === 'number' ? Math.max(0, c.value) : null;
  }

  function fmtTimer(sec) {
    if (sec === null) return '--:--';
    const m = Math.floor(sec / 60);
    const ss = Math.floor(sec % 60);
    return String(m).padStart(2, '0') + ':' + String(ss).padStart(2, '0');
  }

  /* Bind a makeTimerChip() element to the package clock state. */
  function bindTimer(chip) {
    const timeEl = chip.querySelector('[data-st-time]');
    setInterval(() => {
      const sec = timerRemainingS(state);
      timeEl.textContent = fmtTimer(sec);
      if (state && state.clock && state.clock.running) chip.removeAttribute('data-st-status');
      else chip.setAttribute('data-st-status', 'local');
    }, 250);
  }

  return { start, onUpdate, getState, patch, clampIdx, resolveTeamIdx, resolveH2H, resolveWinnerIdx, timerRemainingS, fmtTimer, bindTimer };
})();
