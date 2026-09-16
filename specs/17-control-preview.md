# Spec 17 — Control-Page Preview

**Status:** ✅ Done 2026-09-15 · **Wave:** 2 (concurrent with 18, 22, 23)
**Model:** `claude-sonnet-5` · **Depends on:** specs 14, 16 · **Branch:** `feat/graphics-17-control-preview`
**Umbrella:** [`../plan_approved.md`](../plan_approved.md)

---

## 1. Why

The operator drives a graphic from a control page and cannot see it. The graphic is on a second display, or inside OBS, or on a switcher output down the hall. Everything on the control page is a guess about what the audience is looking at.

Spec 16 tells the operator whether an output is *connected*. This spec tells them what it *says*.

## 2. What already exists — do not rebuild

- **Spec 21** ships `?scale=contain` and `?bg=checker` on every render page. The preview is an `<iframe>` loading the render's own URL with those params. **Do not build a second scaling path or a canvas capture.**
- **Spec 16** ships `client.presence`, `onPresence` and `presenceIndicator`. The preview's "no output connected" state comes from there, not from a new check.
- **Spec 14** ships the runtime and `role: 'control'`. The iframe's inner page connects as a `render` — see §3.3 for why that is deliberate and how it is excluded from presence.
- **`src/main/routes/packages.ts:166`** — `GET /packages/:id/render/:renderId` already serves render pages. The iframe points at it; no new route.

## 3. Design

### 3.1 The component

```js
/** Mount a live preview of one render into `el`. */
window.PConAir.preview(el, opts) -> { setRender(renderId), setBackdrop(name), reload(), destroy() }
```

`opts`:

| Key | Default | Meaning |
|---|---|---|
| `packageId` | required | |
| `renderId` | required | Which render to show |
| `backdrop` | `'checker'` | `'checker'`, `'black'`, `'white'`, `'green'` |
| `width` | `480` | CSS px; height derives from 16:9 |

Renders:

```html
<div class="pc-preview" data-backdrop="checker">
  <iframe class="pc-preview-frame" src="/packages/<id>/render/<renderId>?scale=contain&bg=checker&preview=1"
          sandbox="allow-scripts allow-same-origin" title="Preview"></iframe>
  <div class="pc-preview-bar">
    <span class="pc-preview-presence"></span>   <!-- spec 16's presenceIndicator -->
    <div class="pc-preview-backdrops">…</div>   <!-- four backdrop buttons -->
    <button class="pc-preview-reload">↻</button>
  </div>
</div>
```

The iframe is `width: 1920px; height: 1080px` with `transform: scale(opts.width / 1920)` and `transform-origin: top left`, inside an overflow-hidden box sized to `opts.width × opts.width * 9/16`. Scaling the **frame element**, not the page inside it, means the render still lays out at exactly 1920×1080 — a preview that reflowed the graphic would be lying about the thing it exists to verify.

`allow-same-origin` is required so the framed page can open its own WebSocket to the same host. It is same-origin content the app itself serves, so this grants nothing the parent does not already have.

### 3.2 It is genuinely live

No polling, no screenshots. The framed render page connects to the same namespace over the same WS as any real output and re-renders from the same state frames. Whatever the operator changes appears in the preview at the same instant it appears on air, through the identical code path — which is the property that makes it trustworthy.

### 3.3 The preview must not count as an output

A preview subscribing as a render would make `delivered` report 1 when nothing is on air — inverting the exact signal spec 16 exists to provide.

The iframe URL carries `preview=1`. Spec 14's runtime forwards it as `&preview=1` on the WS URL. Spec 16's registration branch in `server.ts` skips `presence.add` when `preview=1` is set. The socket still subscribes and still receives state — it is simply not counted.

Add the counter-test explicitly: **open a preview, assert `delivered` stays 0.**

### 3.4 Backdrops

`checker` (default) makes transparency visible. `black` matches a downstream luma key. `green` matches a chroma key. `white` catches white-on-white text that is invisible against a dark preview and disappears on air over a bright camera shot.

Backdrop choice is a per-viewer convenience: persist it in `localStorage` under `pconair.preview.backdrop`, wrapped in try/catch, defaulting to `checker` when storage throws or is empty.

### 3.5 Reload

`↻` reloads the iframe only. A render page that has crashed on a bad state is otherwise unrecoverable without reloading the whole control page and losing the operator's place.

### 3.6 Files

**Create**
- `tests/control-preview.test.ts`

**Modify**
- `src/runtime/pconair.js` — `PConAir.preview`, and forward `preview=1` onto the WS URL.
- `src/runtime/pconair.css` — `.pc-preview*`, the checkerboard (a CSS `conic-gradient`, no image asset).
- `src/main/server.ts` — skip presence registration when `preview=1`.
- `bundled-packages/{hoops,news,ffg}/control.html` — add a preview to each. `news` has three renders, so its preview uses `setRender` from a selector.
- `docs/designing-packages.md`

## 4. Tasks

