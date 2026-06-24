# PConAir Package Graphics Standard

> Canonical naming conventions for layout IDs, state fields, and Companion actions.
> All graphics packages (FFG, future designs) follow this standard so the control
> layer and Companion module can drive any package without per-package knowledge.

---

## Render IDs (layout types)

Declared in `package.json → renders[].id`. Use these exact identifiers — the
Companion module and `/remote/packages` control UI key off them.

### Camera / feed layouts

| Render ID | Description |
|---|---|
| `wide` | Single full-width feed / camera |
| `wide-pip` | Wide feed + picture-in-picture (lower-right by default) |
| `pip` | Picture-in-picture only (overlaid on program) |

### Grid layouts

| Render ID | Description |
|---|---|
| `two-up` | 2 feeds side-by-side |
| `four-up` | 2×2 grid, all landscape |
| `four-portrait` | 4 portrait frames, 2 per row |

### Score / competition overlays

| Render ID | Description |
|---|---|
| `h2h` | Head-to-head: 2 teams with score chips (uses `h2h.a` slot) |
| `h2h-b` | Head-to-head: alternate pair (uses `h2h.b` slot) |
| `scoreboard` | All teams with scores, ranked or fixed order |
| `leaderboard` | Ranked order with delta indicators |

### Event-state screens

| Render ID | Description |
|---|---|
| `champion` | Winner reveal / champion graphic (reads `winner` field) |
| `podium` | Top-3 display |
| `standby` | Holding / title card (no dynamic score content) |
| `break` | Break screen, typically showing a countdown |

### Crawl / ticker

| Render ID | Description |
|---|---|
| `ticker` | Bottom-of-screen text crawl |

> **Variants:** when a layout exists in multiple visual themes (e.g. city-branded
> champion screens), append a short tag: `champion-kw`, `champion-sf`.
> The base `champion` must always exist as the default.

---

## State Schema — Reserved Field Names

These field names carry fixed semantics. A package may omit fields it doesn't use,
but **must not** repurpose a reserved name for a different meaning.

### `teams` — array of team objects

```json
"teams": [
  { "name": "Team 1", "city": "CITY", "code": "T1", "presenter": "", "color": "" }
]
```

| Field | Type | Purpose |
|---|---|---|
| `name` | `string` | Full team name (displayed on overlays) |
| `city` | `string` | City / region label (ALL CAPS typical) |
| `code` | `string` | Short code, 2–4 chars (scoreboard chips) |
| `presenter` | `string` | Presenter / captain name |
| `color` | `string` | Hex accent color (optional, for custom themes) |

Array index = team index used everywhere else in state.

### `scores` — array of numbers

```json
"scores": [0, 0, 0, 0]
```

One number per team, same index as `teams`. Companion `add` / `set` ops
reference this as `"scores.{teamIndex}"`.

### `clock` — countdown / stopwatch

```json
"clock": {
  "deadline": 0,
  "value": 300,
  "running": false,
  "format": "mm:ss"
}
```

| Field | Type | Purpose |
|---|---|---|
| `deadline` | `number` | Epoch-ms when clock reaches zero; `0` = stopped |
| `value` | `number` | Seconds snapshot (the time shown when stopped) |
| `running` | `boolean` | True while counting down |
| `format` | `"mm:ss" \| "seconds"` | Display format |

Use PConAir's built-in `countdown_start / countdown_stop / countdown_reset` Companion
ops with `deadlineField: "clock.deadline"`, `valueField: "clock.value"`,
`runningField: "clock.running"`.

Render pages compute displayed time as:
```
running ? Math.max(0, deadline - Date.now()) / 1000 : value
```

### `ticker` — text crawl

```json
"ticker": {
  "messages": ["Message one", "Message two"],
  "speed": 80,
  "visible": false
}
```

| Field | Type | Purpose |
|---|---|---|
| `messages` | `string[]` | Lines to crawl (joined with separator) |
| `speed` | `number` | Pixels per second |
| `visible` | `boolean` | Whether the crawl bar is shown |

### `h2h` — head-to-head matchup slots

```json
"h2h": {
  "a": { "left": 0, "right": 1 },
  "b": { "left": 2, "right": 3 }
}
```

Values are team indices into `teams[]`. Render `h2h` reads `h2h.a`;
render `h2h-b` reads `h2h.b`.

### `winner` — winning team

```json
"winner": null
```

