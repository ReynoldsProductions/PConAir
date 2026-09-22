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
| `?line=30` | Reading-marker position, as a percent of the screen; `0` hides it and reads from the top |
| `?indicator=0` | Hide the marker but keep the reading position where it is |
| `?pad=10` | Side margin, as a percent of screen width (0–30) |
| `?align=center` | Text alignment: `left`, `center`, `right`, `justify` |
| `?width=1200` | Older per-display cap on line length, in px |
| `?theme=white` / `amber` / `green` | Text colour |

## Script formatting

Blank lines separate paragraphs. A block that starts with `[` or `(` is shown
dimmed and italic — stage directions the reader should see but not read aloud.

Loading a script always parks it at the top and stops the scroll, so fresh copy
never drops the reader into the middle of the previous script.

## Control

Admin → Prompter has the script box, transport (start/pause, rewind, jump ±200
px), speed and font steps, line height, text alignment, the side margin
(±1vw steps), the
reading-marker controls (up/down in 2% steps, show/hide), and the mirror
toggles.

HTTP (operator session; `/api/prompter/…`):

| Endpoint | Body |
|---|---|
| `POST /start`, `/stop`, `/toggle`, `/rewind` | — |
| `POST /position` | `{ position }` or `{ delta }` in px, or `{ lines }` in whole lines of the current type |
| `POST /scroll` | `{ direction: "faster" \| "slower" }` (±10 px/sec) |
| `POST /speed` | `{ speed }` px/sec, unbounded; negative crawls backwards |
| `POST /font-size` | `{ direction: "in" \| "out" }` or `{ fontSize }` 24–200 |
| `POST /line-height` | `{ lineHeight }` 1–3 |
| `POST /side-padding` | `{ sidePadding }` 0–30 vw, or `{ delta }` to nudge a step |
| `POST /text-align` | `{ align }` — `left`, `center`, `right` or `justify` |
| `POST /marker` | `{ position? }` or `{ delta? }` in percent, and/or `{ visible? }` |
| `POST /mirror` | `{ x?, y? }` |
| `POST /script` | `{ text }` |
| `POST /window` | `{ open, displayId? }` — desktop app only |
| `GET /status` | State, live position, output-window and external-service status |
| `GET /view` | Public snapshot the display hydrates from, plus the server clock |
| `POST /config` | `{ host, enabled }` — admin only, see below |

Companion actions: `prompter_start`, `_stop`, `_toggle`, `_rewind`, `_jump`,
`_scroll_faster`, `_scroll_slower`, `_font_size_in`, `_font_size_out`,
`_set_speed`, `_set_font_size`, `_load_script`, `_mirror`, `_marker_up`,
`_marker_down`, `_set_marker`, `_marker_toggle`, `_margin_wider`,
`_margin_narrower`, `_set_margin`, `_set_text_align`, `_text_align_cycle`,
`_load_doc`, `_load_doc_preset`, `_refresh_doc`, `_take_doc`, `_clear_doc`
(see "Google Doc script source" below).

## Google Doc script source

A producer can keep editing the script in a Google Doc while it is on the
glass — the prompter polls it every 60s and stages a change; nothing reaches
the talent display until an operator deliberately takes it.

- **Load** (`POST /api/prompter/doc/load`, `{ url }` or `{ presetId }`) fetches
  the doc and applies it **immediately** — there's nothing on the glass yet to
  protect, so a first load skips the stage step.
- **Refresh** (`POST /api/prompter/doc/refresh`) fetches the latest text and
  stages it. It never touches the glass.
- **Take** (`POST /api/prompter/doc/take`) applies whatever is staged, parks at
  the top, and stops the scroll — same as any other script load. 409 if
  nothing is staged.
- **Clear** (`POST /api/prompter/doc/clear`) detaches the source; the text
  currently on the glass is left exactly as it is.
- The saved script library (`GET/POST/PATCH/DELETE /api/prompter/docs`) lives
  in the active show profile, the same way URL presets do — it exports and
  imports with the profile for free.

**Sharing requirements:** a doc fetches either through the same signed-in
Google session Slides mode uses, or anonymously if the doc is link-shared. If
neither applies, load/refresh return `DOC_NOT_READABLE` naming both remedies.
Signing out of Google for Slides also breaks private-doc fetching.

**Comments are excluded.** The `format=txt` export drops comments, so
producers can argue in the margins without any of it reaching the talent.
**Review in Editing mode before a show**: if a producer is in *Suggesting*
mode, verify (Phase 0 live check) whether pending suggestions export as
accepted text — until that is confirmed for your Google Workspace, treat any
doc used on a live show as reviewed/accepted before load.

In every failure — bad URL, network down, not signed in, empty doc, doc too
large — the script already on the glass is untouched. A refresh that never
gets taken is equally invisible to the talent: `GET /api/prompter/view` never
carries the staged text.

Companion actions:

| Action | Options | Behaviour |
|---|---|---|
| `prompter_load_doc` | Google Doc URL (variable-capable) | Fetch and apply immediately |
| `prompter_load_doc_preset` | Saved Script (dropdown, from the library) | Fetch and apply immediately |
| `prompter_refresh_doc` | — | Fetch and stage; never touches the glass |
| `prompter_take_doc` | — | Apply the staged text |
| `prompter_clear_doc` | — | Detach the source; leave the glass alone |

Companion variables: `prompter_doc_name` (library name, blank for an ad-hoc
URL), `prompter_doc_status` (`idle`/`fetching`/`ready`/`error`),
`prompter_doc_words` (word count of the text **currently on the glass**, not
the staged text), `prompter_doc_loaded_at` (local time of the last load/take),
`prompter_doc_staged` (Yes/No — a refreshed version is waiting for Take).

Companion feedbacks: `prompter_doc_update_ready` (amber — true only when a
refresh is staged and waiting for Take; a doc that just loaded successfully
with nothing staged does **not** light this up) and `prompter_doc_error` (red
— the last load or refresh failed).

A "Script" preset page ships with Refresh, Take (carrying the amber
`prompter_doc_update_ready` feedback), Clear, a status tile, and one named
Load button per saved library entry.

### Alignment and margins

The margin is symmetric — the same gap goes on both sides — but the script
reads `left`-aligned by default, so lines end wherever they end. On a wide rig
with a big margin that ragged right edge can read as though the text has been
pushed left. `center` is usually what is wanted there; it costs the talent a
fixed left edge to return to, so try it on the real glass before a show.

`justify` forces both edges flush by stretching the spaces between words, which
makes the gaps jump line to line. It is offered for completeness and is rarely
the right choice on a prompter.

### The reading marker

The marker is the rule the talent reads from, so moving it moves the reading
line: the script's blank leader tracks it. Hiding the marker deliberately leaves
that leader alone, so the script does not jump when an operator toggles it
mid-show — use `?line=0` on a display that really should read from the top.

## Third-party prompter services

Admin → Prompter can also point at a separate prompter box that exposes
`POST /api/state`. When it is enabled, transport and script commands are
mirrored to it on top of the built-in display, best-effort: a service that is
unreachable is reported in the response (`forwarded: "failed"`) but never blocks
the local prompter.

## Known limits

- A pasted script (Admin's script box, `prompter_load_script`) lives in
  runtime state and does not survive an app restart. A script loaded from the
  Google Doc library does survive — the source URL is saved in the show
  profile and can be reloaded after a restart; only the in-memory staged
  refresh (if any) is lost.
- The display is read-only: there are no controls on the talent's screen.
- Multi-tab Google Docs export all tabs concatenated with no separator;
  selecting a single tab is out of scope.