- [x] **T1 — Preview excluded from presence.** Test first, because it is the correctness-critical one: subscribe a socket with `?render=1&preview=1`, assert `GET /api/packages/:id/presence` reports `renders: 0` and `POST …/state` returns `delivered: 0`. Then the same socket without `preview=1` reports 1. Commit.
- [x] **T2 — Runtime forwards `preview=1`.** jsdom test: a page loaded with `?preview=1` opens a WS whose URL contains `preview=1`; without it, it does not. Commit.
- [x] **T3 — Component markup and scale.** jsdom test: `preview(el, {packageId:'p', renderId:'r', width: 480})` produces an iframe whose `src` contains `scale=contain`, `bg=checker` and `preview=1`, with `transform: scale(0.25)` and a container 480×270. Commit.
- [x] **T4 — Backdrop switching + persistence.** Test: `setBackdrop('green')` updates `data-backdrop`, the iframe `src` `bg` param, and `localStorage`; a fresh mount reads it back; a throwing `localStorage` still mounts with `checker`. Commit.
- [x] **T5 — `setRender` and `reload`.** Test: `setRender('other')` swaps the `src` render segment and preserves the backdrop; `reload()` changes only a cache-busting param. Commit.
- [x] **T6 — `destroy`.** Test: removes the DOM, unsubscribes the presence indicator, and leaves no timers (assert with fake timers that no pending timer remains). Commit.
- [x] **T7 — Wire the three bundled control pages.** `news` gets a render selector driving `setRender`. Commit.
- [x] **T8 — Docs.** Commit.

## 5. Acceptance

- [x] Each bundled control page shows a live, correctly-proportioned preview of its render.
- [x] Changing a field updates the preview at the same time as a real output, with no reload.
- [x] With only a preview open, the presence indicator still reads **"no output connected"** and `delivered` is 0.
- [x] The four backdrops render correctly and the choice survives a control-page reload.
- [x] The framed graphic lays out at exactly 1920×1080 — no reflow, no text rewrapping versus the full-size render.
- [x] `npm run typecheck && npm test` green.

## 6. Out of scope

Preview in the Operator shell (`src/renderer/operator/`) — package control pages only. Multi-render side-by-side previews. Any capture, screenshot or thumbnail generation. Interacting with the graphic by clicking inside the preview.

## 7. Implementation notes

Departures from this spec's exact prescription, and why:

1. **Test files, plural, not singular.** §3.6 lists a single file to create,
   `tests/control-preview.test.ts`. The server-side T1 correctness test (node
   environment, real `ws` sockets via supertest) and the client-side T2-T6
   tests (jsdom environment, a real DOM `el` and `window.localStorage`) can't
   share one file — Vitest's environment is chosen per file via a docblock,
   and this repo's own precedent (`tests/output-presence.test.ts` /
   `tests/output-presence-client.test.ts`, `tests/package-runtime.test.ts` /
   `tests/package-runtime-client.test.ts`) already splits exactly this way.
   `tests/control-preview.test.ts` holds T1, T7, and the final end-to-end
   acceptance test (node); `tests/control-preview-client.test.ts` holds
   T2-T6 (jsdom).

2. **T3-T6 landed as one commit, not four.** `preview()`'s constructor,
   `setBackdrop`, `setRender`, and `destroy` all close over the same
   variables (`curBackdrop`, `curRenderId`, `presenceHandle`, `bust`) and
   wire directly into each other — the backdrop buttons built in the
   constructor call `setBackdrop`, `setRender` tears down and rebuilds the
   presence indicator `destroy` also tears down, etc. There was no
   intermediate state where e.g. T3's markup passed without T4-T6's methods
   already existing in working form; splitting them would have meant writing
   throwaway stub methods the very next commit would replace. All four
   tasks' tests were written together, confirmed to fail together against a
   `PConAir.preview is not a function` stub, then made to pass together — the
   same test-first discipline as every other task, at a coarser commit
   granularity. T1, T2, T7, and the docs each landed as their own commit as
   the spec asks.

3. **`ffg`'s preview has no render selector, unlike `news`'s.** §3.6 only
   calls out `news` needing one ("`news` has three renders, so its preview
   uses `setRender` from a selector"); `ffg` in fact ships five renders
   (`single-pip`, `four-portrait`, `four-up`, `head-to-head`, `champion`, per
   `bundled-packages/ffg/package.json`). Rather than read that omission as
   silent scope-narrowing, the sensible call was to preview `ffg`'s primary
   "Four-Up Live Grid" render (`renderId: 'four-up'`) by default and leave
   the existing OBS-browser-source URL table in `ffg/control.html` as the way
   to reach the others — consistent with the spec naming only `news` for a
   selector, and with §6's "out of scope: multi-render side-by-side
   previews" (a 5-way selector felt like it was reaching toward that). A
   `ffg` render selector would be a small, easy follow-up if an operator
   wants it.

4. **One extra "Acceptance" test beyond T1-T8**, in
   `tests/control-preview.test.ts`. T1-T7's own tests each verify one
   mechanism in isolation (presence/delivered are zero; the runtime forwards
   the param; the component's markup/scale/backdrop/setRender/destroy behave
   correctly; the bundled pages mount it). None of them, alone, demonstrates
   the combined property acceptance criterion #2 and #3 actually assert: that
   the *same* socket a preview would open receives a live state patch with no
   reload, at the same time `delivered`/presence report zero. Rather than
   leave that as an inference from the other tests, one additional
   end-to-end test opens a socket with the exact query string
   `PConAir.preview()`'s iframe uses, patches state over the real HTTP route,
   and asserts both properties together on that one socket.