`null` = no winner declared. Number = team index into `teams[]`.
The `champion` render watches this field; it shows a standby state when `null`.

### `activeRender` — selected overlay (optional)

```json
"activeRender": "four-up"
```

When a package wants a single "what's on screen now" selector driven from
the control UI, use this field. Render pages check it on state update and
show/hide themselves accordingly. Companion `set_active_render` action targets
this field.

---

## Standard Companion Action IDs

Packages declare these in `package.json → companionActions`. Using consistent
IDs means the Companion module can surface them on predictable button types.

### Scores

| Action ID | Options | Ops |
|---|---|---|
| `score_add` | `team` (number), `value` (number, default 1) | `add` on `scores.{team}` |
| `score_subtract` | `team` (number), `value` (number, default 1) | `add` on `scores.{team}` (negative) |
| `score_set` | `team` (number), `value` (number) | `set` on `scores.{team}` |
| `score_reset_all` | — | `set` each `scores.N` to 0 |

### Clock

| Action ID | Ops |
|---|---|
| `clock_start` | `countdown_start` (deadline/value/running fields) |
| `clock_stop` | `countdown_stop` |
| `clock_reset` | `countdown_reset` |

### Teams

| Action ID | Options | Ops |
|---|---|---|
| `h2h_set_left` | `slot` (a/b), `team` (number) | `set` on `h2h.{slot}.left` |
| `h2h_set_right` | `slot` (a/b), `team` (number) | `set` on `h2h.{slot}.right` |

### Event state

| Action ID | Options | Ops |
|---|---|---|
| `set_winner` | `team` (number) | `set` on `winner` |
| `clear_winner` | — | `set` on `winner` to null |
| `set_active_render` | `render` (dropdown of render IDs) | `set` on `activeRender` |

### Ticker

| Action ID | Options | Ops |
|---|---|---|
| `ticker_show` | — | `set` on `ticker.visible` to true |
| `ticker_hide` | — | `set` on `ticker.visible` to false |
| `ticker_toggle` | — | `toggle` on `ticker.visible` |
| `ticker_set` | `messages` (textinput, newline-separated, `split: "\n"`) | `set` on `ticker.messages` |

---

## Standard Companion Variable IDs

| Variable ID | Field | Notes |
|---|---|---|
| `score_{N}` (0-indexed) | `scores.{N}` | One per team |
| `team_{N}_name` | `teams.{N}.name` | |
| `team_{N}_code` | `teams.{N}.code` | |
| `clock_display` | — | `countdown` computed from `clock.*` fields |
| `winner_name` | — | `lookup` derived: `teams[winner].name` |
| `active_render` | `activeRender` | |

---

## Standard Companion Feedbacks

| Feedback ID | Field | Condition |
|---|---|---|
| `winner_set` | `winner` | `notEquals: null` |
| `clock_running` | `clock.running` | `equals: true` |
| `render_active` | `activeRender` | `equals: { option: "render" }` |

---

## `package.json` skeleton

Minimal package manifest implementing the full standard:

```json
{
  "id": "my-package",
  "name": "My Package",
  "version": "1.0.0",
  "description": "...",
  "renders": [
    { "id": "four-up",   "label": "Four-Up Grid",    "file": "renders/four-up.html" },
    { "id": "h2h",       "label": "Head-to-Head A",  "file": "renders/h2h.html" },
    { "id": "h2h-b",     "label": "Head-to-Head B",  "file": "renders/h2h.html" },
    { "id": "champion",  "label": "Champion",         "file": "renders/champion.html" },
    { "id": "scoreboard","label": "Scoreboard",       "file": "renders/scoreboard.html" },
    { "id": "ticker",    "label": "Ticker",           "file": "renders/ticker.html" }
  ],
  "stateSchema": {
    "teams":        [{ "name": "string", "city": "string", "code": "string", "presenter": "string", "color": "string" }],
    "scores":       [0, 0, 0, 0],
    "clock":        { "deadline": "number", "value": "number", "running": "boolean", "format": "string" },
    "ticker":       { "messages": [], "speed": "number", "visible": "boolean" },
    "h2h":          { "a": { "left": "number", "right": "number" }, "b": { "left": "number", "right": "number" } },
    "winner":       null,
    "activeRender": "string"
  },
  "initialState": {
    "teams":  [
      { "name": "Team 1", "city": "CITY 1", "code": "T1", "presenter": "", "color": "" },
      { "name": "Team 2", "city": "CITY 2", "code": "T2", "presenter": "", "color": "" },
      { "name": "Team 3", "city": "CITY 3", "code": "T3", "presenter": "", "color": "" },
      { "name": "Team 4", "city": "CITY 4", "code": "T4", "presenter": "", "color": "" }
    ],
    "scores":  [0, 0, 0, 0],
    "clock":   { "deadline": 0, "value": 300, "running": false, "format": "mm:ss" },
    "ticker":  { "messages": [], "speed": 80, "visible": false },
    "h2h":     { "a": { "left": 0, "right": 1 }, "b": { "left": 2, "right": 3 } },
    "winner":  null,
    "activeRender": "four-up"
  },
  "companionActions": [],
  "companionFeedbacks": [],
  "companionVariables": [],
  "companionDerived": [
    { "field": "winnerTeam", "fn": "lookup", "source": "teams", "index": "winner", "path": "name" }
  ]
}
```

