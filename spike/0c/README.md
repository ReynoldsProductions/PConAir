# Spike 0C — NDI sender (throwaway, never merges to main)

Run: `node spike/0c/main.js` (plain Node, not Electron -- see "Why plain Node" below).
Env: `SPIKE_SECONDS` (default 20), `SPIKE_NDI_NAME`, `SPIKE_OUT`, `SPIKE_DUMP`.
Needs `spike/0c/node_modules` installed first: `cd spike/0c && npm install`
(installs `grandi@2.0.2`; not committed, see `.gitignore`).

Rig: same headless Linux container as 0A/0B. No real camera, no real network
peers, **no mDNS/Avahi responder running** (confirmed: no `avahi-daemon`
process, `dbus-daemon` only). `/usr/bin/time` is not installed in this
container either, so CPU is measured via Node's own `process.cpuUsage()`
instead. 20 s runs, not a 10-minute soak, mirroring 0A/0B's time budget.

## Library evaluation (in the spec's stated order)

### 1. `stagetimerio/grandiose` -- BLOCKED, proprietary-SDK download gate

npm name is `@stagetimerio/grandiose` (0.2.0). `npm install` in a scratch
folder ran its `install` script (`node scripts/ndi.js && node-gyp rebuild`),
which does an anonymous `GET` of the full NDI SDK installer directly from
`https://downloads.ndi.tv/...` (Linux: `Install_NDI_SDK_v6_Linux.tar.gz`) to
assemble headers/libs for node-gyp, then compiles the addon against them.
That request failed in this container:

```
gyp error / npm error: HTTPError: Request failed with status code 403 (Forbidden):
GET https://downloads.ndi.tv/SDK/NDI_SDK_Linux/Install_NDI_SDK_v6_Linux.tar.gz
```

Root cause, confirmed with a direct `curl`: this container's egress proxy
rejects the CONNECT to `downloads.ndi.tv` as **organization policy**, not an
NDI-side auth check -- `curl` never got past the proxy tunnel, so whether
`downloads.ndi.tv` itself requires a session/email-gated cookie for an
anonymous script `GET` was never actually tested. Either way the practical
result is the same: **this install cannot complete headlessly in this
container**, which is exactly the "proprietary SDK behind a licensing/account
gate" case the task called out in advance. Not fought further, per
instructions -- moved on to library 2.

### 2. `tux-tn/grandi` -- INSTALLS AND LOADS CLEANLY

npm name `grandi` (2.0.2), plus its optional per-platform prebuild package
(`@grandi/linux-x64` here). `npm install` took under a second, no compiler
invoked, no network fetch beyond npm itself -- the prebuild package *bundles*
`libndi.so`/`libndi.so.6` (the redistributable runtime shared library, not
the full SDK headers) directly in the npm tarball. `require('grandi')` loads
in plain Node; `grandi.initialize()` returns `true`;
`grandi.version()` reports `NDI SDK LINUX ... 6.3.2.0`. This is the library
the rest of this spike uses.

## Synthetic pattern sender: ran, 20 s, clean

`spike/0c/pattern.js` builds a 1920x1080 BGRA frame: moving color bars (cheap
window-slide over a precomputed double-width row, not a per-pixel recompute)
plus a 24-bit binary frame-counter block in the top-left, round-trip verified
(`decodeCounter` exactly recovers the frame index -- checked for indices 0,
1, 5, 1000, 123456 before the timed run).

`spike/0c/sender.js` sent this for 20 s at 30 fps via `grandi.send()`.
Results in `spike/0c/result-send.json`:

- **600/600 frames sent, 0 errors, 0 drops vs. expected, 0 "blocked" sends**
  (none took >2x the 33.3 ms period to resolve).
- **Emit-interval jitter is tight on this rig**: mean 33.326 ms, sd 1.036 ms,
  p99 34.728 ms, max 39.682 ms -- comfortably inside the spec's ±2 ms exit
  criterion, *for send-side pacing alone*, on this rig. This is the
  self-correcting `next += PERIOD` scheduler from 0A/0B's pacer, not a naive
  `setInterval`; there is no dirty-rect/paint problem here since there is no
  DOM in this path -- the harness *is* the frame source.
