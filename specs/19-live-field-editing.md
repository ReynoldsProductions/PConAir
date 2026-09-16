# Spec 19 — Live Field Editing

**Status:** Planned · **Date:** 2026-09-09 · **Wave:** 3 (final)
**Model:** `claude-sonnet-5` · **Depends on:** specs 15, 18 · **Branch:** `feat/graphics-19-live-field-editing`
**Umbrella:** [`../plan_approved.md`](../plan_approved.md)

---

## 1. Why

Spec 15 gives graphics a transport. Spec 18 gives operators a generated panel. Put them together and a gap appears: **what should happen to a graphic that is currently on air when its text changes?**

Right now every state patch re-renders the graphic from scratch. For a lower third holding on screen with a misspelled name, that means the correction either pops in with no transition — or, if the render re-runs its intro on state change, the card slides out and back in on air. Both are visible mistakes.

Breeze solves this with an explicit **UPDATE ON AIR**: fields edit freely, and a separate commit pushes them to the live graphic without replaying its timeline. This spec brings that model to PConAir, plus a per-field choice about which fields should behave that way at all.

## 2. What already exists — do not rebuild

- **Spec 15** — `RenderTransportState`, `_transport`, `TransportPhase`, the `data-phase`/`data-step` attribute contract, `client.verb()`. "On air" means `phase` is `playing-in`, `holding` or `playing-out`. Do not invent a second liveness concept.
- **Spec 18** — `ControlField`, `FieldBase`, `controlPanel`, the debounce/optimistic/focus rules, and the nested-patch builder in §3.5. This spec adds one property to `FieldBase` and one commit path to the panel. **Do not restructure the panel.**
- **Spec 16** — `delivered`. The commit response reports it, so the operator knows whether the correction reached anything.
- **`src/main/packages/state-hub.ts`** — patches still go through the hub. This spec does not add a second write path; it adds *staging in front of* the existing one.

## 3. Design

### 3.1 Update modes

One new optional property on `FieldBase`:

```ts
/** How an edit reaches a graphic that is currently on air.
      'live'      — patch immediately, as today. Default for non-text fields.
      'staged'    — hold locally until COMMIT. Default for text and asset fields.
      'next-play' — patch state immediately, but the render must not read it
                    until its next transition. */
updateMode?: 'live' | 'staged' | 'next-play';
```

Defaults are chosen so the common case is right without any manifest change:

| Field type | Default | Why |
|---|---|---|
| `number`, `slider`, `toggle`, `select`, `color` | `live` | A score, a colour, a possession arrow — the operator wants these instant, and they do not reflow the graphic. |
| `text`, `asset` | `staged` | A half-typed name must never be on air. This is the case that produces visible errors today. |
| `transport`, `action`, `data`, `static` | n/a | Not value-bearing. |

**Crucially, staging only applies while the render is on air.** When the graphic's transport phase is `idle` or `finished`, or when the render is not transport-managed at all, a `staged` field behaves exactly like `live` — there is nothing to protect. Otherwise a package without transport would become unusable.

### 3.2 The panel's commit surface

`controlPanel` (spec 18) gains a staging area, rendered only when there is at least one pending edit:

```
┌──────────────────────────────────────────────┐
│ 2 changes pending — not on air               │
│   name   "Jane Smith" → "Jane Smyth"         │
│   title  "CEO" → "Chief Executive"           │
│                    [ Revert ]  [ UPDATE ON AIR ] │
└──────────────────────────────────────────────┘
```

- Staged inputs get `data-staged="true"` and a left accent border in `--pc-accent`, so a glance shows what is not yet live.
- **UPDATE ON AIR** sends one patch containing every staged field, then clears the staging area and reports `delivered`.
- **Revert** discards staged values and restores each input from `client.state`.
- `Ctrl`/`Cmd`+`Enter` anywhere in the panel commits. Operators use these one-handed.
- Staged edits are **per-panel and in memory only.** Never persist them, never share them between operators, and discard them if the socket drops — a stale correction committed after a reconnect is worse than a lost one.
- When the graphic goes to `idle` (a `stop` or `clear` completes), pending staged edits are **committed automatically and silently**. The reason to hold them has gone, and leaving them pending means the next `play` shows stale text.

