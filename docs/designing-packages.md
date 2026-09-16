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

## Data sources

A package can declare polled, normalized data feeds — RSS/Atom, JSON, or CSV — instead of hand-rolling its own `fetch` and poll timer. Every kind produces the same shape:

```ts
type DataRow = Record<string, string>; // values are always strings — formatting is the graphic's job

interface DataSourceResult {
  rows: DataRow[];
  columns: string[];   // column names, first-seen order
  fetchedAt: number;
  error: string | null; // null when the last fetch succeeded
  rawCount: number;      // row count before transforms
}
```

### Declaring a source

```json
"dataSources": [
  {
    "id": "headlines",
    "label": "Headlines feed",
    "kind": "rss",
    "pollSeconds": 300,
    "transforms": [
      { "op": "sort", "column": "date", "direction": "desc" },
      { "op": "limit", "count": 8 }
    ]
  }
]
```

- `id` — lowercase, matches `/^[a-z0-9][a-z0-9-_]*$/` (same rule as a render `id`), unique within the package. This is the key under `_data` in package state, so it can never start with `_`.
- `kind` — `'http-json'`, `'http-csv'`, or `'rss'` (covers Atom too).
- `url` — optional default. Leave it off (as `news`'s `headlines` source does) when there's no sensible default and the operator must supply one from the control page / Admin.
- `path` — `http-json` only: a dotted path to the array in the response, e.g. `"data.standings"`.
- `pollSeconds` — clamped to a **60-second floor** no matter what you ask for.
- `transforms` — applied in array order (see below).

The operator owns the live URL, poll interval, and enabled flag — those are overrides on top of your declaration, set via the control page (spec 18) or `PUT /api/packages/:id/data/:sourceId` (admin-only), and they persist independently of your manifest.

### Transforms

Applied in array order to the parsed rows:

| op | fields | effect |
|---|---|---|
| `sort` | `column`, `direction?` (`asc`\|`desc`), `numeric?` | Re-orders rows. `numeric: true` compares as numbers (`2` before `10`); otherwise the comparison is lexical string order. |
| `filter` | `column`, `test` (`eq`\|`neq`\|`contains`\|`gt`\|`lt`), `value` | Keeps rows where the test passes. `gt`/`lt` compare numerically. |
| `limit` | `count` | Keeps the first `count` rows. |
| `offset` | `count` | Drops the first `count` rows. |
| `rank` | `column` | Writes a 1-based position into `column`, based on row order **at that point in the pipeline** — put it after `sort` and before `limit` for a "top 5 with ranks 1–5" result. |

### Reading a source from a render page

Results land in package state under the reserved `_data` key, keyed by source id:

```js
window.PConAir.connect('my-package', {
  role: 'render',
  onState: (s) => {
    const source = s._data && s._data.my_source;
    if (source && source.enabled !== false && source.rows.length > 0) {
      // use source.rows
    } else {
      // fall back to a manually-authored field from your own stateSchema
    }
  },
});
```

**The fallback is required.** A package must never go dark because a feed is unconfigured, disabled, or hasn't polled yet — always ship a manually-editable field (like `news`'s `tickerItems`) as the fallback, and only prefer the data source's rows when it's enabled and has actually returned something. See `bundled-packages/news/render-ticker.html`'s `resolveItems()` for the reference implementation, including joining new copy at a crawl's loop seam instead of mutating text mid-scroll.

`_data` is **never persisted** — it's rebuilt from a live poll every time the app starts, the same as any other value under a leading-underscore reserved key (`_transport`, `_meta`). Don't rely on it surviving a restart.

### Safety rules (do not weaken these)

Because this is real outbound network access on behalf of a manifest file, the poller enforces, unconditionally:

- **`http:`/`https:` only.** `file:`, `data:`, `ftp:`, everything else is refused.
- **No loopback, link-local, or private-network (RFC1918) targets** — checked against the resolved IP, not just the literal hostname, so a DNS answer can't smuggle a request onto the LAN. An admin can allow a specific host anyway from Admin → System → **Data Source Allowed Hosts**.
- **10-second timeout**, **2 MB response cap** (aborted, not buffered past the cap).
- **Same-host redirects only**, up to 3 hops; a redirect to a different host is refused.
- **A failed poll keeps the last good rows** and sets `error` — it never blanks what's already on air.

If you're writing a new `kind`, the parser must be a pure function (no I/O) so it's unit-testable without a network stub — see `parseJson`/`parseCsv`/`parseRss` in `src/main/packages/data-sources.ts`.

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

