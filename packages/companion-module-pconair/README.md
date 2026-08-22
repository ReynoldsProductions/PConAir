# companion-module-pconair

Bitfocus Companion module for **PC On Air** — a live event graphics and playout application built on Electron.

## What this module does

Connects Companion to a running PC On Air instance over WebSocket (with HTTP polling fallback). Exposes **100 actions, 47 feedbacks, 154 variables, and 55 preset buttons** for controlling:

- Slide deck navigation and loading (Google Slides / A/B instances) + speaker notes
- URL playout mode with A/B instance switching and URL presets
- Lower thirds cue take/clear, playlists, stacking, and the graphics overlay
- Still store takes and slideshows
- Scoreboard graphics (scores, clocks, possession, fouls, timeouts)
- Teleprompter scroll/speed/font/script control
- Global mode switching, render backgrounds, stagetimer overlay, panic slate
- Connection, health, and tunnel status display

## Installation

### From the packaged tarball (recommended for testing)

1. Build it: `npm install && npm run package` — produces `pconair-companion-<version>.tgz`
   with the production dependencies already bundled.
2. In Companion, go to **Settings → Modules → Import module bundle** and select the `.tgz`.
3. Add a **PC On Air** connection.

### Manual install (development)

1. Build the module: `npm install && npm run build`.
2. Copy (or symlink) the `packages/companion-module-pconair` directory into Companion's
   local dev modules path:
   ```
   <companion-user-data>/module-local-dev/companion-module-pconair/
   ```
   On macOS, `<companion-user-data>` is typically `~/Library/Application Support/companion/`.
3. Restart Companion. The **PC On Air** connection type will appear in the module list.

> **Before it will connect:** PC On Air gates cookie-less clients behind an IP
> allowlist. Add the Companion machine's IP under **Admin → Security → Network**
> on the PC On Air machine, or the WebSocket upgrade is refused.

### Via Companion module registry (future)

Once published, search for **PC On Air** in the Companion module browser.

## Build instructions

```bash
npm install
npm run build
```

This compiles the TypeScript sources in `src/` to `dist/` using `tsc`.

## Package for distribution

```bash
npm run package
```

This will:
1. Compile TypeScript (`npm run build`)
2. Validate `companion/manifest.json` with Companion's own validator, and check that
   the manifest version, the `package.json` version, and the built entrypoint all agree
3. Produce **`pconair-companion-<version>.tgz`** — `dist/`, `companion/`, `LICENSE`,
   `README.md` and the production dependency closure, laid out under `package/` the way
   Companion's bundle importer expects

The dependency closure is read from the installed tree via `npm ls --omit=dev`, so
packaging works offline and the tarball name always tracks `package.json`.

## Configuration

| Field | Default | Description |
|-------|---------|-------------|
| Host | `127.0.0.1` | IP address or hostname of the PC On Air machine |
| Port | `8080` | Port for the PC On Air WebSocket/HTTP API (**Settings → Network**) |
| Operator PIN | _(empty)_ | Only used by the HTTP fallback. Actions over the WebSocket do not need it. |
| HTTP Polling Interval (ms) | `1000` | Fallback polling interval when the WebSocket is unavailable |

### Connection status

The module distinguishes its two transports rather than reporting a flat
"connected":

| Companion status | `connection_status` | `transport` | Meaning |
|---|---|---|---|
| OK | `connected` | `ws` | WebSocket up; state is pushed |
| Unknown (warning) | `http_fallback` | `http` | Degraded — state is polled, and actions need the Operator PIN |
| Connection failure | `disconnected` | _(blank)_ | Unreachable, or this IP is not allowlisted |

## Variables in every input

Every text input in every action and feedback supports Companion variables
(`$(internal:custom_my_var)`, `$(pconair:slide_index)`, …). Numeric inputs are
text fields for the same reason — type a number or a variable expression.
Dropdowns accept custom values where useful (`allowCustom`), so a variable can
drive the mode, instance, transition, etc.; unknown values fall back to the
option's default. Configs saved before v0.3.0 are migrated automatically by an
upgrade script when the module loads.

## Actions (100)

Grouped by category — see `src/actions/` for the full definitions:

- **GSC compat** (`src/actions/gsc.ts`): the complete `companion-module-gslide-opener`
  ID set — open/close presentation, next/prev/goto slide, speaker notes
  open/close/scroll/zoom (scroll/zoom now run natively), tunnel QR show/hide,
  backup controls / notes layout / PerfectCue stubs
- **Slides** (`slides.ts`): native next/prev/goto/first/last, deck load with
  backup + instance targeting, reload, A/B switch, offline mode, native notes
  scroll/zoom
- **URL** (`url.ts`): load URL / preset, reload on-air / off-air, A/B switch
- **Lower thirds** (`l3.ts`): cue take/clear, playlists (activate/next/prev),
  stacking, plus the graphics overlay `lower_third_apply` / `lower_third_hide`
  with theme, animation style and fade control
- **Still store** (`stills.ts`): take/clear, slideshow play/pause/resume/stop/step
- **Graphics** (`graphics.ts`): `graphics_scoreboard_set` (every field optional —
  blank leaves it unchanged), `graphics_score_bump`, game/shot clock start/stop,
  possession
- **System** (`system.ts`): mode/display/A-B, render background modes,
  stagetimer overlay show/hide/toggle/settings, teleprompter (start/stop/toggle,
  speed and font nudge or set, script load), panic slate on/off/toggle,
  off-air instance reload, debug status log

## Feedbacks (47)

Connection, mode, A/B instance, slide position (first/last/at-number), deck and
backup state, offline mode/cache, lower third on-air / specific cue / stacking /
playlist, still store on-air / specific still / slideshow state + position,
stagetimer overlay + configured, tunnel active/error/enabled/PIN, panic, show
lock, render background modes, slides loading / content kind, teleprompter
enabled/scrolling, graphics lower-third visible, game/shot clock running,
possession, score leader, watchdog unresponsive, memory pressure, current preset.

## Variables (154)

All GSC-compat names preserved (`current_slide`, `slide_info`, …) plus the full
PConAir state: slides (index/count/title/urls/notes/offline/cache), lower thirds
(cue/playlist), still store + slideshow, stagetimer, tunnel, render outputs,
teleprompter (enabled/scrolling/speed/font), scoreboard (teams, scores, clocks,
possession, fouls, timeouts), graphics lower third (name/title/subtitle/theme),
watchdog + memory health, background, displays, A/B instance urls/readiness, and
the live connection transport.

Packages contribute their own variables on top of these, prefixed with the package
id (e.g. `$(pconair:hoops_score_home)`). With the three bundled packages loaded
that is a further 42 actions, 17 feedbacks and 25 variables, registered without a
Companion restart.

## Presets (55)

Ready-made button presets organised into categories:

- **Slides**: Next, Previous, Counter, Load Deck slots 1–3, Offline toggle, Notes scroll/zoom
- **A/B**: Switch toggle, Instance A, Instance B
- **Mode**: Slides, URL, Lower Third, Idle
- **Lower Thirds**: Take slots, Clear, Stacking, Playlist next/prev
- **Still Store**: Clear, Slideshow play/pause/stop
- **Graphics**: Score +1/+2/+3 per team, scoreboard display, game clock start/stop, possession, graphics L3 take/clear
- **Teleprompter**: Start/stop toggle, speed ±, font ±
- **System**: Panic toggle, reload off-air instance, health tile
- **Tunnel / Status**: QR, tunnel status, connection status, stagetimer overlay

## Not exposed (admin-only)

The module talks to PConAir over the cookie-less Companion WebSocket and the
operator-level action API. Functions that require an **admin session** are
deliberately not exposed as actions: tunnel start/stop/config, program
background set + background presets, show lock, app settings, teleprompter/
stagetimer configuration, media upload/delete, URL preset management, and the
director window. Use the admin UI for those; their *state* is still readable
through variables and feedbacks where available.

## Licence

MIT — see [LICENSE](./LICENSE).

## Links

- PC On Air repository: <https://github.com/ReynoldsProductions/PConAir>
- In-Companion help page: [`companion/HELP.md`](./companion/HELP.md)
- Bitfocus Companion: <https://bitfocus.io/companion>
