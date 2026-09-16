# Designing Graphics Packages for PConAir

Packages are self-contained directories of HTML files, a JSON manifest, and optional assets. Drop a package into your packages folder and it appears instantly in PConAir — no build step, no restart, no compile.

This guide walks from zero to a working package. By the end you'll have a custom overlay running live in OBS, controlled from the PConAir web UI and Bitfocus Companion.

---

## How packages work

A package has three moving parts:

**The manifest** (`package.json`) declares what the package is, what HTML pages it contains, what state it tracks, and how Companion can drive it.

**Render pages** are the actual graphics — 1920×1080 HTML files loaded as OBS Browser Sources. They connect to PConAir over WebSocket, receive state updates, and draw themselves. They have no controls of their own.

**The control page** (`control.html`) is an operator UI opened from `/remote/packages` in any browser. It reads the same state and sends patches back via the REST API.

State flows in one direction: the operator (or Companion) patches state via the API → PConAir broadcasts it over WebSocket → every connected render page updates itself. There's no polling.

---

## Where to put your package

PConAir loads from two directories, in order:

1. **Bundled packages** — baked into the app, always present
2. **User packages** — your personal overlay directory, configured in Settings → Packages

Set your user packages directory to any folder you like (e.g. `~/Documents/PConAir/packages/`). Create a sub-folder per package inside it. Hit **Rescan** in the web UI at any time; the new package appears immediately.

For development, point the user packages dir at your working folder so live edits are visible on the next browser reload in OBS.

---

## The manifest (`package.json`)

Every package needs a `package.json` at its root.

### Minimum viable manifest

```json
{
  "id": "my-package",
  "name": "My Package",
  "version": "1.0.0",
  "renders": [
    { "id": "main", "label": "Main Overlay", "file": "render.html" }
  ]
}
```

`id` must be lowercase alphanumeric with hyphens or underscores. It's permanent — changing it creates a new package and loses saved state.

### Adding state

Declare your state shape in `stateSchema` and initial values in `initialState`:

```json
"stateSchema": {
  "title": "string",
  "visible": "boolean",
  "count": "number"
},
"initialState": {
  "title": "WELCOME",
  "visible": true,
  "count": 0
}
```

Schema types are `"string"`, `"boolean"`, `"number"`, or nested objects. Arrays can be written as literal default values: `"scores": [0, 0, 0, 0]`.

`initialState` wins over schema-derived defaults. Use it for anything that needs a real starting value rather than zero/empty/false.

### Reserved field names

Use these exact names for common data — the Companion module and future PConAir features understand them:

| Field | Shape | Purpose |
|---|---|---|
| `teams` | `[{name, city, code, presenter, color}]` | Team roster |
| `scores` | `[number, ...]` | One score per team, same index as `teams` |
| `clock` | `{deadline, value, running, format}` | Countdown/stopwatch |
| `ticker` | `{visible, messages, speed, label}` | Text crawl |
| `h2h` | `{a:{left,right}, b:{left,right}}` | Head-to-head matchup slots |
| `winner` | `number \| null` | Winning team index, or null |
| `activeRender` | `string` | Currently displayed render ID |

You don't need all of them. Use what your package requires and omit the rest.

