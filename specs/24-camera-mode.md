# 24 — Camera Mode + NDI Out

Status: Draft spec for agent handoff. Not yet started — Phase 0 has not run.

Repo: `ReynoldsProductions/PConAir` — the org is "ReynoldsProductions" (with the
trailing s), the repo is "PConAir" (singular, no trailing s). An earlier draft of
this doc got the org name wrong (`ReynoldsProduction`, missing the s) while
claiming to correct a `TomsFaire/PConAir` reference elsewhere — verify against
`git remote -v` before citing the repo anywhere else.

## Goal

Add a Camera page to PConAir: capture a USB (UVC) camera, composite PConAir's
existing graphics on top of it, and emit the result as a single video source.
This turns PConAir into an in-line graphics injector for Zoom Rooms and any
other UVC/NDI consumer, replacing the current OBS-based proof of concept.

## What we are replacing, and why it has to go

The working POC chain: PConAir on the speaker-notes mini renders lower thirds
as a browser source → OBS on that same mini composites the browser source
over the Q-SYS USB camera feed → OBS Virtual Camera → selected as the camera
in the Zoom Room. Graphics fire remotely from Companion, they land over live
camera with no meaningful added delay, and lipsync is trimmable in Q-SYS if
needed. Functionally it succeeded.

It is still the wrong thing to deploy, for reasons that compound:

- **Four apps and a virtual device to put a name on screen.** PConAir, a
  headless browser source, OBS, the OBS virtual camera driver, and Zoom Rooms
  — five things that must all be running, all correctly configured, and all
  agreeing about resolution and frame rate. Every one is a separate failure
  point with its own update cycle, and none of them knows anything about the
  others. A name and title over a camera feed does not warrant five moving
  parts.
- **OBS is enormously over-built for this.** We use one scene, two sources,
  and the virtual camera. Everything else it ships — encoders, streaming,
  recording, filters, plugin surface, scene collections — is inert weight
  that still has to be installed, updated, signed and trusted on a
  production room machine.
- **OBS and the Zoom Rooms reboot cycle are incompatible.** The Zoom Rooms
  mini reboots weekly by policy. OBS does not reliably come back into the
  correct scene collection with the virtual camera started and the capture
  device reacquired. Anything that requires an operator to open a laptop and
  fix the graphics machine before a show is not deployable across offices.
- **Fragile, invisible state.** The chain only works if OBS holds a specific
  scene collection, the virtual camera is started, the browser source URL is
  correct and reachable, and the capture device enumerated in the expected
  order. None of that state is visible from Companion or from the Zoom Rooms
  tablet. The first symptom of any of it breaking is a black or stale camera
  in front of an audience.
- **Two cameras in the Zoom Room picker.** The raw bridge camera and the OBS
  virtual camera both appear. Renaming helps, but any room user can still
  pick the wrong one, and the wrong one looks almost right — which is worse
  than looking broken.
- **Nothing is owned.** When the chain breaks mid-show, the fix is spelunking
  through a third-party app's settings under time pressure. We own PConAir
  end to end: state, health endpoint, watchdog, Companion feedback, logs.

**The bet:** PConAir already renders these graphics, already serves control
surfaces, already has Companion coverage, a watchdog and a health dashboard.
Pulling capture and output inside it collapses five components to one, makes
the whole path observable through tooling we control, and removes the reboot
problem by removing the app that cannot survive a reboot.

## MVP scope

### In scope

- New **Camera** mode, peer to the existing `slides` / `url` / `media-library`
  modes.
- Capture from any UVC device the OS exposes. Primary target: the Q-SYS USB
  Video Bridge.
- Overlay the existing graphics surfaces on the camera: lower thirds
  (left/right), graphics packages (Faire Wire, FFG, Hoops), and
  background/still layers. Google Slides over camera is low priority.
- Two mutually exclusive output modes, operator-selected:
  1. **NDI** (primary) — named NDI sender on the network.
  2. **Local display** — fullscreen Electron window on a chosen display.
- Control from the operator Web UI, the HTTP API, and Companion, consistent
  with the existing action-dispatch contract.
- Target format: **1920×1080, 30 fps**.
- **macOS only.** No Windows parity at MVP. Do not add platform branches or
  Windows-specific build work; do not adopt a library that forecloses Windows
  later.
