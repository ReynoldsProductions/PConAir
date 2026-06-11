# PConAir v2 — Product & Architecture Plan

> **For Fable 5.** This is the authoritative brief. Read it fully before touching code. When in doubt, follow the references listed at the bottom — they answer most questions before you need to ask them.

---

## What PConAir Is

**One broadcast graphics appliance** that absorbs Google Slides Controller, FaireL3s, and FaireFulfillmentGames into a single Electron app. It replaces all three in production.

The mental model: **PConAir is a server that runs in the background on a Mac mini.** The Electron shell is a tray/menubar app — it exists only to launch the server and expose a minimal settings window for security-critical config (network, auth, display assignment). Everything else — every operator workflow, every graphics function — lives in the **web GUI** and **HTTP API**. Operators control PConAir from a browser on any machine on the network, or remotely via a Cloudflare tunnel.

### Two output paths (same features, different transport)

| Path | How it works | Use case |
|---|---|---|
| **Hardware path** | Fullscreen Electron `BrowserWindow` on a connected display → HDMI/DeckLink into a hardware video switcher | ATEM, Carbonite, Ross, Ross Carbonite |
| **Software path** | Transparent HTML pages served at `/render/…` — loaded as OBS Browser Sources or vMix/Tricaster web inputs | OBS, vMix, Tricaster |

Both paths are driven by the same WebSocket state. The only difference is transport. **Keep these feature-identical at all times.**

### Design principles
- **Appliance model** — runs unattended. Never require a keyboard or mouse at the machine during a show.
- **Web GUI is the product** — the Electron window is infrastructure.
- **API parity** — anything the web GUI can do, the HTTP API can do. No GUI-only features.
- **Companion parity** — anything the web GUI can do, Companion can do. No GUI-only features. See the Companion section for the full rule.
- **GSC is the reference for slides** — Google Slides Controller's web UI, Companion module, and feature behavior are the gold standard. Port faithfully; don't improve on what works without a specific reason.

---

## Starting Point

### Repo: existing PConAir
Work in the existing `TomsFaire/PConAir` repo. This is a major revision — keep what's good, rebuild what isn't.

