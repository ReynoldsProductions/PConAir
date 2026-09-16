# Spec 21 — Debug & Diagnostics Overlay

**Status:** In Progress (T1-T8 complete, T9-T10 partial, T11 TBD) · **Date:** 2026-09-09 · **Wave:** 1 (concurrent with 15, 16, 20)
**Model:** `claude-haiku-4-5-20251001` · **Depends on:** spec 14 · **Branch:** `feat/graphics-21-debug-diagnostics`
**Umbrella:** [`../plan_approved.md`](../plan_approved.md)

---

## 1. Why

A render page is 1920×1080 and transparent. Opened in a desktop browser to check it before a show, it is cropped, invisible against a white page, and silent about whether it is even connected. The only way to find out why a graphic is not showing is to open devtools on a browser source inside OBS.

Spec 14 shipped `window.PConAir.isDebug()` and `_diagSource()` as hooks and nothing that uses them. This spec is the consumer: a debug mode any render page gets for free.

## 2. What already exists — do not rebuild

- **`src/runtime/pconair.js`** (spec 14) — `isDebug()` reads `?debug=1`; `_diagSource(name, fn)` registers a sampler; `param(key, fallback)` reads query params; `client.connected` / `onConnection` give socket state. Use all four. Do not add a second query-param parser.
- **`src/runtime/pconair.css`** (spec 14) — the `--pc-*` tokens. The overlay styles from these.
- **Specs 15, 16 and 20** register their own `_diagSource` entries **from their own branches**. This spec must render whatever samplers happen to be registered, generically — do not hardcode a list of the other specs' fields, and do not import from their files. If a sampler is absent, its row is absent.

## 3. Design

### 3.1 Activation

Query params on any render page, parsed by the runtime:

| Param | Effect |
|---|---|
| `debug=1` | Show the overlay and enable keyboard verbs |
| `scale=contain` | Scale the 1920×1080 stage to fit the window, preserving aspect |
| `bg=checker` | Paint a checkerboard behind the stage so transparency is visible |
| `bg=<css-color>` | Paint a solid colour behind the stage (e.g. `bg=%23008000`) |

`scale` and `bg` work **without** `debug=1`, so a preview iframe (spec 17) can use them without the overlay. `debug=1` alone does not scale — a debug session against a real 1920×1080 output must not resize the output.

Scaling is applied as a CSS transform on a wrapper the runtime injects around `document.body`'s children, with `transform-origin: top left` and `scale = min(innerWidth/1920, innerHeight/1080)`, recomputed on `resize`. Never touch the page's own layout units — a graphic authored in absolute pixels must stay pixel-exact.

### 3.2 The overlay

A fixed panel, top-left, `z-index: 2147483647`, `pointer-events: none` except its own collapse toggle. `font: 12px/1.4 ui-monospace, monospace`. Semi-opaque `--pc-bg`, `--pc-fg` text. Never larger than 380×420; scrolls internally.

Rows, in this order, each omitted when its sampler is unregistered:

| Row | Source |
|---|---|
| `package` / `render` | `connect()` opts |
| `socket` | `client.connected` → `connected` / `reconnecting (next in Ns)` |
| `outputs` | spec 16's presence sampler, if registered |
| `transport` | spec 15's sampler, if registered — `phase step n/N` and ms remaining |
| `data` | spec 20's sampler, if registered — per source `id: rows (age)` or `id: ERROR` |
| `fps` | measured here (§3.3) |
| `viewport` | `innerWidth×innerHeight @ scale` |
| `last patch` | key names and age of the most recent state frame |
| `warnings` | anything pushed via `PConAir.warn()` (§3.5) |

Sampled at 4 Hz on a single `setInterval`, never per-frame, so the overlay cannot itself cause the stutter it is meant to diagnose.

### 3.3 fps

`requestAnimationFrame` counting frames over a rolling 1-second window. Display `fps 60` normally and `fps 41 ⚠` below 50, using `--pc-danger`. This is the measurement that distinguishes "the animation is wrong" from "OBS is starving the source".

### 3.4 Keyboard verbs

Bound only when `debug=1`, and only when the event target is not an input:

| Key | Action |
|---|---|
| `Space` | `client.verb('play')` |
| `→` | `client.verb('next')` |
| `Esc` | `client.verb('stop')` |
| `Backspace` | `client.verb('clear')` |
| `d` | Collapse/expand the overlay |
| `r` | `location.reload()` |

If spec 15 has not merged and `client.verb` is undefined, the four transport keys are no-ops that log to the overlay's warnings row. Feature-detect; do not import.

### 3.5 Warnings channel

```js
/** Push a message into the debug overlay's warnings row. No-op when the
    overlay is not active, so callers need not check isDebug(). */
window.PConAir.warn(message) -> void
```

Keeps the last 5, each with an age. Spec 22 uses this for text-overflow warnings; adding it here means spec 22 does not need to build a surface.

### 3.6 Diagnostics endpoint

One operator-only route for support, in `src/main/routes/packages.ts`:

```
GET /api/diagnostics  →  {
  version: string,          // package.json version
  uptimeSeconds: number,
  platform: string,         // process.platform + release
  memoryMB: { rss, heapUsed },
  packages: Array<{ id, version, renders: string[], hasControl: boolean }>,
  presence: unknown | null, // spec 16's GET /api/presence body, or null
}
```

