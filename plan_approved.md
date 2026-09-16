# Graphics Control Plane — Implementation Plan (APPROVED)

> **For agentic workers:** this file is the **orchestration entry point**, run from the Claude Code CLI. It does not contain implementation detail. Each numbered spec in [`specs/`](specs/) is a self-contained, independently executable brief. Read this file, then run the waves below.

**Goal:** Let an operator control what a graphic *does* and what it *looks like* from a UI, so adding or restyling a graphic stops being a code-editing job.

**Architecture:** PConAir already has the right substrate — a **graphics package** system (`bundled-packages/`, `src/main/packages/`) with manifest-declared state schemas, namespaced WebSocket state, and declaratively-generated Companion actions. What it lacks is the *operator-facing* half of that idea: every package hand-writes a ~400-line `control.html` and ships a byte-identical copy of `assets/state.js`. This plan supplies the missing half — a shared control runtime, a declarative control schema that generates panels, a transport state machine, and the operator feedback (presence, preview, debug, overflow) that makes live use safe.

**Tech Stack:** TypeScript 5.3 · Express 4 · `ws` 8 · Electron 32 · Vitest 2 + supertest · vanilla ES5-safe JS in render/control pages (no framework, no build step).

---

## The key finding

**Do not build a parallel system.** Earlier analysis compared PConAir to [breeze-overlay](https://github.com/dwclarkphx/breeze-overlay) and recommended a manifest-driven binding model. On inspection, PConAir **already has most of that engine**:

| Capability | Where | Status |
|---|---|---|
| Package manifest + `stateSchema` | `src/main/packages/loader.ts:106` | ✅ Built |
| Namespaced state with pub/sub + persistence | `src/main/packages/state-hub.ts` | ✅ Built |
| `transientFields` (never restore on-air flags) | `loader.ts:121` | ✅ Built |
| Declarative Companion actions/feedbacks/variables | `loader.ts:71-104` | ✅ Built |
| Render pages + render presets | `routes/packages.ts:166`, `packages/render-presets.ts` | ✅ Built |
| Per-package control page | `bundled-packages/*/control.html` | ⚠️ **Hand-written, ~400 lines each** |
| Shared client runtime | `*/assets/state.js` | ⚠️ **Duplicated 6× byte-for-byte** (md5 `b327526b…`) |
| Playback transport (play/stop/clear) | — | ❌ Missing |
| Output presence / `delivered` | — | ❌ Missing |
| Preview in control page | — | ❌ Missing |
| Normalized data sources | `news/ticker.json` (a file in the app bundle) | ❌ Missing |
| Debug overlay | — | ❌ Missing |
| Text overflow warning | ad-hoc per template | ❌ Missing |

Every spec below is **additive to the packages subsystem**. Nothing here forks it, and nothing here touches the legacy `graphics/` templates or the `AppState.graphics` slice except where a spec says so explicitly.

---

## Global Constraints

Every task in every spec inherits these.

- **No new runtime dependencies.** `package.json` `dependencies` stays as-is. No GSAP, no React in render or control pages, no CDN references. Fonts are self-hosted under `_fonts/`.
- **Render and control pages are vanilla, ES5-safe, no build step.** They are loaded by OBS/vMix browser sources and by Electron `BrowserWindow`s; they must work from a plain static file server.
- **Overlay renders stay transparent 1920×1080.** Never introduce an opaque background to a render declared as an overlay.
- **Additive only.** `bundled-packages/hoops`, `bundled-packages/news`, and `bundled-packages/ffg` must keep working unchanged at every commit. New manifest keys are optional; a manifest without them behaves exactly as it does today.
- **Tests are Vitest + supertest against `createFullServer` from `tests/_test-server.ts`.** New tests go in `tests/<area>.test.ts`. Follow `tests/graphics-actions.test.ts` for shape.
- **Every task ends green:** `npm run typecheck && npm test`.
- **Do not modify** `.env`, credentials, or settings files (workspace CLAUDE.md rule).
- **`.gitignore` must continue to include** `.env`, `.env.local`, `.env.*.local`, `.claude/plans/`.
- **Reserved namespace prefix:** specs introduce `_transport` (15), `_data` (20) and `_meta` (19, wire-only) keys inside a package's state namespace. Leading-underscore keys are reserved for the engine: `validateManifest` must reject them in a package-authored `stateSchema`, and `POST /api/packages/:id/state` must strip them from an incoming patch.

---

## Spec map

| # | Spec | Wave | Model | Depends on | Addresses |
|---|------|------|-------|-----------|-----------|
| 14 | [Package Control Runtime](specs/14-package-control-runtime.md) ✅ | **0** | `claude-opus-5` | — | foundation for all |
| 15 | [Graphics Transport (play/next/stop/clear)](specs/15-graphics-transport.md) | 1 | `claude-sonnet-5` | 14 | ask 1 |
| 16 | [Output Presence & `delivered`](specs/16-output-presence.md) | 1 | `claude-sonnet-5` | 14 | ask 2a |
| 20 | [Normalized Data Sources](specs/20-data-sources.md) | 1 | `claude-sonnet-5` | 14 | ask 4 |
| 21 | [Debug & Diagnostics Overlay](specs/21-debug-diagnostics.md) | 1 | `claude-haiku-4-5-20251001` | 14 | ask 5 |
| 17 | [Control-Page Preview](specs/17-control-preview.md) | 2 | `claude-sonnet-5` | 14, 16 | ask 2b |
| 18 | [Declarative Controls](specs/18-declarative-controls.md) | 2 | `claude-opus-5` | 14, 15, 20 | the "UI not code" keystone |
| 22 | [Text Fit & Overflow Warning](specs/22-text-fit-overflow.md) | 2 | `claude-sonnet-5` | 14, 16 | ask 6 |
| 23 | [Status Strip & Live Clock](specs/23-status-strip-clock.md) | 2 | `claude-haiku-4-5-20251001` | 14, 16 | ask 8 |
| 19 | [Live Field Editing](specs/19-live-field-editing.md) | 3 | `claude-sonnet-5` | 15, 18 | ask 3 |

**Deliberately out of scope** (ask 7, and the parts of the breeze comparison we rejected): ffmpeg alpha transcoding, a visual timeline/keyframe editor, GSAP, weather data providers. Weather is a *documented extension point* in spec 20 §6 but ships no provider — corporate work rarely calls for it.

### Model rationale

Opus is used only where the deliverable is a **schema or API contract that every later spec is written against** — spec 14 (the runtime's public surface) and spec 18 (the control schema). Getting those wrong is expensive to unwind; getting them right is cheap to build on. Everything else is implementation against a settled contract, which is Sonnet work. Specs 21 and 23 are self-contained UI with fully-specified behaviour and go to Haiku.

---

## Wave plan

Concurrent by default. A wave starts only when every spec in the previous wave has merged to `main` and `main` is green.

```
 Wave 0        Wave 1  (4 concurrent)      Wave 2  (4 concurrent)     Wave 3
┌────────┐    ┌──────────────────────┐    ┌────────────────────┐    ┌────────┐
│   14   │───▶│ 15  16  20  21       │───▶│ 17  18  22  23     │───▶│   19   │
│runtime │    │                      │    │                    │    │        │
└────────┘    └──────────────────────┘    └────────────────────┘    └────────┘
   gate         15 ─────────────────────────────▶ 18 ────────────────▶ 19
                16 ─────────────────────────────▶ 17, 22, 23
                20 ─────────────────────────────▶ 18
```

**Why wave 0 is sequential:** every other spec imports from the shared runtime introduced in 14 and edits the same six `assets/state.js` deletions. Running anything alongside it guarantees conflicts.

**Why 18 waits for 15 and 20:** the control schema needs to render transport buttons (15) and data-source-bound fields (20) as first-class field types. Building it first would mean designing those field types blind.

---

## Running it from the CLI

Each spec runs in its own git worktree off `main`, so a wave can execute in parallel without stepping on the shared index.

### One-time

```bash
cd /Users/tom/Documents/Claude/PConAir
git checkout main && git pull
git add plan_approved.md specs/1[4-9]-*.md specs/2[0-3]-*.md && git commit -m "docs: graphics control plane plan + specs 14-23"
```

> The approved filename deliberately avoids `plan.md`, which your global gitignore (`~/.config/git/ignore:4`, pattern `PLAN.md`) swallows on macOS's case-insensitive filesystem. `plan_approved.md` commits normally — no `-f` needed.

### Launch a wave

`scripts/run-wave.sh` is committed alongside this plan. It creates one worktree per spec in the wave, launches a `claude -p` run in each with that spec's model, and waits for all of them.

```bash
./scripts/run-wave.sh <wave-number> [base-ref]
```

`base-ref` defaults to `$GFX_BASE`, else `main`. **Until the specs are merged to `main`, pass the branch that carries them** — otherwise every worktree comes up without `plan_approved.md` and `specs/`, and each agent has nothing to read.

```bash
GFX_BASE=claude/breeze-overlay-graphics-review-f12320 ./scripts/run-wave.sh 0
```

Each run writes to `.claude/worktrees/gfx-<N>.log`. Tail one to watch progress:

```bash
tail -f .claude/worktrees/gfx-14.log
```

### Gate between waves

Do not automate this step. For each spec in the finished wave:

```bash
cd .claude/worktrees/gfx-<N>
npm run typecheck && npm test
git log --oneline main..HEAD
```

Then review the diff, merge, and clean up:

```bash
cd /Users/tom/Documents/Claude/PConAir
gh pr create --base main --head feat/graphics-<N>-<slug> --label claude
# after review + merge:
git worktree remove .claude/worktrees/gfx-<N>
```

**Merge order within a wave** (minimises conflict on shared files): 16 → 15 → 20 → 21 for wave 1; 22 → 23 → 17 → 18 for wave 2. Later merges rebase on `main`.

> **macOS/Google Drive note:** `~/Documents` is Drive-mirrored. If push or fetch fails with `bad object refs/…/Icon?`, that is Drive junk in `.git`, not auth — see the `fix-macos-icon-git-refs` skill.

---

## Definition of done for the whole plan

- [x] `bundled-packages/*/assets/state.js` deleted; all six packages load `/packages/_runtime/pconair.js`. *(spec 14)*
- [ ] A new graphics package can ship a working control panel with **zero hand-written control HTML** — manifest `controls` only. Proven by `demo-packages/template-timer` and `demo-packages/template-overlay` having no `control.html`.
- [ ] An operator can play, hold, advance, stop and clear any render from the control page and from Companion.
- [ ] Every control page shows whether an output is actually connected, and every mutating response carries `delivered`.
- [ ] Every control page shows a live scaled preview of its render.
- [ ] A field edited on air updates the render without replaying its transport timeline.
- [ ] `news` ticker headlines come from a polled data source configured in the UI, not from a JSON file inside the app bundle.
- [ ] `?debug=1` on any render page shows transport state, fps, WS status and last patch, with keyboard verbs bound.
- [ ] Text that will not fit raises a visible warning in the control page before it goes on air.
- [ ] `hoops`, `news` and `ffg` behave exactly as they do today.

---

## Hard rules

- **Branch off `main`, one worktree per spec.** Never run two specs in one worktree.
- **Never use bare `git stash`** — the stash stack is shared across worktrees. Use a WIP commit.
- **Additive manifests.** A package.json written before this plan must load and behave identically after it.
- **No silent scope growth.** If a spec turns out to need something from another spec that is not listed in its dependencies, stop and report it rather than implementing across the boundary.
- **Do not touch** `graphics/` legacy templates or `AppState.graphics` unless the spec names the file.