**Keep (solid architecture, don't rewrite):**
- TypeScript strict mode, Express + `ws` WebSocket server architecture
- Route structure (`src/main/routes/`) — the API surface is well-designed
- Profiles / bundles / backup system (`specs/05`)
- Security model — IP allowlist, cookie-based auth, show-lock, admin health dashboard
- State pub/sub store pattern (`src/main/state.ts`) — structuredClone isolation is correct
- Companion module scaffolding — extend it, don't replace it
- Vitest test infrastructure

**Rebuild / significantly revise:**
- Web GUI — operator UI needs to match GSC V2-C quality and UX. The current operator SPA is a skeleton. Reference: `Google-Slides-Controller/docs/plans/web-remote-v2c/`
- Slides mode web UI — take GSC's remote UI as the reference, not the current PConAir slides implementation
- Add everything in the "port from GSC" list below

**Port from Google Slides Controller (these features are missing from PConAir):**
- Cloudflared tunnel — custom domain, PIN protection, tunnel on/off toggle
- QR code delivery — QR accessible from web GUI, not buried in settings
- Stagetimer.io integration — overlay on notes/display
- Speaker notes display in web remote
- Slide thumbnail / preview gallery
- Offline mode (Chromium DevTools Protocol network cache) — see `Google-Slides-Controller/docs/OFFLINE-MODE-RESEARCH.md`
- Rename "Slido" → "Web URL" everywhere in UI and API

**Reference: `Google-Slides-Controller/main.js`** is the source for all of the above. It's 13,000+ lines but well-organized. Read the relevant sections before implementing each feature.

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  Electron main process                              │
│                                                     │
│  ┌──────────────────────────────────────────────┐  │
│  │  Express HTTP server (user-configurable port)│  │
│  │  ├── /api/…          (REST API)              │  │
│  │  ├── /render/…       (transparent OBS pages) │  │
│  │  ├── /remote/…       (operator web GUI)      │  │
│  │  ├── /packages/…     (package render + ctrl) │  │
│  │  └── ws://…          (WebSocket state push)  │  │
│  └──────────────────────────────────────────────┘  │
│                                                     │
│  BrowserWindow manager                              │
│  ├── slides window (fullscreen, selected display)  │
│  ├── L3 window (transparent or keyed)              │
│  ├── still store window                            │
│  ├── package render windows                        │
│  └── URL/web window                                │
│                                                     │
│  Electron tray / settings window (setup only)      │
└─────────────────────────────────────────────────────┘
```

### State model
Every content type's runtime state lives in the central state store. The WebSocket broadcasts state to all connected clients (operator web GUI + Companion module + package render pages) on every change. Render pages subscribe to their slice of state over WebSocket and update themselves — no polling.

State must be designed **Companion-first**: every field an operator would care about must be a named top-level field or sub-field, not buried in internal objects. If a Companion user might want to display it on a button or trigger on it, it needs to be in state.

### Port
User-configurable in settings. Default: `8080`. The port must be settable before the server starts (i.e., in the Electron settings window before launch, or via a config file). **Never hardcode port 9595** — that's GSC's port, and both apps may run on the same machine during the transition period.

---

## Web GUI — Pages & Navigation

The web GUI is a single-page app served at `/remote`. Navigation bar along the bottom (mobile-first, tablet-optimized). Each page is independently usable — two operators can work different pages simultaneously without conflict.

### Navigation pages

| Page | Path | Purpose |
|---|---|---|
| **Slides** | `/remote/slides` | Google Slides control — primary show page |
| **Lower Thirds** | `/remote/l3` | L3 cue gallery, take/clear, playlists |
| **Still Store** | `/remote/stills` | Image gallery, take to output, slideshow |
| **Packages** | `/remote/packages` | Loaded graphics packages — launch control UI |
| **URLs** | `/remote/urls` | Named URL presets, open/close |
| **Timer** | `/remote/timer` | Embedded Stagetimer.io (v1); local timer (v2) |
| **Settings** | `/remote/settings` | Network, tunnel, QR, displays, profiles, security |

**Every page that controls a content type must include:**
- An **output selector** — which display or OBS render URL this content type targets
- A **background/key mode selector** — transparent, black (luma), white (luma), custom chroma color
- A **status indicator** — is this content type currently live on any output

Used outputs are tracked server-side. If an operator selects an output already in use by another content type, show a warning (don't block — operators may be intentionally overriding).

### Slides page
Mirror GSC's V2-C web remote as closely as possible:
- Prev / Next / Go-to-slide controls
- Speaker notes display (scrollable, large text)
- Slide thumbnail strip (click to jump)
- Haptic feedback toggle
- Keyboard shortcut preset selector
- QR code button (generates share link, displays QR inline)
- Offline mode indicator
- A/B failover deck loader (load primary + backup deck URLs)

**Reference:** `Google-Slides-Controller/docs/plans/web-remote-v2c/plan.md` is the design target.

### Lower Thirds page
- Cue gallery — thumbnail + name + title for each L3 cue
- Take / Clear buttons (large, accessible)
- Stacking toggle (layer multiple L3s)
- Playlist mode — select a playlist, step through with Next/Prev
- Template picker — choose from bundled CSS templates
- CSV import button
- Edit / add cue inline

### Still Store page
- Image gallery — thumbnail grid of uploaded stills
- Upload button
- Take selected image to output
- Clear output
- **Slideshow mode:**
  - Select images for slideshow (ordered list, drag to reorder)
  - Set interval (seconds per image)
  - Transition type: Hard Cut, Fade (v1); more transitions later
  - Play / Pause / Stop / Next / Prev controls
  - Current image indicator

### Packages page
- List of loaded packages (name, description, thumbnail/preview)
- Each package entry shows:
  - Live/offline status (is the render window active)
  - "Open Control UI" button — opens that package's `/packages/:id/control` in the same tab or a new tab
  - Output selector
  - Background/key mode selector
  - OBS URL (copy to clipboard)

### URLs page
- Named URL presets (add, edit, delete)
- Open URL in A or B instance
- Current A/B status
- Matches current PConAir URL mode — keep it

### Timer page
- v1: Embed `https://stagetimer.io` in an iframe. Done.
- v2 (future): Host the timer locally so there's no dependency on stagetimer.io. Don't build v2 now — call it out as a roadmap item.

### Settings page (web GUI)
- Network: hostname, port display (read-only — must restart to change port)
- Tunnel: enable/disable, custom domain, PIN, QR code display
- Displays: primary display selector, secondary display selector
- Profiles: create, load, export, import
- Security: IP allowlist, admin PIN change
- System: version, restart server

---

## Content Type Details

### Slides

**API (backwards compatible with GSC on same endpoint names):**
```
POST /api/slides/next
POST /api/slides/prev
POST /api/slides/goto        { slide: number }
POST /api/slides/load        { url: string, backupUrl?: string }
POST /api/slides/reload
GET  /api/slides/status      → { slide, total, notes, thumbnails[], deckTitle, contentKind }
GET  /api/slides/thumbnails  → base64 array
POST /api/slides/share-link  → { url, qr }
POST /api/slides/show-qr     → shows QR overlay on presentation display
```

**State fields (all exposed as Companion variables):**
- `slides.currentSlide` — current slide number (1-indexed)
- `slides.totalSlides`
- `slides.deckTitle`
- `slides.notes` — current speaker notes text
- `slides.thumbnails[]` — base64 slide images
- `slides.deckLoaded` — boolean
- `slides.backupLoaded` — boolean
- `slides.offlineMode` — boolean
- `slides.contentKind` — `'slides'|'url'|'none'`

**Companion actions (full GSC parity + new):**
- `next_slide`, `prev_slide`, `go_to_slide`, `go_to_first`, `go_to_last`
- `load_deck` — with primary + backup URL fields
- `reload_deck`
- `show_share_qr`
- `toggle_offline_mode`

**Companion feedbacks:**
- Is slide at N (configurable, button color)
- Is deck loaded
- Is backup loaded
- Is offline mode active
- Current slide number display
- Total slides display
- Deck title display

---

### Lower Thirds

**State fields:**
- `l3.onAir` — boolean, is an L3 currently displayed
- `l3.activeCueId` — id of live cue (null if none)
- `l3.activeCueName` — display name
- `l3.activePlaylistId`
- `l3.activePlaylistPosition` — current index in playlist
- `l3.playlistLength`
- `l3.stackingEnabled` — boolean
- `l3.cues[]` — full cue list (name, title, id)

**Companion actions:**
- `l3_take` — take a specific cue by ID or name
- `l3_clear`
- `l3_next` — advance playlist
- `l3_prev` — back in playlist
- `l3_activate_playlist`
- `l3_toggle_stacking`

**Companion feedbacks:**
- Is L3 on air (button lights green)
- Is specific cue live (by name or ID)
- Current cue name display
- Playlist position display
- Stacking enabled

---

### Still Store

**State fields:**
- `stills.onAir` — boolean
- `stills.activeImageId`
- `stills.activeImageName`
- `stills.slideshowRunning` — boolean
- `stills.slideshowPosition` — current index
- `stills.slideshowLength`
- `stills.slideshowInterval` — seconds
- `stills.slideshowTransition` — `'cut'|'fade'`

**Companion actions:**
- `stills_take` — take specific image by ID or name
- `stills_clear`
- `stills_slideshow_play`
- `stills_slideshow_pause`
- `stills_slideshow_stop`
- `stills_slideshow_next`
- `stills_slideshow_prev`

**Companion feedbacks:**
- Is still on air
- Is specific image live
- Is slideshow running
- Slideshow position display

---

## Graphics Packages System

Packages are self-contained graphics bundles. PConAir ships with bundled packages and can load user-supplied packages from a `packages/` directory in the app data folder.

### Package format

```
packages/
└── hoops/
    ├── package.json      ← manifest
    ├── render.html       ← 1920×1080 transparent, connects to PConAir WebSocket
    ├── control.html      ← operator control UI (served at /packages/hoops/control)
    └── assets/           ← fonts, images, sounds (optional)
```

**`package.json` schema:**
```json
{
  "id": "hoops",
  "name": "COURTVISION Basketball",
  "version": "1.0.0",
  "description": "NBA-style basketball scorebug with shot clock and player cards",
  "renders": [
    { "id": "scorebug", "label": "Scorebug", "file": "render.html" }
  ],
  "stateSchema": {
    "scoreA": "number",
    "scoreB": "number",
    "teamA": "string",
    "teamB": "string",
    "clock": "string",
    "shotClock": "number",
    "quarter": "number",
    "possession": "string",
    "bonusA": "boolean",
    "bonusB": "boolean",
    "timeoutsA": "number",
    "timeoutsB": "number",
    "playerCard": { "visible": "boolean", "name": "string", "number": "string", "pts": "number", "reb": "number", "ast": "number" }
  },
  "companionActions": [...],
  "companionFeedbacks": [...],
  "companionVariables": [...]
}
```

A package can declare **multiple render pages** (e.g. FFG has 5 overlays). Each render page gets its own `/packages/:id/render/:renderId` URL.

### WebSocket state protocol

Render pages connect to PConAir's WebSocket and subscribe to their package's state namespace:

```js
// In render.html
const ws = new WebSocket(`ws://${location.host}`);
ws.onopen = () => ws.send(JSON.stringify({ type: 'subscribe', namespace: 'package:hoops' }));
ws.onmessage = (e) => {
  const { type, state } = JSON.parse(e.data);
  if (type === 'state') applyState(state);
};
```

PConAir's server routes state updates to the correct namespace. Render pages are stateless — they always hydrate from server state on connect, so an OBS browser source reload is harmless.

**Note:** The current prototype graphics at `obs-mcp/prototype/` use URL query params for state (not WebSocket). When porting them to PConAir, replace the query-param state initialization with WebSocket subscription. The CSS and layout code is production-quality and should be kept as-is.

### Bundled packages (v1)

**1. COURTVISION — Basketball Scorebug**
Port from `obs-mcp/prototype/hoops/basketball.html`.
- Scorebug (bottom center): team names, scores, game clock, quarter, shot clock, possession arrow, timeouts, bonus
- Network bug (top left)
- Player stat card (animated slide-in)
- Ticker (bottom)
- Control UI: team name inputs, score +/−, game clock (start/stop/set), shot clock (start/stop/reset), quarter selector, possession toggle, bonus toggle, timeout tracker, player card fields

**Companion actions:** `set_score_home`, `set_score_away`, `bump_score_home`, `bump_score_away`, `set_clock`, `start_clock`, `stop_clock`, `reset_shot_clock`, `set_quarter`, `set_possession`, `toggle_bonus_home`, `toggle_bonus_away`, `set_timeout_home`, `set_timeout_away`, `show_player_card`, `hide_player_card`, `set_team_name_home`, `set_team_name_away`

**Companion feedbacks:** Score display (home/away), clock display, quarter display, possession indicator, bonus active (home/away), is player card visible, shot clock display

**2. Faire Nightly News — Broadcast Overlay**
Port from `obs-mcp/prototype/faire-nightly-news/overlay.html`.
- Logo bug (top left)
- LIVE indicator + clock (top right)
- Lower third (animated slide-in, uses FaireL3s default style)
- Ticker (bottom)
- Control UI: show/hide logo bug, set clock, L3 name + title fields, take/clear L3, ticker message input, add/clear ticker

**Companion actions:** `news_l3_take`, `news_l3_clear`, `news_set_ticker`, `news_clear_ticker`, `news_toggle_bug`, `news_show_live`, `news_hide_live`

**3. FFG — Faire Fulfillment Games**
Port from `FaireFulfillmentGames/obs/`. This is a complex multi-overlay package.

**Render pages (5 overlays, matching FFG exactly):**
1. `single-pip` — Wide cam + PiP + score chip (`?team=0–3` → `state.activeTeam`)
2. `four-portrait` — Four-team intro layout
3. `four-up` — Live 2×2 grid with order counters
4. `head-to-head` — Two-team matchup (`?slot=a|b` → `state.h2hSlot`)
5. `champion` — Winner reveal (`?winner=0–3` → `state.winner`)

**State schema:**
```json
{
  "teams": [
    { "name": "Team 1", "city": "", "code": "T1", "handle": "" },
    ...
  ],
  "scores": [0, 0, 0, 0],
  "h2h": { "slotA": [0, 1], "slotB": [2, 3] },
  "winner": null,
  "finalScore": null,
  "maxScore": 10,
  "timer": { "running": false, "remaining": null }
}
```

Replace FFG's `localStorage` + SSE relay with PConAir WebSocket state. The render HTML and CSS is production-quality cardboard/kraft-paper aesthetic — keep it. Replace only the state binding mechanism.

**Control UI:** Port `control.html` — score +/− buttons per team (showing team names), reset all, matchup config, champion reveal selector.

**Admin UI:** Port `admin.html` — team names, cities, codes, handles, H2H matchup slots.

**Companion actions:** `ffg_bump_score` (team + delta), `ffg_set_score` (team + value), `ffg_reset_scores`, `ffg_set_team_name`, `ffg_set_matchup` (slot A or B, team indices), `ffg_set_winner`, `ffg_clear_winner`, `ffg_set_max_score`, `ffg_start_timer`, `ffg_stop_timer`, `ffg_reset_timer`

**Companion feedbacks:** Score display per team (4 variables), current leader, is game tied, winner set, timer running, timer display, all four team name displays

---

## Connections

### LAN
`http://[hostname]:[port]` — always works on LAN. Hostname configurable in settings.

### Cloudflare Tunnel
Port from GSC (`Google-Slides-Controller/main.js`, search for `cloudflared`):
- Enable/disable toggle in settings
- Custom domain input (user provides their own Cloudflare domain)
- PIN protection — 4-digit PIN gates access to the web GUI over the tunnel
- Tunnel status (active / inactive / error) visible in settings page and web GUI header
- **QR code must be accessible from the web GUI directly** — one tap/click from the slides page or a persistent QR button in the nav bar. Not just buried in settings.

### API access
All mutating API endpoints gated by IP allowlist. Configurable in settings. GETs (status, thumbnails, state) are unauthenticated on LAN; tunnel access always requires PIN.

---

## Output Modes

Every content type (slides, L3, still store, packages, URL) supports these output modes. The operator selects mode per content type from its control page.

| Mode | Description | Use case |
|---|---|---|
| **Transparent** | No background | OBS browser source, software compositing |
| **Black** | Solid black background | Luma key into hardware switcher (KEY signal) |
| **White** | Solid white background | Luma key — white fill variant |
| **Chroma color** | User-selected solid color (default `#00b140`) | Chroma key into hardware switcher |
| **Opaque** | Normal rendering | Fullscreen HDMI output |

For hardware key/fill workflows, the operator loads the same render URL twice in OBS — once with `?bg=transparent` (fill) and once with `?bg=black` (key). Or loads it once to HDMI output.

Background mode is a URL parameter and also settable via API/WebSocket so Companion can switch it without a page reload.

### Display routing
Each content type's control page has an **output selector**:
- All connected displays (enumerated by Electron, shown by name/resolution)
- OBS URL (copy to clipboard — the `/render/…` URL for that content type)
- *(Future)* DeckLink 1, DeckLink 2
- *(Future)* NDI

The server tracks which display/output each content type is using. Warn (don't block) if an output is already claimed.

---

## Companion Module

### Fundamental rule
**Companion is a first-class control surface.** Every feature available in the web GUI must have a corresponding Companion action. Every piece of state the web GUI displays must have a corresponding Companion variable or feedback. This is not optional — it's a product requirement.

When adding a feature to the web GUI, add its Companion interface at the same time, not as an afterthought.

### Backwards compatibility
The existing GSC Companion module (`Google-Slides-Controller/companion-module-gslide-opener/`) has actions, variables, and feedbacks that are in production use. **Preserve all existing action IDs, variable names, and feedback IDs exactly.** Users who have existing Companion buttons must not need to rebuild their pages after upgrading.

New additions go alongside the old names. Nothing gets removed.

### Feedbacks — be generous
Feedbacks are the mechanism Companion users rely on for visual feedback (button colors, button text updates). When in doubt, add the feedback. Better to have an unused feedback option than to leave an operator with a dark button deck.

**Feedback design principles:**
- Every boolean state field → boolean feedback (button color change)
- Every string/number state field → text variable (button label display)
- Every active/live state → a visible feedback with a meaningful color (green = live, red = error/panic)
- Multi-state fields (e.g. `possession: 'home'|'away'|null`) → separate feedbacks per value, plus a variable

### Package Companion interfaces
Each bundled package declares its Companion actions, feedbacks, and variables in its `package.json`. PConAir's Companion module loads all installed packages and registers their interfaces dynamically. When a package is installed, its Companion interface becomes available immediately without restarting Companion.

### Connection
WebSocket with HTTP polling fallback — same pattern as current PConAir. Connection state exposed as a variable and feedback.

---

## Phase Plan

Execute in order. Each phase has a clear done condition.

| Phase | Work | Done when |
|---|---|---|
| **1** | Repo setup. Establish Electron shell (tray app, minimal settings window), Express server skeleton, WebSocket state pub/sub, TypeScript build. Port profiles/backup system from current PConAir. Port security model (IP allowlist, auth, show-lock). | Server starts, serves `/remote`, `/api/status` responds, profiles CRUD works, settings window configures port/security |
| **2** | Slides mode. GSC-parity web UI (V2-C design), speaker notes, thumbnail gallery, A/B failover, offline mode. API backwards compatible with GSC endpoint names. | Slides remote works end-to-end; existing GSC Companion buttons work against PConAir |
| **3** | Tunnel + QR. Port Cloudflare tunnel from GSC. QR accessible from web GUI nav. PIN protection over tunnel. | Tunnel activates, QR generates, PIN gates tunnel access |
| **4** | Lower thirds. Port current PConAir L3 system, rebuild web UI to match design quality of slides page. Port FaireL3s CSS themes as bundled L3 templates. | L3 take/clear/playlist works from web GUI and API |
| **5** | Still store. Port current PConAir media library. Add slideshow mode (interval, cut/fade). | Stills take/clear works; slideshow plays through gallery with transitions |
| **6** | Software output path. Every content type gets a `/render/:type` transparent HTML page. Background/key mode selector per content type (transparent, black, white, chroma). Per-page output selector in web GUI. | Load `/render/slides` in OBS as browser source; it hydrates from server state and updates in real time |
| **7** | Packages system. Package format (manifest, render, control pages). Package loader (scans `packages/` dir). Package router (`/packages/:id/render`, `/packages/:id/control`). WebSocket namespace routing. | Drop a package folder in, it appears in `/remote/packages`, render URL works in OBS |
| **8** | Bundled packages. Port COURTVISION (hoops), Faire Nightly News, FFG. Replace query-param state with WebSocket. Keep CSS/layout as-is. | All three packages render correctly in OBS; control UI drives state; render pages hydrate on reconnect |
| **9** | Companion module. Full GSC backwards compat. All new PConAir content types (L3, stills, packages). Deep feedbacks per content type. Package-defined interfaces loaded dynamically. | Existing GSC buttons work; L3/stills/packages controllable from Companion; feedbacks light up correctly |
| **10** | Stagetimer integration (port from GSC). URL/web page mode (port current PConAir URL mode). Timer page (embed stagetimer.io iframe). | Timer page works; stagetimer overlay on slides notes display |
| **11** | Polish and hardening. Audit web GUI on mobile/tablet (primary use case). Latency benchmarks. Auto-start on boot (launchd). Panic button. End-to-end test with OBS + hardware switcher. | Cold boot survives; panic clears all outputs; OBS browser sources reconnect automatically after server restart |

**Future (call out in the doc, don't build now):**
- DeckLink video device output
- NDI output
- Local timer (replace stagetimer.io dependency)
- Key/fill dual-output mode (two displays: fill on one, key matte on the other)
- User-loadable custom packages

---

## Reference Map for Fable 5

Study these files before starting each phase. Don't guess at behavior — the answers are here.

| What you're building | Read first |
|---|---|
| Overall architecture, state model, API surface | `PConAir/specs/00-orchestration.md`, `specs/02-api-state-contract.md` |
| What's already implemented in PConAir | `PConAir/specs/11-implementation-status.md` |
| Slides feature, tunnel, QR, stagetimer, speaker notes | `Google-Slides-Controller/main.js` (13k lines — read by section) |
| Slides web UI design target | `Google-Slides-Controller/docs/plans/web-remote-v2c/plan.md` |
| Companion module to port | `Google-Slides-Controller/companion-module-gslide-opener/` |
| L3 templates and themes | `FaireL3s/style_*.json`, `FaireL3s/generate_lowerthirds.py` |
| FFG overlays and control | `FaireFulfillmentGames/obs/` — all HTML files, `server.js`, `overlay-kit.js` |
| Prototype graphics packages | `obs-mcp/prototype/hoops/basketball.html`, `obs-mcp/prototype/faire-nightly-news/overlay.html`, `obs-mcp/prototype/tactical-hud/hud.html` |
| Current PConAir backend (keep this) | `PConAir/src/main/routes/`, `PConAir/src/main/state.ts`, `PConAir/src/main/server.ts` |
| Current PConAir Companion module | `PConAir/packages/companion-module-pconair/` |
| Existing specs for current features | `PConAir/specs/03` through `09` |