### 3.3 Updating without replaying

This is the substantive engineering problem: state changed, the graphic is holding, and it must adopt the new text without re-running its intro.

Spec 15's contract makes this tractable. The render's animation is driven **entirely** by `data-phase` and `data-step` on `<html>`, which change only on transport verbs. A state patch that does not touch transport therefore does not touch those attributes, and CSS transitions keyed to them do not re-run. Text simply changes in place.

Two things must be enforced so that stays true:

1. **The runtime must not re-apply phase attributes on a plain state frame.** Set them only when `_transport` for this render actually differs from what is on the element. A no-op write of `data-phase` is enough to restart a CSS transition in some engines.

2. **A render must not key animation off content.** Document the rule and enforce the common failure: if a `[data-fit]` element (spec 22) re-measures during an on-air update, it must apply the new scale **without** a transition. Add `data-fit-jump` for one frame, the same suppression trick spec 15 uses for late joins.

Optional, for packages that want a deliberate transition on correction:

```css
[data-updated="name"] .name { animation: pc-crossfade 200ms; }
```

The runtime sets `data-updated="<comma-separated field names>"` on `<html>` for 250 ms after a live or committed update, then removes it. Packages that ignore it get a hard cut, which is the correct default.

### 3.4 `next-play`

For fields that genuinely cannot change mid-graphic — a layout variant, a template choice, a background image that would pop.

State updates immediately. The runtime buffers the value and exposes it as `client.stateNext`, only promoting it into `client.state` when the phase transitions through `idle` or `playing-in`. The panel marks these fields `data-pending-play="true"` with the hint *"applies on next play"*.

Implemented in the runtime, not the render, so a package gets it from the manifest alone.

### 3.5 Server side

Almost nothing changes, and that is deliberate: staging is a **client** concern. The server keeps one write path.

Two small additions to `POST /api/packages/:id/state`:

- Accept an optional `_meta: { updatedFields: string[], renderId?: string }` alongside the patch. It is not stored; it is echoed on the `state` WS frame as `updatedFields` so every connected render can drive `data-updated` — including outputs that are not the one the operator is looking at.
- Strip any `_`-prefixed key from the patch body before merging, so `_meta`, `_transport` and `_data` can never be written by a client. Spec 15 blocked underscore keys in the *manifest*; this blocks them on the *wire*. Add the test even if spec 15's validation already covers the manifest case — they are different attack surfaces.

### 3.6 Files

**Create**
- `tests/live-field-editing.test.ts`

**Modify**
- `src/main/packages/loader.ts` — `updateMode` on `FieldBase`, validation (must be one of the three; rejected on non-value-bearing types).
- `src/main/routes/packages.ts` — `_meta` handling, underscore stripping.
- `src/main/server.ts` — echo `updatedFields` on the `state` frame.
- `src/shared/types.ts` — the `state` frame's optional `updatedFields`.
- `src/runtime/pconair-controls.js` — staging area, commit, revert, keyboard shortcut, `data-staged`, `data-pending-play`.
- `src/runtime/pconair.js` — `data-updated` lifecycle, `stateNext`, the no-op phase-write guard from §3.3.1.
- `src/runtime/pconair-fit.js` — `data-fit-jump` suppression on on-air re-measure.
- `src/runtime/pconair.css` — staging area, `[data-staged]`, `[data-pending-play]`.
- `demo-packages/template-overlay/*` — a staged text field and a `next-play` select as the worked example.
- `docs/designing-packages.md`

## 4. Tasks

