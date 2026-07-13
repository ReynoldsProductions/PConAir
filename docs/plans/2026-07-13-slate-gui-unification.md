# PC On Air — Slate GUI Unification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to
> implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking. Model
> assignment per task follows the user's original brief (see "Model assignment logic" below) —
> **always pass the model explicitly when dispatching an implementer for a task in this plan.**

## Model assignment logic

- **Sonnet 4.6** (`sonnet`): novel/judgment-heavy work — the React bootstrap, first screen in
  each new pattern, final scope review.
- **Haiku 4.5** (`haiku`): table-driven, fully-specified, or repeat-of-pattern work.

**Goal:** Replace the hand-rolled vanilla-DOM UI (and its bespoke `:root` token blocks / `.btn`,
`.input-field`, `.select-input`, `.badge`, `.item-row` classes) across the three Electron
renderers — `operator`, `admin`, `remote` — with Faire's Slate React component library, screen by
screen, while preserving 100% of existing runtime behavior (WebSocket state sync, keyboard
shortcuts, API wiring). This is a UI-layer migration, not a feature change — behavior parity is
the correctness bar for every task, not just "renders something."

**Slate DS source (already on disk, not part of this repo):**
`/Users/tom/Documents/Claude/PConAir/docs/_ds/slate-design-system-eb783077-da51-4bea-ad5c-18cededa2449/`
— read `README.md` there first (§ "Tokens" = the token table, § "Components" = the component
list referenced elsewhere in this plan as "§1"/"§2"). Per-component usage is in
`components/<group>/<Name>/<Name>.prompt.md` + `<Name>.d.ts` inside that same directory.

**Human checkpoints:** this plan has explicit ⏸️ points where an agent must stop and a human must
visually confirm the app inside Electron before continuing. Do not skip these — automated
typecheck/build/test passing is not sufficient evidence for a UI migration; screenshots or a live
look are required. The first one is at the end of Task 2.

---

## Global Constraints (bind every task in this plan)

1. **Behavior parity.** Every DOM id/attribute that `src/renderer/*/index.ts` (or its `api.ts` /
   `state.ts` helpers) reads or writes must keep working. If a migrated region's markup+behavior
   moves into a React component, the component must own *both* rendering and event binding for
   that region — do not leave the old vanilla `renderState()`/`bindEvents()` code touching the
   same DOM nodes a React tree also renders (dual-write will desync). Everything not explicitly
   in-scope for the current task (other tabs, other renderers, watchdog banners, panic banner
   overlay, error toast) must be left untouched, byte-for-byte, until its own task migrates it.
2. **React delivery = local UMD, not CDN.** `react` and `react-dom` are added as devDependencies
   (version `^18`) purely so (a) their official UMD builds ship in
   `node_modules/react/umd/react.development.js` and
   `node_modules/react-dom/umd/react-dom.development.js` for vendoring, and (b) `@types/react` /
   `@types/react-dom` resolve for typechecking. The actual browser runtime is the vendored UMD
   file loaded via a `<script>` tag — **never** a `https://unpkg.com/...` or other CDN script tag.
   This app controls live broadcasts; it must keep rendering if the network is down mid-show. The
   Slate bundle's webfonts (`fonts/fonts.css`, from `cdn.faire.com`) are the one exception already
   present in the DS bundle — leave that as-is (fonts degrade gracefully to system fallback;
   React does not).
3. **Webpack externals.** In `forge.config.ts`, the renderer webpack config's `module.rules` must
   keep matching `.tsx` (already does: `/\.tsx?$/`), and must add
   `externals: { react: 'React', 'react-dom': 'ReactDOM' }` so bundled `.tsx` files can
   `import React from 'react'` / `import ReactDOM from 'react-dom'` at the source level (for
   normal typechecked imports) while webpack leaves those as references to the UMD globals
   instead of bundling React's source into the output.
