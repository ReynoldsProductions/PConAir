# Prompter

PConAir serves its own prompter. The reader's display lives at **`/prompter`** on
this machine's server; Admin → Prompter drives it, and so does Companion.

> The feature used to be called "teleprompter". That name is a trademark, so
> every id, route, and label is now `prompter`. Saved Companion buttons are
> migrated automatically by the module's upgrade script.

## The reader's display

Open `http://<this-machine>:<port>/prompter/` on whatever the talent reads from:

- a **tablet or laptop** on the same network — no PIN, same as the render pages
- a **wired monitor or glass rig** — Admin → Prompter → *Open output* pushes a
  fullscreen window onto any monitor attached to this machine
- an **OBS/vMix browser source**, if the prompter needs to be in the mix

Every viewer derives its scroll position from the same anchor in app state, so a
second display, a reload, or a tablet that dropped off Wi-Fi lands on the same
line as everything else — the page also re-reads the server clock on connect, so
a device with a wrong clock still stays in sync.

### Per-display query parameters

One rig may need mirroring while the confidence monitor beside it does not, so
these override state on that display only:

| Parameter | Effect |
|---|---|
| `?mirror=x` / `y` / `xy` / `none` | Flip for beam-splitter glass or a ceiling mount |
| `?font=90` | Script size in px (24–200) |
| `?line=30` | Reading-rule height, as a percent of the screen; `0` hides it |
| `?width=1200` | Maximum line width in px |
| `?theme=white` / `amber` / `green` | Text colour |

## Script formatting

Blank lines separate paragraphs. A block that starts with `[` or `(` is shown
dimmed and italic — stage directions the reader should see but not read aloud.

Loading a script always parks it at the top and stops the scroll, so fresh copy
never drops the reader into the middle of the previous script.

## Control

Admin → Prompter has the script box, transport (start/pause, rewind, jump ±200
px), speed and font steps, line height, and the mirror toggles.

HTTP (operator session; `/api/prompter/…`):

| Endpoint | Body |
|---|---|
| `POST /start`, `/stop`, `/toggle`, `/rewind` | — |
| `POST /position` | `{ position }` or `{ delta }` in px |
| `POST /scroll` | `{ direction: "faster" \| "slower" }` (±10 px/sec) |
| `POST /speed` | `{ speed }` 0–200 px/sec |
| `POST /font-size` | `{ direction: "in" \| "out" }` or `{ fontSize }` 24–200 |
| `POST /line-height` | `{ lineHeight }` 1–3 |
| `POST /mirror` | `{ x?, y? }` |
| `POST /script` | `{ text }` |
| `POST /window` | `{ open, displayId? }` — desktop app only |
| `GET /status` | State, live position, output-window and external-service status |
| `GET /view` | Public snapshot the display hydrates from, plus the server clock |
| `POST /config` | `{ host, enabled }` — admin only, see below |

Companion actions: `prompter_start`, `_stop`, `_toggle`, `_rewind`, `_jump`,
`_scroll_faster`, `_scroll_slower`, `_font_size_in`, `_font_size_out`,
`_set_speed`, `_set_font_size`, `_load_script`, `_mirror`.

## Third-party prompter services

Admin → Prompter can also point at a separate prompter box that exposes
`POST /api/state`. When it is enabled, transport and script commands are
mirrored to it on top of the built-in display, best-effort: a service that is
unreachable is reported in the response (`forwarded: "failed"`) but never blocks
the local prompter.

## Known limits

- The script lives in runtime state, so it does not survive an app restart —
  keep the source document, or re-paste after a restart.
- The display is read-only: there are no controls on the talent's screen.
