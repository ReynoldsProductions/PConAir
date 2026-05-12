# PC On Air — Implementation Status & Handoff

> Last updated: 2026-05-11
> Branch: `claude/zen-roentgen-63471a`
> Test suite: **165 tests passing** across 13 test files

---

## Per-Spec Status

| Spec | Title | Status | Notes |
|------|-------|--------|-------|
| 01 | Source of Truth | ✅ Reference | Product definition doc — no implementation target |
| 02 | API State Contract | ✅ Implemented | All state fields in `types.ts`; includes `media-library` mode, `displayTarget`/`sessionMode` on `abState`, `ReliabilityRuntimeState` |
| 03 | Slides Parity Inventory | ⚠️ Partial | Slides + A/B + Companion parity implemented; Gap 1 (slide_at feedback) addressed in spec 07; Gap 2 (latency benchmarking) still open |
| 04 | Still Store & Media Library | ✅ Implemented | CSS themes, CSV import, image upload, cue export (image + manual PNG render), media library CRUD |
| 05 | Profiles, Bundles, Backups | ✅ Implemented | Full profile CRUD, zip export/import, backup/restore — see §5 below |
| 06 | URL Mode & Multi-Display | ✅ Implemented | A/B dual-instance, URL presets, session modes; `set_display` routes instance to Electron display |
| 07 | Companion Module | ✅ Implemented | `packages/companion-module-pconair/` — actions, feedbacks, variables, presets; see §7 below |
| 08 | Security Hardening | ✅ Implemented | IP allowlist, security headers, show-lock arm/take, admin health dashboard |
| 09 | Reliability & Runbook | ✅ Implemented | Panic toggle, reload-instance, instance-status, show-lock, health dashboard |
| 10 | Cross-Spec Review Findings | ✅ All critical resolved | 6/6 critical, 2/9 important resolved; GO for implementation (see doc) |
| 11 | This document | — | — |

---

## Quick Summary

All backend API modules are complete. All four previously-identified gaps have been closed: background preset store is implemented, `set_display` routes instances to Electron displays, L3 PNG render pipeline produces 1920×1080 PNGs for manual-type cues, and the Admin SPA replaces the placeholder with a full dark-theme configuration UI. The only known open items are latency benchmarking (spec 03 Gap 2) and the Companion parity audit (spec 10).

---

## What Is Complete

### Core Infrastructure
| File | What it does |
|------|------|
| `src/shared/types.ts` | Full `AppState`, all sub-interfaces, `media-library` mode, `ReliabilityRuntimeState`, `SessionMode` |
| `src/main/state.ts` | In-memory state store with pub/sub and `structuredClone` isolation |
| `src/main/auth.ts` | Operator + admin sessions, cookie-based, rate limiting, lockout |
| `src/main/server.ts` | Express + `ws` WebSocket server, companion detection, state broadcast |
| `src/main/runtime-persistence.ts` | JSON file persistence for presets and L3 cues (load on boot, save on change) |
| `src/main/displays.ts` | Electron display enumeration helper |
| `src/main/action-dispatch.ts` | WebSocket action dispatcher (all modes; `set_display` is a 501 stub) |
| `src/main/cli-options.ts` | CLI flag parsing (`--reset-admin-pin`, etc.) |
| `src/main/reliability-store.ts` | In-memory reliability state (panic, show-lock arm/take) |