---

## Render page state subscription pattern

All render pages connect to PConAir's WebSocket on load and subscribe to their
package namespace. This replaces FFG's `localStorage` approach entirely.

```js
const PKG_ID = 'my-package';
const ws = new WebSocket(`ws://${location.host}`);
let state = {};

ws.addEventListener('open', () => {
  ws.send(JSON.stringify({ type: 'subscribe', namespace: `package:${PKG_ID}` }));
});

ws.addEventListener('message', (evt) => {
  const msg = JSON.parse(evt.data);
  if (msg.type === 'state' && msg.namespace === `package:${PKG_ID}`) {
    state = msg.state;
    render(state);
  }
});

function render(s) {
  // teams, scores, clock, winner, ticker, h2h — all available here
}
```

Clock display in the render layer:
```js
function clockDisplay(clock) {
  const secs = clock.running
    ? Math.max(0, (clock.deadline - Date.now()) / 1000)
    : clock.value;
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return clock.format === 'mm:ss'
    ? `${m}:${String(s).padStart(2, '0')}`
    : String(Math.ceil(secs));
}
```


---

## Compliance Audit — Bundled Packages

Reviewed against this standard: `bundled-packages/ffg`, `bundled-packages/hoops`,
`bundled-packages/news`. Issues are grouped by priority.

---

### `ffg` — Faire Fulfillment Games

#### CRITICAL — breaks Companion module consistency

**1. `h2h` structure is wrong**

Current:
```json
"h2h": { "slotA": [0, 1], "slotB": [2, 3] }
```
Standard requires:
```json
"h2h": { "a": { "left": 0, "right": 1 }, "b": { "left": 2, "right": 3 } }
```
- The `ffg_set_matchup` action uses `h2h.slot{slot}` with uppercase `A/B` in the field path — `{slot}` substitution produces `h2h.slotA`, not `h2h.a.left`/`h2h.a.right`
- `ffg-common.js → resolveH2H()` accesses `s.h2h.slotA` and `s.h2h.slotB` — both need updating

**2. `timer` object must become `clock`**

Current:
```json
"timer": { "running": false, "remaining": null, "endsAt": 0 }
```
Standard requires:
```json
"clock": { "running": false, "value": 900, "deadline": 0, "format": "mm:ss" }
```
Field renames: `remaining` → `value`, `endsAt` → `deadline`, add `format`.
- `package.json` action ops (`ffg_start_timer`, `ffg_stop_timer`, `ffg_reset_timer`) reference `timer.endsAt`, `timer.remaining`, `timer.running` — all need updating to `clock.*`
- `ffg-common.js → timerRemainingS()`, `fmtTimer()`, `bindTimer()` all reference `s.timer.*`
- `companionVariables[id=timer]` countdown config references `timer.*` fields
- `companionFeedbacks[id=timer_running]` watches `timer.running`
- `render-four-up.html` and other renders that show the timer chip need updating

**3. Render IDs are non-standard**

| Current ID | Standard ID | File |
|---|---|---|
| `head-to-head` | `h2h` | `render-head-to-head.html` |
| `single-pip` | `wide-pip` | `render-single-pip.html` |
| `four-portrait` | ✓ compliant | — |
| `four-up` | ✓ compliant | — |
| `champion` | ✓ compliant | — |

**4. Companion action IDs use `ffg_` prefix**

Standard action IDs are package-neutral so the Companion module can surface them
on predictable preset button types. Current IDs with required renames:

| Current | Standard |
|---|---|
| `ffg_bump_score` | `score_add` |
| `ffg_set_score` | `score_set` |
| `ffg_reset_scores` | `score_reset_all` |
| `ffg_set_winner` | `set_winner` |
| `ffg_clear_winner` | `clear_winner` |
| `ffg_start_timer` | `clock_start` |
| `ffg_stop_timer` | `clock_stop` |
| `ffg_reset_timer` | `clock_reset` |
| `ffg_set_team_name` | `team_set_name` *(add to standard)* |
| `ffg_set_matchup` | `h2h_set_slot` *(see note below)* |
| `ffg_set_max_score` | keep as-is (package-specific) |

> Note on `h2h_set_slot`: the current action sets both left and right in one op,
> which is better UX than two separate actions. Add `h2h_set_slot` (with `slot`,
> `left`, `right` options) to the standard in addition to `h2h_set_left`/`h2h_set_right`.

#### SHOULD FIX — inconsistency with other packages

**5. `teams[].handle` should be `teams[].presenter`**

Render files (`render-head-to-head.html:103`, `render-champion.html:135`,
`render-four-up.html:105`) all reference `team.handle` — this is a leftover from
the standalone FFG naming where `handle` meant Slack handle / presenter name.
The standard field is `presenter`. Update `initialState`, `stateSchema`, and all
render references.

#### ACCEPTABLE DEVIATIONS — document as intentional

These fields are FFG-specific and have no standard equivalent — keep as-is:
- `maxScore` — target score shown in score pills
- `finalScore` — snapshot of winner's score at champion reveal
- `activeTeam` — which team index the `wide-pip` render follows
- `h2hSlot` — which h2h slot is currently displayed (becomes redundant once
  `activeRender` is used; consider migrating)

---

### `hoops` — COURTVISION Basketball

#### SHOULD FIX — ticker and clock use flat fields instead of standard objects

**6. Ticker should use `ticker.*` nested object**

Current (flat top-level):
```json
"tickerVisible": true,
"tickerItems": [...],
"tickerTag": "AROUND THE LEAGUE"
```
Standard:
```json
"ticker": { "visible": true, "messages": [...], "speed": 80 }
```
Note: `tickerTag` (the label strip) has no standard equivalent — add `ticker.label`
to the standard, or keep `tickerTag` as a hoops-specific extension.

**7. Clock uses flat fields instead of `clock.*` object**

Current:
```json
"clock": "07:42",
"clockEndsAt": 0
```
These should be `clock.value` / `clock.deadline`. The shot clock pattern
(`shotClock` / `shotEndsAt`) is sport-specific and fine as-is. This is a deeper
change since the render references `clock` as a string directly.

**8. `clock_running` feedback watches `clockEndsAt` (number) not a boolean**

The feedback fires when `clockEndsAt` is truthy — this works but is semantically
wrong. A `clock.running` boolean field makes the feedback intent explicit.

#### ACCEPTABLE DEVIATIONS — sport-specific, keep as-is

Hoops uses a flat 2-team model rather than `teams[]`/`scores[]` arrays. This is
correct for a 2-team sport package and should not be forced into the array pattern.
These are intentional sport-specific fields:
- `teamA`/`teamB`, `scoreA`/`scoreB`
- `possession`, `bonusA`/`bonusB`, `timeoutsA`/`timeoutsB`
- `playerCard.*` — stat card sub-object
- `quarter`/`venue`
- Shot clock (`shotClock`/`shotEndsAt`) — second independent countdown, no standard equivalent

---

### `news` — Faire Nightly News

#### SHOULD FIX

**9. Ticker should use `ticker.*` nested object** (same as hoops #6)

Current:
```json
"tickerVisible": true,
"tickerItems": [...],
"tickerLabel": "Faire Wire"
```
Standard: `ticker.visible`, `ticker.messages`, `ticker.label` (add label to standard).
`news_set_ticker` companion action and `news_clear_ticker` need updating accordingly.
The `ticker_visible` feedback and `ticker_label` variable field paths need updating.

#### ACCEPTABLE DEVIATIONS

- `l3.*` (name/title/visible) — package-level lower third; distinct from the system L3
  module; keep as-is
- `bugVisible`, `liveVisible`, `theme` — overlay-specific controls, no standard
  equivalent
- Render ID `overlay` — single-render news package; acceptable for a composite overlay
  that doesn't separate ticker/l3 into independent renders

---

## Compliance Fix Priority

| Package | Fix | Priority |
|---|---|---|
| ffg | `h2h` structure (slotA/B → a.left/right) | Critical |
| ffg | `timer` → `clock` rename + field renames | Critical |
| ffg | render IDs `head-to-head`→`h2h`, `single-pip`→`wide-pip` | Critical |
| ffg | Companion action IDs drop `ffg_` prefix | Critical |
| ffg | `teams[].handle` → `teams[].presenter` | Should fix |
| hoops | Ticker flat → `ticker.*` | Should fix |
| news | Ticker flat → `ticker.*` | Should fix |
| hoops | Clock flat → `clock.*` | Should fix |
| hoops | `clock_running` feedback → boolean `clock.running` field | Should fix |
| ffg | `h2hSlot` → migrate to `activeRender` | Nice to have |

---

## Standard Amendment Needed

Based on the audit, add these to the standard:

1. **`ticker.label`** — short string prefix shown in the ticker bar (e.g. "Faire Wire",
   "AROUND THE LEAGUE"). Add to the `ticker` schema alongside `messages`/`speed`/`visible`.

2. **`h2h_set_slot` Companion action** — sets both `h2h.{slot}.left` and
   `h2h.{slot}.right` in one action (better UX than two separate actions).
   Options: `slot` (dropdown a/b), `left` (team number), `right` (team number).

3. **`team_set_name` Companion action** — sets `teams.{team}.name`. Options:
   `team` (number), `name` (textinput).

---

## Proposed Sample Package: `demo-scores`

A minimal sideloadable test package that exercises every reserved field and
standard Companion action in one place. Primary purpose: smoke-test the full
PConAir package pipeline (state hub → WebSocket → render → Companion) without
needing a real production package deployed.

### What it tests

| System path | How tested |
|---|---|
| `stateSchema` / `initialState` | Uses all 7 reserved fields |
| WebSocket state subscription | All 3 renders subscribe to `package:demo-scores` |
| `patchState` shallow merge | Score +/- buttons on control page |
| `countdown_start/stop/reset` | Clock controls on control page |
| `ticker.*` | Ticker visible toggle + message set |
| `h2h.*` slot resolution | h2h render reads `h2h.a` and `h2h.b` |
| `winner` → champion reveal | Champion render watches `winner` |
| `activeRender` | Control page render selector switches between all 4 |
| Companion actions | All standard IDs wired up |
| Companion feedbacks | `winner_set`, `clock_running`, `render_active` |
| Companion variables | All standard variable IDs |
| `companionDerived` | `argmax` (leader) + `lookup` (winner name) |
| Sideload path | Lives in user packages dir, not bundled |

### Renders (4)

| Render ID | What it shows |
|---|---|
| `scoreboard` | All 4 teams with scores in a clean vertical list. Updates live. |
| `h2h` | Two teams from `h2h.a` slot side-by-side with scores and clock. |
| `champion` | Winner reveal — blank holding state when `winner === null`. |
| `ticker` | Single-line crawl from `ticker.messages`. |

### Visual design intent

Deliberately minimal — flat dark background, white sans-serif, single accent color.
No textures, no animations beyond the clock tick. The goal is that any rendering
problem is immediately visible because there's nothing to hide behind. Cardboard
kit and Courtvision are proof-of-design; this is proof-of-plumbing.

### Control page

A single `control.html` with five sections:

1. **Teams** — 4 name/city/code fields. Save button patches `teams`.
2. **Scores** — +1 / -1 / reset per team. Live display of current scores.
3. **Head-to-Head** — dropdowns for slot A left/right and slot B left/right.
4. **Clock** — duration input, Start / Stop / Reset. Ticking display.
5. **Show** — `activeRender` selector (4 renders), `winner` selector (team + clear),
   `ticker` message textarea + toggle.

### How to sideload

Drop the package directory into `~/Library/Application Support/PConAir/packages/`
(or the equivalent user packages path on the target machine). Hit Rescan in the
web UI. The package appears in `/remote/packages` without an app restart. This
proves the sideload path works before bundling any package into the app.

### Suggested file layout

```
demo-scores/
  package.json          ← manifest with all standard fields + Companion wiring
  control.html          ← operator control page
  assets/
    state.js            ← copy of PConAir's standard PConAirPackage client
    style.css           ← shared tokens (dark bg, type scale, button styles)
  renders/
    scoreboard.html
    h2h.html
    champion.html
    ticker.html
```

