# OBS boot/recovery hardening — plan for external (on-site/ops) execution

## Context

Zoom Room Mac minis run OBS + PConAir side by side (OBS overlays the PConAir
browser-source output on the Q-Sys camera feed before it reaches Zoom).
Zoom Rooms appliances perform an automatic weekly reboot as part of their own
maintenance cycle. From OBS's perspective this is always an **unclean
shutdown** — nothing tells OBS to close gracefully first — which produces two
symptoms every week, at every office:

1. OBS does not reliably relaunch after the reboot.
2. When it does relaunch, the Virtual Camera (the thing that actually feeds
   Zoom) is not automatically started.

This doc is a fix plan, not an implementation — it requires on-site or
remote-hands access to each office's Mac mini and to the installed OBS
Studio version, which is outside this repo and outside this coding session's
reach. Hand this to whoever/whatever has that access (a separate ops-focused
agent session with SSH, or a person at each site).

Companion, in-repo fix already shipped: PConAir itself now has a
**"Launch PConAir at login"** toggle (Admin → System → Startup) so PConAir
comes back on its own after the same reboot — see `applyLaunchAtLogin()` in
`src/main/index.ts`. OBS needs the equivalent, plus virtual-cam recovery,
neither of which PConAir can do from inside its own process (it doesn't
control OBS).

## Root cause

- OBS has no first-class "start at login" setting; whatever gets it running
  today (if anything) is likely a manual Login Item, which macOS Login Items
  do **not** retry if OBS crashes or exits — a single failed launch attempt
  post-reboot leaves the room silently dead until someone notices.
- OBS Studio's own "unclean shutdown" detection can pop a "Start Safe Mode?"
  or "restore last session?" dialog on launch after a hard shutdown. On a
  headless/unattended room, that dialog blocks everything — nothing is
  actually broadcasting even though the OBS process is technically running.
- Virtual Camera start is not persisted across launches and has no GUI
  "auto-start" toggle — it must be explicitly (re)started every time OBS
  starts fresh.

## Recommended fix: a single watchdog, not three separate patches

All three symptoms (OBS not launching, unclean-shutdown dialog, virtual cam
not starting) are best solved by **one supervising script**, run via
`launchd`, rather than three independent fixes — a watchdog that can also
self-heal mid-week (OBS crash, virtual cam silently drops) not just at boot.

### 1. `launchd` LaunchAgent for OBS itself

Replace any manual Login Item with a proper LaunchAgent
(`~/Library/LaunchAgents/com.pconair.obs-launcher.plist`) using `RunAtLoad`
+ `KeepAlive` (or `StartInterval`), so macOS itself restarts OBS if it ever
exits unexpectedly — not just once at boot.

Launch OBS with:
```
/Applications/OBS.app/Contents/MacOS/OBS \
  --startvirtualcam \
  --minimize-to-tray \
  --disable-shutdown-check
```
- `--startvirtualcam` — native OBS CLI flag (OBS ≥ 27) that starts the
  virtual camera immediately on launch. This alone may fully solve symptom
  #3 without any extra scripting.
- `--minimize-to-tray` — avoids a stray foreground window fighting for focus
  in a headless setup.
- `--disable-shutdown-check` — skips the "OBS didn't close properly" prompt
  that would otherwise block an unattended launch after the weekly reboot.

**Verify exact flag names/support against the actual installed OBS version**
on one Mac mini first (`OBS --help`) — flags have shifted across OBS major
versions and this must be confirmed on real hardware before rolling out to
all 5 offices.

### 2. obs-websocket self-heal check (belt-and-suspenders)

`--startvirtualcam` may fail silently (e.g. camera device busy immediately
post-boot, a race with a system extension not yet loaded). Add a lightweight
watchdog script (Node or Python, using `obs-websocket-js` /
`obs-websocket-py`, since obs-websocket ships built into OBS ≥ 28):

- Runs on a `StartInterval` (e.g. every 60s) via its own LaunchAgent.
- Connects to `ws://localhost:4455` (obs-websocket default; must be enabled
  + password-set per machine in OBS's WebSocket Server Settings).
- Calls `GetVirtualCamStatus`; if not active, calls `StartVirtualCam`.
- If the connection itself fails (OBS not running at all), that's a signal
  the LaunchAgent from step 1 hasn't succeeded — log it loudly; this is the
  one case worth alerting on rather than silently retrying forever.
- Logs every state transition (down → recovered, started virtual cam) to a
  local file for post-incident diagnosis — mirrors the pattern PConAir's own
  debug log console already uses, for consistency if these logs are ever
  reviewed side-by-side.

### 3. One-time validation per office

For each of the 5 Mac minis:
- Confirm installed OBS version and exact working CLI flags.
- Enable obs-websocket, set a password, note the port; update the watchdog
  script's config for that machine.
- Install both LaunchAgents (OBS launcher + watchdog).
- **Force an actual unclean shutdown** (hold power, or `sudo shutdown -r now`
  mid-stream) at least once and confirm: OBS relaunches without a blocking
  dialog, and the virtual camera comes up on its own within ~60s — don't
  assume the weekly Zoom reboot will validate this for you after the fact.

## Out of scope for this plan

- PConAir itself needs no further changes here — its own output is already
  reachable at a stable local URL (`/render/l3` or `graphics/lower-third-live`)
  regardless of when OBS starts; OBS just needs to be alive with its browser
  source loaded and the virtual cam running to pick it back up.
- A future nice-to-have: surface OBS/virtual-cam health inside PConAir's own
  watchdog (`src/main/watchdog-electron.ts`) so producers see a single status
  indicator instead of two separate apps to check. Not needed to fix the
  three reported symptoms — flagged here only so it isn't lost.