### Checking a graphic before a show

Every render page ships a debug mode for free — no code required in your package.

Append params to any render URL:

```
/packages/my-package/render/main?debug=1&scale=contain&bg=checker
```

| Param | Effect |
|---|---|
| `debug=1` | Shows a live diagnostics overlay (top-left) and binds keyboard verbs. Nothing is loaded for this unless the param is present — a production browser source pays zero cost. |
| `scale=contain` | Scales the 1920×1080 stage to fit the browser window, preserving aspect. Works with or without `debug=1`. |
| `bg=checker` | Paints a checkerboard behind the stage so transparency is visible against a light or dark viewer. |
| `bg=<hex>` | Paints a solid colour instead, e.g. `bg=%23008000` for chroma green. |

The overlay shows: package/render id, socket status, fps (flagged if it drops below 50), viewport size, and a row for every diagnostic sampler your package (or a later spec — transport, presence, data sources) has registered via `_diagSource`. A package with none of those registered still gets the base rows — the overlay never assumes another spec is present.

Keyboard, only when `debug=1` and focus isn't in a text input:

| Key | Action |
|---|---|
| `Space` | play |
| `→` | next |
| `Esc` | stop |
| `Backspace` | clear |
| `d` | collapse/expand the overlay |
| `r` | reload the page |

The transport keys are no-ops (logged as a warning in the overlay) on a package that hasn't wired up transport verbs.

Push a message into the overlay's own warnings row from anywhere in your page:

```js
window.PConAir.warn('Card name is 40px wider than its box');
```

It's a no-op when the overlay isn't active, so you never need to guard the call with `isDebug()` yourself.

For app-wide diagnostics rather than one render, `GET /api/diagnostics` (operator auth) returns app version, uptime, memory, and the loaded package list. It never includes PINs, hashes, tokens or other secrets — the response is checked for those substrings in `tests/diagnostics-route.test.ts`.

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

## Declarative controls (no control page at all)

**Start here.** You almost certainly do not need to write a control page.

Declare `controls` in `package.json` and the shared runtime generates the whole
operator panel: inputs, labels, layout, debouncing, focus handling, optimistic
updates, the "nothing is listening" notice, the disconnected banner and
keyboard access. Ship no `control.html` and `/packages/<id>/control` serves the
generated panel instead.

`demo-packages/template-timer` and `demo-packages/template-overlay` are both
built this way and contain no control HTML whatsoever. Read their
`package.json` alongside this section.

```json
{
  "id": "my-package",
  "stateSchema": {
    "l3": { "visible": "boolean", "name": "string", "title": "string" },
    "style": { "accent": "string", "panelOpacity": "number", "corner": "number" }
  },
  "controls": {
    "groups": [
      {
        "id": "lowerthird",
        "label": "Lower Third",
        "fields": [
          { "type": "text", "field": "l3.name", "label": "Name", "span": "half" },
          { "type": "text", "field": "l3.title", "label": "Title", "span": "half" },
          { "type": "toggle", "field": "l3.visible", "label": "On air" }
        ]
      }
    ]
  }
}
```

### The principle

The manifest declares **what an operator may change**. The runtime decides
**how it is drawn**. You get a consistent panel for free; the operator gets the
same interaction model in every package.

### Groups

| Key | Meaning |
|---|---|
| `id` | Unique, lowercase. Also the key the operator's collapse choice is stored under. |
| `label` | Section heading. Rendered as a `<legend>`. |
| `collapsed` | Closed on first load. The operator's own choice wins after that, remembered per viewer. |
| `renderId` | Narrows the group to one render — shown only while that render is selected in the preview picker. Omit for "always shown". |
| `fields` | Ordered. Panel order is manifest order, and so is tab order. |

### Field types

Every field takes `label` (required), and optionally `help` (a hint under the
input), `span` (`full` · `half` · `third`, a width hint) and `showIf`.

Value-bearing fields take `field`: a dotted path into your `stateSchema`, array
indices included (`scores.0`). The path is checked when the package loads, so a
typo fails the manifest with a message naming the group, the field and the path
— rather than shipping a control that silently does nothing.