- **CPU (single Node process, `process.cpuUsage()` samples, this container
  has 4 cores)**: mean 16.0% of one core, p99 27.7%. Far below 0A's OSR
  numbers (~19-23% *summed across Electron's multiple processes*) -- not
  a fair comparison, since this measures one plain Node process generating
  and handing off frames, not Electron rendering a real composite. Treat as
  "the send() call itself is cheap," nothing more.
- `sender.connections()` was 0 throughout (expected: nothing ever connected,
  see Discovery below).

**CAVEAT, same as 0A/0B: this rig is NOT the target.** No camera, no
compositing load (this is a synthetic buffer, not a rendered DOM), no
macOS, no Mac mini, no hardened-runtime/notarized bundling tested. These
numbers show the library's send-path mechanics work and are cheap on *some*
Linux box; they say nothing about behavior once this is wired to real
Electron frame delivery, worker-thread marshaling, or the buffer-pool
discipline the spec requires for the real implementation (this spike does
allocate a small number of dump buffers; the hot send path reuses one
buffer via `makeFrameBuilder`, as a nod to that requirement, but is not the
production buffer-pool implementation).

## Discovery and receive verification

Per the task: verify via whatever is actually possible here, without real
NDI hardware/software.

- **`grandi.find()` in a second process** (`spike/0c/finder.js`), polled once
  a second for 15 s while `sender.js` (a third, independent process) was
  actively sending, with `showLocalSources: true`: **found nothing, every
  poll, the whole window.** (`result-discovery.json`)
- **A `grandi.receive()` in a fourth process** (`spike/0c/receiver.js`),
  connecting directly by the sender's exact name (bypassing discovery
  entirely, since discovery already found nothing): the receiver *handle*
  was created without error, but **zero video frames arrived in 15 s of
  polling** -- no actual NDI connection was ever established.
  (`result-receive.json`)
- Checked why: no `avahi-daemon` (or any mDNS responder) is running in this
  container, and NDI's discovery/name-resolution is mDNS-based. This matches
  0B's own finding that some of this container's networking (there: Xvfb/X11
  capture ceilings) doesn't reflect real target-hardware behavior.

**What this does and does not show:** it shows `grandi`'s find/receive APIs
run without crashing and fail *cleanly* (clear errors/timeouts, not hangs or
silent corruption) when there is nothing to discover. It does **not** show
that discovery or connection would work given a real network with mDNS --
that requires a human with real hardware.

**Explicitly NOT verified here, and needs a human with real hardware (per
the task and matching `.agent/state.json`'s own note):**
- Real **NDI Studio Monitor** finding and displaying this source.
- Real **Zoom Room Custom AV NDI input** selecting and displaying this
  source.
- Behavior on the actual mDNS-capable network the target deployment uses.
- Anything about the macOS build: bundling `libndi` inside the `.app`,
  hardened runtime + notarization (the spec's own risk list flags this
  explicitly for Phase 0C, not just Phase 3B).

## Vitest

`npx vitest run` (Node 24.21.0, via `nvm install 24` -- this container's
default Node is v22.22.2 and the project's `engines.node` requires >=24):
first attempt was **87 files run, 2 failed** --
`tests/companion-defs.test.ts` (the same pre-existing `@companion-module/base`
load failure 0A/0B both hit, from not having run `npm run install:companion`
yet) and, new this run, `tests/companion-actions.test.ts` failing with
`Electron failed to install correctly` inside `node_modules/electron`'s own
lazy-download path guard. Re-ran that one file alone: **50/50 passed** in
~70 s, and a full clean re-run after `npm run install:companion` gave
**87/87 files, 1256/1256 tests passed**. Treating the first
`companion-actions` failure as a one-off first-run flake (likely parallel
vitest workers racing `node_modules/electron`'s own path-check logic on a
freshly-`npm ci`'d container) rather than a regression: nothing in this
branch's diff touches `src/main/**`, Electron, or anything that test
exercises -- the diff is entirely new files under `spike/0c/`.

## Deliberately skipped (spike scope, time-boxed like 0A/0B)

- Real camera, real network peer, real NDI Studio Monitor, real Zoom Room.
- Worker-thread send (spec requires it for the real implementation; this
  harness sends from the main/only thread of a plain Node process --
  sufficient to evaluate the library, not to validate the production
  threading model).
- Production buffer-pool discipline (see caveat above).
- Bundling `libndi` in a signed/notarized `.app` (macOS-only concern; this
  container is Linux).
- 10-minute soak; only 20 s, per the task's explicit scope.
- Investigating whether `downloads.ndi.tv` itself (as opposed to this
  container's proxy) would serve `stagetimerio/grandiose`'s install script
  anonymously -- not testable from here, not fought further.

**Open, for whoever runs 0D or a later real-hardware pass:** rerun discovery
and receive on a network with real mDNS (or a human's laptop running NDI
Tools) before relying on "discovery works" as a decided fact; this spike
only shows the failure mode is clean, not that success would also be clean.
