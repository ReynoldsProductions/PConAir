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
| 2 — Slides (V2-C UI, notes, thumbnails, A/B, offline) | pending | |
| 3 — Tunnel + QR + PIN | pending | |
| 4 — Lower thirds UI + FaireL3s themes | pending | |
| 5 — Still store + slideshow | pending | |
| 6 — /render/:type + bg/key modes | pending | |
| 7 — Packages system | pending | |
| 8 — Bundled packages (COURTVISION, News, FFG) | pending | |
| 9 — Companion module | pending | |
| 10 — Stagetimer + URL mode + Timer page | pending | |
| 11 — Polish/hardening | pending | |

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