### HTTP Routes — all mounted in `src/main/routes/index.ts`
| Endpoint group | File | Status |
|----------------|------|--------|
| `POST /auth/operator`, `POST /auth/admin`, `POST /auth/unlock-admin` | `routes/auth.ts` | ✅ |
| `GET /api/status`, `GET /api/health` | `routes/api.ts` | ✅ |
| `POST /api/mode`, `POST /api/ab/switch` | `routes/api.ts` | ✅ |
| `POST /api/panic` | `routes/api.ts` | ✅ |
| `POST /api/reload-instance`, `GET /api/instance-status` | `routes/api.ts` | ✅ |
| `POST /api/show-lock` (arm/take) | `routes/api.ts` | ✅ |
| `GET /api/displays` | `routes/api.ts` | ✅ |
| `POST /api/slides/load|next|prev|goto|reload` | `routes/slides.ts` | ✅ |
| `POST /api/url`, `POST /api/url/reload` | `routes/url.ts` | ✅ |
| `GET/POST/DELETE /api/presets` | `routes/presets.ts` | ✅ |
| `POST /api/l3/take|clear|stacking` | `routes/l3.ts` | ✅ |
| `GET/POST/DELETE /api/l3/cues` | `routes/l3.ts` | ✅ |
| `GET/POST/PUT/DELETE /api/l3/playlists` | `routes/l3.ts` | ✅ |
| `POST /api/l3/playlists/:id/activate` | `routes/l3.ts` | ✅ |
| `GET/POST/DELETE /api/l3/themes` | `routes/l3.ts` | ✅ |
| `GET /api/l3/themes/sample.css` | `routes/l3.ts` | ✅ |
| `POST /api/l3/cues/import` (CSV) | `routes/l3.ts` | ✅ |
| `GET /api/l3/cues/csv-sample` | `routes/l3.ts` | ✅ |
| `POST /api/l3/cues/upload-image` | `routes/l3.ts` | ✅ |
| `GET /api/l3/cues/:id/export` | `routes/l3.ts` | ✅ |
| `GET /api/background`, `POST /api/background` | `routes/background.ts` | ✅ |
| `GET/POST/DELETE /api/background/presets` | `routes/background.ts` | ✅ |
| `POST /api/action` | `routes/action.ts` | ✅ |
| `GET/POST/PATCH/DELETE /api/profiles` | `routes/profiles.ts` | ✅ |
| `GET /api/profiles/active` | `routes/profiles.ts` | ✅ |
| `POST /api/profiles/:id/export` | `routes/profiles.ts` | ✅ |
| `POST /api/profiles/import`, `/import/confirm` | `routes/profiles.ts` | ✅ |
| `GET/POST /api/profiles/:id/backups` + restore/download/delete | `routes/profiles.ts` | ✅ |
| `GET /api/media-library`, `POST /api/media-library/take` | `routes/media-library.ts` | ✅ |
| `GET /api/media-library/:id/download`, `DELETE /api/media-library/:id` | `routes/media-library.ts` | ✅ |
| `POST /admin/admin-show-lock` | `routes/security.ts` | ✅ |
| `GET /admin/health` (dashboard HTML) | `routes/admin.ts` | ✅ |
| Security headers middleware | `routes/middleware.ts` | ✅ |

### Spec 04 — Still Store & Media Library
- **CSS theme system**: `l3/theme-store.ts` — install/delete themes, serve `sample.css`, `GET /api/l3/themes`
- **CSV bulk import**: `POST /api/l3/cues/import` — skips rows with missing required fields, defaults unknown themes to first available, returns per-row results; `GET /api/l3/cues/csv-sample` serves example CSV
- **Image upload**: `POST /api/l3/cues/upload-image` — stores PNG/JPEG/GIF/WebP/SVG, creates Still Store cue with `sourceType: "image"`
- **Cue export**: `GET /api/l3/cues/:id/export` — returns image bytes for `image`-type cues; 501 for `manual`-type (no render pipeline yet)
- **Media Library**: `media-library/item-store.ts` + `window-manager.ts` + `routes/media-library.ts` — CRUD, take/clear, download; `media-library` mode in `AppState`
- **Tests**: `l3-themes.test.ts` (themes, CSV import, image upload, export), `media-library.test.ts`

### Spec 05 — Profiles, Bundles, Backups
- `profiles/types.ts` — `ShowProfile` schema (v1), `BackupManifest`
- `profiles/bundle-zip.ts` — zip export/import with asset bundling
- `profiles/bootstrap.ts` — default profile creation on first run
- `profiles/paths.ts` — Electron `userData` path helpers
- Full CRUD at `GET/POST/PATCH/DELETE /api/profiles`
- Export/import: zip download, multipart upload with two-phase confirm
- Backup/restore: auto-backup on profile change, manual backup, restore, download, delete
- **Tests**: `profiles.test.ts`

