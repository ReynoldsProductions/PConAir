# PC On Air

> **Status: Beta — all planned v1 features implemented; not yet production-tested**

PC On Air is an Electron-based browser playout application for live events. It unifies Google Slides, lower thirds graphics, and arbitrary live URLs into a single operator-friendly interface with HDMI output, a web-based control panel, and Bitfocus Companion integration.

It is the successor to [Google Slides Controller](https://github.com/TomsFaire/google-slides-controller), generalising that tool into a full live graphics system.

---

## What it does

**Three content modes**, all controllable from a web UI or Bitfocus Companion:

| Mode | Description |
|------|-------------|
| **Slides** | Load and navigate Google Slides decks. Full next/prev/goto/reload controls with A/B failover for seamless deck switching. |
| **URL** | Display any live URL fullscreen — Slido, custom dashboards, web apps. A/B dual-instance model with independent reload so you can refresh the off-air instance without interrupting program. |
| **Lower Thirds** | CSS-templated lower thirds with cue library, playlist management, stacking toggle, and arm/take/clear workflow. PNG export of manual cues via Electron offscreen render. |
| **Media Library** | Still-image playout from an in-app media library. |

**Key features:**
- A/B primary/backup switching for Slides and URL modes — flip between instances with zero interruption
- Luma key / solid background colour with preset library
- URL preset library — save and recall frequently used URLs
- Show profiles — bundle presets, cues, themes, and settings as a portable zip; export/import/backup/restore
- PIN-based operator/admin split — operators get show-time controls only; admin access is for configuration
- Show Lock arm/take pattern — operator can freeze admin changes mid-show
- Panic toggle — broadcast blank to all connected clients instantly
- Rate limiting and session lockout to protect against brute-force attacks
- WebSocket state sync — all connected clients (operator panels, Companion) stay in sync in real time
- Bitfocus Companion integration — 19 actions, 11 variables, 6 feedbacks, 20 presets
- Multi-display routing — route URL instances to specific Electron displays via `set_display`
- IP allowlist, security headers, health dashboard

---

## Tech stack

- **Electron 32** — main process manages BrowserWindows for program output
- **TypeScript** — strict mode throughout
- **Express 4** — HTTP API server embedded in the main process
- **`ws`** — WebSocket server for real-time state push and Companion integration
- **Vitest + supertest** — 167 tests across 14 test files
- macOS-first; Windows support is not a current goal

---

## Project structure

```
src/
  main/                 # Electron main process
    routes/             # Express route handlers (one file per resource group)
    l3/                 # Lower thirds: cue store, playlist store, theme store, cue renderer
    url/                # URL mode: A/B BrowserWindow manager
    media-library/      # Media Library: item store, BrowserWindow manager
    profiles/           # Show profiles: schema, bootstrap, zip export/import, path helpers
    security/           # IP allowlist middleware
    slides/             # Slides BrowserWindow manager
    action-dispatch.ts  # WebSocket action dispatcher
    auth.ts             # Session management (operator + admin, rate limiting)
    reliability-store.ts # Panic + show-lock state
  renderer/
    operator/           # Operator web UI (HTML + vanilla JS)
    admin/              # Admin SPA (HTML + vanilla JS) — presets, L3, profiles, show lock
  shared/
    types.ts            # Shared TypeScript types (AppState, API contracts)
tests/                  # Vitest integration tests (167 tests)
specs/                  # Product and API specifications (source of truth)
packages/
  companion-module-pconair/  # Bitfocus Companion module
docs/
  latency-benchmark.md  # Latency benchmark results and methodology
```

The `specs/` directory contains the authoritative design documents — read these before making changes. [`specs/02-api-state-contract.md`](specs/02-api-state-contract.md) is the canonical HTTP API and state reference. [`specs/11-implementation-status.md`](specs/11-implementation-status.md) is the detailed per-spec completion tracker.

---

## Current development status

**Beta.** All planned v1 features are implemented and covered by integration tests. Not yet production-tested in a live event environment.

### Complete

| Area | Notes |
|------|-------|
| HTTP API — all endpoints | Slides, URL, L3, presets, background, displays, auth, health, profiles, media library |
| WebSocket server | Full state push, action dispatch, Companion detection, broadcast |
| A/B URL mode | Persistent browser sessions, independent reload, display routing |
| L3 cue + playlist CRUD | Take/clear/stacking, CSV bulk import, image upload, PNG export |
| CSS theme system | Upload/delete/sample themes; applied to cue renderer |
| Media Library | File upload, take/clear, download |
| Show profiles | CRUD, zip export/import, auto-backup, restore, download |
| Background presets | Luma/solid presets stored on active profile |
| Operator web UI | Slides, URL, L3, A/B controls; panic button; show-lock indicator |
| Admin SPA | URL presets, background, L3 themes/cues, profiles, show lock |
| Bitfocus Companion module | 19 actions, 11 variables, 6 feedbacks, 20 presets; WS + HTTP polling |
| PIN auth | Session cookies, rate limiting, lockout, unlock-admin |
| Security hardening | IP allowlist, security headers, show-lock arm/take |
| Reliability | Panic toggle, reload-instance, instance-status, health dashboard |
| Latency benchmark | API+WS path: 1 ms p95; estimated end-to-end on LAN: ~65 ms (well within 500 ms target) |
| 167 integration tests | 14 test files covering every API surface |

### Deferred (post-v1)

- WAN latency testing under ngrok/tunnel (requires live hardware)
- Slide animations and transitions
- Presenter notes display
- Admin UI for display assignment, port config, and IP allowlist (backend exists; UI not wired)

---

## Running locally

```bash
npm install
npm run dev        # starts Electron in development mode
npm test           # run the test suite (npx vitest run)
```

A `.env.example` is provided. Copy it to `.env` and configure your operator and admin PINs before running.

---

## API

The embedded HTTP server runs on port `8080` by default. All endpoints require a session cookie obtained via:

```
POST /auth/operator   { "pin": "..." }   → operator session
POST /auth/admin      { "pin": "..." }   → admin session
```

Key endpoints:

```
GET  /api/status                  Full application state (AppState)
GET  /api/health                  Health check + uptime
POST /api/mode                    Switch content mode (slides|url|l3|media-library|idle)
POST /api/slides/load             Load a Google Slides deck
POST /api/slides/next|prev        Navigate slides
POST /api/slides/goto             Jump to slide by number (0-based index)
POST /api/url                     Load a URL into the active instance
POST /api/ab/switch               Switch active A/B instance
POST /api/l3/take                 Take a lower third cue to program
POST /api/l3/clear                Clear active lower third
GET  /api/l3/cues                 List lower third cues
POST /api/l3/cues/import          Bulk import cues from CSV
GET  /api/presets                 List URL presets
POST /api/background              Set live background (type+value or presetId)
GET  /api/background/presets      List background presets
GET  /api/profiles                List show profiles
POST /api/profiles/:id/activate   Switch active profile
POST /api/panic                   Toggle panic state
POST /api/show-lock               Arm/take show lock
GET  /api/displays                List available Electron displays
POST /api/action                  WebSocket-style action dispatch over HTTP
GET  /admin/health                Admin health dashboard (HTML)
```

Full contract: [`specs/02-api-state-contract.md`](specs/02-api-state-contract.md)

---

## Bitfocus Companion

The Companion module lives in `packages/companion-module-pconair/`. Install via Companion's developer module path.

Configure in Companion:
- **Host** — IP of the PC On Air machine (default: `localhost`)
- **Port** — API port (default: `8080`)
- **Operator PIN** — optional, if PIN auth is enabled
- **HTTP Polling Interval** — fallback poll rate if WebSocket is unavailable (default: 2000 ms)

The module connects via WebSocket with automatic exponential-backoff reconnection and falls back to HTTP polling if WebSocket is unavailable.

---

## Licence

Private — all rights reserved.