- [ ] **T1 — `updateMode` validation.** Test: the three values pass; a fourth fails; `updateMode` on a `transport` or `static` field fails with a message naming the field. Commit.
- [ ] **T2 — Defaults.** Unit test the resolver: `text`/`asset` → `staged`; `number`/`slider`/`toggle`/`select`/`color` → `live`; an explicit `updateMode` always wins. Commit.
- [ ] **T3 — Staging only while on air.** Test: with the render's phase `idle`, editing a `staged` text field patches immediately and shows no staging area; with phase `holding`, the same edit stages. With no `_transport` entry at all, it patches immediately. Commit.
- [ ] **T4 — Staging area rendering.** jsdom test: two staged edits render two rows with old → new values and the "2 changes pending" heading; the inputs carry `data-staged="true"`. Commit.
- [ ] **T5 — Commit.** Test: **UPDATE ON AIR** sends exactly one patch containing both fields, correctly nested per spec 18 §3.5, clears the staging area, and surfaces `delivered` from the response. Commit.
- [ ] **T6 — Revert.** Test: restores every input from `client.state` and clears staging without sending a patch. Commit.
- [ ] **T7 — Keyboard commit.** Test: `Ctrl+Enter` and `Cmd+Enter` commit; plain `Enter` in a single-line input commits only that field, per spec 18's existing rule. Commit.
- [ ] **T8 — Discard on disconnect.** Test: staged edits are cleared when `connected` goes false, and the staging area disappears. Commit.
- [ ] **T9 — Auto-commit on idle.** Test: with edits staged and phase `holding`, a transport frame moving to `idle` commits them automatically, exactly once. Commit.
- [ ] **T10 — Phase attributes are not rewritten.** Test: a state frame that leaves `_transport` unchanged does not write `data-phase` or `data-step`. Spy on `setAttribute` and assert zero calls — this is the property that stops a correction replaying the intro. Commit.
- [ ] **T11 — `data-updated`.** Test with fake timers: a live update sets `data-updated="name"` on `<html>` and removes it after 250 ms; two fields in one commit produce `"name,title"`. Commit.
- [ ] **T12 — `_meta` echo.** supertest + WS: posting with `_meta: {updatedFields: ['name']}` delivers a `state` frame carrying `updatedFields: ['name']`, and `_meta` is absent from stored state. Commit.
- [ ] **T13 — Underscore keys rejected on the wire.** Test: posting `{_transport: {...}, name: 'x'}` stores `name` and silently drops `_transport`; assert `_transport` is unchanged in the hub. Commit.
- [ ] **T14 — `next-play`.** Test: a `next-play` field patches state but `client.state` still reports the old value while `holding`; `client.stateNext` has the new one; a transition through `idle` promotes it. The input shows `data-pending-play="true"`. Commit.
- [ ] **T15 — Fit re-measure does not animate.** Test: an on-air text update that triggers re-fitting applies `data-fit-jump` for one frame. Commit.
- [ ] **T16 — Worked example + docs.** Commit.

## 5. Acceptance

- [ ] With a lower third holding on air, correcting a misspelled name and pressing **UPDATE ON AIR** changes the text in place — the card does not slide out, re-enter, flicker, or replay any part of its intro. Verify against a real render, not only in jsdom.
- [ ] Typing in a staged field while the graphic is on air changes nothing on screen until commit.
- [ ] The same field, edited while the graphic is off air, applies immediately with no staging step.
- [ ] Committing reports how many outputs received it.
- [ ] Stopping a graphic with edits pending commits them silently, so the next play shows the corrected text.
- [ ] A dropped connection discards pending edits rather than committing them late.
- [ ] A client cannot write `_transport`, `_data` or `_meta` into package state.
- [ ] `hoops`, `news`, `ffg` and `demo-scores` are unaffected — none declares `updateMode`, and none is transport-managed.
- [ ] `npm run typecheck && npm test` green.

## 6. Out of scope

Multi-operator conflict resolution (two panels staging the same field — last commit wins, and that is acceptable for a single-operator appliance). Undo history. Staging transport verbs. Persisting staged edits across a reload. Scheduled or timed commits.
