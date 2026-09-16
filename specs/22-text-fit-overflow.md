# Spec 22 — Text Fit & Overflow Warning

**Status:** ✅ Done 2026-09-15 · **Date:** 2026-09-09 · **Wave:** 2 (concurrent with 17, 18, 23)
**Model:** `claude-sonnet-5` · **Depends on:** specs 14, 16 · **Branch:** `feat/graphics-22-text-fit-overflow`
**Umbrella:** [`../plan_approved.md`](../plan_approved.md)

---

## 1. Why

Long names break lower thirds, and they break them silently. `graphics/README.md` documents the current behaviour: *"Long names shrink 52px → 34px before ellipsis."* An ellipsis is a truncated person's name on a broadcast, and nobody finds out until it is on air.

Every package solves this differently or not at all, in its own render CSS. This spec makes fitting declarative and — the part that matters — makes failure **visible to the operator before they take the graphic**.

## 2. What already exists — do not rebuild

- **Spec 14** — the runtime, and `client.patch()` returning a parsed body.
- **Spec 16** — presence and the `presence` WS frame. This spec adds a second server-pushed frame using the same broadcast path; read `server.ts`'s presence broadcast before writing a new one.
- **Spec 21** — `window.PConAir.warn(message)`. Overflow warnings go there too, so a `?debug=1` render shows them without a control page.
- **`graphics/_shared/lower-third.css`** and `bundled-packages/news/render-l3.html` — read both for the existing shrink-then-ellipsis behaviour before replacing it.

## 3. Design

### 3.1 Declarative fitting

A render page marks an element and the runtime does the rest:

```html
<div class="name" data-fit data-fit-max="620" data-fit-min="0.62">Bartholomew Featherstonehaugh</div>
```

| Attribute | Default | Meaning |
|---|---|---|
| `data-fit` | — | Opt in. Value is an optional field name for the warning message; falls back to the element's `id`, then its first class. |
| `data-fit-max` | element's own width | Max width in CSS px |
| `data-fit-min` | `0.5` | Floor for horizontal condensing |
| `data-fit-mode` | `condense` | `condense` (scaleX) or `shrink` (font-size) |

Algorithm, on content change and on font load:

1. Reset any prior fit, measure natural width against `data-fit-max`.
2. If it fits, clear the warning and stop.
3. Compute `ratio = max / natural`. If `ratio >= data-fit-min`, apply it — `transform: scaleX(ratio)` with `transform-origin` matching the element's computed `text-align`, or `font-size: calc(… * ratio)` in `shrink` mode — and stop.
4. Otherwise apply `data-fit-min`, leave the text **visibly overflowing rather than ellipsised**, and raise a warning.

Step 4 is the deliberate choice. A visible overflow in the preview is a problem the operator sees and fixes; a clean ellipsis is one they ship.

Measurement runs inside `document.fonts.ready` and re-runs on `document.fonts.onloadingdone`. Measuring against a fallback font and then swapping to Saira Condensed is how a graphic passes in the editor and fails on air.

Use a `MutationObserver` on `characterData` and `childList` for the marked subtree, and a `ResizeObserver` for container changes. Batch all recomputation into one `requestAnimationFrame` — never measure per mutation.

### 3.2 Reporting overflow

Warnings must reach the control page, which is a different browser tab from the render.

Render side, when the warning set changes:

```
POST /api/packages/:id/warnings
{ renderId: string, warnings: Array<{ field: string, text: string, naturalWidth: number, maxWidth: number }> }
```