- **Camera mode is exclusive.** While active it owns the output. It does not
  need to coexist with an active slides or URL output on a second display,
  which removes multi-surface routing from the MVP.
- NDI source naming: `PConAir — <ROOM> <ROLE>`, e.g. `PConAir — SF AH Stage`.
  Default generated from the show profile; operator-editable in admin
  settings.

### Out of scope for MVP

- Virtual camera (see Stretch).
- Audio in the NDI stream. MVP is a video-only sender; audio passthrough
  moves to Stretch.
- Multi-camera switching, PTZ control, transitions between cameras.
- Key/fill or alpha NDI output. The camera composite is opaque by definition.
- SDI/DeckLink.

### Stretch, explicitly not a requirement

- **macOS virtual camera** at 1080p30 via a CoreMediaIO Camera Extension, so
  the composite appears in the Zoom Rooms camera picker without NDI. Treated
  as a separate phase because it is a signed system extension with its own
  install and MDM story, not an Electron feature.
- **Audio passthrough** — capture an audio input alongside the camera and
  embed it in the NDI output, so the sender carries a single A/V stream. The
  point is lipsync: if audio and video are aligned once at the sender, every
  downstream consumer inherits that alignment instead of each one being
  trimmed by hand in Q-SYS. Needs a measured, operator-adjustable A/V offset
  and proof that it does not drift over a show. Explicitly not MVP.

## Non-negotiables

1. **No regressions.** Every existing mode, render page, Companion action and
   GSC-compat endpoint behaves exactly as it does today. Camera mode is
   additive.
2. **Graphics are reused, not reimplemented.** The lower thirds and package
   renderers that exist today must drive the camera composite. Forking a
   second rendering path for camera mode is a failure condition.
3. **Deterministic bypass.** There must be a single command that guarantees
   clean camera passthrough with all graphics suppressed, and it must work
   even if the graphics layer has wedged. Wire it to the existing Panic
   toggle.
4. **Survives restart unattended.** App relaunch restores camera mode,
   device selection, output mode and NDI source name with no operator input.
5. **Show-safe pacing.** The output emits frames at a steady cadence even
   when nothing on screen is changing. A frozen or stuttering output is worse
   than no graphics.

## Open dependency: camera device contention

PConAir holding the UVC device may prevent the Zoom Room from using it
directly at the same time. The doc's proposed mitigation — run PConAir on a
second mini fed by its own Q-SYS USB bridge — is a hardware/deployment
decision, not a code change, and **it has not been made yet**. Confirm the
deployment topology (single mini vs. second mini + second USB bridge) before
Phase 1 device-enumeration work is scoped, since it affects what "device
selection" even means in that phase.

## Architecture decision to resolve in Phase 0

The entire feature hinges on one question: **how do composed pixels get out
of Chromium and into an NDI sender at a steady 30 fps?**

The graphics packages are HTML/CSS/JS. That rules out compositing in a 2D
canvas, because it would mean rewriting every package. The composite has to
happen in the DOM, which means the pixel tap has to read a rendered DOM tree.

Two candidate pipelines. Phase 0 builds both as throwaway spikes and measures
them.

### Candidate A — Offscreen rendering (OSR)

Hidden `BrowserWindow` with `webPreferences.offscreen: true` hosting a
`<video>` element (camera via `getUserMedia`) with the existing graphics
layers stacked over it in the DOM. Frames arrive on the `paint` event.

- **Pro:** reuses every graphics package verbatim. No screen-recording
  permission. Window need not be visible.
- **Con:** paint is dirty-rect and event-driven, not clock-driven. Static
  content produces no paints, so a frame pacer must hold and re-emit the last
  full frame at 30 fps. GPU→CPU readback cost; evaluate `useSharedTexture`.
- **Unknown to measure:** whether `getUserMedia` behaves reliably in an
  offscreen renderer, and whether dirty-rect paints can be forced to
  full-frame cheaply.

### Candidate B — Self-capture via `getDisplayMedia`

A normal (possibly offscreen-positioned) window hosts the same DOM
composite. The app captures its own window through
`desktopCapturer`/`getDisplayMedia`, yielding a paced `MediaStream`. Frames
pulled via `requestVideoFrameCallback`/WebCodecs `VideoFrame`.

- **Pro:** natively paced by the capture pipeline, so no pacer needed.
  Well-trodden path, hardware-accelerated on macOS via ScreenCaptureKit.
