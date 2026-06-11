# PConAir v2 — Execution Progress

> Working state for the v2 build (plan: `docs/pconair-v2-plan.md`). Updated at every phase boundary, **before** any context compaction. If you are resuming from a compacted context, read this file and the plan first.

## Context rules (token budget)
- **Never read `Google-Slides-Controller/main.js` whole** (13,195 lines ≈ a full context window). Grep for the feature, read only that section.
- Compact at phase boundaries only, never mid-phase. Update this file first.
- Baseline established 2026-06-10: `npx vitest run` → **202 tests passing, 16 files**.
- node_modules was rebuilt for Linux (repo synced from a Mac); if rollup native module errors appear, `rm -rf node_modules && npm ci`.

## Phase status

| Phase | Status | Notes |
|---|---|---|
| 1 — Tray shell, settings window, /remote, port config | ✅ done 2026-06-10 | New: `src/main/app-settings.ts` (port in userData `app-settings.json`, env > file > 8080), `src/main/tray.ts`, `src/main/settings-window.ts` (+ `src/renderer/settings/`, `settings-preload.ts`, IPC `pconair:settings:*`), `/remote` SPA shell (`src/main/routes/remote.ts` + `src/renderer/remote/`, hash-nav, WS status), `next=/remote/` support in browser login (allowlisted, no open redirect). Appliance behavior: no windows at boot, app survives window-all-closed, quit via tray; settings window auto-opens on EADDRINUSE (`listen()` now rejects on error). Forge entries added: `remote`, `settings` (with preload). Tests: 216 passing (was 202); new `tests/app-settings.test.ts`, `tests/remote-routes.test.ts`. `electron-forge package` succeeds; GUI not launchable here (no X server) — tray/settings window need a manual check on the Mac mini. |
| 2 — Slides (V2-C UI, notes, thumbnails, A/B, offline) | ✅ done 2026-06-10 (code) / ⚠️ needs live verify | `SlidesState` extended (notes, notesOpen, thumbnails, backup deck, offlineMode/cacheWarmed, contentKind, deckUrl) via `makeSlidesState()`. GSC compat: `src/main/services/gsc-status.ts` (flat fields merged into now-unauthenticated GET /api/status) + `src/main/routes/gsc-compat.ts` (open-presentation, next/previous-slide, go-to-slide 1-based, reload/close, open-slido→url mode, honest 400s for unsupported endpoints) — cookie-less, IP-allowlist-gated like GSC. Native API additions: GET /api/slides/status, GET /api/slides/thumbnails, POST /api/slides/load {backupUrl}, POST /api/slides/offline-mode. Window manager rebuilt with GSC techniques: S-key spawns Google presenter-notes popup (hidden capture source), 1 Hz DOM poll (aria-posinset/setsize, title, `.punch-viewer-speakernotes-text-body-scrollable`, U+FFFD normalize), arrow-key navigation + hash jump, capturePage thumbnails, backup deck preload into inactive A/B instance, 30s cache-warm timer. /remote slides page: V2-C-adapted UI (counter, thumb strip, notes card w/ zoom+readout+localStorage, 72px prev/next, goto, A/B switch, offline toggle, haptics, keyboard shortcuts). Tests 235 passing (19 new in `tests/gsc-compat.test.ts`); logout test now uses /api/instance-status (status is unauthenticated). **Manual verify on Mac mini:** presenter-popup capture, navigation against real deck, GSC Companion module pointed at PConAir port. |
| 3 — Tunnel + QR + PIN | pending | |
| 4 — Lower thirds UI + FaireL3s themes | pending | |
| 5 — Still store + slideshow | pending | |
| 6 — /render/:type + bg/key modes | pending | |
| 7 — Packages system | pending | |
| 8 — Bundled packages (COURTVISION, News, FFG) | pending | |
| 9 — Companion module | pending | |
| 10 — Stagetimer + URL mode + Timer page | pending | |
| 11 — Polish/hardening | pending | |

## Phase 2 research findings (GSC Companion compat surface)

