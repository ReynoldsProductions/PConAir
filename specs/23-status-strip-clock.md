# Spec 23 — Status Strip & Live Clock

**Status:** Planned · **Date:** 2026-09-09 · **Wave:** 2 (concurrent with 17, 18, 22)
**Model:** `claude-haiku-4-5-20251001` · **Depends on:** specs 14, 16 · **Branch:** `feat/graphics-23-status-strip-clock`
**Umbrella:** [`../plan_approved.md`](../plan_approved.md)

Two small, self-contained additions. They share a branch because both are thin consumers of spec 16 and neither justifies its own wave slot.

---

# Part A — Status strip

## A1. Why

Spec 16 makes presence queryable at `GET /api/presence`. Nobody looks at it. The Operator shell's status bar shows two LEDs — its own WebSocket and Companion (`src/renderer/operator/components/LiveControl.tsx:58-70`) — and says nothing about whether the graphics that are supposed to be on air have anything rendering them.

## A2. What already exists — do not rebuild

- **`src/renderer/operator/components/LiveControl.tsx`** — `StatusHeader` renders `.status-bar`, `.status-bar-indicators` and `.status-indicator` with `.led` / `.led.connected`. **Extend this component.** Do not add a second header, and do not convert any more of the vanilla shell to React.
- **`src/renderer/operator/index.tsx`** — mounts `StatusHeader` as its own React root and re-renders it on every store update. Read the boot section before adding props.
- **Spec 16's `GET /api/presence`** and the `presence` WS frame.
- **Spec 21's `GET /api/diagnostics`** — supplies uptime and memory when merged. Feature-detect; do not import.
- **`src/renderer/operator/api.ts`** — the shell's fetch helpers. Use them.

## A3. Design

`StatusHeader` gains one prop, `presence: PresenceSummary | null`, and renders three new indicators after the existing two:

| Indicator | Text | LED |
|---|---|---|
| Outputs | `3 outputs` / `no outputs` | green when > 0 |
| Controls | `2 panels` | neutral, no LED |
| Uptime | `4h 12m` | none |

`PresenceSummary` is computed in `index.tsx` from `GET /api/presence`:

```ts
export interface PresenceSummary {
  totalRenders: number;
  totalControls: number;
  /** Packages with at least one output, for the tooltip. */
  activePackages: string[];
  uptimeSeconds: number | null;   // null until /api/diagnostics exists
}
```

Refreshed on the `presence` WS frame, plus a 30-second interval for `uptimeSeconds` only. **No polling for presence** — spec 16 pushes it.

`title` attribute on the outputs indicator lists the active packages, so hovering answers "which graphic is live".

`0 outputs` is not an error state. Between graphics it is correct, so the LED is grey, never red — a status bar that cries wolf gets ignored.

The same summary renders in package control pages via `window.PConAir.statusStrip(el)`, using the same markup and `pconair.css` styling.

---

# Part B — Live clock element

## B1. Why

Clocks get rebuilt in every graphic that needs one, each with its own `setInterval`, its own format string, and its own timezone bug. `graphics/news/index.html` had one, then it was removed. The `hoops` scorebug has its own. A show with a venue clock and a "live from London" clock needs two, correct in two timezones.

`Intl.DateTimeFormat` does this correctly; nobody uses it because wiring it up per graphic is tedious.

## B2. What already exists — do not rebuild

- **`src/runtime/pconair.js`** (spec 14) — where this lives. It is a runtime feature, not a package feature.
- **`src/main/stagetimer/`** — countdown and cue timing for the *show*. Unrelated: this is wall-clock display inside a graphic. Do not couple them.
- **Node 20 / Chromium 128** both ship full ICU, so `Intl` timezone and locale support is available without a dependency.

## B3. Design

A custom element, so a graphic uses it with no JavaScript at all:

```html
<pc-clock format="h:mm A" tz="America/Phoenix"></pc-clock>
<pc-clock format="dddd, MMMM D" locale="en-GB"></pc-clock>
<pc-clock preset="HH:mm:ss"></pc-clock>
```

| Attribute | Default | Meaning |
|---|---|---|
| `format` | `h:mm A` | Token string, §B4 |
| `preset` | — | Named format; `format` wins if both are set |
| `tz` | machine zone | IANA zone |
| `locale` | `en` | BCP 47 tag |
| `tick` | auto | `second` or `minute`; auto-detected from whether the format contains `s` |

Presets: `time-12` (`h:mm A`), `time-24` (`HH:mm`), `time-12-s` (`h:mm:ss A`), `time-24-s` (`HH:mm:ss`), `date-long` (`dddd, MMMM D`), `date-short` (`M/D/YYYY`), `datetime` (`M/D/YYYY h:mm A`).

All attributes are observed and reflect live, so spec 18 can bind them to control fields.

### B4. Tokens

