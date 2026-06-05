# PC On Air — Spec 12: Platform Architecture

> **Status: Proposed** — direction agreed 2026-06-05. Generalizes PC On Air from a switcher-era playout app into the **Faire broadcast-graphics platform**: one shared feature core, two parallel output paths (switcher/key + software/OBS), driven by swappable graphics packages and show profiles. Supersedes the planned NodeCG rebuild of Faire Fulfillment Games and the standalone FaireL3s tool.

Read alongside: [`01-source-of-truth.md`](01-source-of-truth.md), [`02-api-state-contract.md`](02-api-state-contract.md), [`05-profiles-bundles-backups.md`](05-profiles-bundles-backups.md), [`07-companion-module.md`](07-companion-module.md), [`09-reliability-runbook.md`](09-reliability-runbook.md).

---

## 1. Why this spec

PC On Air already provides the hard parts of a live-graphics system — realtime WebSocket state sync, an operator/admin control UI, a Bitfocus Companion module, portable show profiles, PIN auth, and a reliability model. Three separate efforts were converging on the *same* capabilities:

- **FaireL3s** — static PNG lower-thirds → ATEM media pool.
- A planned **NodeCG rebuild** of Faire Fulfillment Games — realtime overlays for OBS.
- **PC On Air** — live L3s, slides, URL, media for switcher events.

Rather than maintain three L3 systems and two control stacks, we consolidate onto PC On Air's core and add the one capability it lacks: a **software / OBS output path**. The result generalizes cleanly to future sports and broadcast work.

## 2. The three layers (organizing principle)

| Layer | What it is | Cost to add |
|---|---|---|
| **Content types** | The render/capability primitives: `scoreboard`, `lower-third`, `slides`, `url`, `media`. | Engine code — written once, available to every package. |
| **Graphics packages** | The *look*: theme + layout/template sets applied to content types (FFG cardboard, NBA-on-TNT scorebug, Faire News editorial, Soccer, …). | Mostly CSS + templates; little/no engine code. |
| **Profiles** | A show's chosen package + presets/cues/team config/settings, exportable as a zip (existing profiles system, Spec 05). | Data only. |

Design rule: **a new look is a package; a new show is a profile; only a genuinely new kind of graphic is a content type.**

## 3. Shared core (mostly exists today)

Reuse as-is from the current architecture: WebSocket state sync + action dispatch (Spec 02), operator/admin UIs, Companion module (Spec 07), profiles/bundles (Spec 05), auth + security (Spec 08), reliability/panic/show-lock (Spec 09). The platform work **extends** this core; it does not replace it.

New core additions:
- **`scoreboard` content type** — generic, N-team competition graphics (team names/colors/scores/order-counters, head-to-head, champion/winner reveal, optional clock binding). FFG's overlays are the first consumer; built generic so other sports reuse it. State lives in the existing `AppState` (e.g. a `scoreboard` slice) and syncs over the existing WebSocket.
- **Package loader** — resolve the active graphics package (theme tokens + templates) per profile, applied to all content types.

## 4. Two output paths (same features)

The core is output-agnostic; **adapters** render the same state two ways.

### 4.1 Switcher / key path (exists)
Fullscreen Electron BrowserWindow → HDMI/display → luma/chroma key into a hardware switcher. Unchanged from today (Spec 06, Spec 09 keying notes).

### 4.2 Software / OBS path (new)
The embedded Express server serves **transparent overlay pages** (per content type) that **OBS loads as Browser Sources**. These pages:
- subscribe to the **same WebSocket state** the operator UI uses (so they update live and **re-hydrate from current state on (re)connect** — the failure mode that killed the old FFG relay);
- render on a **transparent** background (no Electron window / no HDMI needed);
- are driven by the **same Companion** actions/variables;
- are addressed by a single configurable **base URL** (`localhost` for colocated, the host's LAN IP/`.local` when OBS is on a separate machine).

**Packaging (open question):** one app with a runtime "output mode," vs. two build targets from the shared core. Either way the **feature set is identical** across paths — "two parallel apps with the same features."

## 5. First show: Faire Fulfillment Games

FFG stops being its own app and becomes the platform's **first show**:
1. Port FFG's overlays (single-pip, four-portrait, four-up, head-to-head, champion) into the `scoreboard` content type + L3s.
2. Package the cardboard/kraft look, team/score model, timer, and champion reveal as the **FFG graphics package + profile**.
3. Air it via the **software/OBS path** (FFG is streamed). Building that path *is* FFG's stable rebuild — on PC On Air's proven state/control/Companion/reliability layer.
4. The legacy FFG `obs/` relay stays deployable as fallback until parity; the FFG repo is the **design/content source**, then archived.

## 6. Deployment

**Targets:** build on the dev Mac (Apple-Silicon); run in production on an **Apple-Silicon Mac mini**. PC On Air is an Electron app, so:
- **Switcher path:** runs as the Electron app driving the program display (existing model).
- **Software/OBS path:** the same app's Express/WS server serves overlay pages; OBS (same mini for the POC, a second machine later) loads them as Browser Sources. Bind the server to all interfaces so the tablet, Companion, and a remote OBS can reach it; keep the Browser Source **base URL** the single configurable so the 1-machine → 2-machine move is config-only.
- **Auto-start / unattended:** launch at login (auto-login) and keep alive; disable sleep (`pmset -a sleep 0 displaysleep 0 disksleep 0`), auto-restart on power loss (`pmset -a autorestart 1`), firewall-allow the server port, DHCP-reserve the mini's IP. (Mirrors the proven FFG launchd pattern; PC On Air ships its own packaged app, so prefer its built-in start over a hand-written LaunchAgent where possible.)
- **Fonts self-hosted** (no CDN) so a locked-down/offline network never changes the type.
- **Deploy** via the app's normal release/update flow; keep `.env` (PINs, creds) on the mini, untouched by updates.

**Carried-forward validation (gate the software path):** the transparency + live-update + **re-hydrate-on-reload** + **auto-reconnect-on-restart** tests from the FFG `docs/phase0-validation.md` apply directly to the new OBS overlay pages — run them before trusting the software path live.

## 7. Migration & retirement
- **NodeCG rebuild** → superseded; keep its root-cause analysis and the Phase 0a validation (folded into §6 here).
- **FaireL3s** → retired into the platform's live L3s; keep the Python PNG generator only if a pure PNG→ATEM need lingers; archive otherwise.
- **FFG app** → becomes a package + profile (§5); repo archived after port.
- **`faire-design-language.md`** → vendored into this repo as the design source for packages.
- **obs-mcp** → stays a separate, complementary tool (Claude's OBS control); not part of this platform.

## 8. Open questions
- Software/OBS path: single app + runtime output mode, or two build targets from the shared core?
- Repo: keep the name **PConAir**, or rename to a platform-neutral name now that it's general?
- Graphics packages: in-repo `packages/` dir to start (recommended), or separate repos per package?
- `scoreboard` content type: data model + how it binds to the existing timer/Stagetimer.
- Should the OBS overlay pages reuse the operator renderer templates, or be a dedicated transparent render path?
