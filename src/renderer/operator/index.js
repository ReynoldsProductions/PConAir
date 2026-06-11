"use strict";
(() => {
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
    }
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
  var mediaLibraryList = () => apiGet("/api/media-library");
  var mediaLibraryTake = (itemId) => apiPost("/api/media-library/take", { itemId });
  var mediaLibraryClear = () => apiPost("/api/media-library/clear");
  var fetchActiveProfile = () => apiGet("/api/profiles/active");
  var reloadInstance = (instance, timeout) => apiPost("/api/reload-instance", timeout ? { instance, timeout } : { instance });
  async function panicAction(action = "toggle") {
    return apiPost("/api/panic", { action });
  }

  // src/renderer/operator/index.ts
  var store = createClientStore();
  var l3StackingUiLock = false;
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
  async function refreshActiveProfile() {
    try {
      const p = await fetchActiveProfile();
      const el = document.getElementById("active-profile");
      if (el) el.textContent = `Profile: ${p.name}`;
    } catch {
      const el = document.getElementById("active-profile");
      if (el) el.textContent = "";
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
    document.getElementById("ws-dot").classList.toggle("connected", connected);
    document.getElementById("ws-label").textContent = connected ? "Connected" : "Disconnected";
  }
  function renderState(state) {
    const badge = document.getElementById("mode-badge");
    badge.textContent = state.currentMode.toUpperCase();
    badge.className = `mode-badge ${state.currentMode}`;
    const lockBadge = document.getElementById("show-lock-badge");
    if (lockBadge) {
      lockBadge.classList.toggle("visible", state.connectionStatus.adminShowLocked);
    }
    const panicBanner = document.getElementById("panic-banner");
    const panicBtn = document.getElementById("panic-btn");
    if (panicBanner && panicBtn) {
      panicBanner.classList.toggle("visible", state.reliability.panicActive);
      panicBtn.textContent = state.reliability.panicActive ? "UN-PANIC" : "PANIC";
    }
    document.getElementById("companion-dot").classList.toggle(
      "connected",
      state.connectionStatus.companionConnected
    );
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
    const active = state.abState.activeInstance;
    document.getElementById("ab-a-btn").classList.toggle("active", active === "A");
    document.getElementById("ab-b-btn").classList.toggle("active", active === "B");
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
    const unrespBanner = document.getElementById("wd-unresponsive-banner");
    const unrespText = document.getElementById("wd-unresponsive-text");
    if (unrespBanner && unrespText) {
      const show = wd?.programUnresponsive ?? false;
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
      const show = wd?.memoryPressure ?? false;
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
      const sel = document.getElementById("l3-cue-select");
      if (sel.value) {
        await l3Take({ cueId: sel.value });
        return;
      }
      const name = document.getElementById("l3-name-input").value.trim();
      const title = document.getElementById("l3-title-input").value.trim();
      await l3Take({ name, title });
    });
    on("l3-clear-btn", () => l3Clear());
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
    on("panic-btn", () => panicAction("toggle"));
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
      if (e.key !== "p" && e.key !== "P") return;
      void panicAction("toggle").catch((err) => showError(err.message));
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
    document.querySelectorAll(".ab-btn").forEach(
      (btn) => btn.addEventListener("click", async () => {
        try {
          await switchAB(btn.dataset.instance);
        } catch (e) {
          showError(e.message);
        }
      })
    );
    document.querySelectorAll("[data-mode]").forEach(
      (btn) => btn.addEventListener("click", async () => {
        try {
          await setMode(btn.dataset.mode);
        } catch (e) {
          showError(e.message);
        }
      })
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
      });
    });
  }
  store.subscribe(renderState);
  bindEvents();
  void refreshL3CueSelect().catch(() => {
  });
  void refreshMediaSelect().catch(() => {
  });
  void refreshActiveProfile().catch(() => {
  });
  setInterval(() => {
    void refreshActiveProfile().catch(() => {
    });
  }, 6e4);
  connectWs();
})();
