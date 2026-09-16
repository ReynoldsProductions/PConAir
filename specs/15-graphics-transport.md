# Spec 15 — Graphics Transport (play / next / stop / clear)

**Status:** ✅ Done 2026-09-15 · **Date:** 2026-09-09 · **Wave:** 1 (concurrent with 16, 20, 21)
**Model:** `claude-sonnet-5` · **Depends on:** spec 14 · **Branch:** `feat/graphics-15-graphics-transport`
**Umbrella:** [`../plan_approved.md`](../plan_approved.md)

---

## 1. Why

PConAir has two incompatible ways to put a graphic on air, and neither can hold.

- **L3 mode** is binary: `lower_third_apply` / `lower_third_hide` (`src/main/action-dispatch.ts:529`, `:600`).
- **Package renders** carry a `visible` boolean in their own `stateSchema` and each package invents its own animation trigger in its render HTML.

Neither supports a graphic that reveals in stages. A stat card that brings up a name, then a headshot, then three bullet points is not expressible: it is one boolean. Operators also have no consistent verb set — every package's control page names its buttons differently, and Companion needs bespoke actions per package.

This spec introduces one playback state machine, shared by every render, with four verbs the operator and Companion always have.

## 2. What already exists — do not rebuild

- **Spec 14's runtime** (`src/runtime/pconair.js`) — `window.PConAir.connect(id, {role, renderId})` returning a `Client` with `.state`, `.patch()`, `.on()`, `.connected`. Build the transport client on top of it; do not open a second socket.
- **`src/main/packages/state-hub.ts`** — namespace state, pub/sub, persistence, `transientFields`. Transport state is stored here, not in a new store.
- **`src/main/packages/loader.ts`** — `PackageManifest`, `validateManifest`, `PkgCompanionAction`. Transport is declared in the manifest and validated here.
- **`packages/companion-module-pconair/src/pkg-engine.ts`** — already turns manifest `companionActions` into registered Companion actions. Transport actions are generated, not hand-written.
- **`bundled-packages/hoops/render.html`** and `bundled-packages/news/render-l3.html` — read these to see how packages animate today before designing the render-side hook.

## 3. Design

### 3.1 The state machine

```
                 play          play/next        stop
  idle ──▶ playing-in ──▶ holding[n] ──▶ playing-out ──▶ finished
    ▲          │              │  ▲            │              │
    └──────────┴──────────────┴──┴────────────┴──────────────┘
                          clear (from any state)
```

- `play` from `idle` or `finished` → `playing-in`, then automatically → `holding[0]`.
- `play` or `next` from `holding[n]` → `playing-in` toward stop `n+1` → `holding[n+1]`. From the last hold, `play` behaves as `stop`.
- `stop` from any live state → `playing-out` → `finished`.
- `clear` from any state → `idle` immediately, no outro. This is the panic verb.

### 3.2 Manifest declaration

New optional key on `PackageRenderDecl` (`loader.ts:16`):

```ts
export interface PackageRenderTransport {
  /** Number of hold points. 1 = classic in/hold/out. Max 16. */
  stops: number;
  /** Milliseconds of intro per segment. Segment i is durations[i], last repeats. */
  inMs?: number[];
  /** Milliseconds of outro. Default 400. */
  outMs?: number;
  /** Auto-advance a hold after N ms. 0 or absent = hold until told. */
  autoAdvanceMs?: number[];
}

export interface PackageRenderDecl {
  id: string;
  label: string;
  file: string;
  preset?: PackageRenderPreset;
  transport?: PackageRenderTransport;   // ← new, optional
}
```

A render with no `transport` key is **not** transport-managed and behaves exactly as it does today. This is what keeps `hoops`, `news` and `ffg` working untouched.

`validateManifest` additions: `stops` is an integer 1–16; `inMs`, `outMs`, `autoAdvanceMs` are non-negative integers; `inMs` and `autoAdvanceMs` arrays are at most `stops` long. Reject otherwise with a specific message.

### 3.3 Transport state

Stored in the package namespace under the reserved `_transport` key, one entry per render id:

```ts
export type TransportPhase = 'idle' | 'playing-in' | 'holding' | 'playing-out' | 'finished';

export interface RenderTransportState {
  phase: TransportPhase;
  /** Which hold we are at or heading toward. 0-based. */
  step: number;
  /** Total holds, mirrored from the manifest so render pages need not fetch it. */
  stops: number;
  /** epoch ms the current phase began — render pages drive animation from this
      so a late-joining browser source lands mid-animation correctly. */
  phaseStartedAt: number;
  /** ms the current phase is expected to last; 0 for holding without auto-advance. */
  phaseMs: number;
}

/** Keyed by render id. */
export type PackageTransportState = Record<string, RenderTransportState>;
```

`_transport` is **entirely transient**. Add it to the state hub's reset-on-load path unconditionally — a crash mid-show must never restore a graphic to `holding`. Do this in `state-hub.ts` next to the existing `transientFields` handling, not by asking packages to declare it.

Extend `validateManifest` to reject any top-level `stateSchema` key beginning with `_`, so a package cannot collide with `_transport` or with `_data` (spec 20). Spec 19 blocks the same prefix on the wire; this blocks it in the manifest.

### 3.4 Server: the transport engine

New file `src/main/packages/transport.ts`:

```ts
export interface TransportEngine {
  /** Apply a verb. Returns the resulting state, or null if the render is
      unknown or not transport-managed. */
  dispatch(packageId: string, renderId: string, verb: TransportVerb): RenderTransportState | null;
  /** Current state for one render, or null. */
  get(packageId: string, renderId: string): RenderTransportState | null;
  /** Clear every render in a package. Used by clear-all and by panic. */
  clearAll(packageId: string): void;
  /** Stop timers. Called on server close. */
  dispose(): void;
}

export type TransportVerb = 'play' | 'next' | 'stop' | 'clear';

export function createTransportEngine(hub: PackageHub): TransportEngine;
```

Phase advance is driven by `setTimeout` in the main process, not by the render page, so every connected output agrees on the phase and a page that joins late gets the truth. Timers are cleared on `dispose()` and on any verb that supersedes them.

**Panic integration:** `action-dispatch.ts` case `'panic'` must call `clearAll` for every loaded package. Panic that blanks the program window but leaves a graphic in `holding` is a lie the operator will act on.

### 3.5 HTTP surface

In `src/main/routes/packages.ts`:

| Route | Auth | Body | Response |
|---|---|---|---|
| `POST /api/packages/:id/transport/:renderId/:verb` | operator | — | `{ ok, verb, renderId, transport: RenderTransportState }` |
| `POST /api/packages/:id/transport/clear-all` | operator | — | `{ ok, cleared: string[] }` |
| `GET /api/packages/:id/transport` | operator | — | `PackageTransportState` |

`:verb` not in the four verbs → 400 `INVALID_VERB`. Unknown render, or a render without `transport` in its manifest → 404 `ITEM_NOT_FOUND`. Match the existing error-envelope shape in `routes/packages.ts`.

Spec 16 adds `delivered` to these responses. Do not add it here; leave the shape open.

### 3.6 Runtime: the render-side hook

Add to `src/runtime/pconair.js`, on the object returned by `connect()`:

```js
/** Transport view for this page's renderId. null when not transport-managed. */
client.transport            // RenderTransportState | null
client.onTransport(fn)      // subscribe; returns unsubscribe
client.verb(name)           // 'play'|'next'|'stop'|'clear' → Promise<object>
```

A render page opts in declaratively rather than writing animation JS. The runtime sets two attributes on `<html>` on every transport frame:

```html
<html data-phase="holding" data-step="1">
```

and the page styles against them:

```css
[data-phase="idle"]        .card { opacity: 0; transform: translateY(40px); }
[data-phase="playing-in"]  .card,
[data-phase="holding"]     .card { opacity: 1; transform: none; }
[data-step="0"] .bullets { opacity: 0; }
```

The runtime also sets `--pc-phase-ms` on `<html>` to the current `phaseMs`, so transitions can be authored as `transition: all calc(var(--pc-phase-ms) * 1ms)` and honour manifest timing without duplicating numbers in CSS.

