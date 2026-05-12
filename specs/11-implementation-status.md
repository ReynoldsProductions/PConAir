# PC On Air — Implementation Status & Handoff

> Last updated: 2026-05-11
> Branch: `feat/phase1-foundation`
> Test suite: **99 tests passing** across 10 test files

---

## Quick Summary

The HTTP API layer, WebSocket server, and core state machine are largely complete. The main gaps are the **operator L3 panel** (frontend only), **media library**, **profiles/export**, and **Companion module**. Admin UI is unstarted.

---

## 1. What Is Complete

### Core Infrastructure
| File | What it does |
|------|------|
| `src/shared/types.ts` | Full `AppState`, all sub-interfaces, error codes, WS message types |
| `src/main/state.ts` | In-memory state store with pub/sub and `structuredClone` isolation |
| `src/main/auth.ts` | Operator + admin sessions, cookie-based, rate limiting, lockout |
| `src/main/server.ts` | Express + `ws` WebSocket server, companion detection, state broadcast |
| `src/main/runtime-persistence.ts` | JSON file persistence for presets and L3 cues (load on boot, save on change) |
| `src/main/displays.ts` | Electron display enumeration helper |
| `src/main/action-dispatch.ts` | WebSocket action dispatcher (all modes) |

### HTTP Routes — all mounted in `src/main/routes/index.ts`
| Endpoint group | File | Status |
|---------------|------|--------|
| `POST /auth/operator`, `POST /auth/admin` | `routes/auth.ts` | ✅ |
| `GET /api/status`, `GET /api/health` | `routes/api.ts` | ✅ |
| `POST /api/mode` | `routes/api.ts` | ✅ |
| `POST /api/ab/switch` | `routes/api.ts` | ✅ |
| `GET /api/displays` | `routes/api.ts` | ✅ |
| `POST /api/slides/load|next|prev|goto|reload` | `routes/slides.ts` | ✅ |
| `POST /api/url`, `POST /api/url/reload` | `routes/url.ts` | ✅ |
| `GET/POST/DELETE /api/presets` | `routes/presets.ts` | ✅ |
| `POST /api/l3/take|clear|stacking` | `routes/l3.ts` | ✅ |
| `GET/POST/DELETE /api/l3/cues` | `routes/l3.ts` | ✅ |
| `GET/POST/PUT/DELETE /api/l3/playlists` | `routes/l3.ts` | ✅ |
| `POST /api/l3/playlists/:id/activate` | `routes/l3.ts` | ✅ |
| `GET /api/background`, `POST /api/background` | `routes/background.ts` | ✅ |
| `POST /api/action` | `routes/action.ts` | ✅ |

### Service/Business Logic
| File | What it does |
|------|------|
| `src/main/services/slide-ops.ts` | Slide state mutations (load, next, prev, goto, reload) |
| `src/main/services/url-ops.ts` | URL state mutations (load, reload, A/B) |
| `src/main/l3/cue-store.ts` | L3 cue CRUD store |
| `src/main/l3/playlist-store.ts` | L3 playlist CRUD store |
| `src/main/l3/take-ops.ts` | L3 take/clear/stacking business logic |
| `src/main/l3/window-manager.ts` | L3 BrowserWindow lifecycle |
| `src/main/presets.ts` | URL preset CRUD store with `onChange` callback |

### URL Mode (Phase 4)
- A/B dual `BrowserWindow` model with `session.fromPartition('persist:pconair-url-A/B')`
- `src/main/url/window-manager.ts` — subscribe-driven, no double-load race, mode guard before `showInstance`
- WebSocket exponential backoff fixed (`connectWs(delay = 1000)` recursive parameter)

### Operator UI (`src/renderer/operator/`)
- `index.html` — Slides panel, URL panel, A/B instance buttons, mode buttons, status dump
- `index.ts` — All bindings wired: slides controls, URL load/reload, A/B switch, mode switch
- `api.ts` — Typed fetch helpers for all above operations
- `state.ts` — Client-side state store with `applyFullState` (defensive clone) + `applyPatch`

### WebSocket Actions (all handled in `action-dispatch.ts`)
`slides_next`, `slides_prev`, `slides_goto`, `slides_reload`, `slides_load`, `ab_switch`, `url_switch_ab`, `url_switch_to`, `load_url`, `load_url_preset`, `reload_url`, `reload_url_offair`, `set_mode`, `set_display` (stub), `l3_take`, `l3_clear`, `l3_stacking_on`, `l3_stacking_off`

---

## 2. What Is Remaining

### 2a. Operator L3 Panel (frontend only — no backend work needed)
**Effort: Small (~2h)**

The L3 API is 100% complete. The operator HTML has a "Lower Thirds" mode button but no controls panel.

Add to `src/renderer/operator/index.html`:
```html
<div class="panel-title" style="margin-top:20px;">Lower Thirds</div>
<!-- Cue selector / manual name+title fields -->
<!-- Take button, Clear button, Stacking toggle -->
```