The GSC Companion module (`companion-module-gslide-opener/`) uses **HTTP polling, no auth, no cookies** (GSC gates by IP allowlist only — matches v2 plan's API model). To keep existing buttons working, PConAir must serve:

- `GET /api/status` polled at 1 Hz. Module reads **flat fields**: `presentationOpen, notesOpen, currentSlide (1-based), totalSlides, presentationUrl, contentKind ('slides'|'slido'), slideInfo ("3 / 10"), isFirstSlide, isLastSlide, nextSlide, previousSlide, presentationTitle, timerElapsed, presentationDisplayId, notesDisplayId, loginState, loggedInUser, backupControlsEnabled, notesZoomSteps, notesZoomDefault, notesLayout, perfectcue {enabled, ports[]}`. **Merge these into PConAir's existing /api/status response** (extra fields are harmless to both consumers).
- Action POSTs (all unauthenticated, IP-allowlist only): `/api/open-presentation {url}`, `/api/open-presentation-with-notes {url}`, `/api/open-slido {url}`, `/api/open-url {url, backgroundColor}`, `/api/open-key-fill`, `/api/close-key-fill`, `/api/open-preset {preset:1-3}`, `/api/close-presentation`, `/api/next-slide`, `/api/previous-slide`, `/api/go-to-slide {slide}` (1-based), `/api/reload-presentation`, `/api/toggle-video`, `/api/open-speaker-notes`, `/api/close-speaker-notes`, `/api/scroll-notes-down`, `/api/scroll-notes-up`, `/api/zoom-in-notes`, `/api/zoom-out-notes`, `/api/show-tunnel-qr {duration}`, `/api/hide-tunnel-qr`, `/api/set-backup-controls {enabled}`, `/api/preferences {notesLayout}`, `/api/relaunch-speaker-notes`, `/api/set-perfectcue-enabled`, `/api/toggle-perfectcue-port`. Success = HTTP 200 + JSON.
- Phase 2 must implement the slides/notes/url subset; tunnel-qr lands in phase 3; key-fill / perfectcue / toggle-video / backup-controls may return graceful no-op errors (module shows action failure but doesn't break) — decide per endpoint.
- GSC module action IDs / variables / feedbacks (for phase 9 module parity): variables incl. `current_slide, total_slides, slide_info, is_first/last_slide, presentation_title, content_kind, timer_elapsed…`; feedbacks `presentation_open, notes_open, on_slide, is_first_slide, is_last_slide, login_state, backup_controls_enabled, notes_layout_is`.
- V2-C design (`web-remote-v2c/plan.md`): Faire design tokens (§3), V2-C layout order: header (status dot + name + counter + toggles) → stagetimer card → slide strip (current/next thumbs) → notes card (toolbar: scroll/zoom + px readout, Lora 19/30) → prev/next 72px buttons → bottom tabs. Stagetimer tone tokens + overtime state. PConAir /remote already uses bottom-nav shell; adapt V2-C inside the Slides page.
- Current PConAir slides impl: `SlidesState {deckId, deckTitle, slideIndex (0-based), slideCount, isLoading}`; ops in `src/main/services/slide-ops.ts`; window manager `src/main/slides/window-manager.ts` (A/B windows, loads `/present`, navigates by aria-label click — weak). PConAir-native API: POST `/api/slides/load {deckUrl, instance}`, `/next`, `/prev`, `/goto {slideIndex 0-based}`, `/reload` — all operator-cookie-gated.

## Decisions log
- 2026-06-10: Branch `feat/v2-phase1-shell` created from `docs/phase3-phase4-complete` (carries the v2 plan doc). Commit at each phase boundary.
- Existing implementation status doc: `specs/11-implementation-status.md` (now 202 tests, doc says 167).
- Port default 8080, never 9595 (GSC's port).

## Reference sizes (measured, for budgeting)
- GSC `main.js`: 13,195 lines — section reads only
- v2c design: plan.md 400 ln, Web Remote UI.html 153 ln, design-canvas.jsx 253 ln + components/
- GSC companion module: ~1,230 ln JS
- Prototypes: hoops 208 ln, faire-nightly-news 133 ln
- FFG obs/: ~3,054 ln total
- PConAir src: 7,172 ln TS