### Spec 06 — URL Mode & Multi-Display
- A/B dual `BrowserWindow` with `session.fromPartition` per instance
- `src/main/url/window-manager.ts` — subscribe-driven, no double-load race
- `abState.instanceA/B` now includes `displayTarget` and `sessionMode` (per spec 10 fix)
- `set_display` WS action is a 501 stub (no display routing logic)

### Spec 07 — Companion Module (`packages/companion-module-pconair/`)
| File | Contents |
|------|----------|
| `src/actions.ts` | `load_url`, `load_url_preset`, `reload_url`, `set_mode`, `slides_next/prev/goto/load`, `ab_switch`, `l3_take/clear/stacking_on/off` |
| `src/feedbacks.ts` | `connection_status`, `current_mode`, `slide_at`, `l3_cue_active`, `ab_active_instance` |
| `src/variables.ts` | `connection_status`, `current_mode`, `current_slide`, `total_slides`, `deck_title`, `active_url`, `l3_active_cue_name` |
| `src/presets.ts` | Drop-in preset buttons for common actions |
| `src/client.ts` | WebSocket connection with exponential backoff; HTTP polling fallback |
| `src/upgrades.ts` | Companion upgrade definitions |

### Spec 08 — Security Hardening
- `security/ip-allowlist.ts` — configurable IP allowlist middleware
- `routes/middleware.ts` — `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Cache-Control: no-store` on all API responses
- Show-lock arm/take (`POST /admin/admin-show-lock` + `POST /api/show-lock`)
- Admin unlock via PIN: `POST /auth/unlock-admin` (in-app, no restart needed)
- Emergency unlock: restart app or `--reset-admin-pin` CLI flag
- `GET /admin/health` — admin-only health dashboard HTML

### Spec 09 — Reliability & Runbook
- `POST /api/panic` — toggle panic state; broadcasts to all WS clients
- `POST /api/reload-instance` — reloads off-air instance only; rejects if requested instance is on-air
- `GET /api/instance-status` — returns `{ instance, isLoading, isReady }` for each instance
- `POST /api/show-lock` — arm/take pattern: first call arms, second call within TTL locks
- `ReliabilityRuntimeState` in `AppState` — `panicActive`, `panicSlate`, `showLockArmed`, `showLockActive`
- `GET /admin/health` — live health dashboard with instance status, mode, panic state, show-lock

### Operator UI (`src/renderer/operator/`)
- L3 panel: cue selector dropdown, name/title manual entry, Take/Clear buttons, Stacking toggle, active cue display
- All L3 bindings wired in `index.ts`
- `api.ts` includes `l3Take`, `l3Clear`, `l3Stacking`

---

## What Is Remaining

### A. Latency Benchmarking (spec 03 Gap 2)
**Effort: Small (testing/docs)**

The spec has a conflict: spec 01 §5.10 states "<50ms from action to display" while spec 03 Gap 2 uses "<500ms" from the original Slides Controller. Neither has been measured. Needs a benchmark test and a decision on which target is authoritative.

### B. Companion Parity Audit (spec 10)
**Effort: Small (research/review)**

Spec 10 flags that the original Companion module source should be reviewed before declaring spec 07 complete. The implemented module covers all documented actions/feedbacks/variables, but a side-by-side comparison with the upstream source has not been done.

---

## Auth Model

| Role | How to auth | What it can do |
|------|------------|----------------|
| Operator | `POST /auth/operator` with `pin` → session cookie | All read + all playback controls |
| Admin | `POST /auth/admin` with `pin` → session cookie | Everything + presets CRUD, L3 cue management, background config, profiles, show lock |

Cookie name: `pconair_session`. Admin lock (`POST /api/show-lock` arm+take) blocks all admin routes at 403 until `POST /auth/unlock-admin` with admin PIN.

---

## Test Infrastructure