Server side: hold the latest warning set per `(packageId, renderId)` **in memory only** — never persisted, cleared when the last output for that render disconnects (hook the presence registry's removal path). A warning from a browser source that has gone away is noise.

Server pushes to control pages using spec 16's broadcast path:

```ts
{ type: 'warnings', namespace: 'package:<id>', renderId: string, warnings: FitWarning[] }
```

Extend `WsServerMessage` in `src/shared/types.ts`. Add `GET /api/packages/:id/warnings` (operator) returning the whole map, so a control page opened late is correct immediately.

**Authentication:** `POST /api/packages/:id/warnings` is called by cookie-less render pages, so it takes the same LAN IP-allowlist path as the other render-facing surfaces. Cap the body at 16 KB and 32 warnings per render; ignore and 400 beyond that.

### 3.3 Control-page surface

```js
/** Live overflow warnings for a package. Renders nothing when there are none. */
window.PConAir.warningsPanel(el, client, opts) -> { destroy() }
```

One line per warning: `name — "Bartholomew Featherstonehaugh" is 738px in a 620px box (min scale 0.62)`. Styled with `--pc-danger`. `opts.renderId` narrows to one render.

Also call `window.PConAir.warn()` (spec 21) on the render side so `?debug=1` surfaces the same information without a control page. Feature-detect — spec 21 may not have merged.

### 3.4 Migrate the lower third

`bundled-packages/news/render-l3.html` currently hand-rolls shrink-then-ellipsis. Replace it with `data-fit` on the name and title elements, preserving the existing 52px/32px type sizes and the 861px panel max. Delete the bespoke JS. The visual result at normal name lengths must be unchanged.

### 3.5 Files

**Create**
- `src/runtime/pconair-fit.js` — loaded by `pconair.js` only when the document contains a `[data-fit]` element at boot, or when one appears later.
- `tests/text-fit.test.ts`
- `tests/text-fit-routes.test.ts`

**Modify**
- `src/runtime/pconair.js` — conditional loader, `warningsPanel`.
- `src/runtime/pconair.css` — `.pc-warnings`, `[data-fit]` base rules.
- `src/main/packages/warnings.ts` *(new)* — the in-memory store.
- `src/main/routes/packages.ts` — the two routes.
- `src/main/server.ts` — broadcast `warnings` frames; clear on last-output disconnect.
- `src/shared/types.ts` — `FitWarning`, `WsServerMessage` addition.
- `bundled-packages/news/render-l3.html`, `bundled-packages/news/control.html`
- `docs/designing-packages.md`

## 4. Tasks

- [x] **T1 — Fits, no warning.** jsdom test with a stubbed `getBoundingClientRect`: natural 400px in a 620px box leaves no transform and produces no warning. Commit.
- [x] **T2 — Condense above the floor.** Test: natural 700px, max 620, min 0.5 → `transform: scaleX(0.8857…)`, no warning. Commit.
- [x] **T3 — Below the floor warns.** Test: natural 1400px, max 620, min 0.62 → transform is exactly `scaleX(0.62)`, no ellipsis applied, and one warning with `naturalWidth: 1400`, `maxWidth: 620`. Commit.
- [x] **T4 — `transform-origin` follows `text-align`.** Test: `left` → `left center`, `right` → `right center`, `center` → `center`. A right-aligned card that condenses from the left drifts off its panel. Commit.
- [x] **T5 — `shrink` mode.** Test: `data-fit-mode="shrink"` scales `font-size` instead of applying a transform. Commit.
- [x] **T6 — Font-load re-measure.** Test: measuring before `document.fonts.ready` resolves and again after a wider metric produces a warning on the second pass. Commit.
- [x] **T7 — Batched recomputation.** Test with a stubbed `requestAnimationFrame`: ten text mutations in one tick cause one measurement pass, not ten. Commit.
- [x] **T8 — Warning store.** Unit test `warnings.ts`: set, overwrite by `(packageId, renderId)`, clear on disconnect, and `get` for an unknown package returns an empty map. Commit.
- [x] **T9 — Routes.** supertest: `POST …/warnings` from an allowlisted IP stores them; `GET …/warnings` returns the map for an operator and 401 unauthenticated; a 33-warning body and a 20 KB body are both 400. Commit.
- [x] **T10 — Push frame.** Test: a subscribed control socket receives a `{type:'warnings'}` frame after a POST, and receives a cleared set when the reporting render disconnects. Commit.
- [x] **T11 — `warningsPanel`.** jsdom test: renders nothing when empty; renders the §3.3 sentence for one warning; `opts.renderId` filters; `destroy()` unsubscribes. Commit.
- [x] **T12 — Migrate `render-l3.html`.** Assert the bespoke shrink JS is gone (`grep`) and that a normal-length name renders at 52px with no transform. Commit.
- [x] **T13 — Docs.** Commit.

## 5. Acceptance

- [x] A name too long for its panel condenses to the floor, stays fully legible with no ellipsis, and raises a warning in the control page within a second — without a reload.
- [x] The warning names the field, the text, the natural width and the box width.
- [x] Warnings clear when the text is shortened and when the render disconnects.
- [x] `?debug=1` on the render shows the same warning with no control page open.
- [x] Right-aligned text condenses toward its right edge.
- [x] `news`'s lower third looks identical to `main` at normal name lengths, with no bespoke fitting JS left in the file.
- [x] `npm run typecheck && npm test` green.

## 6. Out of scope

Multi-line wrapping or auto-balancing. Vertical fitting. Warnings for anything other than text width. Blocking a take on a warning — the operator is told, and decides.

---

## 6. Implementation notes (2026-09-15)

Landed on `feat/graphics-22-text-fit-overflow` (base: `claude/breeze-overlay-graphics-review-f12320` with specs 14, 15, 16, 20, 21 merged). All thirteen tasks done, plus a follow-up commit closing two acceptance gaps T1-T13's own tests hadn't actually covered. Departures from the spec as written:

- **`FitWarning` gained a `min: number` field**, carried through the whole wire path (pconair-fit.js's warning object -> POST body -> the store -> the push frame -> `warningsPanel`). Section 3.2's wire shape (`{field, text, naturalWidth, maxWidth}`) and section 3.3's example message (`... (min scale 0.62)`) disagreed — the message needs a field the wire format didn't carry. Extended it end-to-end rather than have the control-side panel show a strictly poorer message than the render-side `window.PConAir.warn()` call, which has the ratio available locally either way.
- **`WarningsStore` gained `onChange(fn)`**, not in the spec's original interface sketch (§3.5 didn't list it), because server.ts needs to know exactly which `(packageId, renderId)` changed to push the one right frame — mirrors `PresenceRegistry.onChange` exactly, including "does not fire for a no-op clear."
- **`routeIdentity()` reads `location.pathname`** (`/packages/<id>/render/<renderId>`) rather than adding a new DOM attribute for packageId — the render route already encodes both ids in its URL, so no page-author markup is needed to make reporting work.
- **`tests/news-l3-typography.test.ts` deleted, not amended.** Its entire premise — that padding must compensate for an `overflow:hidden` clip box — is gone now that nothing clips `.name`. Replaced with `tests/news-l3-fit-migration.test.ts`, which asserts the old mechanism is actually gone (grep) and drives the real engine against the migrated markup.
- **`bundled-packages/news/control.html`** got a `warningsPanel` wired in alongside its existing `presenceIndicator`, matching spec 16/17's pattern of demonstrating each new surface in the bundled reference package (spec's own file list named `control.html` as modified but didn't specify what for).
- **Two acceptance criteria — "warnings clear when the text is shortened" and "`?debug=1` shows the same warning" — were not actually exercised by any T1-T13 test**, only asserted true by inspection. Added tests for both in a follow-up commit; the first also caught a real bug in the *test* itself (`vi.stubGlobal('fetch', ...)` doesn't reach `window.fetch` as read from inside the module under this repo's jsdom setup — switched to the direct-assignment + `history.replaceState` pattern `tests/package-runtime-client.test.ts` already established, and hardened `beforeEach` to reset both so the leak couldn't reach later tests in the file).

**Final verification:** `npm run typecheck && npm test` — typecheck clean, 822/822 real tests passing. The only failing file is `tests/companion-defs.test.ts`, the same pre-existing environmental failure seen on every branch in this plan (`packages/companion-module-pconair/node_modules` never installed in this worktree) — confirmed unrelated to this work.
