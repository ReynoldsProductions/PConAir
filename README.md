# PC On Air

> **Status: Pre-Alpha — under active development, not yet suitable for production use**

PC On Air is an Electron-based browser playout application for live events. It unifies Google Slides, lower thirds graphics, and arbitrary live URLs into a single operator-friendly interface with HDMI output, a web-based control panel, and Bitfocus Companion integration.

It is the successor to [Google Slides Controller](https://github.com/TomsFaire/google-slides-controller), generalising that tool into a full live graphics system.

---

## What it does

**Three content modes**, all controllable from a web UI or Bitfocus Companion:

| Mode | Description |
|------|-------------|
| **Slides** | Load and navigate Google Slides decks. Full next/prev/goto/reload controls with A/B failover for seamless deck switching. |
| **URL** | Display any live URL fullscreen — Slido, custom dashboards, web apps. A/B dual-instance model with independent reload so you can refresh the off-air instance without interrupting program. |
| **Lower Thirds** | CSS-templated lower thirds with cue library, playlist management, stacking toggle, and arm/take/clear workflow. |

**Key features:**
- A/B primary/backup switching for Slides and URL modes
- Luma key / solid background colour configuration
- URL preset library (save and recall frequently used URLs)
- PIN-based operator/admin split — operators get show-time controls only; admin access is for configuration
- Rate limiting and session lockout to protect against brute-force attacks
- WebSocket state sync — all connected clients (operator panels, Companion) stay in sync in real time
- Bitfocus Companion integration via WebSocket actions
- Multi-display routing for URL mode

---

## Tech stack

- **Electron 32** — main process manages BrowserWindows for program output
- **TypeScript** — strict mode throughout
- **Express 4** — HTTP API server embedded in the main process
- **`ws`** — WebSocket server for real-time state push and Companion integration
- **Vitest + supertest** — test suite (99 tests, 10 test files)
- macOS-first; Windows support is not a current goal

---

## Project structure

```
src/
  main/           # Electron main process
    routes/       # Express route handlers
    services/     # Business logic (slide-ops, url-ops)
    l3/           # Lower thirds: cue store, playlist store, window manager
    url/          # URL mode: A/B BrowserWindow manager
  renderer/
    operator/     # Operator web UI (HTML + TypeScript)
  shared/
    types.ts      # Shared TypeScript types (AppState, API contracts)
tests/            # Vitest integration tests
specs/            # Product and API specifications (source of truth)
```

The `specs/` directory contains the authoritative design documents — read these before making changes. `specs/02-api-state-contract.md` is the canonical HTTP API and state reference.

---

## Current development status

**Pre-alpha.** The server-side API layer is largely complete; the Electron wiring and renderer are still being built out.

### Done
- Full HTTP API: slides, URL, L3, presets, background, displays, auth, health
- WebSocket server: full state push, action dispatch, Companion detection
- A/B URL mode with persistent browser sessions
- L3 cue + playlist CRUD with take/clear/stacking
- Operator web UI: slides and URL controls, mode/AB switching
- PIN auth with session cookies, rate limiting, lockout
- Runtime persistence (presets and L3 cues survive restarts)
- 99 passing tests

### In progress / not started
- **Operator L3 panel** — the API is ready; the UI controls are not yet wired up
- **Admin UI** (`/admin`) — preset management, L3 cue editor, system settings
- **Media Library** — file upload and management for still images
- **Profile export/import** — bundle presets, cues, and settings as a portable zip
- **Bitfocus Companion module** — separate npm package wrapping the WebSocket actions
- **L3 CSS template renderer** — theme field is stored; rendering is not yet implemented

See [`specs/11-implementation-status.md`](specs/11-implementation-status.md) for a detailed breakdown of what is complete and what each remaining area requires.

---

## Running locally

```bash
npm install
npm run dev        # starts Electron in development mode
npm test           # run the test suite
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
GET  /api/status              Full application state
GET  /api/health              Health check + uptime
POST /api/mode                Switch content mode
POST /api/slides/load         Load a Google Slides deck
POST /api/slides/next|prev    Navigate slides
POST /api/url                 Load a URL
POST /api/l3/take             Take a lower third to program
POST /api/l3/clear            Clear active lower third
GET  /api/presets             List URL presets
POST /api/background          Set luma key / background colour
```

Full contract: [`specs/02-api-state-contract.md`](specs/02-api-state-contract.md)

---

## Licence

Private — all rights reserved.