- **Con:** requires Screen Recording TCC permission — an MDM profile item on
  managed minis. Behavior with hidden/minimized windows is unreliable; the
  window may need to exist on a real or virtual display.

**Decision rule:** pick whichever spike holds 1080p30 for 10 minutes with
lower CPU and no dropped or duplicated frames under a realistic graphics
load. If both pass, prefer A for the absent permission requirement.

## NDI sender

Do not write bindings from scratch. Evaluate, in this order:

- `stagetimerio/grandiose` — N-API fork of the Streampunk bindings, NDI work
  on threads off the event loop, already shipping NDI output in a production
  Electron desktop app.
- `tux-tn/grandi` — TypeScript-native NDI 6 bindings, prebuilt binaries for
  macOS/Windows/Linux, documented Electron usage.

Requirements either way: send on a worker thread, preallocated buffer pool
(1080p BGRA is 8.3 MB/frame, ~250 MB/s at 30 fps — no per-frame allocation),
`libndi` bundled inside the `.app` with hardened runtime intact so
notarization passes, and an `ndi.video` link in the UI near the NDI controls
per the SDK terms.

## Running this on a Pro ($20/mo) plan

This plan is usage-constrained, and the constraint is the main scheduling
input. Confirm the numbers in Settings → Usage and with `/usage` before
launching anything.

- A **5-hour rolling window** that starts at the first message of a session
  and resets five hours later.
- A **weekly cap across all models**, plus a separate weekly Sonnet cap,
  both resetting at a fixed time assigned to the account.
- Opus costs several times a Sonnet turn, and Sonnet several times Haiku.
  Opus access on Pro is limited — confirm it is usable at all before the
  plan depends on it.

**Known reset points as of 28 Sep 2026:** the next 5-hour window resets at
1:09 PM PT today, and the weekly cap resets Sat 3 Oct, 12:59 PM PT. Two
scheduling consequences. First, the rolling window is not a fixed clock — it
restarts at the first message of each new session, so after today's reset
the cadence depends on when work actually starts, and the orchestrator must
read the reset time from the limit response rather than assume 6:09, 11:09
and so on. Second, there are only five days of weekly allowance left before
3 Oct. Use that remainder for Phase 0 spikes, which are throwaway and lose
nothing if they get cut short, and start Phase 1 after the weekly reset with
a full allowance in hand.

Two consequences that override instructions elsewhere in this doc:

**"Parallel" means independent, not concurrent.** Every track draws from one
shared pool. Three agents running at once drain the window roughly three
times faster and hit the wall three times sooner, with no wall-clock gain
once throttled. Keep the worktree isolation — it is what makes clean merges
possible — but execute one track at a time, in the order each phase states.
Parallelism returns for free if this ever moves to a Max plan or API
billing.

**Every unit of work must be resumable by a cold agent.** Assume any turn
can be the last one before the window closes.

## Work units

A unit is the largest chunk that reliably completes inside one window with
reserve left over. Rule of thumb: one PR-sized change, roughly ten files or
fewer. A unit is **done** when all six are true:

1. Tests written first and shown failing (RED), then implementation added to
   pass them (GREEN), then refactored — per the project's standing TDD
   requirement. Minimum 80% coverage on new code, covering unit,
   integration, and (for user-facing flows) E2E cases.
