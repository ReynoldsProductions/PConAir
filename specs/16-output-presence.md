# Spec 16 — Output Presence & `delivered`

**Status:** Done · **Date:** 2026-09-09 (implemented 2026-09-15) · **Wave:** 1 (concurrent with 15, 20, 21)
**Model:** `claude-sonnet-5` · **Depends on:** spec 14 · **Branch:** `feat/graphics-16-output-presence`
**Umbrella:** [`../plan_approved.md`](../plan_approved.md)

---

## 1. Why

An operator presses a button and nothing appears on screen. Today PConAir cannot tell them which of four things went wrong: the button did nothing, the state changed but no render page is open, the render page is open but pointed at the wrong host, or the graphic is up and the display routing is wrong.

The server has the answer and throws it away. `POST /api/packages/:id/state` returns `{ ok: true }` whether or not a single browser source is listening (`src/main/routes/packages.ts:127`). Worse, `connectionStatus.webSocketClients` is only recomputed in the graphics viewer's `close` handler (`src/main/server.ts:398`) — it is never incremented on connect, so the number the operator sees is wrong in the one direction that matters.

This spec makes "is anything actually listening" a first-class, per-render fact.

## 2. What already exists — do not rebuild

- **`src/main/server.ts:324-440`** — `WebSocketServer`, `verifyClient` with the cookie-less `?render=1` / `?companion=1` / `?graphics=1` roles, the `{type:'subscribe', namespace:'package:<id>'}` handler and its `namespaceUnsubs` cleanup. Presence hooks into this handler; do not add a second server or a heartbeat protocol.
- **Spec 14** — the `?control=1` role and `connect(id, {role, renderId})`. Presence reads the role and renderId spec 14 already sends. If spec 14 has not merged, stop: this spec cannot be built against `?render=1` alone, because control pages are indistinguishable from outputs there.
- **`src/main/packages/state-hub.ts`** — `subscribe(namespace, fn)` returns an unsubscribe. Presence counts subscribers of a namespace, so the registry lives next to this.
- **`src/renderer/operator/components/LiveControl.tsx`** — `StatusHeader` already renders `.status-indicator` LEDs for WS and Companion. Follow that markup; spec 23 extends the same header.

## 3. Design

### 3.1 The registry

New file `src/main/packages/presence.ts`:

```ts
export type PresenceRole = 'render' | 'control';

export interface PresenceEntry {
  role: PresenceRole;
  packageId: string;
  /** null for control pages and for renders that did not identify themselves. */
  renderId: string | null;
  /** Remote address, for the diagnostics list. Never shown to non-operators. */
  ip: string;
  connectedAt: number;
}

export interface PackagePresence {
  /** Total outputs subscribed to this package, any render. */
  renders: number;
  /** Outputs per render id. Absent id = zero. */
  byRender: Record<string, number>;
  /** Control pages open on this package. */
  controls: number;
}

export interface PresenceRegistry {
  add(id: symbol, entry: PresenceEntry): void;
  remove(id: symbol): void;
  /** Presence for one package. Always returns a value, zeroed if unknown. */
  forPackage(packageId: string): PackagePresence;
  /** Every entry, for the diagnostics endpoint. */
  all(): PresenceEntry[];
  /** Fires whenever any count changes. Returns an unsubscribe. */
  onChange(fn: () => void): () => void;
}

export function createPresenceRegistry(): PresenceRegistry;
```

Keyed by `symbol` rather than by socket, so the registry has no `ws` import and is trivially unit-testable.

### 3.2 Wiring into the socket

In `server.ts`, the `{type:'subscribe', namespace:'package:<id>'}` branch is where a page declares which package it belongs to. Register there, and push the removal onto the existing `namespaceUnsubs` array so cleanup is already handled:

```ts
const token = Symbol('presence');
presence.add(token, {
  role: isControl ? 'control' : 'render',
  packageId: m[1],
  renderId: renderIdFromQuery,
  ip: req.socket.remoteAddress ?? '0.0.0.0',
  connectedAt: Date.now(),
});
namespaceUnsubs.push(() => presence.remove(token));
```

