# Spec 18 — Declarative Controls

**Status:** Planned · **Date:** 2026-09-09 · **Wave:** 2 (concurrent with 17, 22, 23)
**Model:** `claude-opus-5` · **Depends on:** specs 14, 15, 20 · **Branch:** `feat/graphics-18-declarative-controls`
**Umbrella:** [`../plan_approved.md`](../plan_approved.md)

> This is the keystone of the plan. Everything else improves what an operator can *see* or *do*; this is what removes code editing from the loop. Read `../plan_approved.md` and specs 14, 15 and 20 before starting.

---

## 1. Why

A graphics package today needs a hand-written control page:

| Package | `control.html` |
|---|---|
| `ffg` | 461 lines |
| `news` | 428 lines |
| `hoops` | 394 lines |
| `demo-scores` | 361 lines |

That is ~1,600 lines of hand-maintained HTML, CSS and DOM wiring across four packages, doing the same four things: draw an input, send a patch on change, re-render from state, and avoid clobbering the operator's cursor while they type. `bundled-packages/hoops/control.html:350-370` is the whole pattern, repeated per field.

The consequence is not just duplication. It is that **every change to what an operator can adjust is a code change** — restyling a lower third, exposing a colour, adding a headline field. The manifest already describes state and Companion declaratively (`loader.ts:106`). The operator UI is the last thing that does not.

## 2. What already exists — do not rebuild

- **`src/main/packages/loader.ts:24`** — `PackageSchemaLeaf`, `PackageSchema`, `defaultStateFromSchema`. Controls annotate this schema; they do not replace it.
- **`loader.ts:46`** — `PkgCompanionOption` already models a control-ish input (`number`, `textinput`, `dropdown`, `checkbox`). **Reuse its vocabulary** where it fits so a package author does not learn two type systems.
- **Spec 15** — `client.verb()`, `client.transport`, `RenderTransportState`. Transport buttons are a control type, not new plumbing.
- **Spec 20** — `PackageDataSource`, `_data` state, the override routes. The data control type is a view onto those routes.
- **Spec 14** — `pconair.css` and its `--pc-*` tokens. The generated panel styles from these; do not introduce a second token set.
- **Spec 16 / 17 / 22** — `presenceIndicator`, `preview`, `warningsPanel`. The generated panel composes these; do not reimplement them. Feature-detect each, since merge order within wave 2 is not guaranteed.
- **`src/main/routes/packages.ts:188`** — `GET /packages/:id/control`. It serves `control.html` when present; §3.6 makes it fall back to the generated panel.

## 3. Design

### 3.1 Principle

The manifest declares **what an operator may change**. The runtime decides **how it is drawn**. A package author writes zero HTML for the panel and gets a consistent one for free; the operator gets the same interaction model in every package.

### 3.2 The schema

New optional `controls` on `PackageManifest`:

```ts
export interface PackageControls {
  /** Ordered. Rendered as titled sections. */
  groups: ControlGroup[];
}

export interface ControlGroup {
  id: string;
  label: string;
  /** Collapsed on first load. Operator's choice persists per viewer. */
  collapsed?: boolean;
  /** Narrows this group to one render's panel. Absent = always shown. */
  renderId?: string;
  fields: ControlField[];
}

export type ControlField =
  | TextField | NumberField | ToggleField | SelectField
  | ColorField | SliderField | AssetField
  | TransportField | DataField | ActionField | StaticField;

interface FieldBase {
  /** Dotted path into the package's state, e.g. "home.score". Required for
      value-bearing fields, absent for transport/action/static. */
  field?: string;
  label: string;
  /** Operator-facing hint under the input. */
  help?: string;
  /** Show only when another field's value matches. Enables "logo position"
      appearing only once "show logo" is on. */
  showIf?: { field: string; equals: string | number | boolean };
  /** Width hint. Default 'full'. */
  span?: 'full' | 'half' | 'third';
}

interface TextField     extends FieldBase { type: 'text'; multiline?: boolean; maxLength?: number; placeholder?: string }
interface NumberField   extends FieldBase { type: 'number'; min?: number; max?: number; step?: number;
                                            /** Renders -/+ buttons beside the input. */ bump?: number[] }
interface ToggleField   extends FieldBase { type: 'toggle' }
interface SelectField   extends FieldBase { type: 'select'; choices: Array<{ id: string | number; label: string }> }
interface ColorField    extends FieldBase { type: 'color'; /** Also offer these as swatches. */ swatches?: string[] }
interface SliderField   extends FieldBase { type: 'slider'; min: number; max: number; step?: number; unit?: string }
interface AssetField    extends FieldBase { type: 'asset'; accept?: 'image' | 'video' | 'any' }
interface TransportField extends FieldBase { type: 'transport'; renderId: string; field?: never }
interface DataField     extends FieldBase { type: 'data'; sourceId: string; field?: never }
interface ActionField   extends FieldBase { type: 'action'; /** Patch merged on click. */ patch: Record<string, unknown>;
                                            confirm?: string; variant?: 'default' | 'danger' }
interface StaticField   extends FieldBase { type: 'static'; text: string; field?: never }
```