4. **Test build path.** `tests/setup/build-operator-renderer.ts` runs an esbuild pre-bundle of the
   operator entry point before the vitest suite runs (see `vitest.config.ts` `globalSetup`). Any
   task that touches `src/renderer/operator/index.ts` (or renames it to `.tsx`) must update that
   esbuild config's `entryPoints` path to match, and add `external: ['react', 'react-dom']` to its
   `build()` options — otherwise esbuild will try (and fail) to resolve `react` as a real module.
5. **Styling idiom.** Per the Slate README: style Slate components via **props**, never via
   passed-in CSS classes or Tailwind utility classes. Layout/spacing *around* Slate components
   uses the `--slate-*` CSS custom properties from `_ds_bundle.css`, never raw hex values or the
   old `--bg`/`--surface-2`/`--border`/etc. tokens. `SlateDSProvider` must wrap the tree once, at
   the root, above all Slate component usage, or components throw
   (`[React Intl] Could not find required intl object`).
6. **Verification per task, minimum bar:** `npm run typecheck` and `npm test` both clean, plus
   (once React is wired) a webpack/electron-forge build (`npx electron-forge start` or equivalent)
   that boots without console errors. This is necessary but not sufficient — see human checkpoints
   above.

---

## File Map (after Task 1 + Task 2)

```
PConAir/
├── package.json                        # + react, react-dom, @types/react, @types/react-dom (devDeps)
├── tsconfig.json                       # + "jsx": "react"
├── forge.config.ts                     # renderer config + externals: { react, 'react-dom' }
├── src/renderer/
│   ├── vendor/
│   │   ├── react/
│   │   │   ├── react.development.js        # copied from node_modules/react/umd/
│   │   │   └── react-dom.development.js    # copied from node_modules/react-dom/umd/
│   │   └── slate/
│   │       ├── _ds_bundle.js
│   │       ├── _ds_bundle.css
│   │       ├── styles.css
│   │       └── fonts/
│   │           └── fonts.css
│   └── operator/
│       ├── index.html                  # + React/ReactDOM/Slate <script>/<link> tags, #app-root
│       ├── index.tsx                   # renamed from index.ts; mounts React root
│       ├── components/
│       │   └── LiveControl.tsx         # status header + A/B panel + Mode grid (Task 2)
│       ├── state.ts                    # unchanged
│       └── api.ts                      # unchanged
└── tests/setup/build-operator-renderer.ts   # entry path + externals updated for Task 2
```

---

## Task 1: Branch setup + vendor Slate (and React UMD) into the repo

**Model: `haiku`** (Phase 0 — mechanical, fully specified)

**Files:**
- Create: `src/renderer/vendor/slate/_ds_bundle.js`, `_ds_bundle.css`, `styles.css`,
  `fonts/fonts.css`
- Create: `src/renderer/vendor/react/react.development.js`, `react-dom.development.js`
- Modify: `package.json` (add devDependencies)

- [x] **Step 1: Create and check out the feature branch** — done (`feature/slate-gui-unification`).

- [x] **Step 2: Install React as devDependencies** — done directly by the controller after a
  sandbox-permission false start (npm needed unsandboxed access to `~/.npm`, not a real
  root-owned-cache bug). `react@^18`, `react-dom@^18`, `@types/react@^18`, `@types/react-dom@^18`
  are now in `package.json` devDependencies in this worktree.

- [ ] **Step 3: Vendor the React UMD builds**

  ```bash
  mkdir -p src/renderer/vendor/react
  cp node_modules/react/umd/react.development.js src/renderer/vendor/react/
  cp node_modules/react-dom/umd/react-dom.development.js src/renderer/vendor/react/
  ```

  Use the **development** build, not `.production.min.js` — the dev build's console warnings
  (key props, deprecated lifecycle, etc.) are exactly what Task 2's "no console errors" checkpoint
  needs to catch. Switching to the production build is a later, separate decision (Phase 7
  ship-it hardening), not this task's call to make.

