# Project Roadmap — Electron 44 Migration → Camera Mode + NDI Out

Status: orchestration layer over two existing plans. This doc does not
duplicate their task lists — it sequences them and defines how an unattended,
quota-aware scheduler drives both to completion on one shared Pro ($20/mo)
plan.

Sourced plans, executed in this order:

1. [`docs/plans/2026-09-28-dependency-currency.md`](./2026-09-28-dependency-currency.md) — Layers 2–3 (Layer 1 already merged, PR #62)
2. [`docs/plans/2026-09-28-electron-44-migration.md`](./2026-09-28-electron-44-migration.md) — Phases 0–3
3. [`specs/24-camera-mode.md`](../../specs/24-camera-mode.md) — Phases 0–5

**Every dispatched unit and every scheduled firing reads this document
first**, before its own plan's task list.

---

## Orchestrator

### Why this differs from what the source plans say

The camera plan's original orchestrator design polls `/usage` before each
unit and gates on "remaining window ≥ 2× estimate." That doesn't work as a
scheduled, unattended process: there is no tool that exposes remaining
Pro-plan quota to an agent outside an interactive session. `/usage` is a CLI
display, not a callable API.

The Electron migration plan's instruction to "dispatch Tasks 3–9 in a single
message so they run concurrently" is also overridden here. On a shared Pro
quota pool, concurrent agents don't save wall-clock time — they drain the
same 5-hour window proportionally faster for zero gain, then wait exactly as
long as sequential execution would have taken anyway.

**This orchestrator is reactive instead of predictive:** it doesn't guess
whether there's enough quota before starting. It starts a unit, and if that
unit's execution actually hits a rate limit, the limit response itself
carries the real reset timestamp — ground truth, not an estimate. The
orchestrator commits progress, records that timestamp, and stops. A cheap
scheduled check later resumes exactly there.

### State: `.agent/state.json`

The only thing that survives a pause. Fields:

```
effort          "dependency-currency" | "electron-migration" | "camera-mode"
phase           the source plan's phase label (e.g. "Phase 0")
track / task_id the source plan's task/track identifier (e.g. "Task 7", "2A")
status          "pending" | "in_progress" | "done" | "blocked" | "paused-for-quota"
branch
worktree_path
last_commit
resume_command  the literal prompt to re-issue on resume
resume_after    ISO timestamp from the actual rate-limit response, if paused
notes
```

`.agent/JOURNAL.md` gets one short entry per completed or paused unit: what
landed, what was deliberately skipped, measured numbers, open questions —
matching each source plan's own report-format convention.

### Lock file: `.agent/lock.json`

Added after a real incident (2026-09-29): two live firings ran concurrently
against this repo and independently implemented the same tasks three times
in a row before one of them correctly stopped rather than racing a fourth
time. No work was lost — both firings converged on the same correct code —
but it was pure waste, and a genuine two-writer conflict on a task with real
side effects (e.g. Task 14, the Electron version bump itself) could corrupt
`package-lock.json` or leave a half-applied change. The root cause of the
concurrent firing was never fully confirmed (only one schedule trigger was
configured, so it may be a scheduler-level double-fire, or a manual trigger
overlapping the cron, or a batched session simply running long enough to
still be active when the next hourly tick landed) — this lock defends
against the *symptom* regardless of cause.

Fields: `{ "session_id": <this firing's own session id or a random token>,
"started_at": <ISO timestamp> }`.

**Before doing anything else** (before even reading `state.json` for real
work), a firing must:

1. Pull latest, then read `.agent/lock.json`.
2. **If it exists and `started_at` is less than 90 minutes ago:** another
   firing is presumed still active. Exit immediately — do not read
   `state.json`, do not dispatch anything, do not commit anything. This
   should be the common case if two firings ever do land close together
   again, and it costs almost nothing.
3. **Otherwise** (no lock file, or one older than 90 minutes — presumed
   dead from a crash): write a fresh `.agent/lock.json` with this firing's
   own session id and the current timestamp, commit, and push *immediately*,
   before starting any real work. This is the claim.
4. Proceed with the loop below.
5. **On every exit path** (unit completed and batch continuing, batch
   stopped normally, paused-for-quota, blocked, or an error) — delete
   `.agent/lock.json` (or mark it released) and commit+push that removal as
   part of the same final commit, so the next firing doesn't wait out the
   90-minute staleness window unnecessarily. If a firing dies without
   reaching this step, the staleness check in step 2 is what eventually
   unsticks things.

90 minutes was chosen to comfortably cover a full 8-unit batch (observed
per-unit time has been roughly 5–10 minutes) with margin, while still being
short enough that a genuinely dead lock doesn't block progress for long.

### The loop (what each scheduled firing does)

0. **Acquire the lock first** — see above. Do not proceed past this step
   without either holding a fresh lock or confirming none is needed.
1. Read `.agent/state.json`.
2. **If `status == "paused-for-quota"` and now < `resume_after`:** exit
   immediately. This is the common case between windows and should cost
   almost nothing.
3. **If `status == "in_progress"` at startup:** the previous run died
   mid-unit (crash, kill, or an unclean rate-limit hit). Do not blindly
   continue it. Run `git status` and the test suite. Either finish the unit
   cleanly from where it sits, or reset to `last_commit` and restart the
   unit from scratch.
4. **If `status == "blocked"`:** stop. Do not dispatch. This means a human
   decision is pending (see "Weekly cap" below, or any other blocker written
   into `notes`). Notify, don't retry.
5. **Otherwise (`pending`):** determine the next unit from the **effort
   ordering** below, dispatch it in a fresh session (no carried-over
   context — resuming a long conversation is itself one of the larger silent
   quota drains, per the camera plan's own observation).
6. **Unit completes normally:** commit, append the `JOURNAL.md` entry,
   advance `state.json` to the next unit with `status: "pending"`.
   **Then, within the same firing, check whether to continue to the next
   unit immediately** rather than waiting for the next hourly tick (see
   "Batching within a firing" below). Only exit once a stopping condition
   is hit.

### Batching within a firing

Early runs showed the real constraint isn't token/usage cost (it's been low)
— it's the platform's 1-hour minimum cron interval combined with a
one-unit-per-firing design. That combination means an idle-but-correct
system was still bottlenecked at roughly one unit per hour of wall clock,
independent of how fast the work itself was. Since usage isn't the scarce
resource here, a single firing should **keep dispatching the next pending
unit in a loop**, in the same session, until it hits one of these stopping
conditions:

- An actual rate limit (→ `paused-for-quota`, as before).
- A condition requiring a human (→ `blocked`, as before).
- **The next unit involves native bindings, code signing, or notarization.**
  Stop the batch *before* starting it, even if the session has budget left —
  these fail in long unpredictable loops and deserve a clean, freshly
  started session, not one already several units deep. Leave `state.json`
  `pending` at that unit; the *next* firing will pick it up as the first
  (and, per the same rule, likely only) unit of its own batch.
- **A phase/effort boundary is reached** (e.g. a source plan's own gate task,
  or the hard gate between efforts in this doc). Stop and let the next
  firing start the new phase/effort fresh, so its journal entry and any
  gate-checking happen at the top of a session rather than buried mid-batch.
- **A hard safety cap of 8 units in one firing**, regardless of how clean
  things look — a backstop against a subtle loop (e.g. a unit that
  "completes" but doesn't actually advance state), not a target to hit.

This is a deliberate loosening of the original one-unit-per-firing design,
made once real usage data showed quota headroom, not a rule to re-tighten
without similar evidence.
7. **Unit hits an actual rate limit mid-work:** stop at the nearest safe
   checkpoint — do not leave a half-edited file uncommitted. Record the real
   reset timestamp from the limit response as `resume_after`, set
   `status: "paused-for-quota"`, commit whatever is safely committable, exit.
8. **Weekly cap exhausted, not just the 5-hour window** (the limit response
   or its messaging indicates a multi-day reset rather than an hours-away
   one): do **not** just set a far-future `resume_after` and go quiet for
   days unattended. Set `status: "blocked"`, write the reset date into
   `notes`, and stop. A human should see and acknowledge a multi-day gap,
   not have the scheduler silently resume a week later having made no
   progress the whole time it should have flagged the wait.

### Resource: one available limit reset

There is currently **one** free plan-limit reset available on the account.
It is account-level and user-triggered — nothing in this orchestrator can
invoke it itself. Treat it as a reserve, not something spent on the first
pause encountered.

- Track it in `.agent/state.json` as `free_reset_available: true`. The
  orchestrator only ever reads and reports this flag; only a human flips it
  to `false`, after actually using it.
- **Do not recommend using it for an ordinary `paused-for-quota` stop.**
  Those are expected and cheap — the routine resumes on its own once
  `resume_after` passes.
- **Do surface it as a decision point when a pause would stall something
  time-sensitive:** mid-way through a native-binding/notarization unit (Task
  14 or later in the Electron migration; the NDI sender bindings in Camera
  Phase 3), or if a `blocked` (weekly-cap) stop lands right before a known
  deadline or show date. In that case, set `status: "blocked"` with a
  `notes` entry that explicitly says a free reset is available and names the
  tradeoff, and stop for the human to decide — don't spend it
  automatically and don't stay silent about the option either.
- Once used, a human updates `free_reset_available: false` in `state.json`
  and the orchestrator drops the option from future `notes` entries.

### Hard rule carried over from both source plans

Before any unit involving native bindings, code signing, or notarization
(the Electron bump itself, and later the NDI sender bindings in Camera
Phase 3) — these fail in long, unpredictable loops. Do not dispatch one on a
firing that just resumed from a pause. Let the resumed window run at least
one normal unit first, so there's headroom observed in practice before
committing to a unit type that's historically unpredictable.

### Schedule mechanics

Implemented as a **`schedule`-skill routine** (a persistent cloud agent on
its own cron schedule), not `CronCreate` — `CronCreate` jobs are session-only
and auto-expire after 7 days, and this roadmap spans multiple weeks across
both efforts.

- Fire cadence: **hourly** — the platform's minimum cron interval is 1 hour,
  so that's the tightest polling loop available, not a deliberate choice.
- Each firing is a **fully isolated cloud session with its own fresh git
  checkout** — it has no access to any local machine, local disk, or memory
  of the previous firing. **All state must live in git.** Every firing that
  makes progress must end by committing and pushing `.agent/state.json`,
  `.agent/JOURNAL.md`, and any code/spec changes, or the next firing has
  nothing to resume from.
- A firing that finds `paused-for-quota` (not yet due) or `blocked` costs
  almost nothing — it reads one file and exits without committing anything.
- A firing that's clear to proceed dispatches exactly one unit, then stops.
  The routine's cron cadence is what "resumes on the next window" — there is
  no long-running process to keep alive between firings.
- Counts as ordinary Claude Code usage against the same account plan as any
  interactive session — it does not create separate billing exposure unless
  usage-based overage purchasing is enabled on the account (verify it is
  off before relying on this).

---

## Effort ordering

### 1. Dependency currency, Layers 2–3

Layer 1 (CI gate) is done — PR #62 merged. Do Layers 2 (Dependabot) and 3
(the staleness alarm) **before** the Electron bump itself: Layer 3's alarm
should fire once for real against the actual 573-days-stale Electron 32,
which is the proof it works, and that proof is worth having on record before
the version it's alarming about changes out from under it.

### 2. Electron 32 → 44 migration

Phases 0–3, Tasks 1–18, in strict numeric order — **sequential, not the
"dispatch Tasks 3–9 concurrently" instruction in the source plan.** See
Orchestrator above for why.

Task 17 (human smoke test) and Task 18 (release, tag push) are hard
completion markers for this effort. Nothing in Camera Mode starts until both
are done.

### 3. Camera Mode + NDI Out

Phases 0–5, per `specs/24-camera-mode.md`, beginning only once Electron
migration Task 18's tag is pushed and the published DMG has been downloaded
and launched once.

Camera Phase 0's spikes (device capture, `getUserMedia`/`getDisplayMedia`,
display enumeration) should build on the now-current Electron 44 baseline,
and its test authors should look at `tests/setup/electron-mock.ts` (built in
the Electron migration's Phase 0) before writing new Electron mocks from
scratch — the window/display/session fakes built there are directly
reusable for camera device and output-window testing.

---

## Hard gate between efforts

Do not start Camera Mode Phase 0 while Electron migration work is still
outstanding, even opportunistically "to save a window." The quota pool is
shared; there is no idle capacity to spend — running both means each
progresses slower with no net time saved, and it doubles the number of
in-flight `state.json` branches the orchestrator has to reason about after a
crash.

**This gate does not auto-open.** The Electron migration is the priority;
Camera Mode is explicitly not (decision recorded 2026-09-29). When the
Electron migration's Task 18 completes — tag pushed, published DMG
downloaded and launched once — do **not** advance `state.json` into Camera
Mode Phase 0 automatically. Instead, set `status: "blocked"` with a note
saying the Electron migration is complete and Camera Mode is ready to start
whenever a human says go. A firing that finds this state should keep
checking in cheaply (per the normal `blocked` handling — read, see blocked,
exit) rather than either starting Camera Mode unasked or disabling itself.
This is a deliberate full stop, not a pause waiting on quota or a decision
about *how* to proceed — it's waiting on whether to proceed at all.

---

## Known corrections applied here (vs. the three source docs as written)

- Camera plan's `/usage`-polling gate → replaced with the reactive
  rate-limit-response design above.
- Electron plan's concurrent Tasks 3–9 dispatch → sequential.
- Both plans' implicit "the orchestrator is some existing tool" assumption →
  made explicit: this is a `schedule`-skill routine you configure once, not
  a built-in feature.
