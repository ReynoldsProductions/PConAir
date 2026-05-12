# companion-module-pconair

Bitfocus Companion module for **PC On Air** — a live event graphics and playout application built on Electron.

## What this module does

Connects Companion to a running PC On Air instance over WebSocket (with HTTP polling fallback). Exposes button actions, dynamic feedbacks, variables, and ready-made preset buttons for controlling:

- Slide deck navigation and loading (Google Slides / A/B instances)
- URL playout mode with A/B instance switching
- Lower thirds cue take/clear and stacking control
- Global mode switching (Slides / URL / Lower Thirds / Idle)
- Connection status display

## Installation

### Manual install (development / local testing)

1. Build the module (see [Build instructions](#build-instructions) below).
2. Copy the `packages/companion-module-pconair` directory into Companion's local dev modules path:
   ```
   <companion-user-data>/module-local-dev/companion-module-pconair/
   ```
   On macOS, `<companion-user-data>` is typically `~/Library/Application Support/companion/`.
3. Restart Companion. The **PC On Air** connection type will appear in the module list.

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
2. Create a `pkg/` directory
3. Copy `companion/`, `dist/`, and `package.json` into `pkg/`
4. Install production dependencies only inside `pkg/`
5. Produce **`pkg/pconair-companion-0.1.0.zip`** — ready to submit to the Companion marketplace

## Configuration

| Field | Default | Description |
|-------|---------|-------------|
| Host | `localhost` | IP address or hostname of the PC On Air machine |
| Port | `8080` | Port for the PC On Air WebSocket/HTTP API |
| Operator PIN | _(empty)_ | Optional PIN for operator-level authentication |
| HTTP Polling Interval (ms) | `2000` | Fallback polling interval when WebSocket is unavailable |

## Actions

| Action ID | Description |
|-----------|-------------|
| `load_url` | Load a URL into the URL playout window |
| `load_url_preset` | Load a saved URL preset by ID or name |
| `reload_url` | Reload the active on-air URL |
| `reload_url_offair` | Reload the off-air URL instance |
| `url_switch_ab` | Toggle between A and B URL instances |
| `url_switch_to` | Switch to a specific URL instance (A or B) |
| `set_mode` | Switch the active mode (Slides / URL / Lower Thirds / Idle) |
| `slides_next` | Advance to the next slide |
| `slides_prev` | Go back to the previous slide |
| `slides_goto` | Jump to a specific slide number |
| `slides_load` | Load a Google Slides deck by URL |
| `ab_switch` | Toggle the active A/B instance for the current mode |
| `l3_take` | Take a lower third cue with optional overrides |
| `l3_clear` | Clear the active lower third |
| `l3_stacking_on` | Enable lower third stacking mode |
| `l3_stacking_off` | Disable lower third stacking mode |
| `set_display` | Set the target HDMI display index |

## Feedbacks

| Feedback ID | Description |
|-------------|-------------|
| `connection_status` | Button style reflects current connection state (green = connected, red = disconnected) |
| `current_mode` | Highlights when the module is in a specified mode |
| `slide_at` | Highlights when the current slide matches a given number |
| `l3_cue_active` | Highlights when any lower third is on-air |
| `ab_active_instance` | Highlights when a specified A/B instance (A or B) is active |

## Variables

| Variable | Description |
|----------|-------------|
| `$(pconair:connection_status)` | Human-readable connection status |
| `$(pconair:current_mode)` | Current active mode |
| `$(pconair:current_slide)` | Current slide number (1-based) |
| `$(pconair:total_slides)` | Total number of slides in the loaded deck |
| `$(pconair:deck_title)` | Title of the loaded deck |
| `$(pconair:active_url)` | URL currently loaded in the playout window |
| `$(pconair:l3_active_cue_name)` | Name of the active lower third cue |

## Presets (19)

Ready-made button presets organised into categories:

- **Slides**: Next, Previous, Counter display, Load Deck slots 1–3
- **A/B**: Switch toggle, Instance A, Instance B
- **Mode**: Slides, URL, Lower Third, Idle
- **Lower Thirds**: Take slots 1–2, Clear, Stacking On, Stacking Off
- **Status**: Connection status, Current mode display

## Links

- PC On Air repository: <https://github.com/TomsFaire/PConAir>
- Bitfocus Companion: <https://bitfocus.io/companion>