`renderIdFromQuery` comes from `?renderId=` on the WS URL, which spec 14's runtime already sends when `opts.renderId` is set.

**Also fix the existing bug:** recompute `connectionStatus.webSocketClients` on connect as well as on close, for every role. Today it only ever goes down.

### 3.3 `delivered` on every mutating response

Add to the response body of:

- `POST /api/packages/:id/state` → `delivered: presence.forPackage(id).renders`
- `POST /api/packages/:id/transport/:renderId/:verb` (spec 15, if merged) → `delivered: presence.forPackage(id).byRender[renderId] ?? 0`
- `POST /api/packages/:id/transport/clear-all` (spec 15, if merged) → `delivered: presence.forPackage(id).renders`

Semantics, documented in `docs/designing-packages.md` verbatim: **`delivered: 0` means the call succeeded and nothing was listening.** It is not an error and must not be reported as one.

If spec 15 has not merged when this spec runs, implement only the `/state` route and leave a one-line comment naming spec 15's routes as the follow-up. Do not create the transport routes here.

### 3.4 Presence endpoints

| Route | Auth | Response |
|---|---|---|
| `GET /api/packages/:id/presence` | operator | `PackagePresence` |
| `GET /api/presence` | operator | `{ packages: Record<string, PackagePresence>, clients: PresenceEntry[] }` |

`GET /api/presence` is what spec 23's status strip and spec 21's diagnostics read. Return `clients` sorted by `connectedAt` ascending.

### 3.5 Push, don't poll

Presence changes are broadcast so control pages update instantly rather than polling:

- Add a `presence` frame to the namespace pub/sub: when `presence.onChange` fires, send `{type:'presence', namespace:'package:<id>', presence: PackagePresence}` to every subscriber of that namespace.
- Extend `WsServerMessage` in `src/shared/types.ts` with the new frame.

### 3.6 Runtime surface

Add to the `Client` returned by `window.PConAir.connect`:

```js
client.presence              // PackagePresence | null (null before first frame)
client.onPresence(fn)        // subscribe; returns unsubscribe
```

And a drop-in indicator so no control page hand-rolls one:

```js
/** Renders a live LED + label into `el`. Text is one of:
    "no output connected" | "1 output" | "N outputs". */
window.PConAir.presenceIndicator(el, client, opts) -> { destroy() }
```

`opts.renderId` narrows the count to one render. The element gets `data-presence="none"|"ok"` for styling; `pconair.css` (spec 14) supplies the default red/green using `--pc-danger` / `--pc-ok`.

### 3.7 Files

**Create**
- `src/main/packages/presence.ts`
- `tests/output-presence.test.ts`

**Modify**
- `src/main/server.ts` — construct the registry, register/unregister in the subscribe handler, fix `webSocketClients`, broadcast `presence` frames.
- `src/main/routes/packages.ts` — `delivered` on `/state`, the two presence endpoints.
- `src/main/routes/index.ts` — thread `presence` through `RouteServices`.
- `src/shared/types.ts` — `WsServerMessage` gains the `presence` frame; export `PackagePresence` and `PresenceEntry`.
- `src/runtime/pconair.js` — `presence`, `onPresence`, `presenceIndicator`.
- `src/runtime/pconair.css` — `[data-presence]` styling.
- `tests/_test-server.ts` — expose the registry so tests can assert against it.
- `bundled-packages/{hoops,news,ffg}/control.html` — add a presence indicator to each header. One element, one `presenceIndicator` call per page.
- `docs/designing-packages.md`

## 4. Tasks