2. Code committed on the track's worktree branch.
3. Vitest green.
4. A code-review pass (code-reviewer agent, or the unit's assigned model
   acting in that role if code-reviewer isn't invoked) has run against the
   diff, and CRITICAL/HIGH findings are resolved before the unit is marked
   done.
5. `specs/24-camera-mode.md` updated in the same commit.
6. A short entry appended to `.agent/JOURNAL.md`: what landed, what was
   deliberately skipped, measured numbers, open questions.

Agents never stop voluntarily mid-unit. The orchestrator stops **between**
units.

## Orchestrator loop

The orchestrator is a thin wrapper, not an agent doing reasoning. Each
cycle:

1. Read `.agent/state.json` for the next pending unit.
2. Run `/usage`. Record remaining 5-hour window, remaining weekly allowance,
   and the window reset timestamp.
3. Look up the unit's cost estimate in `.agent/BUDGET.md` — seeded from the
   table below, then replaced by rolling actuals.
4. **Gate.** Launch only if remaining window ≥ 2× estimate and remaining
   weekly ≥ estimate plus a 15% hard reserve held back for recovery and
   cleanup. Otherwise pause.
5. Execute the unit in a fresh session. Stop at the checkpoint.
6. Append actual consumption to `BUDGET.md`, advance `state.json`, commit.
7. Loop.

**Pause behavior.** Set `state.json.status = "paused-for-quota"` with
`resume_after` set to the reset timestamp, print the resume time, and sleep
until reset plus two minutes. On wake, start a new session — `/clear`, not a
continued context — and re-enter at step 2. Resuming a long accumulated
context is itself one of the larger silent drains.

**Weekly cap exhausted is a different event.** Sleeping for days is not a
run. Stop, write the state file, and notify Tom rather than idling.

### `.agent/state.json`

The only thing that survives a pause. Fields: `phase`, `track`, `unit_id`,
`status` (`pending` | `in_progress` | `done` | `blocked` |
`paused-for-quota`), `branch`, `worktree_path`, `last_commit`,
`resume_command` (the literal prompt to re-issue), `resume_after`, `notes`.

If a unit is found in `in_progress` at startup, the previous session died
mid-unit. Do not continue it blind: run `git status` and the test suite,
then either finish or reset to `last_commit` and restart the unit.

### Cost seeds

Initial guesses only — replace with measured actuals after Phase 0.

| Unit type | Class | Notes |
|---|---|---|
| Spike with native/binding iteration (0A, 0B, 0C) | Large | Build loops and crash cycles dominate; budget a full window each |
| Decision memo, final review (0D, 5E) | Medium, Opus | Read-heavy, low output — but Opus multiplies the cost |
| Feature implementation (1A, 2A, 2B, 3A, 3B, 4A) | Medium | One window each if scoped to a unit |
| Contract/schema/docs/tests (1B, 4C, 5C, 5D) | Small | Haiku; several fit in one window |
| Soak and perf runs (5A, 5B) | Small agent cost, long wall clock | Mostly waiting; do not hold a session open while a 4-hour soak runs |

**5A and 5B are the exception worth calling out:** start the soak, exit the
session, come back after. Never burn window time watching a test run.

## Hard break points

The orchestrator must checkpoint and re-gate at each of these, regardless of
remaining budget:

- End of every phase.
- After 1B merges, before 1A and 1C.
- After 3A's interface lands, before 3B and 3C.
- Before any unit involving native bindings, code signing or notarization —
  these fail in long unpredictable loops. Do not start one with less than
  half a window left.

## Model policy under the cap

- **Sonnet is the default.** Push everything with a clear spec in front of
  it down to Haiku — on this plan that is real savings, not a rounding
  error.
- **Opus for 0D and 5E only**, and preferably via `/model opusplan`: plan
  with Opus, execute with Sonnet in the same conversation. If Opus is
  unavailable or too expensive on the day, run those two on Sonnet with an
  explicit review checklist and record in the journal which model actually
  made the call.
- `/compact` when context passes roughly 60%; `/clear` between units.
  Context bloat is the most common way to burn a window without producing
  anything.

## Phases

### Phase 0 — Spikes and decision (blocking)

Throwaway code on `spike/*` branches. Nothing merges to main. Output is a
written recommendation plus benchmark numbers.

| Track | Work | Model |
|---|---|---|
| 0A | OSR pipeline spike: offscreen window, camera in, frame pacer, dump raw frames to disk. Measure CPU, frame interval jitter, dropped frames. | Sonnet |
| 0B | `getDisplayMedia` self-capture spike, same measurements, same rig. | Sonnet |
| 0C | NDI sender spike: both libraries, send a synthetic 1080p30 pattern, verify discovery and stability in NDI Studio Monitor and in a Zoom Room Custom AV NDI input. | Sonnet |
| 0D | Decision memo: benchmark table, recommendation, risks. Rewrite the Pipeline section of `specs/24-camera-mode.md` to match. | Opus |

0A, 0B and 0C run **in parallel** in separate git worktrees. 0D is the join
point and must not start before all three report.

**Exit criteria:** one pipeline chosen, one NDI library chosen, 10-minute
soak at 1080p30 with measured frame interval within ±2 ms and zero drops.

### Phase 1 — Camera capture and state contract

| Track | Work | Model |
|---|---|---|
| 1A | `src/main/camera/`: device enumeration, selection, hotplug handling, permission prompts, persistence in settings. Camera mode added to the mode state machine. | Sonnet |
| 1B | Extend `shared/types.ts` and `specs/02-api-state-contract.md`: camera state, output mode, NDI config. New endpoints under `/api/camera/*`. | Sonnet |
| 1C | Operator UI shell for the Camera page: device picker, preview, output mode toggle, status. | Sonnet |

1B is written first and merged before 1A and 1C branch off it, since both
consume the contract. 1A and 1C then run in parallel.

**Exit criteria:** operator can select a camera and see live preview in the
operator UI. No output path yet.

### Phase 2 — Graphics compositing

| Track | Work | Model |
|---|---|---|
| 2A | Composite host page: camera video layer plus the existing L3 render layers, driven by the same state hub as `/render/l3`. | Sonnet |
| 2B | Graphics package layers over camera, using the existing package loader, state hub and transport. Verify with all three bundled packages. | Sonnet |
| 2C | Layer ordering, z-index contract, per-layer enable/disable, and the hard bypass path. | Sonnet |
| 2D | Google Slides over camera. Low priority — ship only if 2A–2C land clean. | Haiku |

2A and 2B in parallel; 2C after both; 2D optional and last.

**Exit criteria:** every graphics surface that renders today renders over
camera, fired from the existing Companion actions, with no duplicated
renderer logic.

### Phase 3 — Output router

| Track | Work | Model |
|---|---|---|
| 3A | Output abstraction with two implementations: `ndi` and `local-display`. Mutually exclusive, operator-switchable at runtime, persisted. | Sonnet |
| 3B | NDI sender integration: worker thread, buffer pool, configurable source name, sender lifecycle and reconnect. | Sonnet |
| 3C | Local display output: fullscreen window on a selected display, reusing existing display enumeration and routing. | Haiku |

3A first, then 3B and 3C in parallel against its interface.

**Exit criteria:** composite visible in a Zoom Room via Custom AV NDI input,
and separately on a local HDMI display. Switching modes does not require a
restart.

### Phase 4 — Control surfaces

| Track | Work | Model |
|---|---|---|
| 4A | Companion module: camera actions, variables and feedbacks following existing naming conventions. New actions only, no renames. | Sonnet |
| 4B | Operator and remote UI polish; admin settings for default device, output mode and NDI source name. | Haiku |
| 4C | Show profile schema: camera config included in export/import, with a schema version bump and migration. | Haiku |

All three in parallel.

### Phase 5 — Hardening and ship

| Track | Work | Model |
|---|---|---|
| 5A | Soak testing: 4-hour run, camera unplug/replug, sender restart, app relaunch, graphics storm. | Sonnet |
| 5B | Performance pass against the Phase 0 budget; profile on the actual target mini. | Sonnet |
| 5C | Vitest coverage matching existing suite conventions. | Haiku |
| 5D | Docs: `docs/camera-mode.md`, operator SOP, lipsync measurement procedure and the Q-SYS delay trim. | Haiku |
| 5E | Final review: contract consistency, regression risk to existing modes, failure modes, perf claims. | Opus |

5A–5D in parallel, 5E is the gate.

### Phase 6 — Stretch: virtual camera

Separate effort, separate branch, do not start until Phase 5 ships. macOS
CoreMediaIO Camera Extension: Swift system extension bundled in the `.app`,
Developer ID signing with the system-extension entitlement, notarization,
IOSurface/XPC frame transport from Electron, MDM-deployed user approval.
Reuses the Phase 3 output abstraction as a third implementation.

### Phase 7 — Stretch: audio passthrough

Independent of Phase 6 and cheaper — this is Electron and NDI SDK work, not
a signed system extension, so it can run first if it is wanted sooner.
Capture a selected audio input device, timestamp it against the video path,
and send interleaved audio through the NDI sender at 48 kHz. Requires: audio
device selection and persistence in the same settings surface as the
camera; a configurable A/V offset in milliseconds exposed to the operator
and to Companion; drift measurement over a multi-hour soak, since a
free-running audio clock and a paced video output will separate if nothing
reconciles them. Local display output ignores audio; passthrough applies to
the NDI path only. Sonnet.

## Agent operating rules

- **Worktrees, not branches in one checkout.** Each parallel track gets
  `git worktree add`. Agents never share a working directory.
- **File ownership is exclusive.** Two agents must not edit the same file in
  the same phase. Shared files (`shared/types.ts`, spec files) are owned by
  one track and merged before dependents branch.
- **Specs before code.** `specs/24-camera-mode.md` is the source of truth
  and is updated in the same commit as any behavior change, matching the
  existing `specs/00–23` convention.
- **Tests are not optional, and they come first.** Every track writes
  failing tests before implementation (see Work units), and lands Vitest
  coverage in its own PR. The suite is 1,206 tests across 78 files today; it
  stays green.
- **Code review is not optional.** Every unit gets a review pass against
  CRITICAL/HIGH issues before being marked done (see Work units).
- **Report format.** Each agent ends with: what landed, what it deliberately
  did not do, measured numbers where relevant, and open questions. No status
  prose.

## Model selection rationale

- **Opus** for Phase 0D and Phase 5E only. These are judgment calls where
  being wrong is expensive: choosing the pipeline, and catching a regression
  that would take down a room mid-show.
- **Sonnet** for all implementation involving native bindings, threading,
  frame timing or state-machine changes.
- **Haiku** for docs, tests, schema migration and UI surfaces with a clear
  spec in front of them.

This is deliberately heavier than the original PC On Air launch plan, which
ran Haiku-first with a Sonnet review. That plan was spec writing. This is
native code with real-time constraints and a production dependency.

On a Pro plan this rationale survives but the budget squeezes it: see
**Model policy under the cap**. The short version is that Opus stays limited
to 0D and 5E via `opusplan`, and anything with a clear spec drops to Haiku.

## Acceptance criteria

1. Camera mode selectable from the operator UI, with device picker and live
   preview.
2. NDI output discoverable by name and selectable as a camera in a Zoom Room
   Custom AV NDI input.
3. Local display output renders fullscreen on a chosen display; the two
   output modes are mutually exclusive.
4. Lower thirds and all three bundled graphics packages fire over camera
   from existing Companion buttons.
5. 1080p30 sustained for 4 hours with no dropped frames and no memory
   growth.
6. Panic produces clean camera passthrough within one frame.
7. Cold app launch restores camera, output mode and source name with no
   operator action.
8. Full existing test suite green; no changes to existing render pages'
   behavior.

## Known risks

| Risk | Mitigation |
|---|---|
| OSR pacing proves unworkable | Phase 0 decides before any real code; Candidate B is the fallback |
| Camera device contention — PConAir holding the UVC device prevents the Zoom Room from using it directly | Deployment decision, not a code one, and **not yet made** — see Open dependency above. Likely: run PConAir on a second mini fed by its own Q-SYS USB bridge |
| Zoom Rooms PTZ control lost when the room selects a composited source | Out of scope here. PTZ moves to Q-SYS UCI or Companion. Flag in the operator SOP |
| NDI SDK terms changed in 2025 | Video-only, internal distribution, `ndi.video` link in the UI. Read the current terms before shipping |
| Notarization fails with bundled `libndi` | Validate the signed build in Phase 0C, not at ship time |
| Electron main-thread stalls hitching video | NDI send on a worker thread; no per-frame allocation |
| 5-hour window closes mid-unit, leaving a half-finished tree | Units sized under one window; `state.json` plus commit-per-unit; recovery path for `in_progress` at startup |
| Weekly cap exhausted with phases outstanding | Schedule heavy phases right after the weekly reset; orchestrator stops and notifies rather than idling for days |
| Budget spent on context rather than code | Fresh session per unit, `/compact` at 60%, no long-running continued conversations |

## Decisions (previously open questions)

All resolved 28 Sep 2026 except where noted. Do not re-litigate the resolved
ones.

1. **Repo:** `ReynoldsProductions/PConAir`. Verify with `git remote -v` if
   ever in doubt — see the note at the top of this doc.
2. **NDI source naming:** `PConAir — <ROOM> <ROLE>`. Adopted.
3. **Platform:** macOS only for MVP. Windows is not a requirement and is not
   a review criterion.
4. **Coexistence:** camera mode is exclusive while active.
5. **Usage windows:** recorded in the scheduling note under Running this on
   a Pro plan. Confirmed Pro plan, 28 Sep 2026.
6. **Camera device contention / deployment topology:** open — see Open
   dependency above. Resolve before Phase 1 starts.
