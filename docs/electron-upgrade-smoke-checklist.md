# Electron upgrade smoke checklist

Human-run only — no agent may tick these boxes. Reuse this checklist on
every future Electron bump (see `CLAUDE.md`'s upgrade cadence rule).

Run against a real build, on a physical Mac with a second display.

- [x] Build and launch: install the DMG, launch it
- [X] Tray icon appears; menu opens; quit works
- [x] Settings window opens, renders, saves a setting, survives a reopen
- [x] Admin → System reports the **correct listening port**
- [x] `/operator` loads; the WS pill goes green
- [x] Lower Thirds: Apply → graphic appears on the output window on the
      **intended display**; Hide clears it
- [x] Open `/render/l3` as an OBS browser source on a second machine; fire
      a lower third; confirm transparency and live updates
- [x] URL mode: A/B switch, two instances, each keeping its own partition
- [x] Slides mode: **sign in to Google**, load a deck, restart the app,
      confirm you are **still signed in** (`persist:google-slides`
      survived the Chromium jump)
- [x] Prompter: load a Google Doc via the Drive connection; confirm the
      signed-in fetch still works
- [x] Multi-display: unplug and replug the second display; confirm windows
      recover
- [x] Watchdog: leave running 30+ minutes; confirm no spurious
      unresponsive/crash reports
- [x] Cloudflare tunnel: enable, load `/operator` through the tunnel URL,
      confirm the PIN gate
- [x] Companion: connect the module, fire an action, confirm feedback

**Gate:** every box ticked by a human before the release tag is pushed.

## Electron 44 migration run (2026-09-29)

Tested against the manually-triggered DMG build on `main` @ `2750968`
(GitHub Actions run 36521626498, https://github.com/ReynoldsProductions/PConAir/actions/runs/36521626498).
