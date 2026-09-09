# Spec 14 — Package Control Runtime

**Status:** Planned · **Date:** 2026-09-09 · **Wave:** 0 (gate — nothing runs alongside this)
**Model:** `claude-opus-5` · **Depends on:** — · **Branch:** `feat/graphics-14-package-control-runtime`
**Umbrella:** [`../plan_approved.md`](../plan_approved.md)

---

## 1. Why

Every graphics package ships a byte-identical copy of `assets/state.js` — six copies, md5 `b327526b897f7ad847515345621d9765`. A fix to reconnect behaviour has to be applied six times, and a seventh package starts by copy-pasting a seventh.

Worse, that file is only a *state* client. Specs 15–23 each need render pages and control pages to also know about transport, presence, debug, text fit and clocks. Without a shared home, each of those specs would fan out into six more copy-pasted files.

This spec creates that home: **one served, versioned runtime** that every render and control page loads, with a public API the other nine specs are written against. It is the gate for the whole plan.

## 2. What already exists — do not rebuild

- **`src/main/packages/loader.ts`** — `PackageManifest`, `validateManifest`, `scanPackagesDir`, `defaultStateFromSchema`. Manifest already has `renders`, `stateSchema`, `initialState`, `transientFields`, and the `companion*` declarations.
- **`src/main/packages/state-hub.ts`** — namespace pub/sub, persistence, `mergeSaved`, `resetPath`. This is the state engine. Do not write another.
- **`src/main/routes/packages.ts`** — `GET/POST /api/packages/:id/state`, `GET /packages/:id/render/:renderId`, `GET /packages/:id/control`, `GET /packages/:id/assets/*`, asset upload.
- **`src/main/server.ts:388-440`** — WS `connection` handler with `{type:'subscribe', namespace:'package:<id>'}` pub/sub, and `verifyClient` allowing cookie-less `?render=1` / `?companion=1` / `?graphics=1`.
- **`bundled-packages/*/assets/state.js`** — the thing being replaced. Read it before you delete it; its reconnect-and-rehydrate behaviour is correct and must be preserved.

## 3. Design

### 3.1 Where the runtime lives and how it is served

Create `src/runtime/` in the repo, served read-only at `/packages/_runtime/`:

```
src/runtime/
  pconair.js        — the runtime (single file, ES5-safe, no modules, no build step)
  pconair.css       — control-panel base styling (used from spec 18 onward)
```

Served by a new static mount in `src/main/routes/index.ts`, alongside the existing `/graphics` mount:

```ts
// Shared package runtime — public, no auth, same trust level as /graphics.
if (s.runtimeRoot) {
  app.use('/packages/_runtime', express.static(s.runtimeRoot, { index: false, fallthrough: false }));
}
```

`runtimeRoot` joins `RouteServices` next to the existing `graphicsRoot` (`routes/index.ts:49`), and is resolved in `src/main/index.ts` the same way `graphicsRoot` is (`index.ts:258`):

```ts
runtimeRoot: app.isPackaged
  ? path.join(process.resourcesPath, 'runtime')
  : path.join(app.getAppPath(), 'src', 'runtime'),
```

Add `src/runtime` to `extraResource` in `forge.config.ts` so it exists in the packaged app, mirroring how `graphics` is already wired.

**Reserve the id `_runtime`.** `validateManifest` already enforces `ID_PATTERN = /^[a-z0-9][a-z0-9-_]*$/`, which rejects a leading underscore, so `/packages/_runtime` cannot collide with a package. Add a test asserting that.

### 3.2 Public API

This is the contract specs 15–23 are written against. Namespacing is flat under `window.PConAir`.

```js
window.PConAir = {
  version: '1',

  /**
   * Connect to a package namespace. Replaces PConAirPackage.connect.
   * Rehydrates on every (re)connect; a browser-source reload is harmless.
   */
  connect(packageId, opts) -> Client,

  /** Read ?key=value from the page URL, with a default. */
  param(key, fallback) -> string,

  /** true when the page URL carries ?debug=1. Consumed by spec 21. */
  isDebug() -> boolean,

  /** Register a callback for spec 21's overlay to sample. */
  _diagSource(name, fn) -> void,
};
```

`Client`:

```js
{
  /** Latest state for the namespace, or null before first frame. */
  state: object|null,

  /** Shallow-merge patch via POST /api/packages/<id>/state. Resolves to the
      parsed response body, which from spec 16 onward includes `delivered`. */
  patch(partial) -> Promise<object>,

  /** Subscribe to state frames. Fires immediately if state is already known.
      Returns an unsubscribe function. */
  on(fn) -> (() => void),

  /** Connection state of this client's own socket. */
  connected: boolean,

  /** Subscribe to connection-state changes. Returns an unsubscribe function. */
  onConnection(fn) -> (() => void),

  close() -> void,
}
```

`opts`:

| Key | Default | Meaning |
|---|---|---|
| `role` | `'render'` | `'render'` or `'control'`. Selects the WS query flag (`?render=1`) and, from spec 16, registers the page in the presence registry. |
| `renderId` | `null` | Which render this page is. Required for `role: 'render'` from spec 16 onward; ignored today. Pass it now so spec 16 needs no page edits. |
| `onState` | `null` | Convenience — equivalent to calling `.on(fn)` immediately. |

### 3.3 Behaviour that must be preserved from `state.js`

- Protocol chosen from `location.protocol` (`wss:` on https).
- Subscribe frame `{type:'subscribe', namespace:'package:<id>'}` sent on open.
- Only frames matching `msg.type === 'state' && msg.namespace === namespace && msg.state` are dispatched. The initial `AppState` snapshot uses `payload` and must be ignored.
- `onclose` → reconnect after 2000 ms. `onerror` → close and let `onclose` handle it.
- `close()` sets a `closed` flag so the reconnect timer does not resurrect the socket.

### 3.4 Additions over `state.js`

- **Exponential backoff with a cap.** 2s is fine for the first retry but hammers a stopped server. Back off 1s → 2s → 4s → 8s → capped at 15s, reset to 1s on a successful open. A control page left open overnight against a stopped app currently generates 1,800 connection attempts an hour.
- **`connected` + `onConnection`.** Spec 16's presence LED and spec 21's debug overlay both need to distinguish "no output connected" from "my own socket is down", and today no page can tell.
- **`role: 'control'`.** Control pages currently connect as `?render=1`, which is a lie that spec 16's presence counting would turn into a phantom output. Control pages get `?control=1`; add it to the cookie-less allowlist in `server.ts` `verifyClient` next to `render` and `companion`, with the same IP-allowlist and no-tunnel rules.
- **`patch()` returns the parsed body**, not the raw `Response`. Callers today ignore the return; specs 16 and 22 need `delivered` and `warnings` out of it.

### 3.5 Files

**Create**
- `src/runtime/pconair.js`
- `src/runtime/pconair.css` — empty-but-present base sheet with the CSS custom properties spec 18 will fill (`--pc-bg`, `--pc-fg`, `--pc-accent`, `--pc-danger`, `--pc-ok`, `--pc-gap`). Ship the tokens now so later specs do not renegotiate them.
- `tests/package-runtime.test.ts`
- `scripts/run-wave.sh` (from `plan_approved.md` §Running it from the CLI)

**Modify**
- `src/main/routes/index.ts` — add `runtimeRoot` to `RouteServices`, add the static mount.
- `src/main/index.ts` — resolve `runtimeRoot` for dev and packaged.
- `src/main/server.ts` — accept `?control=1` as a cookie-less role in `verifyClient`.
- `tests/_test-server.ts` — add `runtimeRoot?: string` to `FullServerTestOpts` and thread it through, defaulting to the repo's `src/runtime`.
- `forge.config.ts` — add `src/runtime` to `extraResource`.
- `bundled-packages/{hoops,news,ffg}/control.html` — swap the script tag and the `PConAirPackage.connect` call.
- `bundled-packages/{hoops,news,ffg}/render*.html` — same.
- `demo-packages/{demo-scores,template-overlay,template-timer}/control.html` and `renders/*.html` — same.

**Delete** (last task, only once every page is migrated and tests are green)
- `bundled-packages/{hoops,news,ffg}/assets/state.js`
- `demo-packages/{demo-scores,template-overlay,template-timer}/assets/state.js`

### 3.6 Migration shim

`state.js` is deleted in this spec, but a package installed by a user from outside the repo may still reference it. At the bottom of `pconair.js`, define a compatibility shim and keep it until a major version:

```js
window.PConAirPackage = {
  connect: function (packageId, onState) {
    var c = window.PConAir.connect(packageId, { onState: onState });
    return { patch: c.patch, close: c.close };
  },
};
```

A third-party page loading the *old path* `/packages/<id>/assets/state.js` will 404. That is acceptable and expected — note it in `docs/designing-packages.md`.

## 4. Tasks

Each task: failing test → confirm it fails → minimal implementation → full suite → commit.

- [ ] **T1 — Serve the runtime.** Test: `GET /packages/_runtime/pconair.js` returns 200 with `application/javascript`; `GET /packages/_runtime/../../package.json` does not escape the mount. Add `runtimeRoot` to `RouteServices`, `src/main/index.ts`, `tests/_test-server.ts`, `forge.config.ts`. Commit.
- [ ] **T2 — Reserved id.** Test: `validateManifest({id: '_runtime', …})` returns `{ok: false}`. Assert it holds via the existing `ID_PATTERN`; add the test even if no code change is needed. Commit.
- [ ] **T3 — `?control=1` role.** Test in `tests/websocket.test.ts` style: a cookie-less WS connect with `?control=1` from an allowlisted IP succeeds; the same via a `cf-ray` header is rejected. Modify `server.ts` `verifyClient`. Commit.
- [ ] **T4 — Runtime core.** Write `src/runtime/pconair.js` with `connect`, `param`, `isDebug`, `_diagSource` and the `Client` surface in §3.2. Test it in `tests/package-runtime.test.ts` under jsdom (`// @vitest-environment jsdom`) with a stub `WebSocket`: asserts subscribe frame shape, that `payload`-shaped frames are ignored, that `on()` fires immediately when state is already known, and that `close()` prevents reconnect. Commit.
- [ ] **T5 — Backoff.** Test with fake timers: closes at 1s, 2s, 4s, 8s, 15s, 15s; a successful open resets the next delay to 1s. Commit.
- [ ] **T6 — Connection callbacks.** Test: `connected` is false before open, true after, false after close; `onConnection` fires on each edge and its unsubscribe stops delivery. Commit.
- [ ] **T7 — `patch()` returns parsed body.** Test with a stub `fetch`: resolves to the decoded JSON, and a non-2xx response rejects with an `Error` carrying the response body's `message` when present. Commit.
- [ ] **T8 — Base stylesheet.** Create `src/runtime/pconair.css` with the six custom properties in §3.5 defined on `:root`, plus a dark default. Test: served 200 as `text/css`. Commit.
- [ ] **T9 — Migrate the six packages.** Point every render and control page at `/packages/_runtime/pconair.js` and `window.PConAir.connect(id, {role, renderId})`. Control pages pass `role: 'control'`; render pages pass `role: 'render'` and their manifest `renderId`. Test: a filesystem assertion in `tests/package-runtime.test.ts` that no file under `bundled-packages/` or `demo-packages/` contains the string `PConAirPackage.connect` or `assets/state.js`. Commit.
- [ ] **T10 — Delete the duplicates.** Remove all six `assets/state.js`. Run the full suite. Add the shim from §3.6. Commit.
- [ ] **T11 — Docs + wave script.** Update `docs/designing-packages.md` and `docs/package-graphics-standard.md` to document the runtime API and the removed path. Create `scripts/run-wave.sh` per `plan_approved.md`. Commit.

## 5. Acceptance

- [ ] `GET /packages/_runtime/pconair.js` and `…/pconair.css` return 200 in dev and from a packaged build.
- [ ] `grep -r "assets/state.js" bundled-packages demo-packages` returns nothing.
- [ ] `find . -name state.js -path '*packages*'` returns nothing.
- [ ] `hoops`, `news` and `ffg` control pages drive their renders exactly as before — verified by loading each control page and its render side by side and changing a field.
- [ ] Killing the server for 60s and restarting it: an open render page reconnects and rehydrates, with visibly widening gaps between attempts, not one every 2s.
- [ ] `npm run typecheck && npm test` green.

## 6. Out of scope

Transport verbs (spec 15), presence counting (spec 16), the debug overlay itself (spec 21 — this spec only ships the `isDebug`/`_diagSource` hooks), the control schema (spec 18). Do not add fields to `PackageManifest` beyond what §3 names.
