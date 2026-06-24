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

  <script src="/packages/my-package/assets/state.js"></script>
  <script>
    PConAirPackage.connect('my-package', function(state) {
      document.getElementById('title').textContent = state.title;
      document.getElementById('count').textContent = state.count;
    });
  </script>
</body>
</html>
```

`state.js` is the PConAir WebSocket client. Copy it from the demo-scores package (`assets/state.js`) — it's the same file for every package, just referenced via your package's asset path.

**`PConAirPackage.connect(packageId, callback)`** connects over WebSocket, subscribes to your package's namespace, and calls `callback(state)` on every update including the initial hydration. It auto-reconnects if the connection drops. Returns a client object with a `patch(partialState)` method.

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
PConAirPackage.connect('my-package', function(s) {
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

  <script src="/packages/my-package/assets/state.js"></script>
  <script>
    const client = PConAirPackage.connect('my-package', function(state) {
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
- [ ] Copy `assets/state.js` from the demo-scores package
- [ ] Write `package.json` with your `id`, `name`, and `renders` list
- [ ] Write your first render HTML (1920×1080, transparent body, includes state.js, calls `PConAirPackage.connect`)
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