### 3.3 Look controls — the point of the exercise

The stated goal is *"control more of the look of graphics from a UI and less via code editing."* Field types alone do not achieve that; a package must be able to expose its **styling** as state, and its render must consume it as CSS.

The convention, documented and enforced by a helper rather than by each package:

- A package declares style state under a `style` key in its `stateSchema` — e.g. `style: { accent: 'string', panelOpacity: 'number', corner: 'number', font: 'string' }`.
- The manifest exposes those with `color`, `slider` and `select` fields in a group labelled "Look".
- The runtime applies them to the render automatically:

```js
/** Mirror a state subtree onto :root as CSS custom properties.
    { accent: '#c8a24a', panelOpacity: 0.9 } → --pc-accent: #c8a24a; --pc-panel-opacity: 0.9
    camelCase becomes kebab-case; numbers pass through unitless. */
client.applyStyle(subtree = 'style', prefix = '--pc-')
```

A render then authors against variables — `background: rgb(0 0 0 / var(--pc-panel-opacity))` — and the operator restyles it live from the panel, with the change visible in the preview (spec 17) at the same instant.

**Validation:** `color` values are checked server-side against `/^#[0-9a-fA-F]{3,8}$/` or a fixed set of named colours before entering state, and `applyStyle` refuses any value containing `;`, `}`, `/*` or `url(`. State reaches a `style` attribute, so an unvalidated value is a CSS injection into every output.

### 3.4 The generated panel

`window.PConAir.controlPanel(el, opts)` renders, in order:

1. **Header** — package name, `presenceIndicator` (spec 16), reconnect state.
2. **Preview** (spec 17) when the package has ≥1 render, with a render selector when it has more.
3. **Warnings** (spec 22) when any are live.
4. **Groups**, in manifest order.

Interaction rules — these are the things every hand-written panel gets wrong:

- **Never clobber a focused input.** Incoming state updates skip any element that has focus, and reconcile on `blur`. `hoops/control.html:232`'s `syncInput` gets this right and is the reference.
- **Debounce text and slider input at 150 ms**; commit immediately on `change`, `blur` and `Enter`. Typing a name must not emit a patch per keystroke.
- **Optimistic then reconciled.** Apply locally on input, then accept the server's echo as truth. A rejected patch visibly reverts.
- **`delivered: 0`** (spec 16) shows a one-line, non-blocking notice under the header: *"Applied — no output is connected."* Never a modal, never an error style.
- **Disabled while disconnected.** When `client.connected` is false, inputs go `aria-disabled` and a banner explains why. Silently swallowing an operator's edit during a dropout is worse than refusing it.
- **Keyboard and labels.** Every input has a real `<label for>`; groups are `<fieldset>`/`<legend>`; the panel is fully tab-navigable. Operators work these panels in the dark with one hand.

### 3.5 Field → patch mapping

`field` is a dotted path. The panel builds a nested patch object, because `POST /api/packages/:id/state` shallow-merges:

```
field "home.score", value 3  →  patch { home: { ...currentHome, score: 3 } }
```

Read the current sibling values from `client.state` so a shallow merge does not drop them. Array indices are supported (`scores.0`), reusing the dotted-path convention already established for Companion field paths (`loader.ts:31`).