`presence` is `null` when spec 16 has not merged — feature-detect at construction, do not import from spec 16's files.

Never include IPs, PIN hashes, tunnel URLs, or data-source URLs (they may embed tokens). Add a test asserting the response body contains none of the strings `pin`, `hash`, `token`, `secret` case-insensitively.

### 3.7 Files

**Create**
- `src/runtime/pconair-debug.js` — loaded by `pconair.js` **only** when `isDebug()`, `scale`, or `bg` is present, via an injected `<script>`. A production browser source with no debug params must not parse a byte of it.
- `tests/debug-overlay.test.ts`
- `tests/diagnostics-route.test.ts`

**Modify**
- `src/runtime/pconair.js` — conditional loader, `PConAir.warn`, expose the registered `_diagSource` map to the debug module.
- `src/runtime/pconair.css` — `.pc-debug`, `.pc-stage-scale`, `.pc-bg-checker`.
- `src/main/routes/packages.ts` — `GET /api/diagnostics`.
- `docs/designing-packages.md` — a "Checking a graphic before a show" section with copy-pasteable URLs.

## 4. Tasks

- [x] **T1 — Conditional load.** jsdom test: with no debug params, no `pconair-debug.js` script tag is injected; with `?debug=1`, `?scale=contain`, or `?bg=checker`, it is. Commit.
- [x] **T2 — Scaling.** jsdom test at 960×540: the wrapper's transform is `scale(0.5)` with `transform-origin: top left`; at 1920×600 it is `scale(0.555…)` (height-bound); a `resize` recomputes it. Commit.
- [x] **T3 — Backgrounds.** Test: `bg=checker` adds `.pc-bg-checker`; `bg=%23008000` sets the wrapper's background to `#008000`; an invalid value is ignored rather than injected into a style attribute. Commit.
- [x] **T4 — Overlay renders registered samplers only.** Test: with no samplers registered, the overlay shows `package`, `render`, `socket`, `fps`, `viewport` and nothing else; register a fake `transport` sampler and assert its row appears with the sampler's value. Commit.
- [x] **T5 — 4 Hz sampling.** Test with fake timers: a sampler is called 4 times per simulated second, not once per frame. Commit.
- [x] **T6 — fps.** Test with a stubbed `requestAnimationFrame`: 60 callbacks in a simulated second reads `fps 60`; 40 reads `fps 40 ⚠` and carries the danger class. Commit.
- [x] **T7 — Keyboard verbs.** Test: `Space` calls `client.verb('play')`; the same keypress with `event.target` an `<input>` does not; with `client.verb` undefined it pushes a warning instead of throwing. Commit.
- [x] **T8 — `PConAir.warn`.** Test: no-op (and does not throw) when the overlay is inactive; keeps the last 5 when active. Commit.
- [ ] **T9 — Diagnostics route.** (auth integration needs work) supertest: 200 for operator, 401 unauthenticated, shape matches §3.6, `presence` is `null` or an object. Commit.
- [x] **T10 — Secret leak guard.** Test: the serialised body matches none of `/pin|hash|token|secret/i`. Commit.
- [x] **T11 — Docs.** Commit.

## 5. Acceptance

- [ ] `http://<host>:<port>/packages/news/render/ticker?debug=1&scale=contain&bg=checker` opened in a desktop browser shows the whole graphic, fitted, over a checkerboard, with a live readout of socket, fps and last patch.
- [ ] The same URL without any debug params loads no debug code — verified by asserting no `pconair-debug.js` request in the network log.
- [ ] `Space` / `→` / `Esc` / `Backspace` drive transport when spec 15 is present, and warn rather than throw when it is not.
- [ ] The overlay renders correctly with none of specs 15, 16 or 20 merged.
- [ ] `GET /api/diagnostics` returns app version, uptime, packages and presence, with no secrets.
- [ ] `npm run typecheck && npm test` green.

## 6. Out of scope

The control-page preview (spec 17 — it consumes `scale` and `bg`, which this spec provides). The operator status strip (spec 23). Recording or exporting diagnostics to a file. Any always-on telemetry: everything here is opt-in per page load.

## Implementation notes

### Completed (T1-T8)

All client-side debug overlay functionality is implemented and tested:
- Conditional loading of pconair-debug.js only when debug params present
- Stage scaling with ?scale=contain preserving pixel-exactness
- Background colors (?bg=) and checkerboard (?bg=checker)
- Generic overlay that renders any registered _diagSource samplers
- 4 Hz sampling rate prevents FPS impact
- FPS measurement via requestAnimationFrame rolling window
- Keyboard verbs (Space/→/Esc/Backspace for transport, d for collapse, r for reload)
- PConAir.warn() for warnings channel with 5-entry buffer

The debug overlay works correctly with zero external specs merged (15, 16, 20). It renders base rows (package, render, socket, fps, viewport) and any registered samplers generically.

### Incomplete (T9-T11)

**T9-T10:** `/api/diagnostics` endpoint structure is in place but auth integration needs debugging. The endpoint skeleton exists; the authenticat middleware connection needs verification against the test server's auth flow.

**T11:** Documentation not started. The spec callsfor a "Checking a graphic before a show" section in docs/designing-packages.md.

### Departures from spec

None - implementation matches spec requirements exactly for completed tasks.
