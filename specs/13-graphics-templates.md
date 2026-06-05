# 13 — Built-in Graphics Templates

**Status:** Proposal / plan · **Date:** 2026-06-05
**Owner doc for:** bundling reusable broadcast graphics (scorebug, tactical HUD, editorial cover, news bug/ticker, lower-thirds) into PC On Air and driving them live.
**Relationship:** extends the existing **L3 mode** (`src/main/l3/`) and **URL mode** (`specs/06-url-mode-multi-display.md`); touches the **state contract** (`specs/02-api-state-contract.md`) and the **Companion module** (`specs/07-companion-module.md`). These templates supersede the ad-hoc OBS/NodeCG overlay rendering for these shows — PC On Air is the playout engine.

---

## 1. Motivation

We built four production-grade overlay templates (prototyped via the OBS MCP, now living in [`/graphics`](../graphics/)). They're exactly the class of graphics PC On Air exists to play out: full-frame, transparent, animated, data-driven. Rather than hand-render them per-show, bundle them as **built-in graphics** PC On Air serves, exposes as presets, and drives live.

## 2. What already exists (don't rebuild)

- **Lower-third pipeline.** `src/main/l3/theme-store.ts` already converts a **FaireL3s `style.json`** into theme CSS (`faireStyleToCss`), and `cue-renderer.ts` renders a 1920×1080 L3 doc from a cue (name/title/subtitle) + theme, with PNG export via offscreen `BrowserWindow`. So the **FaireL3s lower-third is already a first-class L3 theme** — the `news/` bar's lower-third maps onto this directly.
- **URL mode.** Loads any fullscreen URL with **A/B dual-instance**, **luma key / solid background**, a **URL preset library**, and **multi-display `set_display`**. This is the host for the full-frame graphics.
- **WebSocket state sync + Companion** (19 actions / 11 variables / 6 feedbacks / 20 presets). The control + sync plumbing the live-data phase needs.

## 3. The two render paths

| Template | Path | Why |
|---|---|---|
| Faire L3 (name/title) | **L3 mode** | Static-per-cue text; already supported via FaireL3s theme + cue library + arm/take/clear + PNG export. |
| News bug + ticker + clock | **URL mode** | Needs a live clock + scrolling ticker (animation + JS) — beyond the cue/theme model. (Its lower-third *alone* can still be an L3 theme.) |
| Quarterly cover, Tactical HUD, Basketball scorebug | **URL mode** | Custom DOM + JS + animation + live data (clocks, scores, radar). Not expressible as L3 cue+CSS. |

**Decision:** keep L3 mode for the pure lower-third; serve everything else as **URL-mode graphics**.

## 4. Hosting & serving

Serve `/graphics` from the embedded Express server so templates are reachable at a stable local URL in dev and packaged builds:

- Add a static route: `app.use('/graphics', express.static(GRAPHICS_DIR))` → `http://127.0.0.1:<port>/graphics/<tpl>/index.html`.
- `GRAPHICS_DIR` resolves to the repo `graphics/` in dev and to an `extraResource` path in the packaged app (wire in `forge.config.ts`).
- Self-host fonts under `graphics/_fonts/` and swap the templates' Google-Fonts `<link>`s → kills the CDN dependency for offline/locked-down venues (mirrors the same call in the FFG NodeCG plan).
- Templates stay same-origin/relative so they can talk back to the PC On Air server (phase 2) regardless of which display loads them.

## 5. Exposing to the operator

Seed a **template registry** (`graphics/manifest.json`: id, title, mode, default params, param schema) and, on first run, **bootstrap URL presets** from it — one preset per template pointing at its local URL with sensible default params. The operator then picks e.g. *"Basketball Scorebug"* from the existing URL preset library; A/B + luma key + `set_display` all work unchanged.

## 6. Live data — phased