| `type` | Draws | Requires a schema leaf of |
|---|---|---|
| `text` | Text input, or a textarea with `multiline` | `string` |
| `text` + `list: true` | Textarea, one array item per line | an array (`[]`) |
| `number` | Number input, plus −/+ buttons for each `bump` magnitude | `number` |
| `slider` | Range input with a value readout (`unit` is display-only) | `number` |
| `toggle` | Checkbox | `boolean` |
| `select` | Dropdown over `choices` | `string` (or `number`, if every choice `id` is a number) |
| `color` | Colour picker plus one-click `swatches` | `string` |
| `asset` | Path input plus upload, through `POST /api/packages/:id/assets` | `string` |
| `transport` | Play / Next / Stop / Clear for `renderId`, plus a phase readout | — |
| `data` | Row count, staleness, error and a refresh button for `sourceId` | — |
| `action` | A button that applies `patch`, or runs a `countdown` verb | — |
| `static` | Explanatory text, no input | — |

Extras per type: `text` takes `maxLength` and `placeholder`; `number` takes
`min`, `max`, `step` and `bump`; `slider` requires `min` and `max` (with
`min < max`) and takes `step` and `unit`; `select` requires at least one
`choice`; `asset` takes `accept` (`image` · `video` · `any`); `action` takes
`confirm` (a message the operator must accept) and `variant: "danger"`.

`transport.renderId` must name a render that declares `transport`, and
`data.sourceId` a declared data source — both checked at load.

### Conditional fields

```json
{ "type": "select", "field": "logo.position", "label": "Logo position",
  "showIf": { "field": "logo.visible", "equals": true } }
```

The field is absent from the DOM until the condition matches, and appears in
its manifest position the moment it does. Comparison is strict: `"12"` never
matches `12`.

### Actions

A button that merges a declared patch:

```json
{ "type": "action", "label": "Clear lower third", "variant": "danger",
  "confirm": "Clear the lower third?", "patch": { "l3": { "visible": false } } }
```

The patch is rebuilt from its dotted paths against current state before
sending, so `{ "l3": { "visible": false } }` keeps `l3.name` rather than
wiping it. Every path in it is resolved at load.

### Clocks: `action.countdown`

A static patch cannot start a clock, because that needs `Date.now()`. Use
`countdown`, which has exactly the same semantics as the Companion
`countdown_start` / `countdown_stop` / `countdown_reset` ops:

```json
{ "type": "action", "label": "Start", "countdown": {
    "verb": "start",
    "deadlineField": "clock.deadline",
    "valueField": "clock.value",
    "runningField": "clock.running",
    "secondsField": "clock.duration"
} }
```

| `verb` | Effect |
|---|---|
| `start` | `deadlineField = now + remaining`. Resumes an already-running clock rather than adding time; uses `seconds`/`secondsField` when stopped. |
| `stop` | Banks the remaining seconds (rounded up) into `valueField` and clears `deadlineField`. |
| `reset` | Restores `seconds`/`secondsField` into `valueField` and clears `deadlineField`. |

`runningField` is optional; omit it and that state is left alone rather than
guessed at. `deadlineField`, `valueField` and `secondsField` must be `number`
leaves and `runningField` a `boolean` — checked at load, so a timer cannot
ship pointing at the wrong leaf and fail the first time an operator hits Start.

Why a deadline rather than a ticking counter: the remaining time is always
computed from `Date.now()` against a stored epoch-ms deadline, so every output
agrees to the millisecond and a browser source that reloads mid-show comes back
at the right time instead of at the start.

### The "Look" convention — restyling from the UI

This is the point of the exercise: **an operator should be able to restyle a
graphic without anyone editing a file.**

1. Declare your styling as state under a `style` key:

   ```json
   "style": { "accent": "string", "panelOpacity": "number", "corner": "number" }
   ```

2. Expose it with `color`, `slider` and `select` fields in a group labelled
   "Look".

3. Call `kit.applyStyle()` (or `client.applyStyle()`) once in your render.

The runtime then mirrors that subtree onto `:root` as CSS custom properties on
every state frame — camelCase becomes kebab-case, numbers pass through
unitless:

```
{ accent: '#c8a24a', panelOpacity: 0.9, corner: 18 }
  →  --pc-accent: #c8a24a;  --pc-panel-opacity: 0.9;  --pc-corner: 18;
```

4. Author your CSS against those variables, always with a fallback, so the
   graphic still renders correctly before the first frame and if the Look
   controls are removed:

   ```css
   :root {
     --accent: var(--pc-accent, #b5a998);
     /* rgba()'s comma syntax cannot take a variable for alpha; the
        space-separated form can. */
     --panel-bg: rgb(251 248 246 / var(--pc-panel-opacity, .94));
     --panel-corner: calc(var(--pc-corner, 4) * 1px);
   }
   ```

   Keep unit conversion in the render (`calc(... * 1px)`) so the manifest stays
   free of CSS syntax.