Tests live in `tests/`. Shared helper: `tests/_test-server.ts` — `createFullServer({ store, auth, presets, port: 0 })`.

Run tests: `npx vitest run`

| Test file | Covers |
|-----------|--------|
| `api.test.ts` | `/api/status`, `/api/health`, mode, AB switch, panic, reload-instance, show-lock, security headers |
| `auth.test.ts` | Login, logout, session expiry, rate limiting, unlock-admin |
| `background.test.ts` | GET/POST /api/background + preset CRUD |
| `l3-action.test.ts` | L3 routes + action dispatch |
| `l3-themes.test.ts` | CSS themes CRUD + sample.css, CSV import, image upload, cue export |
| `media-library.test.ts` | Media library CRUD, take/clear, mode transitions |
| `operator-routes.test.ts` | Operator HTML serving |
| `presets.test.ts` | Presets CRUD + GET /api/displays |
| `profiles.test.ts` | Profile CRUD, export, import, backups |
| `slides.test.ts` | Slides routes + AB switch |
| `state.test.ts` | State store unit tests |
| `url.test.ts` | URL load/reload routes |
| `websocket.test.ts` | WS connection, state push, action dispatch, `set_display` |

---

## Known Issues / Tech Debt

1. **`tests/l3-action.test.ts` cookie cast** — pre-existing TypeScript error (cookie header cast); tests pass, just a type annotation issue.
2. **Latency benchmarking** — spec 01 and spec 03 have contradictory targets (50ms vs 500ms); not yet measured.
3. **Companion parity audit** — spec 10 flags the original Companion module source should be reviewed; not yet done.
4. **Admin UI — `set_display` / system settings** — the Admin SPA does not expose display assignment, port config, or IP allowlist UI. Backend routes for display enumeration exist (`GET /api/displays`); port/allowlist require restart-time config rather than live API.
5. **`action-dispatch.ts` default branch** — unknown `action_id` returns `code: 'INVALID_MODE'`; semantically `UNKNOWN_ACTION` would be more accurate (pre-existing).

---

## File Tree (notable files added/changed since initial status doc)

```
src/
  main/
    cli-options.ts                ← CLI flag parsing
    reliability-store.ts          ← Panic + show-lock state
    l3/
      cue-renderer.ts             ← renderCueHtml (pure) + renderCueToPng (Electron offscreen)
      theme-store.ts              ← CSS theme CRUD + getThemeCss()
    media-library/
      image-meta.ts
      item-store.ts               ← Media Library item CRUD
      window-manager.ts           ← Electron BrowserWindow for media-library
    profiles/
      bootstrap.ts                ← Default profile on first run
      bundle-zip.ts               ← Zip export/import
      paths.ts                    ← userData path helpers
      types.ts                    ← ShowProfile schema (includes backgroundPresets)
    routes/
      admin.ts                    ← /admin HTML + health dashboard
      background.ts               ← /api/background + /api/background/presets CRUD
      media-library.ts            ← /api/media-library routes
      middleware.ts               ← Security headers
      operator.ts                 ← /operator HTML serving
      profiles.ts                 ← /api/profiles routes
      security.ts                 ← /admin/admin-show-lock
    security/
      ip-allowlist.ts
    slides/
      window-manager.ts
    url/
      window-manager.ts           ← applyDisplayTarget() wired on displayTarget changes
  renderer/
    admin/
      index.html                  ← Full dark-theme admin SPA (presets, bg, L3, profiles, show-lock)
    operator/
      index.html                  ← Operator UI with full L3 panel
tests/
  background.test.ts              ← GET/POST /api/background + preset CRUD
  l3-action.test.ts               ← L3 routes + action dispatch + PUT cues
  l3-themes.test.ts               ← CSS themes, CSV import, image upload, PNG render
  media-library.test.ts
  profiles.test.ts
  websocket.test.ts               ← WS + set_display action
packages/
  companion-module-pconair/
    src/
      actions.ts
      client.ts
      feedbacks.ts
      index.ts
      presets.ts
      upgrades.ts
      variables.ts
```
