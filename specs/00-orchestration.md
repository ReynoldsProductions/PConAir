# Spec 00 — Faire Broadcast Graphics: Orchestration & Platform Architecture

> Versioned copy of the workspace umbrella (`/Users/tom/Documents/Claude/broadcast-platform-architecture.md`). Companion detail: [`12-platform-architecture.md`](12-platform-architecture.md). This is the **handoff entry point** — read this, then spec 12.

**Status:** Direction agreed 2026-06-05.

## Vision
One **Faire broadcast-graphics platform** — built by evolving **PConAir** — with a shared feature core that feeds **two parallel output paths**, generalized for sports & broadcast (not FFG-specific). Build the engine once; ship many graphics packages and show profiles.

## The three layers (organizing principle)
1. **Content types** *(engine code, built once)* — scoreboard, lower-third, slides, URL, media. New *kinds* of graphics = new content types (code once, every package gets them).
2. **Graphics packages** *(themes/templates — mostly CSS/layout, no engine code)* — the *look*: FFG cardboard, NBA-on-TNT scorebug, Faire News editorial, future "Soccer on Faire", etc.
3. **Profiles** *(portable bundles)* — a show's chosen package + presets/cues/config/settings, exportable as a zip (PConAir already does this).

## Two output paths (same features)
- **Switcher / key path** *(PConAir today)* — fullscreen → HDMI/DeckLink → luma/chroma key into a hardware switcher.
- **Software / OBS path** *(new adapter)* — the same server serves **transparent overlay pages** that OBS/vMix load as Browser Sources, driven by the *same* WebSocket state + Companion.

## Repo map
| Repo / file | Role | Status |
|---|---|---|
| **`TomsFaire/PConAir`** | **The platform** — engine, both output adapters, control UIs, Companion, profiles, graphics packages, specs | **Active.** Gains the `scoreboard` content type + software/OBS output adapter |
| `TomsFaire/FaireFulfillmentGames` | FFG legacy app + the design/content **source** to port from | Legacy/fallback → **archive after port**. `feature/nodecg-rebuild` = **superseded** |
| `TomsFaire/FaireL3s` | Standalone Python PNG L3 generator (PNG → ATEM media pool) | Legacy; **superset by the platform's live L3s** → archive after port |
| `TomsFaire/obs-mcp` | Claude's OBS control layer (fork of `royshil/obs-mcp`) | **Separate & complementary** — not part of the platform |
| `faire-design-language.md` | Shared design system (color, type, tokens) | **Vendor into this repo** as the design source for every package |

## What this supersedes
- The **NodeCG rebuild** of FFG (PConAir already provides realtime state, control, Companion, profiles, reliability — the software path is a new *output adapter*, not a new control stack).
- **Three separate L3 systems** collapse into **one** (the platform's live L3s); FaireL3s and the planned NodeCG `faire-l3` module are retired.

---

# Orchestration Plan (handoff)

**For the next instance:** read this spec, then [`12-platform-architecture.md`](12-platform-architecture.md). Execute the ordered build below; each step names the **model** to run it and its **gate**.

## Status snapshot (2026-06-05)
- **Decided:** one platform under **PConAir**; two output adapters (hardware/Electron→HDMI/DeckLink + software/OBS browser-source); functions converge, only output transport diverges. **FFG = first show**; **FaireL3s retired**; **obs-mcp separate**.
- **Docs in place:** this spec + `12-platform-architecture.md` (in this repo) · in the **FaireFulfillmentGames** repo: `docs/nodecg-rebuild-plan.md` (branch `feature/nodecg-rebuild`, pushed), `docs/phase0-validation.md`, `nodecg-spike/` (validation spike, pushed, `5aded83`).
- **Not started:** any platform implementation.
- **OPEN GATING DECISION:** NodeCG vs **PConAir-core** for the software path → decided by the spike (Step 0→1). Leaning PConAir-core (its server already provides state/serve/Companion; NodeCG would duplicate it).

## Model map
**Opus 4.8** = architecture + visual/design (image analysis) · **Sonnet 4.6** = code/implementation · **Haiku 4.5** = docs / mechanical / triage.

## Ordered build
| # | Step | Model | Depends on | Done when |
|---|------|-------|-----------|-----------|
| 0 | Run validation spike — Blockers 1/2/3/**3b** (FFG repo `docs/phase0-validation.md`); drop in `test.gif`/`test.webm` | **human-run** (Claude assists) | — | runbook checkboxes ticked; results recorded |
| 1 | **Decide NodeCG vs PConAir-core** from spike results | **Opus 4.8** | 0 | decision written into spec 12 §8 |
| 2 | Verify/refactor PConAir into `core` + `shell-electron` + `shell-web` (headless core) | design **Opus**, impl **Sonnet** | 1 | core runs without Electron and serves a page |
| 3 | Software/OBS output adapter (serve transparent overlay pages) | **Sonnet 4.6** | 2 | page loads in OBS, transparent, **hydrates + auto-reconnects** (re-run phase0-validation 3/3b) |
| 4 | Generic `scoreboard` content type (N-team, scores/clock/H2H/champion) | **Sonnet 4.6** | 2 | renders from state; theme-able |
| 5 | Port FFG → scoreboard/L3 + **FFG graphics package + profile** | **Sonnet** (wiring) + **Opus** (visual fidelity) | 3,4 | FFG overlays reproduced; parity vs legacy `obs/` |
| 6 | Convert assets **GIF → WebM/Lottie**, optimize | **Haiku 4.5** | 5 | no animated GIFs; load/quality pass |
| 7 | Companion integration (scoreboard + L3 actions/vars) | **Sonnet 4.6** | 4,5 | Companion drives state |
| 8 | Mac-mini deploy: launchd/packaged auto-start, `pmset` hardening, runbook | **Sonnet** (scripts) + **Haiku** (runbook) | 5 | cold-boot / power-loss / reboot survive unattended |
| 9 | Cutover from legacy `obs/` (swap OBS Browser Source URLs) | **Sonnet 4.6** | 8 | software path live; legacy kept as fallback |
| ∥ | **OBS MCP track** (independent): evaluate fork → implement obs-websocket tools → tricky design | **Haiku** → **Sonnet** → **Opus** | — | fork `TomsFaire/obs-mcp`; see `obs-mcp/PROJECT_PLAN.md` |
| ⟳ | Docs / spec upkeep (ongoing) | **Haiku 4.5** | — | specs current |

## Hard rules for the next instance
- **Do not disturb** PConAir's active branch `feat/operator-gsc-ui` (dirty). Work on a **fresh branch off `main`**; **commit only when asked**; new repos default to **`main`**.
- Keep the two output paths **feature-identical**; diverge only at the output transport.
- **Validate empirically** (Step 0 spike) before committing to NodeCG vs core.
- Graphics packages use **WebM/Lottie, not GIFs**.
- Reuse PConAir's existing state/control/Companion/profiles/reliability — don't build a second stack.
