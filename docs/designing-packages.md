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

### Text fit & overflow warnings

A name typed into a control panel is not length-limited. Long names break lower thirds the same way every time: the text keeps growing past its box until something gives. The wrong fix is a silent ellipsis — a truncated name on air that nobody notices until after the show. The right fix is to condense the text as far as looks good, and if that still is not enough, leave it **visibly overflowing** so whoever is watching the control page sees the problem before they take the graphic.

Mark an element and the shared runtime does the rest — no page-specific JavaScript:

```html
<div class="name" data-fit data-fit-max="620" data-fit-min="0.62">Bartholomew Featherstonehaugh</div>
```

| Attribute | Default | Meaning |
|---|---|---|
| `data-fit` | — | Opt in. An optional value names the field in the warning message (falls back to the element's `id`, then its first class). |
| `data-fit-max` | the element's own current width | Max width in CSS px the text must fit inside |
| `data-fit-min` | `0.5` | Floor ratio for condensing — never goes narrower/smaller than this |
| `data-fit-mode` | `condense` | `condense` scales the element horizontally (`transform: scaleX(...)`); `shrink` scales `font-size` instead |

The element must have `white-space: nowrap` in your own CSS — the engine measures a single line's natural width, the same way the browser would if nothing were clipping it.

What happens as text grows:

1. **Fits** — nothing changes.
2. **Too wide, but condensing to `data-fit-min` or above closes the gap** — that exact ratio is applied. No warning.
3. **Still too wide at the floor** — the floor ratio is applied anyway, the text is left **overflowing rather than ellipsized**, and a warning is raised.

`transform-origin` (for `condense` mode) follows the element's own `text-align`, so a right-aligned card condenses toward its own edge instead of drifting off its panel.

Measurement re-runs when text changes, when the element (or an ancestor affecting its size) resizes, and again once `document.fonts.ready` resolves — a graphic that measures against a fallback font and then swaps to the real webfont can still fail once the real metrics land, and this catches it. All of that is batched into one pass per animation frame, however many changes fire in between.

**Seeing the warning.** A render page in `?debug=1` shows it immediately via the debug overlay (spec 21's `window.PConAir.warn()` — wired automatically, nothing to call yourself). On a control page, drop in the live panel:

```html
<div id="fit-warnings"></div>
<script>
  window.PConAir.warningsPanel(document.getElementById('fit-warnings'), client);
  // Or scope it to one render when your package has several:
  // window.PConAir.warningsPanel(el, client, { renderId: 'l3' });
</script>
```

It renders nothing when there are nothing to show, and one line per warning otherwise: `name — "Bartholomew Featherstonehaugh" is 738px in a 620px box (min scale 0.62)`. Warnings clear themselves as soon as the text is fixed, and when the reporting render's last output disconnects — a warning from a browser source that closed five minutes ago is noise, not a fact worth keeping.

Under the hood: the render page POSTs its current warning set to `POST /api/packages/:id/warnings` whenever it changes; the server holds it in memory only (never persisted — same lifetime rule as presence) and pushes a `{type:'warnings'}` frame to every control page subscribed to that package, the same broadcast path presence uses. `GET /api/packages/:id/warnings` (operator auth) returns the whole map, so a control page opened after the fact is correct immediately rather than waiting for the next change.

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

### Live preview

An operator driving a graphic from a control page usually can't see the
render itself — it's on a second display, in OBS, or on a switcher output
down the hall. `window.PConAir.preview` drops in a genuinely live, correctly
scaled preview so the control page shows what the audience actually sees,
not a guess:

```html
<div id="preview"></div>
<script>
  const preview = window.PConAir.preview(document.getElementById('preview'), {
    packageId: 'my-package',
    renderId: 'main', // which render (from your manifest) to show
    width: 480,        // CSS px; height is derived at 16:9
  });
</script>
```

It mounts an `<iframe>` pointed at the render's own page
(`?scale=contain&bg=<backdrop>&preview=1`) and scales the **frame element**,
never the page inside it — the framed graphic always lays out at exactly
1920×1080, so nothing reflows or rewraps versus the real, full-size render.
There is no separate capture/screenshot path: the iframe runs the identical
render page code, over the identical WebSocket, so whatever you change in
the control page appears in the preview at the same instant it appears on
air.

**A preview never counts as an output.** The `preview=1` param it adds is
stripped from presence and `delivered` server-side — opening a preview must
never make "is anything actually listening" lie. This is automatic; you
don't need to do anything extra to get it.

`preview(el, opts)` returns:

| Method | Meaning |
|---|---|
| `setRender(renderId)` | Swap which render the preview shows (e.g. from a `<select>`), keeping the current backdrop. |
| `setBackdrop(name)` | `'checker'` (default, shows transparency), `'black'`, `'white'`, or `'green'`. Persisted per-viewer in `localStorage`, so it survives a control-page reload. |
| `reload()` | Reload just the framed page — for recovering a render that's wedged on bad state, without losing the operator's place on the control page. |
| `destroy()` | Tear down the preview (DOM, presence subscription, socket) if you remove it without reloading the whole page. |

If your package has more than one render, wire a selector to `setRender`
rather than mounting several previews side by side — see
`bundled-packages/news/control.html` for a working example with three
renders.

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
- [ ] Drop in `window.PConAir.preview(el, { packageId, renderId })` so the control page shows what's actually on air
- [ ] Add `companionActions` for anything Companion should be able to trigger
- [ ] Hit **Rescan** in `/remote/packages`
- [ ] Load the render URL (`/packages/my-package/render`) as an OBS Browser Source
- [ ] Open the control page (`/packages/my-package/control`) in a browser tab

---

## Reference: `demo-scores` package

The `demo-scores` package in `demo-packages/demo-scores/` is a working template that exercises every feature described in this guide: all seven reserved state fields, all standard Companion action IDs, four render layouts, a full five-section control page, and live clock ticking. Read it alongside this guide to see each concept applied.

To sideload it: copy the `demo-scores/` directory into your user packages folder, hit Rescan, and you're running.