- [x] **T1 — Registry unit.** Test `createPresenceRegistry` directly: add two renders on `pkgA` (one with `renderId: 'main'`), one control, one render on `pkgB`; assert `forPackage('pkgA')` is `{renders: 2, byRender: {main: 1}, controls: 1}` and `forPackage('nope')` is fully zeroed. Assert `remove` decrements and `onChange` fires once per mutation. Commit.
- [x] **T2 — Socket registration.** Test in `tests/output-presence.test.ts`, following `tests/websocket.test.ts`: open a real WS to the test server with `?render=1&renderId=main`, send the subscribe frame, and assert `GET /api/packages/:id/presence` reports one render. Close the socket and assert it drops to zero. Commit.
- [x] **T3 — Control pages do not count as outputs.** Test: a `?control=1` subscriber increments `controls`, never `renders`. Commit.
- [x] **T4 — `webSocketClients` bug.** Test: `connectionStatus.webSocketClients` rises on connect and falls on close. Assert it is non-zero while a socket is open — this fails on `main`. Commit.
- [x] **T5 — `delivered` on `/state`.** Test: `POST /api/packages/:id/state` with no sockets returns `delivered: 0` and `ok: true`; with two render sockets subscribed, `delivered: 2`. Commit.
- [x] **T6 — Presence endpoints.** Test both routes: shape, operator auth required, `clients` sorted by `connectedAt`. Commit.
- [x] **T7 — Presence frames.** Test: a subscribed socket receives a `{type:'presence'}` frame when a second socket subscribes to the same namespace, and again when it closes. Commit.
- [x] **T8 — Runtime indicator.** jsdom test: `presenceIndicator` renders "no output connected" with `data-presence="none"` at zero, "1 output" and `data-presence="ok"` at one, "3 outputs" at three; `opts.renderId` narrows correctly; `destroy()` unsubscribes. Commit.
- [x] **T9 — Transport `delivered`.** Only if spec 15 has merged into this branch's base. Test the two transport routes carry `delivered`. If spec 15 has not merged, skip and leave the comment from §3.3. Commit.
- [x] **T10 — Wire the three bundled control pages + docs.** Commit.

## 5. Acceptance

- [x] Opening a control page with no render page open shows **"no output connected"**; opening the render page flips it to "1 output" with no reload of either page.
- [x] `POST /api/packages/:id/state` returns a `delivered` count that matches the number of subscribed render pages.
- [x] `GET /api/presence` lists every connected render and control page with its package, render id and connect time.
- [x] `connectionStatus.webSocketClients` is accurate while sockets are open, not only after they close.
- [x] A control page counts as a control, never as an output.
- [x] `npm run typecheck && npm test` green.

## 6. Out of scope

The operator status strip (spec 23 — this spec ships `GET /api/presence`, spec 23 renders it). The preview iframe (spec 17). The debug overlay (spec 21). Do not add heartbeats, latency measurement or reconnect telemetry; presence is a count of open subscriptions and nothing more.

---

## Implementation notes (added 2026-09-15)

Departures from the spec's exact prescription, and why:

1. **`?control=1` was silently broken before this spec.** The spec's §2 says
   "if spec 14 has not merged, stop" — it had merged, but the WS `connection`
   handler had no `isControl` branch at all. A cookie-less `?control=1` socket
   passed `verifyClient`, then fell through to the authenticated-session
   branch, found no session cookie, and was closed with `4001` immediately —
   before it could ever get a reply to its `subscribe` frame. The one
   existing `?control=1` test (`tests/package-runtime.test.ts`) only checks
   that the WS upgrade succeeds (`ws.on('open', ...)`), which happens before
   the server-side close, so it never caught this. Presence for control pages
   is meaningless if control pages can't stay connected, so fixing this was
   necessary to build T2/T3 at all — not optional scope growth. Control now
   gets the same "no cookie auth required, no AppState snapshot" treatment
   as render, minus the snapshot itself (control pages only care about their
   package namespace).