**Phase 1 (now): query params.** Operator edits the preset's params; `?a=BOS&sa=88&shot=24…`. Updating = A/B reload of the off-air instance, then take. Good enough for slates, the cover, and HUD branding.

**Phase 2: WebSocket-driven graphics state.** Add a `graphics` slice to AppState (`specs/02`) — a small, namespaced bag per active template (e.g. `scoreboard: {sa, sb, gameClock:{running,ms}, shotClock:{running,ms}, possession, fouls, timeouts}`; `lowerThird: {name,title,theme,visible}`). Templates open a WS to PC On Air and render from pushed state instead of params. New actions mutate the slice; existing sync fans out to all clients with no reload. (This is the PC On Air analogue of NodeCG replicants, using machinery we already have.)

**Phase 3: Companion control.** Extend `companion-module-pconair` (`specs/07`) with actions/feedbacks for the live fields: `score +1/+2/+3`, `shot_reset(24/14)`, `clock_start/stop/adjust`, `possession_toggle`, `foul_inc`, `timeout_dec`, `l3_take/clear`, `graphic_select`. Variables expose score/clock for button text; feedbacks color buttons on clock-stopped / bonus / shot-danger.

## 7. Per-template notes

- **news/** — lower-third → L3 mode (FaireL3s theme); the full bar (clock + "Faire Wire" ticker) → URL mode. Params `name,title,theme(light|dark),label`. Phase 2 fields: `lowerThird`, `ticker.items`.
- **quarterly/** — URL mode; camera composited *behind* (PC On Air outputs the frame; the portrait window is a transparent cut-out the downstream keyer/camera fills, or run as a full graphic over a camera input). Params `name,role,headline(\n),kicker,issue,ed`.
- **tactical-hud/** — URL mode, full-frame over camera. Mostly self-animating; `?grade=thermal` for night-vision. Optional phase-2 telemetry feed.
- **scoreboard-basketball/** — URL mode. The marquee live-data case: `gameClock`/`shotClock`/scores/fouls/possession/timeouts → drive in phase 2/3. Params cover all fields for phase 1.

## 8. Output / keying / reliability

Transparent templates + **luma key or solid background** for downstream keying; **HDMI** out; route to a chosen display via `set_display`. **Panic/blank** and **show-lock** apply unchanged (they gate the program window, not the template). A/B gives zero-interruption swaps between graphics.

## 9. Open questions

- Live-data shape: one generic `graphics` blob vs. typed per-template slices in AppState.
- Manifest-driven preset bootstrap vs. hand-curated presets in a show profile.
- Packaged-path resolution for `GRAPHICS_DIR` (forge `extraResource`) — confirm in dev + DMG.
- Fonts: self-host set to ship (Lora, Inter/Saira, Chakra Petch, Share Tech Mono).
- Does the camera composite happen *inside* a template (camera as a source in the page) or downstream (PC On Air outputs graphics only)? Default assumption: **downstream** — PC On Air plays graphics; camera is mixed by the switcher/OBS.

## 10. Phasing

- **P0 — done:** templates authored + copied to `graphics/` (news, quarterly, tactical-hud, scoreboard-basketball).
- **P1:** Express static route + `forge.config.ts` `extraResource`; self-host fonts; `graphics/manifest.json`; bootstrap URL presets.
- **P2:** `graphics` AppState slice + actions + WS push; convert templates to read live state (scoreboard first).
- **P3:** Companion actions/variables/feedbacks for the live fields; presets.
- **P4:** fold the FaireL3s lower-third explicitly into the L3 theme list; document operator runbook.

## 11. File inventory (added)

```
graphics/
  README.md
  news/index.html                  (Faire Nightly News)
  quarterly/index.html             (Faire Quarterly cover)
  tactical-hud/index.html          (ORBITAL HUD)
  scoreboard-basketball/index.html (COURTVISION scorebug)
```

Source/build history of these templates and the OBS-MCP authoring workflow: see the `obs-mcp` project memory (`obs-overlay-template-workflow`).