- [ ] **Step 4: Vendor the Slate design system bundle**

  Source directory (read-only, outside this repo):
  `/Users/tom/Documents/Claude/PConAir/docs/_ds/slate-design-system-eb783077-da51-4bea-ad5c-18cededa2449/`

  ```bash
  mkdir -p src/renderer/vendor/slate/fonts
  DS_SRC="/Users/tom/Documents/Claude/PConAir/docs/_ds/slate-design-system-eb783077-da51-4bea-ad5c-18cededa2449"
  cp "$DS_SRC/_ds_bundle.js" src/renderer/vendor/slate/
  cp "$DS_SRC/_ds_bundle.css" src/renderer/vendor/slate/
  cp "$DS_SRC/styles.css" src/renderer/vendor/slate/
  cp "$DS_SRC/fonts/fonts.css" src/renderer/vendor/slate/fonts/
  ```

  Copy exactly these four files — not the whole `$DS_SRC` tree (it also contains
  `_adherence.oxlintrc.json`, `_ds_manifest.json`, per-component `.prompt.md`/`.d.ts`/`.html`
  reference docs, and a stray macOS `Icon` file, none of which the running app needs). `styles.css`
  does `@import "./fonts/fonts.css"; @import "./_ds_bundle.css";` — both must land at those
  relative paths inside `src/renderer/vendor/slate/` for the imports to resolve.

  Note: `$DS_SRC` is outside this repo/worktree (in the main checkout's `docs/_ds/`), so it is
  read-only reference material shared across worktrees — never write to it.

- [ ] **Step 5: Verify nothing else broke**

  ```bash
  cd /Users/tom/Documents/Claude/PConAir/.claude/worktrees/model-assignment-logic-9b020e && npm run typecheck && npm test
  ```
  Expected: same pass/fail state as before this task (no source files changed yet, only vendored
  assets + devDependencies) — confirms the `npm install` didn't perturb anything.
  **Run this from the worktree directory above — not `/Users/tom/Documents/Claude/PConAir`
  (the main checkout, on a different branch). Mixing the two up is easy and has already happened
  once in this session; double-check `pwd` and `git branch --show-current` before running
  anything that writes files.**

- [ ] **Step 6: Commit**

  ```bash
  git add package.json package-lock.json src/renderer/vendor/
  git commit -m "chore: vendor React 18 UMD build and Slate design system bundle"
  ```

---

## Task 2: React/Slate bootstrap on Operator Live Control ⏸️ HIGHEST RISK

**Model: `sonnet`** (Phase 1 — novel judgment: first React root in the app, first Slate
component pattern, touches the live-broadcast control surface)

**Depends on:** Task 1 (vendored React + Slate must exist at the paths above).

**Scope — in:** the status header bar (machine name, WS dot/label, Companion dot, mode badge,
show-lock badge, PANIC button) and the "Live Control" tab's two panels (A/B Instance, Mode grid)
in `src/renderer/operator/index.html` / `index.ts`.
**Scope — out (do not touch):** every other `<section data-tab="...">` (Slides, URL Mode, Lower
Thirds, Lower Third — Live, Media Library, Status, Speaker Notes, Settings), the sidebar nav, the
watchdog banners, the panic banner overlay, the error toast. Those keep their current vanilla
markup/JS until their own later task in this plan.

**Current markup being replaced** (read `src/renderer/operator/index.html` lines 920–960 for the
exact current version before editing — it may have drifted slightly since this plan was written):

```html
<header class="status-bar">
  <span class="status-bar-machine" id="machine-name-label">PC On Air</span>
  <div class="status-bar-indicators">
    <div class="status-indicator">
      <span class="led" id="ws-dot"></span>
      <span id="ws-label">Disconnected</span>
    </div>
    <div class="status-indicator">
      <span class="led" id="companion-dot"></span>
      <span>Companion</span>
    </div>
    <span id="mode-badge" class="mode-badge">IDLE</span>
    <span id="show-lock-badge">SHOW LOCKED</span>
    <button type="button" id="panic-btn" class="btn btn-primary">PANIC</button>
  </div>
</header>
...
<section data-tab="dashboard">
  <h1 class="page-title">Live Control</h1>
  <div class="panel">
    <div class="panel-title">A/B Instance</div>
    <div class="ab-row">
      <button type="button" class="ab-btn" id="ab-a-btn" data-instance="A">A</button>
      <button type="button" class="ab-btn" id="ab-b-btn" data-instance="B">B</button>
    </div>
  </div>
  <div class="panel">
    <div class="panel-title">Mode</div>
    <div class="mode-btn-grid">
      <button type="button" class="btn btn-secondary" data-mode="idle">Idle</button>
      <button type="button" class="btn btn-secondary" data-mode="slides">Slides</button>
      <button type="button" class="btn btn-secondary" data-mode="url">URL</button>
      <button type="button" class="btn btn-secondary" data-mode="l3">Lower Thirds</button>
      <button type="button" class="btn btn-secondary" data-mode="media-library">Media Library</button>
    </div>
  </div>
</section>
```

**Current behavior being ported** (from `src/renderer/operator/index.ts` — read the full current
file before editing):
- `setWsStatus(connected)` toggles the `ws-dot`/`ws-label` — called from the WebSocket
  `open`/`close` handlers in `connectWs()`.
- `renderState(state)` (called on every `store.subscribe` notification) sets: mode badge text +
  className from `state.currentMode`; show-lock badge visibility from
  `state.connectionStatus.adminShowLocked`; panic button text ("PANIC" / "UN-PANIC") and banner
  visibility from `state.reliability.panicActive`; companion dot from
  `state.connectionStatus.companionConnected`; A/B button `.active` class from
  `state.abState.activeInstance`.
- `bindEvents()` wires: `panic-btn` click → `api.panicAction('toggle')`; each `.ab-btn` click →
  `api.switchAB(btn.dataset.instance)`; each `[data-mode]` button click → `api.setMode(btn.dataset.mode)`.
  All three wrap the call in try/catch and call `showError((e as Error).message)` on failure —
  preserve this error-toast behavior for the ported buttons too.
- The panic **banner overlay** (`#panic-banner`) and its "UN-PANIC" text update are visually
  adjacent but out of scope for this task — leave `renderState`'s two lines that touch
  `panic-banner`/`panic-btn` textContent as-is for the banner, but the PANIC **button** itself
  moves into the React tree (it's inside the ported status header).

**Implementation approach:**

1. Rename `src/renderer/operator/index.ts` → `src/renderer/operator/index.tsx`. Update every
   reference to that filename: `forge.config.ts` renderer entryPoints (`js:` for the `operator`
   entry) and `tests/setup/build-operator-renderer.ts` (`entryPoints`).
2. `tsconfig.json`: add `"jsx": "react"` to `compilerOptions`.
3. `forge.config.ts`: add `externals: { react: 'React', 'react-dom': 'ReactDOM' }` to the
   renderer webpack `config` block (sibling to the existing `module`/`resolve` keys).
4. `tests/setup/build-operator-renderer.ts`: add `external: ['react', 'react-dom']` to the
   esbuild `build()` call options, and update `entryPoints`/`outfile` for the `.tsx` rename
   (outfile stays `index.js` — only the source entry path changes extension).
5. `src/renderer/operator/index.html`:
   - Add, before the existing `<style>` block or right after it (either is fine — Slate CSS
     import order relative to the page's own `<style>` doesn't matter here since the migrated
     region won't use the old `.btn`/`.ab-btn`/`.mode-badge`/etc. rules anymore, and other
     sections still need those rules untouched):
     ```html
     <script src="../vendor/react/react.development.js"></script>
     <script src="../vendor/react/react-dom.development.js"></script>
     <link rel="stylesheet" href="../vendor/slate/styles.css" />
     <script src="../vendor/slate/_ds_bundle.js"></script>
     ```
     Confirm the relative path resolves correctly from wherever webpack emits
     `operator/index.html` in `.webpack/renderer/` (check a built output path, e.g.
     `.webpack/renderer/operator/index.html`, to confirm `../vendor/...` actually lands on
     `.webpack/renderer/vendor/...` — if webpack's dev server / asset pipeline doesn't copy
     `src/renderer/vendor/` into `.webpack/renderer/vendor/` automatically, you'll need to check
     whether `@electron-forge/plugin-webpack`'s asset-copying needs a rule for this — e.g. a
     `CopyWebpackPlugin` entry or `static` asset handling. Report exactly what you find either
     way; this is the part of this task most likely to need a follow-up decision.
   - Replace the `<header class="status-bar">...</header>` block and the `<section
     data-tab="dashboard">...</section>` block's two panels with a single mount point, e.g.
     `<div id="app-root"></div>`, placed where the status header currently sits, and update the
     dashboard section to contain a second mount point (or reuse one root rendering both regions
     — implementer's call, document which) instead of its current panel markup. Keep
     `<section data-tab="dashboard">` itself (the `hidden` attribute / tab-switching logic in
     `bindEvents()` still targets it by `data-tab="dashboard"`) — only its *inner* panel markup is
     replaced by the mount point.
6. `src/renderer/operator/components/LiveControl.tsx` (new): Slate-based components for the
   status header contents and the two Live Control panels, using `window.Slate.Tag` for the mode
   badge (per the plan's explicit call-out), `window.Slate.Button` for PANIC / A/B / Mode buttons.
   Read `Tag.prompt.md`/`Tag.d.ts` and `Button.prompt.md`/`Button.d.ts` under the Slate DS source
   directory's `components/` tree (see Global Constraints) for exact prop contracts before
   composing — e.g. `Tag` variants for idle/slides/url/l3/media-library states, `Button`
   `variant="primary"` `destructive` for PANIC.
7. `src/renderer/operator/index.tsx`: replace the DOM-mutating lines in `renderState()` and the
   event-binding lines in `bindEvents()` that touch the migrated elements (see "current behavior"
   above) with a single React render call driven by `store.subscribe` — e.g. mount once at boot
   with `ReactDOM.createRoot(...)` (verify the vendored UMD global actually exposes `createRoot`
   on `window.ReactDOM`; if it doesn't, use `ReactDOM.render` instead and note that in your
   report — this is a real open question, not a formality), then re-render on every state
   change with the latest `AppState` and the same `api.*` functions as props/handlers.
8. Everything else in `renderState()`/`bindEvents()` (slides panel, URL status line, L3 line,
   etc.) stays exactly as it is today — do not refactor unrelated code "while you're in there."

**Verification:**

- [ ] **Step A:** `npm run typecheck && npm test` — both clean.
- [ ] **Step B:** Build the renderer and boot the app:
  ```bash
  npm start
  ```
  Watch both the terminal (main-process/webpack-dev-server output) and, once the Electron window
  opens, open DevTools in the operator window (Cmd+Option+I) and check the Console tab. Report
  any errors/warnings verbatim in your task report — do not paraphrase away a warning as
  "harmless" yourself; that's a judgment call for the reviewer/human, not something to decide.
- [ ] **Step C: Commit**
  ```bash
  git add -A
  git commit -m "feat: React/Slate bootstrap on Operator Live Control tab"
  ```

**⏸️ HUMAN CHECKPOINT — stop here.** Do not proceed to Task 3 until a human has visually
confirmed the Operator window inside Electron: status header renders correctly (WS/Companion
dots, mode badge via `Slate.Tag`, PANIC button), A/B panel and Mode grid work and reflect real
state changes, and no visual regression against the previous vanilla version (screenshot
comparison recommended). This is called out explicitly because everything downstream (Phases 2–7)
repeats whatever pattern gets established here across ~15 more screens — get this one right
before it propagates.

---

## Remaining Phases (outline — detail each into full Task N briefs before dispatching)

These continue numbering from Task 3. Do not treat the bullet points below as sufficient specs to
hand an implementer directly — each needs the same treatment Task 2 got (read the current
HTML/TS for that tab, identify exact ids/behavior, write the explicit before/after) before
dispatch. Recorded here so the plan is resumable across sessions without re-deriving the phase
breakdown or model assignments.

### Phase 2 — Operator: remaining tabs + tokens
- Task 3 — `sonnet`: Slides tab (establishes TextInput/Select/Button/Tag pattern for the rest of
  the app).
- Task 4 — `sonnet`: Lower Third — Live tab (+ apply the nav label renames already visible in
  today's sidebar, e.g. tidy "Lower Thirds (ATEM Export)" / "Lower Third — Live (use this)" into
  cleaner Slate-era labels — confirm exact wording with a human before finalizing copy changes).
- Task 5 — `haiku`: Speaker Notes, URL Mode, Lower Thirds — ATEM Cues, Media Library, Settings,
  Status tabs (same pattern, no new components).
- Task 6 — `haiku`: delete operator's custom `:root` token block and `.btn`/`.input-field`/
  `.select-input`/`.badge`/`.ab-btn`/`.mode-btn-grid`/etc. rules once nothing references them;
  apply the Slate token table from the DS README in their place for any remaining bespoke layout
  CSS (sidebar, status-bar shell, etc. that Slate doesn't have components for).

### Phase 3 — Admin bootstrap + Dashboard
- Task 7 — `haiku`: repeat the Task 2 bootstrap pattern (React/Slate script tags, `.tsx` rename,
  `#app-root`) for `admin/index.html` (currently `index.ts` is a 2-line stub — check what actually
  renders the Admin SPA before assuming this is symmetrical with operator).
- Task 8 — `haiku`: delete the duplicate "Monitors" nav item + duplicate `case 'monitors'` (pure
  deletion — locate both occurrences in the admin source first, don't guess).
- Task 9 — `haiku`: delete admin's dark `:root` block, apply Slate tokens, drop `--accent`.
- Task 10 — `sonnet`: port Admin Dashboard to Slate, reusing Operator's shell pattern from Task 2;
  confirm visual parity with today's Admin Dashboard.

### Phase 4 — Admin CRUD lists
- Task 11 — `sonnet`: URL Presets, L3 Cues (establishes ListItem/ListItemEnd action-row pattern).
- Task 12 — `haiku`: L3 Themes, Profiles, Packages, Background presets, remaining CRUD sections
  (same pattern).

### Phase 5 — Control panel (remote)
- Task 13 — `haiku`: bootstrap into `remote/index.html` (third repetition of the pattern).
- Task 14 — `sonnet`: Slides page, Lower Thirds page — mobile layout; the bottom tab bar stays
  custom (tokens only, no Slate nav component swap).
- Task 15 — `haiku`: Stills, Packages, URLs, Timer, Settings pages.

### Phase 6 — Scope/consistency review
- Task 16 — `sonnet`: grep the whole renderer tree for surviving `.btn`/`.input-field`/
  `.select-input`/`.badge`/`.item-row` classes; confirm no dark-theme remnants or `--accent`
  leftovers; confirm both nav fixes (Task 4 renames, Task 8 dedup) landed; confirm no IA/layout
  drift (24px content padding, 220px sidebar — note: today's sidebar is 180px per the current
  CSS, not 220px — reconcile this discrepancy with a human before treating either number as
  correct); confirm the icon-button decision was applied consistently (glyph `Button`, not
  `IconButton`, everywhere a bare-icon button was needed).

### Phase 7 — Ship it
- Task 17 — `haiku`: build/lint/typecheck, fix trivial failures, commit.
- Task 18 — `sonnet`: write the PR description (screen-by-screen summary; note visual QA still
  needs human eyes at each of this plan's ⏸️ checkpoints).
- Task 19 — `haiku`: push branch, `gh pr create`.

---

## Progress Ledger

(Appended to as tasks complete — see `.superpowers/sdd/progress.md` for the live version during
execution.)

- Task 1: in progress — branch renamed, `npm install` for React/Slate devDeps done directly by
  the controller in the worktree (after a false-start in the main repo checkout, reverted). UMD +
  DS bundle vendoring still pending.