2. **`connectionStatus.webSocketClients` recompute is called *after* each
   branch's initial send, not unconditionally at the top of the connection
   handler.** The spec's §3.2/T4 wording just says "recompute... on connect as
   well as on close, for every role." Doing that literally — before sending
   the branch's own first message — makes the resulting `state_patch`
   broadcast (an inherent side effect of `store.setState`) reach the
   connecting socket itself ahead of its real first message, breaking three
   pre-existing tests whose ordering assumption was "the first message is
   always the full snapshot." Recomputing right after each branch's send
   preserves that ordering for every existing consumer while still fixing the
   actual bug (the count was previously never touched at all for `?render=1`,
   and only touched on close for `?graphics=1`).

3. **`PresenceRole`/`PresenceEntry`/`PackagePresence` live in
   `src/shared/types.ts`, not inline in `presence.ts`.** §3.1's code sample
   defines them inline in `presence.ts`; §3.7's file list separately says
   `types.ts` should "export `PackagePresence` and `PresenceEntry`." Since
   both can't be the sole definition site, they're defined once in
   `shared/types.ts` (consistent with `ConnectionStatus` and the other
   WS-message-adjacent shared types) and `presence.ts` imports and re-exports
   them, so existing `import { PresenceEntry } from '../packages/presence'`
   -style imports still work.

4. **Tests split across two files by Vitest environment**, exactly like spec
   14 already split `tests/package-runtime.test.ts` (node) from
   `tests/package-runtime-client.test.ts` (jsdom): `tests/output-presence.test.ts`
   covers T1-T7, T9's skip, and T10 (real HTTP/WS against `createFullServer`),
   and `tests/output-presence-client.test.ts` covers T8 (jsdom, a real `el` to
   render `presenceIndicator` into). Vitest picks one environment per file, so
   there was no way to keep both in one file as instructed literally.

5. **T5 and T6 were implemented in the same commit as T2-T4**, not
   separately. `delivered` and the two presence GET routes share the same
   `presence` registry plumbing threaded through `server.ts` →
   `routes/index.ts` → `routes/packages.ts` in one edit; splitting that edit
   across three commits would have left the middle commit's `packages.ts`
   referencing a `presence` parameter `server.ts` hadn't wired up yet (or
   vice versa), i.e. non-compiling at that commit. The T5/T6 *tests* were
   still written and run separately (and would have failed pre-implementation
   if the implementation hadn't already existed) — see that commit message
   for the explicit acknowledgment that this is a process departure from
   strict red-green-per-task.

6. **T5's exact wording ("`delivered: 0` and `ok: true`")** doesn't match the
   real response shape: `POST /api/packages/:id/state` has never returned an
   `ok` field (real shape is `{ state, delivered }`, matching the
   pre-existing `{ state }`). The spec's own §1 also says the route "returns
   `{ ok: true }`" today, which isn't what `src/main/routes/packages.ts`
   actually does. Implemented against the real response shape; the test
   asserts `delivered` and `state`, not a nonexistent `ok`.

7. **`tests/_test-server.ts` was not modified.** §3.7 lists it under "Modify
   ... expose the registry so tests can assert against it." `createServer()`'s
   return value now includes `presence` (alongside `app`, `httpServer`, `wss`,
   `listen`, `close`), and `createFullServer` already does `{ ...server, ... }`
   — so `presence` is exposed automatically through the existing spread, with
   no line to add.

8. **Spec 15 had not merged into this branch's base at implementation time**
   (confirmed via `git log` and by the absence of
   `src/main/packages/transport.ts`; the sibling worktree `.claude/worktrees/gfx-15`
   exists but is a separate, unmerged branch). Per §3.3/T9, only
   `/api/packages/:id/state` carries `delivered`; the two transport routes
   were not created. A one-line comment naming spec 15's routes as the
   follow-up is in `src/main/routes/packages.ts` immediately after the
   `/state` handler.

9. **Bundled control page header markup** (T10): `ffg/control.html` has no
   `.row` utility class (unlike `hoops`/`news`), so its presence indicator
   wrapper uses an inline `display:flex` style instead of reusing a class
   that doesn't exist there.
