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

  // src/renderer/operator/state.ts
  var DEFAULT_STATE = {
    currentMode: "idle",
    currentPreset: null,
    currentUrl: null,
    slides: null,
    l3: null,
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
    teleprompter: { enabled: false, host: "", scrolling: false, speed: 40, fontSize: 72 },
    graphics: { scoreboard: null, lowerThird: null }
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
  async function apiPost(path, body) {
    const res = await fetch(path, {
      ...fetchDefaults,
      method: "POST",
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
  var urlReload = (instance) => apiPost("/api/url/reload", instance ? { instance } : {});
  var l3ListCues = () => apiGet("/api/l3/cues");
  var l3Take = (body) => apiPost("/api/l3/take", body);
  var l3Clear = () => apiPost("/api/l3/clear");
  var l3Stacking = (enabled) => apiPost("/api/l3/stacking", { enabled });
  var lowerThirdApply = (body) => apiPost("/api/action", { action_id: "lower_third_apply", params: body });
  var lowerThirdHide = () => apiPost("/api/action", { action_id: "lower_third_hide", params: {} });
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
    l3: "warning",
    "media-library": "strong"
  };
  var MODE_BUTTONS = [
    { mode: "idle", label: "Idle" },
    { mode: "slides", label: "Slides" },
    { mode: "url", label: "URL" },
    { mode: "l3", label: "Lower Thirds" },
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
  var l3StackingUiLock = false;
  var notesPollingInterval = null;
  var ltCuesCache = [];
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
  async function refreshL3CueSelect() {
    const { cues } = await l3ListCues();
    const sel = document.getElementById("l3-cue-select");
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
  async function refreshLowerThirdCueSelect() {
    const { cues } = await l3ListCues();
    ltCuesCache = cues;
    const sel = document.getElementById("lt-cue-select");
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
    const l3Line = document.getElementById("l3-active-line");
    const l3s = state.l3;
    if (l3s?.activeCueName != null || l3s?.activeTitle != null) {
      const parts = [l3s.activeCueName, l3s.activeTitle].filter(
        (x) => typeof x === "string" && x.length > 0
      );
      l3Line.textContent = parts.length ? `Active: ${parts.join(" \u2014 ")}` : "Active: \u2014";
    } else {
      l3Line.textContent = "Active: \u2014";
    }
    const ltLine = document.getElementById("lt-active-line");
    const lowerThird = state.graphics?.lowerThird;
    if (ltLine) {
      if (lowerThird?.visible) {
        const parts = [lowerThird.name, lowerThird.title].filter((x) => Boolean(x));
        ltLine.textContent = parts.length ? `Active: ${parts.join(" \u2014 ")}` : "Active: \u2014";
      } else {
        ltLine.textContent = "Active: \u2014";
      }
    }
    const stackCb = document.getElementById("l3-stacking-checkbox");
    l3StackingUiLock = true;
    stackCb.checked = Boolean(l3s?.isStacking);
    l3StackingUiLock = false;
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
    document.getElementById("l3-cues-refresh-btn").addEventListener("click", async () => {
      try {
        await refreshL3CueSelect();
      } catch (e) {
        showError(e.message);
      }
    });
    on("l3-take-btn", async () => {
      const autoOutSec = parseFloat(document.getElementById("l3-auto-out-input").value);
      const autoOutMs = Number.isFinite(autoOutSec) && autoOutSec > 0 ? Math.round(autoOutSec * 1e3) : null;
      const sel = document.getElementById("l3-cue-select");
      if (sel.value) {
        await l3Take({ cueId: sel.value, autoOutMs: autoOutMs ?? void 0 });
        return;
      }
      const name = document.getElementById("l3-name-input").value.trim();
      const title = document.getElementById("l3-title-input").value.trim();
      await l3Take({ name, title, autoOutMs: autoOutMs ?? void 0 });
    });
    on("l3-clear-btn", () => l3Clear());
    on("lt-open-output-btn", async () => {
      const displayRaw = document.getElementById("lt-output-display-input").value.trim();
      const url = `${location.origin}/graphics/lower-third-live/index.html`;
      const statusEl = document.getElementById("lt-output-status");
      await loadUrl(url, displayRaw || void 0);
      if (statusEl) statusEl.textContent = `Output opened: ${url}${displayRaw ? ` \u2192 ${displayRaw}` : ""}`;
    });
    document.getElementById("lt-fade-ms-slider").addEventListener("input", () => {
      const slider = document.getElementById("lt-fade-ms-slider");
      document.getElementById("lt-fade-ms-input").value = slider.value;
    });
    document.getElementById("lt-fade-ms-input").addEventListener("input", () => {
      const input = document.getElementById("lt-fade-ms-input");
      const slider = document.getElementById("lt-fade-ms-slider");
      const v = Number(input.value);
      if (Number.isFinite(v)) slider.value = String(Math.min(5e3, Math.max(0, v)));
    });
    document.getElementById("lt-cues-refresh-btn").addEventListener("click", async () => {
      try {
        await refreshLowerThirdCueSelect();
      } catch (e) {
        showError(e.message);
      }
    });
    document.getElementById("lt-cue-select").addEventListener("change", () => {
      const sel = document.getElementById("lt-cue-select");
      if (!sel.value) return;
      const cue = ltCuesCache.find((c) => c.id === sel.value);
      if (!cue) return;
      document.getElementById("lt-name-input").value = cue.name;
      document.getElementById("lt-title-input").value = cue.title;
      document.getElementById("lt-subtitle-input").value = cue.subtitle ?? "";
    });
    on("lt-apply-btn", async () => {
      const cueId = document.getElementById("lt-cue-select").value;
      const name = document.getElementById("lt-name-input").value.trim();
      const title = document.getElementById("lt-title-input").value.trim();
      const subtitle = document.getElementById("lt-subtitle-input").value.trim();
      const theme = document.getElementById("lt-theme-select").value;
      const fadeEnabled = document.getElementById("lt-fade-enabled-checkbox").checked;
      const fadeMs = Number(document.getElementById("lt-fade-ms-input").value);
      const animationStyle = document.getElementById("lt-animation-style-select").value;
      if (!name) {
        showError("Enter a name");
        return;
      }
      await lowerThirdApply({
        ...cueId ? { cueId } : {},
        name,
        title,
        // Always send subtitle explicitly (even '') so the server can tell
        // "leave blank on purpose" apart from "field wasn't included at all" —
        // otherwise clearing this input would never actually clear the output.
        subtitle,
        theme,
        fadeEnabled,
        fadeMs: Number.isFinite(fadeMs) ? fadeMs : void 0,
        animationStyle
      });
    });
    on("lt-hide-btn", () => lowerThirdHide());
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
    document.getElementById("l3-stacking-checkbox").addEventListener(
      "change",
      async () => {
        if (l3StackingUiLock) return;
        const cb = document.getElementById("l3-stacking-checkbox");
        try {
          await l3Stacking(cb.checked);
        } catch (e) {
          showError(e.message);
          l3StackingUiLock = true;
          cb.checked = !cb.checked;
          l3StackingUiLock = false;
        }
      }
    );
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
      });
    });
  }
  renderReactRoots(store.getState());
  store.subscribe(renderState);
  bindEvents();
  renderKbdPresetButtons();
  void refreshL3CueSelect().catch(() => {
  });
  void refreshLowerThirdCueSelect().catch(() => {
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
  var savedTheme = localStorage.getItem("pconair-operator-theme");
  if (savedTheme === "light" || savedTheme === "dark") {
    document.documentElement.setAttribute("data-theme", savedTheme);
  }
  void refreshSlidePresets().catch(() => {
  });
  void refreshUrlPresets().catch(() => {
  });
  void fetchActiveProfile().then((p) => {
    const theme = p.appPreferences?.operatorTheme ?? "light";
    document.documentElement.setAttribute("data-theme", theme);
  }).catch(() => {
  });
})();