### 3.6 Serving the panel

`GET /packages/:id/control` (`routes/packages.ts:188`):

1. If the package has `control.html` → serve it, unchanged. **Existing packages keep their hand-written panels.**
2. Else if the manifest has `controls` → serve a generated shell that loads the runtime and calls `controlPanel`.
3. Else → the current 404.

A package may also have both: `control.html` can call `PConAir.controlPanel()` itself for part of the page and hand-write the rest. That escape hatch matters — a scorebug's clock controls will always want bespoke treatment.

New route `GET /api/packages/:id/controls` (operator) returns the validated `PackageControls`, so the generated shell fetches one small document rather than the whole manifest.

### 3.7 Validation

In `validateManifest`, with messages naming the group and field:

- Group ids unique; field `label` non-empty.
- Every `field` path resolves against `stateSchema` — a typo'd path is caught at load, not by an operator wondering why a control does nothing.
- Leaf type matches field type: `text`→`string`, `number`/`slider`→`number`, `toggle`→`boolean`, `color`/`select`/`asset`→`string`.
- `select` has ≥1 choice; `slider` has `min < max`.
- `transport.renderId` names a render that declares `transport` (spec 15).
- `data.sourceId` names a declared data source (spec 20).
- `showIf.field` resolves.
- `action.patch` paths resolve.

If spec 15 or 20 has not merged when this runs, skip only that specific check and leave a comment naming the spec. Do not stub their types.

### 3.8 Proof: two packages with no control HTML

- **`demo-packages/template-timer`** — port `control.html` (110 lines) to `controls`, then delete the file.
- **`demo-packages/template-overlay`** — port `control.html` (125 lines), then delete it. It gains spec 15's transport in wave 1, so its panel gets a `transport` field: the end-to-end demonstration that a package can declare a full operator surface with zero UI code.

Both must also gain a **"Look"** group per §3.3 — accent colour, panel opacity, corner radius — with renders reading the variables. This is the acceptance demo for the plan's stated goal.

`hoops`, `news`, `ffg` and `demo-scores` keep their hand-written panels. Migrating them is follow-up work, not this spec.

### 3.9 Files

**Create**
- `src/runtime/pconair-controls.js` — the panel renderer.
- `src/main/packages/controls-validate.ts` — validation, imported by `loader.ts` to keep that file readable.
- `tests/declarative-controls.test.ts`
- `tests/declarative-controls-render.test.ts`

**Modify**
- `src/main/packages/loader.ts` — `PackageControls` and the field union; call the validator.
- `src/main/routes/packages.ts` — generated-shell fallback, `GET /api/packages/:id/controls`, colour validation on `POST /state` for `color`-typed fields.
- `src/runtime/pconair.js` — `controlPanel`, `applyStyle`, conditional load of `pconair-controls.js`.
- `src/runtime/pconair.css` — the full panel stylesheet.
- `demo-packages/template-timer/*`, `demo-packages/template-overlay/*`
- `docs/designing-packages.md`, `docs/package-graphics-standard.md`

## 4. Tasks