Top-level `stateSchema` keys starting with `_` are reserved for the engine
(`_transport` for spec 15's transport state; more may follow) — declaring one
fails manifest validation.

### Render IDs

Use these standard IDs when your layout matches the concept — it makes Companion presets and multi-package setups predictable:

| ID | Layout |
|---|---|
| `wide` | Single full-width feed |
| `wide-pip` | Wide + picture-in-picture |
| `four-up` | 2×2 camera grid |
| `four-portrait` | 4 portrait frames |
| `h2h` | Head-to-head (uses `h2h.a` slot) |
| `h2h-b` | Head-to-head slot B |
| `scoreboard` | All teams with scores |
| `leaderboard` | Ranked order |
| `champion` | Winner reveal |
| `standby` | Holding/title card |
| `ticker` | Text crawl only |

For bespoke layouts, any lowercase ID is fine.

---

## Writing a render page

A render page is a standard HTML file. It connects to PConAir's WebSocket on load, receives the full state immediately, and re-renders on every update.

### Basic structure

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>My Overlay</title>
  <style>
    html, body {
      width: 1920px; height: 1080px;
      margin: 0; overflow: hidden;
      background: transparent; /* transparent for OBS */
      color: #fff;
      font-family: sans-serif;
    }
    #stage { position: absolute; inset: 0; }
  </style>
</head>
<body>
  <div id="stage">
    <!-- your graphics here -->
  </div>

  <script src="/packages/_runtime/pconair.js"></script>
  <script>
    window.PConAir.connect('my-package', {
      role: 'render',
      onState: function (state) {
        document.getElementById('title').textContent = state.title;
        document.getElementById('count').textContent = state.count;
      },
    });
  </script>
</body>
</html>
```

### The shared runtime

`/packages/_runtime/pconair.js` is PConAir's WebSocket client and is served by
the app. **Do not copy it into your package.** Packages used to each ship their
own `assets/state.js`; those copies are gone and that path now 404s.

**`window.PConAir.connect(packageId, opts)`** connects over WebSocket,
subscribes to your package's namespace, and re-subscribes on every reconnect —
so a browser-source reload rehydrates rather than waiting for the next change.
Reconnects back off 1s → 2s → 4s → 8s → 15s and reset after a successful open.

`opts`:

| Key | Default | Meaning |
|---|---|---|
| `role` | `'render'` | `'render'` for an output page, `'control'` for a panel. Get this right: PConAir counts render subscriptions as live outputs, so a panel claiming `'render'` makes the operator think something is on air when nothing is. |
| `renderId` | `<html data-render-id>` | Which render this page is. Set the attribute on your render pages — a helper shared across several renders cannot hardcode one id. |
| `onState` | — | Convenience; same as calling `.on(fn)` immediately. |

The returned client:

| Member | Meaning |
|---|---|
| `state` | Latest state, or `null` before the first frame |
| `on(fn)` | Subscribe. Fires immediately if state is already known. Returns an unsubscribe |
| `patch(partial)` | Shallow-merge write. Resolves to the **parsed response body**, rejects with the server's error message |
| `connected` | Whether this page's own socket is up |
| `onConnection(fn)` | Subscribe to connection edges. Returns an unsubscribe |
| `presence` | `PackagePresence \| null` — live counts of who else is connected to this package (see below). `null` before the first frame |
| `onPresence(fn)` | Subscribe to presence changes. Fires immediately if presence is already known. Returns an unsubscribe |
| `close()` | Disconnect and stop reconnecting |

Also on `window.PConAir`: `param(key, fallback)` reads the page query string,
`isDebug()` reports `?debug=1`, and `presenceIndicator(el, client, opts)` is a
drop-in LED (see below).

A `window.PConAirPackage.connect(id, cb)` shim remains for packages written
against the old API, but new packages should not use it.

### Output presence

An operator can press a button and have nothing happen for four different
reasons: nothing changed server-side, the state changed but no render page is
open, the render page is open but pointed at the wrong host, or the graphic
is up and the display routing is wrong. Presence answers the second
question — "is anything actually listening" — as a live, per-render count.

**`delivered` on `POST /api/packages/:id/state`.** Every response carries a
`delivered` count: the number of render pages (never control pages) currently
subscribed to that package.

> **`delivered: 0` means the call succeeded and nothing was listening. It is
> not an error and must not be reported as one.** A control page should show
> this as "no output connected", not as a failure toast.

A control page never counts as an output itself — `window.PConAir.connect`
already sends `?control=1` rather than `?render=1` for `role: 'control'`, so
this is automatic as long as you pass the right `role`.

**Drop in the indicator** rather than hand-rolling one:

```html
<div id="presence"></div>
<script>
  const client = window.PConAir.connect('my-package', { role: 'control' });
  window.PConAir.presenceIndicator(document.getElementById('presence'), client);
  // Or, to report on just one render when your package has several:
  // window.PConAir.presenceIndicator(el, client, { renderId: 'scoreboard' });
</script>
```

It renders "no output connected" / "1 output" / "N outputs" into the element
and sets `data-presence="none"|"ok"` for styling — `pconair.css` supplies a
red/green dot via `--pc-danger` / `--pc-ok`. Call `.destroy()` on the returned
handle if you ever remove the element without closing the whole client.

**Presence endpoints** (operator auth required):

| Route | Response |
|---|---|
| `GET /api/packages/:id/presence` | `{ renders, byRender, controls }` for one package |
| `GET /api/presence` | `{ packages: Record<packageId, PackagePresence>, clients: PresenceEntry[] }` — every package, plus the raw connected-client list (sorted by connect time), for a diagnostics view |

Presence changes are pushed over the same WebSocket you already have open —
a `{type:'presence', namespace, presence}` frame lands on every socket
subscribed to that namespace the moment another one joins or leaves. Nothing
needs to poll for it.

### Transport (play / hold / advance / stop / clear)

Some graphics reveal in stages — a stat card that brings up a name, then a
headshot, then bullet points — rather than a single `visible` boolean. Declare
a `transport` block on a render in the manifest and the shared runtime drives
a playback state machine for you, with no page-specific animation JavaScript:

```json
{
  "renders": [
    {
      "id": "overlay",
      "label": "Overlay",
      "file": "renders/overlay.html",
      "transport": { "stops": 2, "inMs": [500, 350], "outMs": 400 }
    }
  ]
}
```

| Key | Meaning |
|---|---|
| `stops` | Number of hold points, 1-16. 1 is the classic in/hold/out. |
| `inMs` | Intro duration per segment; segment *i* is `inMs[i]`, the last value repeats for further stops. Defaults to 400ms. |
| `outMs` | Outro duration. Defaults to 400ms. |
| `autoAdvanceMs` | Auto-advance a hold after N ms; 0 or omitted holds until told. |

The state machine: `idle → playing-in → holding[0] → (playing-in → holding[1] → …) → playing-out → finished`.
`play`/`next` from a hold advances to the next one; from the last hold, `play`
behaves as `stop`. `clear` snaps to `idle` from anywhere — the panic verb.

**Driving it.** From a control page or any script with a `Client`:

```js
client.verb('play');   // idle/finished -> playing-in -> holding[0]
client.verb('next');   // holding[n] -> playing-in -> holding[n+1]
client.verb('stop');   // any live phase -> playing-out -> finished
client.verb('clear');  // any phase -> idle, immediately
```

Each resolves to the parsed response body, same contract as `patch()`. The
same four verbs are also available as `POST /api/packages/:id/transport/:renderId/:verb`,
`GET /api/packages/:id/transport`, `POST /api/packages/:id/transport/clear-all`,
and as synthesised Companion actions/feedback/variables (nothing to declare —
see "Companion integration" below).

**Styling it.** The runtime sets `data-phase` and `data-step` on `<html>` for
this render's own id, and `--pc-phase-ms` to the current phase's duration.
Style purely against those — no JavaScript:

```css
[data-phase="idle"]        .card { opacity: 0; transform: translateY(40px); }
[data-phase="playing-in"]  .card,
[data-phase="holding"]     .card { opacity: 1; transform: none; }
.card { transition: all calc(var(--pc-phase-ms) * 1ms); }
[data-step="0"] .bullets { opacity: 0; } /* revealed at step 1 */
```

A render whose manifest has no `transport` key is not transport-managed —
`client.transport` is `null` and the attributes are never set, so an existing
render is unaffected until you opt in. `demo-packages/template-overlay`'s
`.stat-card` is a worked example.

### Clock display

For a clock field, compute the display value live:

```js
function clockDisplay(state) {
  const c = state.clock || {};
  const secs = (c.running && c.deadline > 0)
    ? Math.max(0, (c.deadline - Date.now()) / 1000)
    : (c.value || 0);
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return c.format === 'mm:ss'
    ? m + ':' + String(s).padStart(2, '0')
    : String(Math.ceil(secs));
}

// Call on a timer so the display ticks while running
setInterval(() => {
  clockEl.textContent = clockDisplay(currentState);
}, 250);
```

### Transparent vs opaque background

By default your page background should be `transparent` so OBS composites the graphics over video. Add `?obs=1` to the Browser Source URL and handle it in CSS if you want to switch between a dark preview background and true transparency:

```js
if (new URLSearchParams(location.search).get('obs')) {
  document.body.style.background = 'transparent';
}
```

Or use body classes: `body.obs { background: transparent }` vs `body { background: #111 }` for the design preview.

For luma key (black or white background), add `?key=black` / `?key=white` and apply accordingly. This lets hardware switchers key the graphic over video.

### Handling teams and scores

```js
window.PConAir.connect('my-package', { role: 'render', onState: function (s) {
  const teams = s.teams || [];
  const scores = s.scores || [];

  // Sort by score descending for a leaderboard
  const ranked = teams
    .map((t, i) => ({ ...t, score: scores[i] || 0 }))
    .sort((a, b) => b.score - a.score);

  // Render each team
  ranked.forEach((t, rank) => {
    // t.name, t.city, t.code, t.presenter, t.score
  });
});
```

### Ticker crawl

```js
function buildTicker(state) {
  const t = state.ticker || {};
  if (!t.visible) { tickerEl.style.display = 'none'; return; }
  tickerEl.style.display = '';

  const items = t.messages || [];
  const text = items.join(' · ');
  // Duplicate for seamless loop:
  track.textContent = text + '  ·  ' + text;

  // Approximate speed: assume text at 14px/char, speed in px/s
  const totalPx = text.length * 14;
  const dur = totalPx / (t.speed || 80);
  track.style.animationDuration = dur + 's';
}
```

---

## Writing a control page

The control page is served at `/packages/my-package/control` and opened from `/remote/packages` by operators. It's a normal web page — mobile-friendly, no framework required.

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>My Package — Control</title>
</head>
<body>
  <button id="btn-show">SHOW</button>
  <button id="btn-hide">HIDE</button>

  <script src="/packages/_runtime/pconair.js"></script>
  <script>
    const client = window.PConAir.connect('my-package', { role: 'control' });
    client.on(function (state) {
      // update UI to reflect current state
      document.getElementById('btn-show').disabled = state.visible;
      document.getElementById('btn-hide').disabled = !state.visible;
    });

    document.getElementById('btn-show').onclick = () => client.patch({ visible: true });
    document.getElementById('btn-hide').onclick = () => client.patch({ visible: false });
  </script>
</body>
</html>
```

`client.patch(partialState)` sends a shallow merge to the server. Only include the fields you're changing — other fields are untouched. For nested fields you must send the whole nested object:

```js
// DO THIS — send the whole clock object
client.patch({ clock: { ...currentState.clock, running: true, deadline: Date.now() + 300000 } });

// NOT THIS — the server doesn't deep-merge
client.patch({ 'clock.running': true }); // ← this doesn't work
```

---

## Companion integration

Declare actions, feedbacks, and variables in `package.json`. The PConAir Companion module loads them dynamically — you get a working Companion page with no module code to write.

If a render declares `transport` (see above), its Companion interface needs no
declaration at all: `transport_play`, `transport_next`, `transport_stop`,
`transport_clear` (each with a `renderId` dropdown listing your
transport-managed renders), `transport_clear_all`, a `transport_phase`
feedback, and one `transport_<renderId>_phase` variable per transport-managed
render are all synthesised automatically.

### Actions

An action applies one or more operations to the state when a Companion button is pressed:

```json
"companionActions": [
  {
    "id": "score_add",
    "label": "Add to score",
    "options": [
      {
        "id": "team",
        "label": "Team",
        "type": "dropdown",
        "default": 0,
        "choices": [
          { "id": 0, "label": "Team 1" },
          { "id": 1, "label": "Team 2" }
        ]
      },
      {
        "id": "value",
        "label": "Amount",
        "type": "number",
        "default": 1,
        "min": -10,
        "max": 10
      }
    ],
    "ops": [
      {
        "op": "add",
        "field": "scores.{team}",
        "value": { "option": "value" },
        "min": 0
      }
    ]
  }
]
```

**Op types:**

| Op | Effect |
|---|---|
| `set` | Set a field to a literal value, an option value, or a state snapshot |
| `add` | Add to a numeric field (supports `min`/`max` clamp) |
| `toggle` | Flip a boolean field |
| `countdown_start` | Start a running countdown (sets deadline = now + remaining) |
| `countdown_stop` | Stop countdown (captures remaining seconds into value field) |
| `countdown_reset` | Reset to a given value without starting |

**Field paths** use dot notation: `scores.0`, `teams.2.name`, `clock.deadline`, `h2h.a.left`. `{optionId}` in a path gets substituted from the action option at runtime, so `scores.{team}` with team=2 targets `scores.2`.

**Value references:**
- `"value": 42` — literal
- `"value": { "option": "amount" }` — from a Companion option
- `"value": { "state": "scores.0" }` — snapshot of another state field
- `"value": { "option": "items", "split": "|" }` — split a text input into an array

### Feedbacks

Feedbacks light up Companion buttons when a condition is true:

```json
"companionFeedbacks": [
  {
    "id": "winner_set",
    "label": "Winner is declared",
    "field": "winner",
    "notEquals": null
  },
  {
    "id": "render_active",
    "label": "Render is active",
    "field": "activeRender",
    "equals": { "option": "render" },
    "options": [
      {
        "id": "render",
        "label": "Render",
        "type": "dropdown",
        "default": "scoreboard",
        "choices": [
          { "id": "scoreboard", "label": "Scoreboard" },
          { "id": "h2h", "label": "Head-to-Head" }
        ]
      }
    ]
  }
]
```

### Variables

Variables surface state values as Companion variable tokens (usable in button labels, etc.):

```json
"companionVariables": [
  { "id": "score_0", "label": "Team 1 score", "field": "scores.0" },
  { "id": "team_0_name", "label": "Team 1 name", "field": "teams.0.name" },
  {
    "id": "clock_display",
    "label": "Clock",
    "countdown": {
      "deadlineField": "clock.deadline",
      "valueField": "clock.value",
      "runningField": "clock.running",
      "format": "mm:ss"
    }
  }
]
```

### Derived fields

Computed values that aren't stored in state but can be used by feedbacks and variables:

```json
"companionDerived": [
  { "field": "_leader", "fn": "argmax", "source": "scores" },
  { "field": "_leaderName", "fn": "lookup", "source": "teams", "index": "_leader", "path": "name" }
]
```

`argmax` returns the index of the highest value in an array. `lookup` fetches a nested field from an array item by index.

---

## Standard Companion action IDs

If your package implements any of these common functions, use these exact IDs. The Companion module creates consistent preset button layouts for packages that follow this convention.

| Action ID | What it does |
|---|---|
| `score_add` | Add to `scores.{team}` |
| `score_set` | Set `scores.{team}` |
| `score_reset_all` | Zero all scores |
| `team_set_name` | Set `teams.{team}.name` |
| `h2h_set_slot` | Set both `h2h.{slot}.left` and `.right` |
| `set_winner` | Set `winner` to a team index |
| `clear_winner` | Set `winner` to null |
| `clock_start` | `countdown_start` on `clock.*` fields |
| `clock_stop` | `countdown_stop` on `clock.*` fields |
| `clock_reset` | Reset clock to a duration |
| `ticker_show` | Set `ticker.visible` = true |
| `ticker_hide` | Set `ticker.visible` = false |
| `ticker_toggle` | Toggle `ticker.visible` |
| `ticker_set` | Set `ticker.messages` from a split-input |

---

## Quickstart checklist

- [ ] Create `my-package/` in your user packages directory
- [ ] Write `package.json` with your `id`, `name`, and `renders` list
- [ ] Write your first render HTML (1920×1080, transparent body, `<html data-render-id="...">`, loads `/packages/_runtime/pconair.js`, calls `window.PConAir.connect(id, { role: 'render' })`)
- [ ] Set `stateSchema` and `initialState` for the state you need
- [ ] Write `control.html` with buttons that call `client.patch()`
- [ ] Add `companionActions` for anything Companion should be able to trigger
- [ ] Hit **Rescan** in `/remote/packages`
- [ ] Load the render URL (`/packages/my-package/render`) as an OBS Browser Source
- [ ] Open the control page (`/packages/my-package/control`) in a browser tab

---

## Reference: `demo-scores` package

The `demo-scores` package in `demo-packages/demo-scores/` is a working template that exercises every feature described in this guide: all seven reserved state fields, all standard Companion action IDs, four render layouts, a full five-section control page, and live clock ticking. Read it alongside this guide to see each concept applied.

To sideload it: copy the `demo-scores/` directory into your user packages folder, hit Rescan, and you're running.