`applyStyle(subtree, prefix)` defaults to `('style', '--pc-')`. Only scalar
leaves become properties; nested objects are skipped.

**Colour safety.** A `color` field's value ends up in a `style` attribute on
every connected output, so an unvalidated one is a CSS injection into all of
them at once. Values are checked twice: `POST /api/packages/:id/state` rejects
anything at a `color` field's path that is not a 3/4/6/8-digit hex value or one
of a short list of named colours, with a 400 and nothing applied; and
`applyStyle` independently refuses any value containing `;`, `}`, `{`, `/*`,
`*/`, `url(`, a backslash or a parenthesis, dropping it rather than writing it.
Declared `swatches` are validated at load too.

### What the generated panel does for you

- **Never clobbers a focused input.** An incoming state frame skips any input
  the operator has focus in, and reconciles on blur — unless they were
  mid-edit, in which case blur commits their work instead of discarding it.
- **Debounces typing and dragging at 150 ms**, and commits immediately on
  `change`, blur and Enter. Naming a guest does not emit a patch per keystroke.
- **Optimistic, then reconciled.** The input updates immediately; the server's
  echo is the truth; a rejected patch visibly reverts and says why.
- **Carries siblings.** `POST /state` shallow-merges at the top level, so a
  change to `home.score` is sent with `home`'s other keys read out of current
  state. You never think about this.
- **Shows `delivered: 0`** as a one-line informational notice — *"Applied — no
  output is connected."* Never a modal, never an error.
- **Refuses edits while disconnected**, out loud, with the input snapping back.
  Silently swallowing an operator's edit during a dropout is worse than
  refusing it.
- **Is keyboard-complete.** Real `<label for>` on every input, `<fieldset>` /
  `<legend>` per group, no positive `tabindex`, tab order = manifest order.

### Reading the controls document

`GET /api/packages/:id/controls` (operator session) returns the validated
`controls` plus the package's id, name and render list. The generated shell
fetches exactly this, which is why a panel opened without an operator session
tells you to sign in rather than rendering empty.

### The escape hatch

A package may have **both**. If `control.html` exists it is always served
unchanged, and it can call the panel renderer itself for part of the page:

```html
<script src="/packages/_runtime/pconair.js"></script>
<script src="/packages/_runtime/pconair-controls.js"></script>
<script>
  window.PConAir.controlPanel(document.getElementById('generated'), {
    packageId: 'my-package'
  });
  // …and hand-write the rest around it.
</script>
```

Both scripts are required: `pconair-controls.js` registers the renderer, and
`controlPanel()` throws a message naming it if it is missing. A render page
should load neither.

A scorebug's clock controls are the usual reason to reach for this. If you find
yourself hand-writing something that every package would want, that is a gap in
the field types worth filing rather than a reason to write a panel.

---

## Writing a control page by hand

Only when `controls` above genuinely cannot express what you need. The control page is served at `/packages/my-package/control` and opened from `/remote/packages` by operators. It's a normal web page — mobile-friendly, no framework required.

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
- [ ] Declare `controls` in `package.json` and let the runtime generate the operator panel — only hand-write `control.html` if `controls` genuinely cannot express it
- [ ] Expose your styling as `style` state with a "Look" group, and call `kit.applyStyle()` in the render, so the graphic can be restyled from the UI
- [ ] Add `companionActions` for anything Companion should be able to trigger
- [ ] Hit **Rescan** in `/remote/packages`
- [ ] Load the render URL (`/packages/my-package/render`) as an OBS Browser Source
- [ ] Open the control page (`/packages/my-package/control`) in a browser tab

---

## Reference: `demo-scores` package

The `demo-scores` package in `demo-packages/demo-scores/` is a working template that exercises every feature described in this guide: all seven reserved state fields, all standard Companion action IDs, four render layouts, a full five-section control page, and live clock ticking. Read it alongside this guide to see each concept applied.

`demo-scores` keeps a hand-written `control.html` on purpose, as the worked example of that style. For the declarative style — the one you should start from — read `demo-packages/template-overlay/` and `demo-packages/template-timer/`: neither contains any control HTML at all, and both get a complete operator panel (including transport, a clock, an array-editing textarea and a live "Look" group) from `controls` alone.

To sideload it: copy the `demo-scores/` directory into your user packages folder, hit Rescan, and you're running.