`YYYY YY MMMM MMM MM M DDDD dddd ddd DD D HH H hh h mm m ss s A a ZZ`. Escape literals in square brackets: `[at] h:mm A`. Month and day names come from `Intl.DateTimeFormat(locale, {timeZone: tz, …}).formatToParts` — never from a hardcoded English array, which is the bug this element exists to prevent.

### B5. Ticking

**One shared timer for every clock on the page**, not one per element. It aligns to the next second or minute boundary using `setTimeout` with a recomputed delay each tick — a plain `setInterval(fn, 1000)` drifts, and a clock on air that is 400 ms late looks broken next to a countdown.

Elements needing only minute resolution are updated on minute boundaries. The timer stops entirely when no `pc-clock` is connected.

An invalid `tz` or `locale` falls back to the machine default and calls `PConAir.warn()` (spec 21, feature-detected) rather than throwing — a bad attribute must not take a graphic off air.

---

## Files

**Create**
- `src/runtime/pconair-clock.js` — registered by `pconair.js` unconditionally; the element is inert until used.
- `tests/status-strip.test.ts`
- `tests/live-clock.test.ts`

**Modify**
- `src/renderer/operator/components/LiveControl.tsx` — three indicators, `presence` prop.
- `src/renderer/operator/index.tsx` — fetch and thread `PresenceSummary`; subscribe to the `presence` frame.
- `src/renderer/operator/api.ts` — `getPresence()`, `getDiagnostics()`.
- `src/runtime/pconair.js` — `statusStrip`, register the clock element.
- `src/runtime/pconair.css` — `.pc-status-strip`.
- `bundled-packages/news/render-ticker.html` — a `<pc-clock>` as the worked example.
- `docs/designing-packages.md`

## Tasks

- [ ] **T1 — `PresenceSummary` derivation.** Unit test the pure function that maps a `GET /api/presence` body to `PresenceSummary`: totals, `activePackages` containing only packages with ≥1 render, and `uptimeSeconds: null` when diagnostics is unavailable. Commit.
- [ ] **T2 — `StatusHeader` indicators.** Extend `tests/operator-renderer-boot.test.ts` or add to `tests/status-strip.test.ts`: three outputs renders `3 outputs` with a connected LED; zero renders `no outputs` with a **grey, not red** LED; the `title` lists active packages. Commit.
- [ ] **T3 — Push, not poll.** Test: a `presence` WS frame updates the header without a fetch; assert the presence endpoint is called once at boot and not on a 30s timer. Commit.
- [ ] **T4 — `statusStrip` in control pages.** jsdom test: same text and classes as the operator header. Commit.
- [ ] **T5 — Clock: token formatting.** Test a fixed instant (`2026-03-08T18:42:07Z`) against every token in §B4, with `tz: 'UTC'`. Include `h` vs `HH` at 18:42 and `A` producing `PM`. Commit.
- [ ] **T6 — Clock: escaping.** Test: `[at] h:mm A` renders `at 6:42 PM` — the `a` and `t` are literal, not tokens. Commit.
- [ ] **T7 — Clock: timezone.** Test the same instant in `America/Phoenix`, `Europe/London` and `Asia/Tokyo` gives three different, correct times. Include a DST-boundary instant for `America/New_York`. Commit.
- [ ] **T8 — Clock: locale.** Test `dddd, MMMM D` in `en`, `fr` and `de` gives localized day and month names via `Intl`. Commit.
- [ ] **T9 — Clock: shared aligned timer.** Test with fake timers: three elements on a page create one timer; the delay is recomputed to the next boundary rather than a fixed 1000; removing all three stops it. Commit.
- [ ] **T10 — Clock: attribute reflection.** Test: changing `tz` re-renders immediately without waiting for the next tick. Commit.
- [ ] **T11 — Clock: invalid input.** Test: `tz="Not/AZone"` falls back to the default, renders a valid time, and does not throw. Commit.
- [ ] **T12 — Worked example + docs.** Commit.

## Acceptance

- [ ] The Operator status bar shows live output and panel counts, updating the instant a browser source connects or disconnects, with no polling.
- [ ] Zero outputs reads `no outputs` in grey, never as an error.
- [ ] Hovering the outputs indicator names the packages with something on air.
- [ ] `<pc-clock format="h:mm A" tz="America/Phoenix">` renders the correct Phoenix time and updates on the minute, aligned to the boundary.
- [ ] Month and day names localize correctly for at least three locales.
- [ ] Three clocks on a page share one timer.
- [ ] A bad `tz` degrades to the machine zone without taking the graphic down.
- [ ] `npm run typecheck && npm test` green.

## Out of scope

Countdowns and stage timers (`src/main/stagetimer/` owns those). Server CPU in the status strip — `process.cpuUsage()` per-core numbers mislead more than they help, and uptime plus memory from `/api/diagnostics` covers the real question. No further React migration of the Operator shell.