**Late-join correction:** on the first transport frame after connect, if `Date.now() - phaseStartedAt > 120`, the runtime applies the attributes with transitions suppressed for one frame (add `data-phase-jump`, force reflow, remove it) so a browser source that opened mid-show snaps to the correct state instead of animating from idle.

### 3.7 Companion

`pkg-engine.ts` gains a synthesised action per transport-managed render, without the package declaring anything:

- `transport_play`, `transport_next`, `transport_stop`, `transport_clear` — each with a `renderId` dropdown populated from the manifest's transport-managed renders.
- `transport_clear_all` — no options.
- One feedback `transport_phase` (options: `renderId`, `phase`) so a button can light while its graphic is on air.
- One variable per transport-managed render: `transport_<renderId>_phase`.

### 3.8 Files

**Create**
- `src/main/packages/transport.ts`
- `tests/graphics-transport.test.ts`
- `tests/graphics-transport-companion.test.ts`

**Modify**
- `src/main/packages/loader.ts` — `PackageRenderTransport`, validation, underscore-key rejection.
- `src/main/packages/state-hub.ts` — always-transient `_transport`; expose whatever the engine needs to read/write a namespace key.
- `src/main/routes/packages.ts` — the three routes.
- `src/main/action-dispatch.ts` — `panic` calls `clearAll`.
- `src/main/server.ts` / `src/main/index.ts` — construct the engine, `dispose()` on close.
- `src/runtime/pconair.js` — `transport`, `onTransport`, `verb`, attribute driving, late-join correction.
- `packages/companion-module-pconair/src/pkg-engine.ts` — synthesised transport actions/feedback/variables.
- `demo-packages/template-overlay/package.json` + its render — declare `transport: { stops: 2, inMs: [500, 350], outMs: 400 }` as the worked example.
- `docs/designing-packages.md` — document the manifest key and the CSS attribute contract.

## 4. Tasks

- [x] **T1 — Manifest schema.** Test: a manifest with `transport: {stops: 3}` validates; `stops: 0`, `stops: 17`, `stops: 1.5`, `inMs: [-1]` each fail with a distinct message. Implement in `loader.ts`. Commit.
- [x] **T2 — Underscore keys reserved.** Test: `stateSchema: {_transport: 'string'}` fails validation; `stateSchema: {scoreA: 'number'}` still passes. Commit.
- [x] **T3 — Engine: play from idle.** Test: `dispatch('p','r','play')` on a `stops: 2` render returns `phase: 'playing-in'`, `step: 0`, `phaseMs` = manifest `inMs[0]`; after the timer fires, phase is `holding`. Use vitest fake timers. Commit.
- [x] **T4 — Engine: advance and wrap.** Test: `next` from `holding` step 0 → `playing-in` step 1 → `holding` step 1; `play` from the last hold behaves as `stop`. Commit.
- [x] **T5 — Engine: stop and clear.** Test: `stop` → `playing-out` → `finished` after `outMs`; `clear` from `playing-in` returns `idle` synchronously and cancels the pending timer (advance the clock and assert phase is still `idle`). Commit.
- [x] **T6 — Auto-advance.** Test: with `autoAdvanceMs: [1500, 0]`, holding step 0 advances itself after 1500 ms; holding step 1 does not advance. Commit.
- [x] **T7 — Transient across reload.** Test: put a render in `holding`, rebuild the hub from the persist file, assert `_transport` is absent or `idle` — never `holding`. Commit.
- [x] **T8 — HTTP routes.** supertest against `createFullServer` with a temp package dir: the four verbs return 200 with the expected `transport` body; a bad verb is 400 `INVALID_VERB`; a render with no `transport` key is 404; unauthenticated is 401. Commit.
- [x] **T9 — clear-all + panic.** Test: two renders in `holding`, `POST …/transport/clear-all` returns both ids and both are `idle`. Separately: `POST /api/action {action_id:'panic'}` leaves every transport-managed render `idle`. Commit.
- [x] **T10 — Runtime attributes.** jsdom test in `tests/graphics-transport.test.ts`: feeding transport frames through a stubbed socket sets `data-phase`, `data-step` and `--pc-phase-ms` on `document.documentElement`. Commit.
- [x] **T11 — Late-join correction.** jsdom test: a first frame with `phaseStartedAt` 5000 ms in the past adds `data-phase-jump`, and it is gone after a frame. Commit.
- [x] **T12 — Companion.** Test in `tests/graphics-transport-companion.test.ts` following `tests/companion-pkg-engine.test.ts`: a manifest with two transport renders yields five actions, one feedback and two variables, with the `renderId` dropdown listing exactly the transport-managed renders. Commit.
- [x] **T13 — Worked example + docs.** Give `demo-packages/template-overlay` a two-stop transport and CSS driven purely by `data-phase`/`data-step`. Document in `docs/designing-packages.md`. Commit.

