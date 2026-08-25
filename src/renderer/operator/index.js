"use strict";
(() => {
  var __create = Object.create;
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __getProtoOf = Object.getPrototypeOf;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __commonJS = (cb, mod) => function __require() {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
    // If the importer is in node compatibility mode or this is not an ESM
    // file that has been converted to a CommonJS file using a Babel-
    // compatible transform (i.e. "__esModule" has not been set), then set
    // "default" to the CommonJS "module.exports" for node compatibility.
    isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
    mod
  ));

  // src/renderer/vendor/react-global-shim.js
  var require_react_global_shim = __commonJS({
    "src/renderer/vendor/react-global-shim.js"(exports, module) {
      "use strict";
      module.exports = window.React;
    }
  });

  // src/renderer/vendor/react-dom-global-shim.js
  var require_react_dom_global_shim = __commonJS({
    "src/renderer/vendor/react-dom-global-shim.js"(exports, module) {
      "use strict";
      module.exports = window.ReactDOM;
    }
  });

  // src/renderer/operator/index.tsx
  var React2 = __toESM(require_react_global_shim());
  var ReactDOMBase = __toESM(require_react_dom_global_shim());

  // src/shared/types.ts
  function makePrompterState() {
    return {
      enabled: false,
      host: "",
      scrolling: false,
      speed: 40,
      fontSize: 72,
      lineHeight: 1.4,
      script: "",
      offset: 0,
      startedAt: null,
      mirrorX: false,
      mirrorY: false
    };
  }

  // src/renderer/operator/state.ts
  var DEFAULT_STATE = {
    currentMode: "idle",
    currentPreset: null,
    currentUrl: null,
    slides: null,
    mediaLibrary: null,
    background: { presetId: null, presetName: null, type: "luma", value: "#000000" },
    displays: [],
    abState: {
      activeInstance: "A",
      instanceA: { url: null, isLoading: false, isReady: false, displayTarget: null, sessionMode: "persistent" },
      instanceB: { url: null, isLoading: false, isReady: false, displayTarget: null, sessionMode: "persistent" }
    },
    connectionStatus: { webSocketClients: 0, companionConnected: false, adminShowLocked: false },
    reliability: { panicActive: false, panicSlate: { type: "color", value: "#000000" } },
    watchdog: {
      programUnresponsive: false,
      programUnresponsiveSecs: 0,
      memoryPressure: false,
      memoryPressurePct: 0,
      memoryHeapUsedGb: 0,
      memoryHeapTotalGb: 0,
      lastRendererCrashAt: null
    },
    tunnel: {
      enabled: false,
      status: "inactive",
      url: null,
      pinRequired: false,
      lastError: null
    },
    renderOutputs: {
      slides: { bg: "opaque", chromaColor: "#00b140", claimedOutput: null },
      l3: { bg: "transparent", chromaColor: "#00b140", claimedOutput: null },
      stills: { bg: "transparent", chromaColor: "#00b140", claimedOutput: null },
      url: { bg: "opaque", chromaColor: "#00b140", claimedOutput: null }
    },
    stageTimer: {
      overlayEnabled: false,
      overlayPosition: "bottom-left",
      overlaySize: 10,
      roomId: null,
      configured: false
    },
    prompter: makePrompterState(),
    graphics: { scoreboard: null, lowerThirds: { left: null, right: null } }
  };
  function createClientStore() {
    let state = structuredClone(DEFAULT_STATE);
    const listeners = /* @__PURE__ */ new Set();
    function getState() {
      return state;
    }
    function applyFullState(newState) {
      state = structuredClone(newState);
      notify();
    }
    function applyPatch(patch) {
      state = { ...state, ...patch };
      notify();
    }
    function subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    }
    function notify() {
      for (const fn of listeners) fn(state);
    }
    return { getState, applyFullState, applyPatch, subscribe };
  }

  // src/renderer/operator/api.ts
  var fetchDefaults = { credentials: "include" };
  async function apiGet(path) {
    const res = await fetch(path, fetchDefaults);
    const data = await res.json();
    if (!res.ok) {
      const msg = data.error?.message ?? `HTTP ${res.status}`;
      throw new Error(msg);
    }
    return data;
  }
  async function apiPost(path, body, method = "POST") {
    const res = await fetch(path, {
      ...fetchDefaults,
      method,
      headers: { "Content-Type": "application/json" },
      body: body !== void 0 ? JSON.stringify(body) : void 0
    });
    const data = await res.json();
    if (!res.ok) {
      const msg = data.error?.message ?? `HTTP ${res.status}`;
      throw new Error(msg);
    }
    return data;
  }
  var getGoogleAuthState = () => apiGet("/api/slides/auth");
  var openGoogleAuth = () => apiPost("/api/slides/auth/open");
  var loadDeck = (deckUrl) => apiPost("/api/slides/load", { deckUrl });
  var slideNext = () => apiPost("/api/slides/next");
  var slidePrev = () => apiPost("/api/slides/prev");
  var slideGoto = (slideIndex) => apiPost("/api/slides/goto", { slideIndex });
  var slideReload = () => apiPost("/api/slides/reload");
  var switchAB = (instance) => apiPost("/api/ab/switch", { instance });
  var setMode = (mode) => apiPost("/api/mode", { mode });
  var loadUrl = (url, display) => apiPost("/api/url", display ? { url, display } : { url });
  var listDisplays = () => apiGet("/api/displays");
  var urlReload = (instance) => apiPost("/api/url/reload", instance ? { instance } : {});
  var l3ListCues = () => apiGet("/api/l3/cues");
  var lowerThirdApply = (body) => apiPost("/api/action", { action_id: "lower_third_apply", params: body });
  var lowerThirdHide = (side) => apiPost("/api/action", { action_id: "lower_third_hide", params: { side } });
  var l3CreateCue = (body) => apiPost("/api/l3/cues", body);
  var l3UpdateCue = (cueId, body) => apiPost(`/api/l3/cues/${encodeURIComponent(cueId)}`, body, "PUT");
  async function apiPostFormData(path, form) {
    const res = await fetch(path, { credentials: "include", method: "POST", body: form });
    const data = await res.json();
    if (!res.ok) {
      const msg = data.error?.message ?? `HTTP ${res.status}`;
      throw new Error(msg);
    }
    return data;
  }
  var l3ImportCsv = (file) => {
    const form = new FormData();
    form.append("csvFile", file);
    return apiPostFormData("/api/l3/cues/import", form);
  };
  var l3ListLogos = () => apiGet("/api/l3/logos");
  var l3UploadLogo = (file) => {
    const form = new FormData();
    form.append("logoFile", file);
    return apiPostFormData("/api/l3/logos", form);
  };
  var l3DeleteLogo = async (id) => {
    const res = await fetch(`/api/l3/logos/${encodeURIComponent(id)}`, { credentials: "include", method: "DELETE" });
    if (!res.ok && res.status !== 204) throw new Error(`HTTP ${res.status}`);
  };
  async function l3ExportPng(body) {
    const res = await fetch("/api/l3/export", {
      credentials: "include",
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try {
        const data = await res.json();
        if (data.error?.message) msg = data.error.message;
      } catch {
      }
      throw new Error(msg);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(body.name || "lower-third").replace(/[^\w\s-]/g, "_")}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }
  var mediaLibraryList = () => apiGet("/api/media-library");
  var mediaLibraryTake = (itemId) => apiPost("/api/media-library/take", { itemId });
  var mediaLibraryClear = () => apiPost("/api/media-library/clear");
  var fetchActiveProfile = () => apiGet("/api/profiles/active");
  var reloadInstance = (instance, timeout) => apiPost("/api/reload-instance", timeout ? { instance, timeout } : { instance });
  async function panicAction(action = "toggle") {
    return apiPost("/api/panic", { action });
  }
  var fetchSlidesNotes = () => apiGet("/api/slides/notes");
  var fetchPresets = () => apiGet("/api/presets");

  // src/renderer/operator/components/LiveControl.tsx
  var React = __toESM(require_react_global_shim());
  var { SlateDSProvider, Tag, Button } = window.Slate;
  var MODE_TAG_VARIANT = {
    idle: "neutral",
    slides: "info",
    url: "success",
    "media-library": "strong"
  };
  var MODE_BUTTONS = [
    { mode: "idle", label: "Idle" },
    { mode: "slides", label: "Slides" },
    { mode: "url", label: "URL" },
    { mode: "media-library", label: "Media Library" }
  ];
  function StatusHeader({ state, wsConnected: wsConnected2, onPanic }) {
    const panicActive = state.reliability.panicActive;
    const companionConnected = state.connectionStatus.companionConnected;
    return /* @__PURE__ */ React.createElement(SlateDSProvider, null, /* @__PURE__ */ React.createElement("header", { className: "status-bar" }, /* @__PURE__ */ React.createElement("span", { className: "status-bar-machine", id: "machine-name-label" }, "PC On Air"), /* @__PURE__ */ React.createElement("div", { className: "status-bar-indicators" }, /* @__PURE__ */ React.createElement("div", { className: "status-indicator" }, /* @__PURE__ */ React.createElement("span", { className: wsConnected2 ? "led connected" : "led", id: "ws-dot" }), /* @__PURE__ */ React.createElement("span", { id: "ws-label" }, wsConnected2 ? "Connected" : "Disconnected")), /* @__PURE__ */ React.createElement("div", { className: "status-indicator" }, /* @__PURE__ */ React.createElement("span", { className: companionConnected ? "led connected" : "led", id: "companion-dot" }), /* @__PURE__ */ React.createElement("span", null, "Companion")), /* @__PURE__ */ React.createElement(
      Tag,
      {
        id: "mode-badge",
        label: state.currentMode.toUpperCase(),
        variant: MODE_TAG_VARIANT[state.currentMode]
      }
    ), /* @__PURE__ */ React.createElement("span", { id: "show-lock-badge", className: state.connectionStatus.adminShowLocked ? "visible" : void 0 }, "SHOW LOCKED"), /* @__PURE__ */ React.createElement(
      Button,
      {
        id: "panic-btn",
        type: "button",
        variant: "primary",
        destructive: true,
        size: "small",
        onClick: onPanic
      },
      panicActive ? "UN-PANIC" : "PANIC"
    ))));
  }
  function LiveControlPanels({ state, onSwitchAB, onSetMode }) {
    const activeInstance = state.abState.activeInstance;
    return /* @__PURE__ */ React.createElement(SlateDSProvider, null, /* @__PURE__ */ React.createElement("div", { className: "panel" }, /* @__PURE__ */ React.createElement("div", { className: "panel-title" }, "A/B Instance"), /* @__PURE__ */ React.createElement("div", { className: "ab-row" }, /* @__PURE__ */ React.createElement(
      Button,
      {
        id: "ab-a-btn",
        type: "button",
        "data-instance": "A",
        variant: activeInstance === "A" ? "primary" : "secondary",
        fullWidth: true,
        onClick: () => onSwitchAB("A")
      },
      "A"
    ), /* @__PURE__ */ React.createElement(
      Button,
      {
        id: "ab-b-btn",
        type: "button",
        "data-instance": "B",
        variant: activeInstance === "B" ? "primary" : "secondary",
        fullWidth: true,
        onClick: () => onSwitchAB("B")
      },
      "B"
    ))), /* @__PURE__ */ React.createElement("div", { className: "panel" }, /* @__PURE__ */ React.createElement("div", { className: "panel-title" }, "Mode"), /* @__PURE__ */ React.createElement("div", { className: "mode-btn-grid" }, MODE_BUTTONS.map(({ mode, label }) => /* @__PURE__ */ React.createElement(
      Button,
      {
        key: mode,
        type: "button",
        "data-mode": mode,
        variant: "secondary",
        fullWidth: true,
        onClick: () => onSetMode(mode)
      },
      label
    )))));
  }

  // src/renderer/operator/index.tsx
  var store = createClientStore();
  var ReactDOM = ReactDOMBase;
  var statusHeaderRoot = ReactDOM.createRoot(document.getElementById("status-header-root"));
  var liveControlPanelsRoot = ReactDOM.createRoot(document.getElementById("live-control-panels-root"));
  var wsConnected = false;
  async function handlePanicClick() {
    try {
      await panicAction("toggle");
    } catch (e) {
      showError(e.message);
    }
  }
  async function handleSwitchAB(instance) {
    try {
      await switchAB(instance);
    } catch (e) {
      showError(e.message);
    }
  }
  async function handleSetMode(mode) {
    try {
      await setMode(mode);
    } catch (e) {
      showError(e.message);
    }
  }
  function renderReactRoots(state) {
    statusHeaderRoot.render(
      /* @__PURE__ */ React2.createElement(StatusHeader, { state, wsConnected, onPanic: handlePanicClick })
    );
    liveControlPanelsRoot.render(
      /* @__PURE__ */ React2.createElement(LiveControlPanels, { state, onSwitchAB: handleSwitchAB, onSetMode: handleSetMode })
    );
  }
  var KBD_PRESETS = {
    google: {
      next: ["ArrowRight", " ", "PageDown"],
      prev: ["ArrowLeft", "PageUp"]
    },
    powerpoint: {
      next: ["ArrowRight", "Enter", "PageDown", "n", "N"],
      prev: ["ArrowLeft", "Backspace", "PageUp", "p", "P"]
    },
    keynote: {
      next: ["ArrowRight", " ", "Enter"],
      prev: ["ArrowLeft", "Delete"]
    }
  };
  var KBD_PRESET_KEY = "pconair-kbd-preset";
  function getSavedPreset() {
    const v = localStorage.getItem(KBD_PRESET_KEY);
    if (v === "google" || v === "powerpoint" || v === "keynote") return v;
    return "google";
  }
  var activeKbdPreset = getSavedPreset();
  function setKbdPreset(preset) {
    activeKbdPreset = preset;
    localStorage.setItem(KBD_PRESET_KEY, preset);
    renderKbdPresetButtons();
  }
  function renderKbdPresetButtons() {
    document.querySelectorAll("[data-kbd-preset]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.kbdPreset === activeKbdPreset);
    });
  }
  var notesPollingInterval = null;
  var ltCuesCache = [];
  var ltLogosCache = [];
  async function refreshMediaSelect() {
    const { items } = await mediaLibraryList();
    const sel = document.getElementById("ml-item-select");
    const prev = sel.value;
    sel.replaceChildren();
    const opt0 = document.createElement("option");
    opt0.value = "";
    opt0.textContent = "\u2014 Select an item \u2014";
    sel.appendChild(opt0);
    for (const it of items) {
      const o = document.createElement("option");
      o.value = it.id;
      o.textContent = it.displayName;
      sel.appendChild(o);
    }
    if (prev && items.some((x) => x.id === prev)) sel.value = prev;
  }
  var DISPLAY_SELECT_IDS = ["lt3-output-display-select"];
  async function refreshDisplaySelect() {
    const { displays } = await listDisplays();
    for (const id of DISPLAY_SELECT_IDS) {
      const sel = document.getElementById(id);
      if (!sel) continue;
      const prev = sel.value;
      sel.replaceChildren();
      const opt0 = document.createElement("option");
      opt0.value = "";
      opt0.textContent = "Primary display (default)";
      sel.appendChild(opt0);
      for (const d of displays) {
        const o = document.createElement("option");
        o.value = d.id;
        o.textContent = d.isPrimary ? `${d.name} (primary)` : d.name;
        sel.appendChild(o);
      }
      if (prev && displays.some((x) => x.id === prev)) sel.value = prev;
    }
  }
  async function refreshGoogleAuth() {
    const statusEl = document.getElementById("google-auth-status");
    const signinBtn = document.getElementById("google-signin-btn");
    if (!statusEl) return;
    try {
      const auth = await getGoogleAuthState();
      if (auth.loggedIn) {
        statusEl.textContent = auth.email ? `Signed in as ${auth.email}` : "Signed in to Google \u2713";
        if (signinBtn) signinBtn.textContent = "Sign in again";
      } else {
        statusEl.textContent = "Not signed in \u2014 private slides will not load";
        if (signinBtn) signinBtn.textContent = "Sign in to Google";
      }
    } catch {
      statusEl.textContent = "Could not check Google auth status";
    }
  }
  var LT3_SIDES = ["left", "right"];
  function fillCueSelect(sel, cues) {
    const prev = sel.value;
    sel.replaceChildren();
    const opt0 = document.createElement("option");
    opt0.value = "";
    opt0.textContent = "\u2014 Manual entry below \u2014";
    sel.appendChild(opt0);
    for (const c of cues) {
      const o = document.createElement("option");
      o.value = c.id;
      o.textContent = `${c.name} \u2014 ${c.title}`;
      sel.appendChild(o);
    }
    if (prev && cues.some((x) => x.id === prev)) sel.value = prev;
  }
  async function refreshL3CuesCache() {
    const { cues } = await l3ListCues();
    ltCuesCache = cues;
    for (const side of LT3_SIDES) {
      const sel = document.getElementById(`lt3-${side}-cue-select`);
      if (sel) fillCueSelect(sel, cues);
    }
  }
  function fillLogoSelect(sel, logos) {
    const prev = sel.value;
    sel.replaceChildren();
    const opt0 = document.createElement("option");
    opt0.value = "";
    opt0.textContent = "\u2014 No logo uploaded \u2014";
    sel.appendChild(opt0);
    for (const l of logos) {
      const o = document.createElement("option");
      o.value = l.id;
      o.textContent = l.filename;
      sel.appendChild(o);
    }
    if (prev && logos.some((x) => x.id === prev)) sel.value = prev;
  }
  async function refreshL3LogosCache() {
    const { logos } = await l3ListLogos();
    ltLogosCache = logos;
    for (const side of LT3_SIDES) {
      const sel = document.getElementById(`lt3-${side}-logo-select`);
      if (sel) fillLogoSelect(sel, logos);
    }
  }
  var LT3_THEME_OPTIONS = [
    { value: "default", label: "Default" },
    { value: "dark", label: "Dark" },
    { value: "dark_alt", label: "Dark Alt" },
    { value: "bright", label: "Bright" },
    { value: "bright_insider", label: "Bright \u2014 Insider" },
    { value: "bright_warm", label: "Bright \u2014 Warm" },
    { value: "bright_info", label: "Bright \u2014 Info" },
    { value: "palette_olive", label: "Palette \u2014 Olive" },
    { value: "palette_teal", label: "Palette \u2014 Teal" },
    { value: "palette_terracotta", label: "Palette \u2014 Terracotta" },
    { value: "palette_plum", label: "Palette \u2014 Plum" },
    { value: "palette_copper", label: "Palette \u2014 Copper" },
    { value: "palette_sage", label: "Palette \u2014 Sage" }
  ];
  var LT3_ANIMATION_OPTIONS = [
    { value: "fade", label: "Fade / Slide" },
    { value: "wipe", label: "Wipe" },
    { value: "grow", label: "Grow" },
    { value: "slide-up", label: "Slide Up" },
    { value: "slide-down", label: "Slide Down" },
    { value: "zoom", label: "Zoom" },
    { value: "flip", label: "Flip" }
  ];
  function buildLowerThirdPanelHtml(side) {
    const label = side === "left" ? "Left" : "Right";
    const themeOpts = LT3_THEME_OPTIONS.map((o) => `<option value="${o.value}">${o.label}</option>`).join("");
    const animOpts = LT3_ANIMATION_OPTIONS.map((o) => `<option value="${o.value}">${o.label}</option>`).join("");
    return `
    <div class="panel-title">${label} <span id="lt3-${side}-onair" class="field-hint" hidden style="color:#c0392b;font-weight:700;">ON AIR</span></div>
    <div id="lt3-${side}-active-line" class="field-hint" style="margin-bottom:12px;">Off air</div>
    <div class="form-group">
      <label for="lt3-${side}-cue-select">Load from library (optional)</label>
      <div class="ml-l3-select-wrap">
        <select id="lt3-${side}-cue-select" class="select-input">
          <option value="">\u2014 Manual entry below \u2014</option>
        </select>
        <button type="button" class="btn btn-secondary" id="lt3-${side}-cues-refresh-btn" title="Reload cue list">Refresh</button>
      </div>
    </div>
    <div class="form-group">
      <label for="lt3-${side}-name-input">Name</label>
      <input type="text" id="lt3-${side}-name-input" class="input-field" placeholder="Speaker name" autocomplete="off" />
    </div>
    <div class="form-group">
      <label for="lt3-${side}-title-input">Title</label>
      <input type="text" id="lt3-${side}-title-input" class="input-field" placeholder="Role or second line" autocomplete="off" />
    </div>
    <div class="form-group">
      <label for="lt3-${side}-subtitle-input">Subtitle (optional)</label>
      <input type="text" id="lt3-${side}-subtitle-input" class="input-field" placeholder="Leave blank for none" autocomplete="off" />
    </div>
    <div class="form-group">
      <label for="lt3-${side}-theme-select">Theme</label>
      <select id="lt3-${side}-theme-select" class="select-input">${themeOpts}</select>
    </div>
    <label class="form-group" style="display:flex;flex-direction:row;align-items:center;gap:8px;cursor:pointer;user-select:none;">
      <input type="checkbox" id="lt3-${side}-logo-enabled-checkbox" />
      <span>Show logo</span>
    </label>
    <div class="form-group">
      <label for="lt3-${side}-logo-select">Logo image</label>
      <select id="lt3-${side}-logo-select" class="select-input">
        <option value="">\u2014 No logo uploaded \u2014</option>
      </select>
    </div>
    <div class="form-group">
      <label for="lt3-${side}-fade-enabled-checkbox">
        <input type="checkbox" id="lt3-${side}-fade-enabled-checkbox" checked />
        Fade in/out
      </label>
    </div>
    <div class="form-group">
      <label for="lt3-${side}-fade-ms-slider">Fade duration (ms)</label>
      <input type="range" id="lt3-${side}-fade-ms-slider" min="0" max="5000" step="50" value="550" style="width:100%;margin-bottom:8px;" />
      <input type="number" id="lt3-${side}-fade-ms-input" class="input-field" min="0" step="50" value="550"
        title="Slider tops out at 5000ms \u2014 type a larger value here for a longer custom fade" />
    </div>
    <div class="form-group">
      <label for="lt3-${side}-animation-style-select">Animation style</label>
      <select id="lt3-${side}-animation-style-select" class="select-input">${animOpts}</select>
    </div>
    <div class="btn-row" style="margin-top:16px;flex-wrap:wrap;">
      <button type="button" class="btn btn-primary" id="lt3-${side}-apply-btn">Apply</button>
      <button type="button" class="btn btn-secondary" id="lt3-${side}-hide-btn">Hide</button>
    </div>
    <div class="btn-row" style="margin-top:8px;flex-wrap:wrap;">
      <button type="button" class="btn btn-secondary" id="lt3-${side}-save-btn">Save to library</button>
      <button type="button" class="btn btn-secondary" id="lt3-${side}-export-btn">Export PNG</button>
    </div>
    <p id="lt3-${side}-msg" class="field-hint" style="margin-top:8px;"></p>
  `;
  }
  function bindLowerThirdSide(side) {
    const g = (suffix) => document.getElementById(`lt3-${side}-${suffix}`);
    g("cues-refresh-btn").addEventListener("click", async () => {
      try {
        await refreshL3CuesCache();
      } catch (e) {
        showError(e.message);
      }
    });
    g("cue-select").addEventListener("change", () => {
      const sel = g("cue-select");
      if (!sel.value) return;
      const cue = ltCuesCache.find((c) => c.id === sel.value);
      if (!cue) return;
      g("name-input").value = cue.name;
      g("title-input").value = cue.title;
      g("subtitle-input").value = cue.subtitle ?? "";
    });
    g("fade-ms-slider").addEventListener("input", () => {
      const slider = g("fade-ms-slider");
      g("fade-ms-input").value = slider.value;
    });
    g("fade-ms-input").addEventListener("input", () => {
      const input = g("fade-ms-input");
      const slider = g("fade-ms-slider");
      const v = Number(input.value);
      if (Number.isFinite(v)) slider.value = String(Math.min(5e3, Math.max(0, v)));
    });
    function readFields() {
      return {
        cueId: g("cue-select").value || void 0,
        name: g("name-input").value.trim(),
        title: g("title-input").value.trim(),
        subtitle: g("subtitle-input").value.trim(),
        theme: g("theme-select").value,
        logoEnabled: g("logo-enabled-checkbox").checked,
        logoAssetId: g("logo-select").value || null,
        fadeEnabled: g("fade-enabled-checkbox").checked,
        fadeMs: Number(g("fade-ms-input").value),
        animationStyle: g("animation-style-select").value
      };
    }
    g("apply-btn").addEventListener("click", async () => {
      const f = readFields();
      if (!f.name) {
        showError("Enter a name");
        return;
      }
      try {
        await lowerThirdApply({
          side,
          ...f.cueId ? { cueId: f.cueId } : {},
          name: f.name,
          title: f.title,
          // Always send subtitle explicitly (even '') so the server can tell
          // "leave blank on purpose" apart from "field wasn't included at all".
          subtitle: f.subtitle,
          theme: f.theme,
          fadeEnabled: f.fadeEnabled,
          fadeMs: Number.isFinite(f.fadeMs) ? f.fadeMs : void 0,
          animationStyle: f.animationStyle,
          logoEnabled: f.logoEnabled,
          logoAssetId: f.logoEnabled ? f.logoAssetId ?? void 0 : null
        });
      } catch (e) {
        showError(e.message);
      }
    });
    g("hide-btn").addEventListener("click", async () => {
      try {
        await lowerThirdHide(side);
      } catch (e) {
        showError(e.message);
      }
    });
    g("save-btn").addEventListener("click", async () => {
      const f = readFields();
      if (!f.name) {
        showError("Enter a name");
        return;
      }
      const msgEl = g("msg");
      try {
        if (f.cueId) {
          await l3UpdateCue(f.cueId, { name: f.name, title: f.title, subtitle: f.subtitle, themeId: f.theme });
          msgEl.textContent = "Cue updated in library.";
        } else {
          await l3CreateCue({ name: f.name, title: f.title, subtitle: f.subtitle, themeId: f.theme });
          msgEl.textContent = "Saved as a new cue.";
        }
        await refreshL3CuesCache();
      } catch (e) {
        msgEl.textContent = e.message;
      }
    });
    g("export-btn").addEventListener("click", async () => {
      const f = readFields();
      if (!f.name) {
        showError("Enter a name");
        return;
      }
      const msgEl = g("msg");
      try {
        await l3ExportPng({
          name: f.name,
          title: f.title,
          subtitle: f.subtitle,
          theme: f.theme,
          logoAssetId: f.logoEnabled ? f.logoAssetId : null
        });
        msgEl.textContent = "PNG exported.";
      } catch (e) {
        msgEl.textContent = e.message;
      }
    });
  }
  function initLowerThirdsTab() {
    for (const side of LT3_SIDES) {
      const container = document.getElementById(`lt3-panel-${side}`);
      if (!container) continue;
      container.innerHTML = buildLowerThirdPanelHtml(side);
      bindLowerThirdSide(side);
    }
  }
  function formatLogoRow(logo) {
    return `<div class="item-row" data-id="${logo.id}">
    <img class="item-thumb" src="/api/l3/logos/${encodeURIComponent(logo.id)}/file" alt="" />
    <span class="item-name">${logo.filename}</span>
    <button type="button" class="btn btn-secondary" data-l3-logo-delete="${logo.id}">Delete</button>
  </div>`;
  }
  async function refreshL3LogoList() {
    const { logos } = await l3ListLogos();
    ltLogosCache = logos;
    const list = document.getElementById("l3mgmt-logo-list");
    if (!list) return;
    list.innerHTML = logos.length ? logos.map(formatLogoRow).join("") : '<span class="field-hint">No logos uploaded yet.</span>';
    list.querySelectorAll("[data-l3-logo-delete]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.l3LogoDelete;
        if (!id) return;
        try {
          await l3DeleteLogo(id);
          await refreshL3LogoList();
          await refreshL3LogosCache();
        } catch (e) {
          showError(e.message);
        }
      });
    });
  }
  function initManageLowerThirdsTab() {
    document.getElementById("l3mgmt-csv-import-btn").addEventListener("click", async () => {
      const input = document.getElementById("l3mgmt-csv-input");
      const msg = document.getElementById("l3mgmt-csv-msg");
      const file = input.files?.[0];
      if (!file) {
        msg.textContent = "Choose a CSV file first.";
        return;
      }
      try {
        const r = await l3ImportCsv(file);
        msg.textContent = `Imported ${r.imported}, skipped ${r.skipped}.${r.warnings.length ? " See console for details." : ""}`;
        if (r.warnings.length) console.warn("CSV import warnings:", r.warnings);
        input.value = "";
        await refreshL3CuesCache();
      } catch (e) {
        msg.textContent = e.message;
      }
    });
    document.getElementById("l3mgmt-logo-upload-btn").addEventListener("click", async () => {
      const input = document.getElementById("l3mgmt-logo-input");
      const msg = document.getElementById("l3mgmt-logo-msg");
      const file = input.files?.[0];
      if (!file) {
        msg.textContent = "Choose an image file first.";
        return;
      }
      try {
        await l3UploadLogo(file);
        msg.textContent = "Logo uploaded.";
        input.value = "";
        await refreshL3LogoList();
        await refreshL3LogosCache();
      } catch (e) {
        msg.textContent = e.message;
      }
    });
    void refreshL3LogoList().catch(() => {
    });
  }
  async function refreshActiveProfile() {
    try {
      const p = await fetchActiveProfile();
      const el = document.getElementById("active-profile");
      if (el) el.textContent = `Profile: ${p.name}`;
      const nameLabel = document.getElementById("machine-name-label");
      if (nameLabel) nameLabel.textContent = p.name;
    } catch {
      const el = document.getElementById("active-profile");
      if (el) el.textContent = "";
    }
  }
  function startNotesPolling() {
    if (notesPollingInterval) return;
    void pollNotes();
    notesPollingInterval = setInterval(() => void pollNotes(), 2e3);
  }
  function stopNotesPolling() {
    if (notesPollingInterval) {
      clearInterval(notesPollingInterval);
      notesPollingInterval = null;
    }
  }
  async function pollNotes() {
    const content = document.getElementById("notes-content");
    const indicator = document.getElementById("notes-slide-indicator");
    if (!content) return;
    const state = store.getState();
    if (state.currentMode !== "slides") {
      content.textContent = "Notes are only available in Slides mode.";
      if (indicator) indicator.textContent = "";
      return;
    }
    try {
      const data = await fetchSlidesNotes();
      content.textContent = data.notes ?? "(no notes for this slide)";
      if (indicator && data.slideIndex !== null) {
        indicator.textContent = `Slide ${data.slideIndex + 1}`;
      }
    } catch {
      content.textContent = "Could not load notes.";
    }
  }
  async function refreshSlidePresets() {
    const container = document.getElementById("slide-presets-list");
    if (!container) return;
    try {
      const { presets } = await fetchPresets();
      if (!presets.length) {
        container.innerHTML = "<span>No presets saved. Add presets in Admin \u2192 URL Presets.</span>";
        return;
      }
      container.innerHTML = "";
      for (const p of presets) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "btn btn-secondary";
        btn.style.width = "100%";
        btn.style.marginBottom = "6px";
        btn.style.justifyContent = "flex-start";
        btn.textContent = p.name;
        btn.title = p.url;
        btn.addEventListener("click", async () => {
          try {
            await loadDeck(p.url);
          } catch (e) {
            showError(e.message);
          }
        });
        container.appendChild(btn);
      }
    } catch {
      container.innerHTML = "<span>Could not load presets.</span>";
    }
  }
  async function refreshUrlPresets() {
    const container = document.getElementById("url-presets-list");
    if (!container) return;
    try {
      const { presets } = await fetchPresets();
      if (!presets.length) {
        container.innerHTML = "<span>No presets saved. Add them in Admin \u2192 URL Presets.</span>";
        return;
      }
      container.innerHTML = "";
      for (const p of presets) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "btn btn-secondary";
        btn.style.width = "100%";
        btn.style.marginBottom = "6px";
        btn.style.justifyContent = "flex-start";
        btn.textContent = p.name;
        btn.title = p.url;
        btn.addEventListener("click", async () => {
          try {
            await loadUrl(p.url);
          } catch (e) {
            showError(e.message);
          }
        });
        container.appendChild(btn);
      }
    } catch {
      container.innerHTML = "<span>Could not load presets.</span>";
    }
  }
  function connectWs(delay = 1e3) {
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${location.host}/ws`);
    ws.addEventListener("open", () => setWsStatus(true));
    ws.addEventListener("close", () => {
      setWsStatus(false);
      setTimeout(() => connectWs(Math.min(delay * 2, 3e4)), delay);
    });
    ws.addEventListener("message", (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === "state") store.applyFullState(msg.payload);
      else if (msg.type === "state_patch") store.applyPatch(msg.payload);
    });
  }
  function setWsStatus(connected) {
    wsConnected = connected;
    renderReactRoots(store.getState());
  }
  function renderState(state) {
    renderReactRoots(state);
    const panicBanner = document.getElementById("panic-banner");
    if (panicBanner) {
      panicBanner.classList.toggle("visible", state.reliability.panicActive);
    }
    const slides = state.slides;
    const hasSlides = state.currentMode === "slides" && slides !== null;
    const navEnabled = hasSlides && slides !== null && !slides.isLoading;
    document.getElementById("slide-counter").textContent = hasSlides && slides ? `${slides.slideIndex + 1} / ${slides.slideCount}` : "\u2014 / \u2014";
    document.getElementById("deck-title").textContent = hasSlides && slides ? slides.deckTitle !== slides.deckId ? slides.deckTitle : "Loading\u2026" : "No deck loaded";
    document.getElementById("prev-btn").disabled = !navEnabled || slides.slideIndex === 0;
    document.getElementById("next-btn").disabled = !navEnabled || slides.slideIndex >= slides.slideCount - 1;
    document.getElementById("goto-btn").disabled = !navEnabled;
    document.getElementById("reload-btn").disabled = !hasSlides;
    const activeKey = state.abState.activeInstance === "A" ? "instanceA" : "instanceB";
    const activeUrlInst = state.abState[activeKey];
    const urlReloadOk = state.currentMode === "url" && Boolean(activeUrlInst.url) && !activeUrlInst.isLoading;
    document.getElementById("url-reload-btn").disabled = !urlReloadOk;
    const urlStatusEl = document.getElementById("url-status");
    if (state.currentMode === "url" && state.currentUrl) {
      const tgt = activeUrlInst.displayTarget ? ` \u2192 ${activeUrlInst.displayTarget}` : "";
      const load = activeUrlInst.isLoading ? " (loading)" : activeUrlInst.isReady ? "" : " (not ready)";
      urlStatusEl.textContent = `Active (${state.abState.activeInstance}): ${state.currentUrl}${tgt}${load}`;
    } else if (state.currentMode === "url") {
      urlStatusEl.textContent = "URL mode \u2014 no URL on active instance yet";
    } else {
      urlStatusEl.textContent = "";
    }
    for (const side of LT3_SIDES) {
      const line = document.getElementById(`lt3-${side}-active-line`);
      if (!line) continue;
      const lt = state.graphics?.lowerThirds?.[side];
      if (lt?.visible) {
        const parts = [lt.name, lt.title].filter((x) => Boolean(x));
        line.textContent = parts.length ? `On air: ${parts.join(" \u2014 ")}` : "On air: \u2014";
      } else {
        line.textContent = "Off air";
      }
      const badge = document.getElementById(`lt3-${side}-onair`);
      if (badge) badge.hidden = !lt?.visible;
    }
    const mlLine = document.getElementById("ml-active-line");
    const ml = state.mediaLibrary;
    if (state.currentMode === "media-library" && ml?.activeItemName) {
      mlLine.textContent = `On air: ${ml.activeItemName}`;
    } else if (state.currentMode === "media-library") {
      mlLine.textContent = "On air: (no item)";
    } else {
      mlLine.textContent = "On air: \u2014";
    }
    document.getElementById("state-dump").textContent = JSON.stringify(state, null, 2);
    const wd = state.watchdog;
    const SUPPRESS_UNRELIABLE_WATCHDOG_BANNERS = true;
    const unrespBanner = document.getElementById("wd-unresponsive-banner");
    const unrespText = document.getElementById("wd-unresponsive-text");
    if (unrespBanner && unrespText) {
      const show = !SUPPRESS_UNRELIABLE_WATCHDOG_BANNERS && (wd?.programUnresponsive ?? false);
      unrespBanner.classList.toggle("visible", show);
      if (show) {
        const secs = wd?.programUnresponsiveSecs ?? 0;
        if (secs >= 15) {
          unrespText.textContent = "\u26A0 Program output not responding. Force reload strongly recommended.";
        } else {
          unrespText.textContent = "\u26A0 Program Output Unresponsive";
        }
      }
    }
    const memBanner = document.getElementById("wd-memory-banner");
    const memText = document.getElementById("wd-memory-text");
    if (memBanner && memText) {
      const show = !SUPPRESS_UNRELIABLE_WATCHDOG_BANNERS && (wd?.memoryPressure ?? false);
      memBanner.classList.toggle("visible", show);
      if (show) {
        memText.textContent = `\u26A0 Memory Usage High \u2014 ${wd.memoryPressurePct}% (${wd.memoryHeapUsedGb} GB / ${wd.memoryHeapTotalGb} GB)`;
      }
    }
    const restartBanner = document.getElementById("wd-restart-banner");
    if (restartBanner) {
      const crashed = wd?.lastRendererCrashAt ?? null;
      if (crashed) {
        const age = Date.now() - new Date(crashed).getTime();
        if (age < 8e3) {
          restartBanner.classList.add("visible");
          setTimeout(() => restartBanner.classList.remove("visible"), 8e3 - age);
        }
      }
    }
  }
  function showError(msg) {
    const toast = document.getElementById("error-toast");
    toast.textContent = msg;
    toast.style.display = "block";
    setTimeout(() => {
      toast.style.display = "none";
    }, 4e3);
  }
  function bindEvents() {
    const on = (id, fn) => {
      document.getElementById(id).addEventListener("click", async () => {
        try {
          await fn();
        } catch (e) {
          showError(e.message);
        }
      });
    };
    document.getElementById("google-signin-btn")?.addEventListener("click", async () => {
      try {
        await openGoogleAuth();
      } catch (e) {
        showError(e.message);
      }
    });
    document.getElementById("google-auth-refresh-btn")?.addEventListener("click", () => {
      void refreshGoogleAuth().catch(() => {
      });
    });
    on("load-btn", () => loadDeck(
      document.getElementById("deck-url-input").value.trim()
    ));
    on("next-btn", () => slideNext());
    on("prev-btn", () => slidePrev());
    on("goto-btn", async () => {
      const n = parseInt(document.getElementById("goto-input").value, 10);
      if (!isNaN(n) && n >= 1) await slideGoto(n - 1);
    });
    on("reload-btn", () => slideReload());
    on("url-load-btn", async () => {
      const url = document.getElementById("url-input").value.trim();
      const displayRaw = document.getElementById("url-display-input").value.trim();
      if (!url) {
        showError("Enter a URL");
        return;
      }
      await loadUrl(url, displayRaw || void 0);
    });
    on("url-reload-btn", () => urlReload());
    on("lt3-open-output-btn", async () => {
      const sel = document.getElementById("lt3-output-display-select");
      const displayId = sel.value;
      const displayLabel = displayId ? sel.options[sel.selectedIndex].textContent : "primary display";
      const url = `${location.origin}/graphics/lower-third-live/index.html`;
      const statusEl = document.getElementById("lt3-output-status");
      await loadUrl(url, displayId || void 0);
      if (statusEl) statusEl.textContent = `Output opened: ${url} \u2192 ${displayLabel}`;
    });
    document.getElementById("lt3-displays-refresh-btn").addEventListener("click", () => {
      void refreshDisplaySelect().catch((e) => showError(e.message));
    });
    document.getElementById("ml-refresh-btn").addEventListener("click", async () => {
      try {
        await refreshMediaSelect();
      } catch (e) {
        showError(e.message);
      }
    });
    on("ml-take-btn", async () => {
      const sel = document.getElementById("ml-item-select");
      if (!sel.value) {
        showError("Select a media item");
        return;
      }
      await mediaLibraryTake(sel.value);
    });
    on("ml-clear-btn", () => mediaLibraryClear());
    document.getElementById("wd-force-reload-btn")?.addEventListener("click", async () => {
      try {
        const state = store.getState();
        const activeInst = state.abState.activeInstance;
        await reloadInstance(activeInst === "A" ? "B" : "A");
        await urlReload();
      } catch (e) {
        showError(e.message);
      }
    });
    document.addEventListener("keydown", (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const preset = KBD_PRESETS[activeKbdPreset];
      if (preset.next.includes(e.key)) {
        if (e.key === " " || e.key === "Enter") e.preventDefault();
        const btn = document.getElementById("next-btn");
        if (btn && !btn.disabled) void slideNext().catch((err) => showError(err.message));
      } else if (preset.prev.includes(e.key)) {
        if (e.key === "Backspace") e.preventDefault();
        const btn = document.getElementById("prev-btn");
        if (btn && !btn.disabled) void slidePrev().catch((err) => showError(err.message));
      } else if (e.key === "p" || e.key === "P") {
        if (!preset.prev.includes(e.key)) {
          void panicAction("toggle").catch((err) => showError(err.message));
        }
      }
    });
    document.querySelectorAll("[data-kbd-preset]").forEach((btn) => {
      btn.addEventListener("click", () => {
        setKbdPreset(btn.dataset.kbdPreset);
      });
    });
    document.querySelectorAll(".nav-item").forEach((item) => {
      item.addEventListener("click", (ev) => {
        ev.preventDefault();
        document.querySelectorAll(".nav-item").forEach((n) => n.classList.remove("active"));
        document.querySelectorAll("section[data-tab]").forEach((s) => {
          s.hidden = true;
        });
        item.classList.add("active");
        const target = item.dataset.target;
        if (target) {
          const section = document.querySelector(`section[data-tab="${target}"]`);
          if (section) section.hidden = false;
        }
        if (target === "notes") {
          startNotesPolling();
        } else {
          stopNotesPolling();
        }
        if (target === "lower-third-live") {
          void refreshDisplaySelect().catch(() => {
          });
          void refreshL3CuesCache().catch(() => {
          });
          void refreshL3LogosCache().catch(() => {
          });
        }
        if (target === "l3") {
          void refreshL3LogoList().catch(() => {
          });
        }
      });
    });
  }
  renderReactRoots(store.getState());
  store.subscribe(renderState);
  bindEvents();
  renderKbdPresetButtons();
  initLowerThirdsTab();
  initManageLowerThirdsTab();
  void refreshL3CuesCache().catch(() => {
  });
  void refreshL3LogosCache().catch(() => {
  });
  void refreshMediaSelect().catch(() => {
  });
  void refreshActiveProfile().catch(() => {
  });
  void refreshGoogleAuth().catch(() => {
  });
  setInterval(() => {
    void refreshActiveProfile().catch(() => {
    });
  }, 6e4);
  connectWs();
  function initSettingsTab() {
    const current = document.documentElement.getAttribute("data-theme") ?? "light";
    const radio = document.querySelector(`input[name="theme-radio"][value="${current}"]`);
    if (radio) radio.checked = true;
    document.querySelectorAll('input[name="theme-radio"]').forEach((r) => {
      r.addEventListener("change", () => {
        const theme = r.value;
        document.documentElement.setAttribute("data-theme", theme);
        localStorage.setItem("pconair-operator-theme", theme);
      });
    });
  }
  initSettingsTab();
  var localTheme = localStorage.getItem("pconair-operator-theme");
  if (localTheme === "light" || localTheme === "dark") {
    document.documentElement.setAttribute("data-theme", localTheme);
  }
  void refreshSlidePresets().catch(() => {
  });
  void refreshUrlPresets().catch(() => {
  });
  void refreshDisplaySelect().catch(() => {
  });
  void fetchActiveProfile().then((p) => {
    if (localTheme === "light" || localTheme === "dark") return;
    const theme = p.appPreferences?.operatorTheme === "dark" ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", theme);
    const radio = document.querySelector(`input[name="theme-radio"][value="${theme}"]`);
    if (radio) radio.checked = true;
  }).catch(() => {
  });
})();