- [ ] **T1 — Schema types + basic validation.** Test: a valid two-group manifest passes; duplicate group ids, an empty label, a `select` with no choices, and a `slider` with `min >= max` each fail with a message naming the group and field. Commit.
- [ ] **T2 — Path resolution against `stateSchema`.** Test: `field: "home.score"` validates against `{home: {score: 'number'}}`; `"home.scor"` fails naming the path; `"scores.0"` validates against an array leaf. Commit.
- [ ] **T3 — Type agreement.** Test: `type: 'text'` on a `number` leaf fails; each of the seven value-bearing types validates against its correct leaf type. Commit.
- [ ] **T4 — Cross-references.** Test: `transport.renderId` naming a non-transport render fails; `data.sourceId` naming an undeclared source fails; `showIf.field` and `action.patch` paths are resolved. Guard each behind a merged-spec check per §3.7. Commit.
- [ ] **T5 — `GET /api/packages/:id/controls`.** supertest: returns the validated structure for operator, 401 unauthenticated, 404 for a package with no `controls`. Commit.
- [ ] **T6 — Serving precedence.** supertest: a package with `control.html` serves it; one with only `controls` serves the generated shell; one with neither 404s. Commit.
- [ ] **T7 — Render text, number, toggle, select.** jsdom test: each produces a labelled input reflecting state; changing it emits the correctly-nested patch per §3.5. Assert sibling keys survive the shallow merge. Commit.
- [ ] **T8 — Focus is never clobbered.** Test: focus a text input, deliver a state frame with a different value, assert the input's value is unchanged; blur it and assert it reconciles. Commit.
- [ ] **T9 — Debounce.** Test with fake timers: five `input` events in 100 ms emit one patch after 150 ms; a `change` event emits immediately. Commit.
- [ ] **T10 — Optimistic + revert.** Test: the input updates before the response; a rejected patch reverts it to the last known state. Commit.
- [ ] **T11 — `delivered: 0` notice.** Test: a response with `delivered: 0` renders the §3.4 notice, non-blocking and not error-styled; `delivered: 1` renders none. Commit.
- [ ] **T12 — Disconnected state.** Test: `connected: false` marks inputs `aria-disabled` and shows the banner; reconnecting clears both. Commit.
- [ ] **T13 — Colour validation.** Test: `#c8a24a` and `#fff` are accepted; `red; background: url(x)`, `expression(1)` and `}` are rejected by the server with 400 and by `applyStyle` client-side. Commit.
- [ ] **T14 — `applyStyle`.** Test: `{accent: '#c8a24a', panelOpacity: 0.9}` sets `--pc-accent` and `--pc-panel-opacity` on `:root`; camelCase → kebab-case; a value containing `;` is dropped, not written. Commit.
- [ ] **T15 — `showIf`.** Test: a field with `showIf` is absent from the DOM when unmatched and present when matched, updating live. Commit.
- [ ] **T16 — Transport, action, asset, data, slider, static.** One test each: transport renders four buttons calling `client.verb`; action merges its patch and honours `confirm`; asset opens the existing upload flow at `POST /api/packages/:id/assets`; data shows row count, age, error, and a refresh button hitting spec 20's route; slider commits on `change`; static renders text and no input. Guard the transport and data cases per §3.7. Commit.
- [ ] **T17 — Accessibility.** Test: every input has an associated `<label for>`, groups are `<fieldset>`/`<legend>`, and tab order follows manifest order. Commit.
- [ ] **T18 — Port `template-timer`.** Declare `controls`, add a Look group, delete `control.html`. Test: `GET /packages/template-timer/control` returns the generated shell and the package directory contains no `control.html`. Commit.
- [ ] **T19 — Port `template-overlay`.** Same, including a transport field and a Look group whose values drive the render's CSS variables. Commit.
- [ ] **T20 — Regression guard.** Test: `hoops`, `news`, `ffg` and `demo-scores` still serve their hand-written `control.html` byte-for-byte. Commit.
- [ ] **T21 — Docs.** Full field-type reference, the Look convention, the `control.html` escape hatch, and a worked package walkthrough. Commit.

## 5. Acceptance

- [ ] `demo-packages/template-timer` and `demo-packages/template-overlay` contain **no `control.html`** and both serve a complete, working operator panel.
- [ ] An operator changes accent colour, panel opacity and corner radius from the panel and sees the render restyle live in the preview — **with no file edited and no reload**.
- [ ] `template-overlay`'s panel drives its two-stop transport.
- [ ] Typing in a text field never loses characters to an incoming state frame, and emits one patch per pause, not one per keystroke.
- [ ] A patch with nothing listening shows an informational notice, not an error.
- [ ] A manifest with a typo'd `field` path fails at load with a message naming the group, field and path.
- [ ] A colour value containing CSS syntax is rejected server-side and never reaches a render.
- [ ] `hoops`, `news`, `ffg` and `demo-scores` are byte-identical in behaviour to `main`.
- [ ] `npm run typecheck && npm test` green.

## 6. Out of scope

Live-editing semantics against a held graphic (spec 19). Migrating the four hand-written panels. A visual builder for the manifest itself. Per-operator layout customisation. Drag-to-reorder. Generating Companion presets from `controls` — the manifest's `companionActions` already covers that and duplicating it here would create two sources of truth.