Add to `src/renderer/operator/api.ts`:
```typescript
export const l3Take = (body: { cueId?: string; name?: string; title?: string }) =>
  apiPost('/api/l3/take', body);
export const l3Clear = () => apiPost('/api/l3/clear');
export const l3Stacking = (enabled: boolean) => apiPost('/api/l3/stacking', { enabled });
```

Wire event bindings in `src/renderer/operator/index.ts`.

Update `renderState` to display active L3 cue name/title.

### 2b. Media Library (spec `04-still-store-media-library.md`)
**Effort: Medium (~1 day)**

Not started. Needs:
- `src/main/media-library/` — item store (id, name, path, type, tags)
- `GET/POST/DELETE /api/media-library/items` — CRUD
- File upload endpoint (`multipart/form-data`) — store files in Electron `userData`
- `mediaLibrary` state field already exists in `AppState` (`activeItemId`, `activeItemName`)
- Tests

### 2c. Background Preset Store
**Effort: Small (~3h)**

`POST /api/background` currently returns 404 for any `presetId`. There is no background preset concept separate from URL presets. Re-read spec §2.6 and `05-profiles-bundles-backups.md` to decide if background presets are a separate store or just stored in the profiles bundle. This may be deferred to the profiles phase.

### 2d. Profiles / Export-Import Bundles (spec `05-profiles-bundles-backups.md`)
**Effort: Large (~1–2 days)**

Not started. Needs:
- Bundle schema: JSON manifest + asset files zipped
- `POST /api/profiles/export` → returns a `.zip` download
- `POST /api/profiles/import` → multipart upload, validates, restores state
- Covers: URL presets, L3 cues + playlists, background settings, display assignments

### 2e. Bitfocus Companion Module (spec `07-companion-module.md`)
**Effort: Large (~1–2 days)**

Not started. The server-side WebSocket action dispatch is complete — the Companion module is a separate npm package that wraps it.

- Companion connects to `/ws?companion=1` (already handled: `companionConnected` state flag)
- Module needs: action definitions (already mapped in `action-dispatch.ts`), variable definitions, feedback definitions
- Separate package, not part of this repo — probably `packages/companion-module-pconair/`

### 2f. Admin UI (`/admin` route)
**Effort: Large (~1–2 days)**

Not started. Needs a separate HTML page at `/operator/admin.html` (or similar) with:
- Preset management (create/edit/delete URL presets with live preview)
- L3 cue editor (create/edit/delete cues and playlists)
- Background key color picker
- Session login for persistent URL sessions
- System settings (display assignments, port config)

---

## 3. Auth Model Reminder

| Role | How to auth | What it can do |
|------|------------|----------------|
| Operator | `POST /auth/operator` with `pin` → session cookie | All read + all playback controls |
| Admin | `POST /auth/admin` with `pin` → session cookie | Everything + presets CRUD, L3 cue management, background config |

Cookie name: `pconair_session`. Both expire per config (`operatorSessionMs`, `adminSessionMs`).

---

## 4. Test Infrastructure

Tests live in `tests/`. Shared helper: `tests/_test-server.ts` — `createFullServer({ store, auth, presets, port: 0 })`.

Run tests: `npx vitest run`

Existing test files:
- `api.test.ts` — `/api/status`, `/api/health`, mode, AB switch
- `auth.test.ts` — login, logout, session expiry, rate limiting
- `background.test.ts` — GET/POST /api/background
- `l3-action.test.ts` — L3 routes + action dispatch
- `operator-routes.test.ts` — operator HTML serving
- `presets.test.ts` — presets CRUD + GET /api/displays
- `slides.test.ts` — slides routes + AB switch
- `state.test.ts` — state store unit tests
- `url.test.ts` — URL load/reload routes
- `websocket.test.ts` — WS connection, state push, action dispatch

---

## 5. Known Issues / Tech Debt

1. **`tests/l3-action.test.ts` cookie cast** — pre-existing TypeScript error (cookie header cast); tests pass, just a type annotation issue.
2. **`set_display` action stub** — returns 501. No display routing logic yet.
3. **Media Library state** — `AppState.mediaLibrary` exists but the API and store are unimplemented.
4. **No L3 CSS template system** — `theme` field is stored on cues but there's no template download or renderer; L3 window manager exists but rendering is stub.
5. **Background preset store** — `presetId` on background always 404; deferred to profiles phase.

---

## 6. File Tree (new files added this branch)

```
src/
  main/
    action-dispatch.ts          ← WebSocket action router
    displays.ts                 ← Electron display enumeration
    runtime-persistence.ts      ← JSON persistence for presets + cues
    l3/
      cue-store.ts
      playlist-store.ts
      take-ops.ts
      window-manager.ts
    services/
      slide-ops.ts
      url-ops.ts
    routes/
      action.ts                 ← POST /api/action
      background.ts             ← GET/POST /api/background
      l3.ts                     ← All /api/l3/* routes
docs/
  plans/
    2026-05-11-phase4-url-mode.md
tests/
  _test-server.ts               ← Shared test server helper
  background.test.ts
  l3-action.test.ts
specs/
  11-implementation-status.md   ← This file
```