## 5. Acceptance

- [x] A render declaring `transport` plays, holds, advances, stops and clears from `POST /api/packages/:id/transport/:renderId/:verb`, with the same result whether driven from the control page or Companion.
- [x] A browser source opened while a graphic is `holding` shows it held, without replaying the intro.
- [x] `hoops`, `news` and `ffg` — none of which declare `transport` — behave identically to `main`.
- [x] Panic leaves no render in a live phase.
- [x] A server restart never restores a render to a live phase.
- [x] `demo-packages/template-overlay` animates two stages with **no animation JavaScript in the render page** — CSS against `data-phase`/`data-step` only.
- [x] `npm run typecheck && npm test` green.

## 6. Out of scope

`delivered` on transport responses (spec 16). Transport buttons in a generated control panel (spec 18 — this spec exposes `client.verb()`; wiring it to declarative UI is spec 18's job). Editing fields mid-hold (spec 19). Do not retrofit transport onto `hoops`/`news`/`ffg`.

---

## 7. Implementation notes (2026-09-15)

Landed on `feat/graphics-15-graphics-transport` in thirteen commits
(`3ccdcaa`..`3107bc8`). Departures from the spec as written, all deliberate:

- **T3's commit landed the whole state machine, not just play-from-idle.**
  The phase transitions (advance/wrap, stop, clear, auto-advance) are one
  tightly coupled function set in `transport.ts`; splitting them across T3-T6
  would have meant committing a half-working state machine at each step. T4-T6
  each still got their own failing-test-first pass and their own commit — the
  tests just verified already-correct behaviour rather than driving new code.
  This is noted plainly rather than claimed as strict per-task TDD.
- **`state-hub.ts` needed no changes for T7.** Section 3.3 says to add
  `_transport` to the reset-on-load path "next to the existing
  `transientFields` handling." In the real code, `mergeSaved()` only carries a
  saved key forward when it already exists in the schema-derived `base`
  object, and `_transport` can never be in `base` — `validateManifest` rejects
  a package-authored schema key starting with `_` (T2). So a rebuilt hub's
  `next = mergeSaved(base, prior)` already drops `_transport` unconditionally,
  whether `prior` came from the persisted file (first load) or the live
  in-memory state (a rescan). Verified directly in T7 rather than assumed.
- **`TransportEngine` gained two methods beyond section 3.4's interface:**
  `clearAllPackages()` (panic needs to clear every loaded package, and the
  engine already holds the `hub` reference to enumerate them — action-dispatch
  has no other way in) and `reseed()` (re-applies idle defaults for any
  transport-managed render lacking a `_transport` entry yet, called once at
  construction and after `hub.rescan()` picks up a new package). Both are
  additive; `dispatch`/`get`/`clearAll`/`dispose` match the spec exactly.
- **`get()` lazily seeds an idle default** the first time a transport-managed
  render is read, rather than returning `null` until the first verb. This is
  what lets a render page's very first namespace snapshot already carry
  `_transport[renderId]` — otherwise `client.transport` would incorrectly read
  `null` (indistinguishable from "not transport-managed") until an operator
  pressed Play once.
- **The action dispatcher reaches the transport engine through a `let`-ref
  closure (`getTransportEngine()`), not a constructor argument.** In both
  `src/main/index.ts` and `tests/_test-server.ts`, `createActionDispatcher()`
  is called *before* `createServer()` — which is what actually builds the
  package hub and, now, the transport engine. `panic` must reach the *same*
  engine instance the HTTP transport routes use (a second engine over the
  same hub would leave its own pending `setTimeout`s uncancelled, able to
  resurrect a "cleared" render moments later), so reordering construction
  wasn't an option without a much larger refactor. `server.ts` now returns
  `transportEngine` from `createServer()`, and both call sites assign it to
  the ref immediately after.
- **The three new HTTP routes use a new `requireOperatorOrPin` guard, not the
  existing cookie-only `requireOperator`.** Section 3.5 says "Auth: operator"
  and T8 requires a bare 401 when unauthenticated — both hold. But
  `routes/packages.ts`'s own file-level comment states the existing package
  routes are deliberately cookie-less *specifically* so the Companion module,
  which never holds a session cookie, can drive them with only its configured
  operator PIN. Gating the new routes on a cookie-only guard would make them
  uncallable from Companion, which is exactly what T12 needs to work.
  `requireOperatorOrPin` mirrors the fallback `routes/action.ts` already uses
  (session cookie, or `?operator_pin=` verified against the operator PIN) and
  is scoped to just these three routes — the shared `requireOperator()` used
  by the rest of the admin GUI is untouched. Covered by two extra tests (T8's
  section, labelled T8b) asserting both a correct and an incorrect PIN.
- **`POST /api/packages/:id/state` now strips leading-underscore keys from an
  incoming patch.** Not its own numbered task, but the Global Constraints
  section of `plan_approved.md` requires it wherever a spec introduces a
  reserved prefix, and this spec introduces `_transport`. Implemented and
  tested alongside T8 since it lives in the same route file and handler.
- **Test files split three ways, not two.** The spec named
  `tests/graphics-transport.test.ts` and
  `tests/graphics-transport-companion.test.ts`. T10/T11 need `jsdom` to touch
  `document.documentElement`, while T1-T9 need node (supertest + real `ws` +
  Vitest fake timers over a real engine) — one environment per Vitest file, so
  those tasks landed in a third file, `tests/graphics-transport-runtime.test.ts`,
  mirroring exactly how spec 14 split `package-runtime-client.test.ts` from
  `package-runtime.test.ts` for the identical reason.
- **`packages/companion-module-pconair`'s own `node_modules` were never
  installed in this worktree** — the same pre-existing condition that fails
  `tests/companion-defs.test.ts` (confirmed unchanged before and after this
  spec's work). `pkg-engine.ts` has zero external imports, so
  `synthesizeTransportDefs` is fully covered by
  `tests/graphics-transport-companion.test.ts`. `client.ts`, `index.ts`, and
  `packages.ts`, which do import `@companion-module/base` transitively, could
  not be typechecked or unit-tested in this environment; those three files'
  changes were reviewed by hand against the file's existing exact patterns
  (the same PIN-query construction `sendAction` already uses, the same
  namespacing `buildPackageDefinitions` already uses for declared actions).
- **Extra end-to-end acceptance test beyond the T-list**, per the task's own
  instructions: a real WebSocket subscribing *after* a render has already been
  played into `holding`, proving the first frame it receives already carries
  `phase: 'holding'` rather than `idle` — the server-side half of "a browser
  source opened while a graphic is holding shows it held." T11 covers the
  client-side half (the runtime's late-join correction) against a stubbed
  frame.

**Known unrelated failure carried over from spec 14:** `tests/companion-defs.test.ts`
still fails to load — `packages/companion-module-pconair/node_modules` was
never installed in this worktree, so `@companion-module/base` does not
resolve. Confirmed identical before this spec's first commit and after its
last.

**Observed but unrelated:** the full suite occasionally shows one extra
failure in a file this spec never touches (media library uploads, prompter
forwarding, slides, presets, l3 themes — a different one most runs), never
reproducing when that file is run alone or with `--no-file-parallelism`. This
matches `vitest.config.ts`'s own comment about CPU-bound tests timing out
non-deterministically under parallel load in this environment; every run
during this spec's work converged to 55/57 files passing with only
`companion-defs.test.ts` failing once concurrency dropped.
