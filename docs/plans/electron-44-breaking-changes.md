# Electron 33 → 44 Breaking Changes — PConAir Applicability

**Date produced:** 2026-09-29
**Produced by:** Task 1 of `docs/plans/2026-09-28-electron-44-migration.md` ("Harvest the real
breaking-change list"), run against `main` = `d26fcbc`.
**Network access:** Live. `electronjs.org` itself was blocked by this sandbox's egress proxy
(`WebFetch` → `EGRESS_BLOCKED`), but `raw.githubusercontent.com/electron/electron/main/docs/breaking-changes.md`
was reachable via both `curl` and `WebFetch` and returned the genuine, current source file
(verified: HTTP 200, 133,103 bytes, 3,586 lines, matching version headers up to the in-development
`46.0` at the top — i.e. this is the live `main`-branch doc, not a stale mirror). **All entries
below are transcribed/paraphrased from that fetched file, not from training-data recollection.**
A first `WebFetch` attempt at the GitHub *blob* HTML page (not the raw file) returned an
unreliable, differently-structured summary that did **not** match the real file's version
boundaries once cross-checked (it started numbering at 44.0 instead of the file's actual current
head of 46.0, and several described changes could not be located in the real text) — that result
was discarded and is not used anywhere below. Only the raw-file fetch, corroborated by a direct
`curl`, is treated as ground truth.

**Methodology:**
1. Fetched the full `docs/breaking-changes.md` and extracted the `## Breaking API Changes (X.0)`
   sections for X = 33 through 44 (lines 239–1186 of the source file, saved for this session at
   `/tmp/claude-0/-home-user-PConAir/7d06fe77-39ff-5a60-8c76-15955f72b3ee/scratchpad/breaking-changes-33-44.md`).
2. Filtered to changes touching only: `app`, `BrowserWindow`, `session`, `screen`, `webContents`,
   `ipcMain`, `ipcRenderer`, `contextBridge`, `Tray`, `Menu`, `dialog`, `shell`, `nativeImage`,
   `net` — the modules named in the migration plan's Audit Findings section. Entries about
   `clipboard`, `systemPreferences`, `webFrame` (routing-id APIs), extensions/`chrome.scripting`,
   printing (`PrinterInfo`), OS/platform-support drops (macOS 10.15/11/12, Windows/Linux 32-bit,
   GTK, Ozone/Wayland env vars, ANGLE linking), native-module C++ standard bumps, and the
   `electron` npm package's postinstall-download removal were filtered out as not touching the
   listed surface, per plan Step 2. `protocol.*` changes were filtered out too — the Audit
   Findings section separately confirmed PConAir uses no custom protocol handlers.
3. For each surviving change, grepped `src/` for the affected API and recorded a verdict with a
   real `file:line` citation.
4. Ran the Node 20→24 removal greps from plan Step 4 separately (see below).

**Result: 34 changes survived the filter across the 12 majors. 3 are `applies: yes`.** That is a
real, non-trivial number of applicable changes — not the "no breaking changes apply" outcome the
plan's gate treats as a red flag requiring a re-check.

---

## Node 20 → 24 removals (plan Step 4)

```bash
grep -rnE "\bnew Buffer\(|url\.parse\(|fs\.rmdir\(|process\.binding|require\('sys'\)" --include="*.ts" src/
```

**No matches.** Task 13 ("Address the Node 24 findings from Task 1 Step 4") should be marked
**skipped** with a note pointing here — per the plan's own instruction, "If Task 1 found nothing,
mark this task skipped with a one-line note and move on. Do not invent work."

Caveat: this only checked the five deprecated/removed Node APIs the plan named. It is not an
exhaustive Node 20→24 diff — Task 13's executor should treat a clean `npx tsc --noEmit` and
`npx vitest run` on Node 24 (Task 12) as the actual gate, not this grep alone.

---

## Electron 33.0

### `ipcMain` — `WebFrameMain` instances from events may be detached or `null`
After a frame's cross-origin navigation, `WebFrameMain` accessors (e.g. `event.senderFrame` on an
`ipcMain` listener) may return an instance with `frame.detached === true`, or `null` if accessed
late (after an `await`) rather than synchronously in the handler.

`applies: no` — PConAir never reads `event.senderFrame` or any other `WebFrameMain` accessor
(`grep -rn "senderFrame" --include="*.ts" src/` → no matches).

### `app` — `webContents` may be `null` on the `login` event
`app.on('login', ...)`'s `webContents` argument is `null` when the request comes from a utility
process with `respondToAuthRequestsFromMainProcess: true`.

`applies: no` — PConAir has no `app.on('login', ...)` handler (`grep -rn "app\.on(" src/` lists
only `before-quit`, `window-all-closed`, `browser-window-created`).

### `BrowserWindow` — `type: 'textured'` deprecated
The `textured` value for `BrowserWindowConstructorOptions.type` (macOS `NSWindowStyleMaskTexturedBackground`)
is deprecated with no replacement.

`applies: no` — no `BrowserWindow` in PConAir sets `type: 'textured'`
(`grep -rn "textured" src/` → no matches).

*(Filtered out from 33.0: `document.execCommand("paste")` deprecation — a DOM/renderer-content
API, not an Electron module; custom-protocol Windows-path handling — `protocol.*` is confirmed
unused; macOS 10.15 support drop and the C++20 native-module requirement — platform/toolchain,
not app-surface API.)*

---

## Electron 34.0

### `BrowserWindow` — menu bar now hidden during fullscreen on Windows
Windows fullscreen windows now hide their menu bar, matching prior Linux behavior. (The upstream
doc notes this was originally mis-dated to 33.0 and actually shipped in 34.0.)

`applies: no` — PConAir does have a Windows CI build target
(`.github/workflows/build-release.yml:88` runs on `windows-latest` and packages with
`--platform win32`), but no code path in the repo ever calls `BrowserWindow.setFullScreen()`
(`grep -rn "setFullScreen\|kiosk" src/` → no matches). The only fullscreen logic in the codebase,
`src/main/fullscreen-chrome.ts:4` (`applyFullscreenChrome`), is explicitly gated to
`process.platform === 'darwin'` (line 5) and uses `setSimpleFullScreen`, a macOS-only API — it is
a documented no-op on Windows. There is no Windows fullscreen behavior for this change to affect.

---

## Electron 35.0

### `dialog` — `defaultPath` on Linux now requires portal v4+
The required XDG desktop-portal version for honoring `defaultPath` in file dialogs was reverted
from 4 to 3; using `defaultPath` with an older portal silently has no effect unless
`--xdg-portal-required-version` forces it.

`applies: no` (with caveat) — `src/main/index.ts:425` (`branding:download-template`,
`dialog.showSaveDialog`) does pass `defaultPath`. PConAir's release workflow only builds macOS
(`macos-latest`) and Windows (`windows-latest`) artifacts (`.github/workflows/build-release.yml:11,88`);
there is no Linux release job, and Linux is not covered by the Task 17 human smoke checklist. If
PConAir is ever run from a Linux dev checkout, this dialog's default-path behavior may silently
no-op on an older portal — worth a one-line mention in the smoke checklist if Linux use ever
becomes real, but not a blocking finding for this migration.

### `session` — `setPreloads`/`getPreloads` deprecated in favor of `registerPreloadScript`/`unregisterPreloadScript`/`getPreloadScripts`
`applies: no` — PConAir does not call `session.setPreloads`/`getPreloads` anywhere
(`grep -rn "setPreloads\|getPreloads\|registerPreloadScript" src/` → no matches; preloads are
wired via `BrowserWindow`'s `webPreferences.preload` option instead).

### `webContents` — `console-message` event signature changed to a single event object
Old: `(event, level, message, line, sourceId)`. New: `({ level, message, lineNumber, sourceId, frame })`,
with `level` now a string (`info`/`warning`/`error`/`debug`) instead of a number.

`applies: no` — no `webContents.on('console-message', ...)` listener exists in PConAir
(`grep -rn "console-message" src/` → no matches).

### `session` — `WebRequestFilter.urls: []` no longer means "match all"; use `['<all_urls>']`
`applies: no` — PConAir does not use `session.webRequest.*` at all
(`grep -rn "webRequest\." src/` → no matches).

*(Filtered out from 35.0: `session.serviceWorkers.fromVersionID` deprecation — not used, but
also would be `session`-surface anyway, so listed above for completeness rather than dropped —
see the "Filtered out" note; `systemPreferences.isAeroGlassEnabled()` deprecation is out of the
filter's module list.)*

**Correction:** `session.serviceWorkers.fromVersionID(versionId)` → `getInfoFromVersionID(versionId)`
deprecation, `applies: no` — `grep -rn "serviceWorkers" src/` → no matches.

---

## Electron 36.0

### `app` — `app.commandLine` now lowercases switches/arguments
`applies: no` — PConAir never touches `app.commandLine` (`grep -rn "commandLine" src/` → no
matches).

### `nativeImage` — `NativeImage.getBitmap()` deprecated in favor of `toBitmap()`
`applies: no` — PConAir's only `nativeImage` call is `nativeImage.createFromDataURL(...)` in
`src/main/tray.ts:22`; `getBitmap`/`toBitmap` are never called
(`grep -rn "toBitmap\|getBitmap" src/` → no matches).

### `session` — `clearStorageData({ quota: { type: 'syncable' } })` removed
`applies: no` — `session.clearStorageData` is never called in PConAir
(`grep -rn "clearStorageData" src/` → no matches).

### `session` — `ProtocolResponse.session = null` deprecated (removed in 37.0, see below)
`applies: no` — PConAir uses no custom `protocol.*` handlers (confirmed by the migration plan's
Audit Findings) and never constructs a `ProtocolResponse`.

### `session` — `clearStorageData({ quota: ... })` property itself deprecated
`applies: no` — same as above, `clearStorageData` unused.

### `session` — extension methods/events (`loadExtension`, `removeExtension`, `getExtension`,
`getAllExtensions`, `extension-loaded`/`extension-unloaded`/`extension-ready`) moved to
`session.extensions`
`applies: no` — PConAir loads no Chrome extensions (`grep -rn "loadExtension\|extensions\." src/`
→ no matches).

*(Filtered out from 36.0: `PrinterInfo.isDefault`/`.status` removal — printing is not in the
filtered module list and PConAir does no printing; `systemPreferences.isAeroGlassEnabled()`
removal — `systemPreferences` not in the filtered module list; GTK4-default-on-GNOME — a Linux
desktop-environment default, not an app-level API.)*

---

## Electron 37.0

### `session` — `ProtocolResponse.session = null` fully removed
`applies: no` — see 36.0 entry; `protocol.*`/`ProtocolResponse` confirmed unused.

### `BrowserWindow` — `isVisibleOnAllWorkspaces()` now returns `false` on Linux when the window
isn't currently visible
`applies: no` — `grep -rn "VisibleOnAllWorkspaces" src/` → no matches; PConAir doesn't use this
API on any platform.

*(Filtered out from 37.0: both `utilityProcess` unhandled-rejection/`process.exit()` behavior
changes — `utilityProcess` is confirmed unused per the Audit Findings; WebUSB/WebSerial blocklist
support — neither API is in the filtered module list and both are confirmed unused.)*

---

## Electron 38.0

### `webContents` — `plugin-crashed` event removed
`applies: no` — `grep -rn "plugin-crashed" src/` → no matches.

*(Filtered out from 38.0: `ELECTRON_OZONE_PLATFORM_HINT`/`ORIGINAL_XDG_CURRENT_DESKTOP` env var
removals and macOS 11 support drop — platform-level, not app-surface API;
`webFrame.routingId`/`webFrame.findFrameByRoutingId` deprecations — `webFrame` is a distinct
renderer-side module not in the filtered list, and in any case PConAir's preloads don't use it.)*

---

## Electron 39.0

### `webContents` — `window.open()` popups are now always resizable per the WHATWG spec; restore
old behavior via `webContents.setWindowOpenHandler`
`applies: no` — PConAir never calls `setWindowOpenHandler`
(`grep -rn "setWindowOpenHandler" src/` → no matches) and no renderer code under `src/` calls
`window.open(...)` either.

### `webContents` — offscreen-rendering shared-texture `paint` event payload restructured
(`sharedTextureHandle`/`planes`/`modifier` moved under a unified `handle` property)
`applies: no` — PConAir's one offscreen `BrowserWindow` (`src/main/l3/cue-renderer.ts:150`) does
not use the shared-texture mode or listen for the `paint` event at all; it captures frames via
`win.webContents.capturePage()` (`src/main/l3/cue-renderer.ts:232`), a different, unaffected API.

*(Filtered out from 39.0: `--host-rules` deprecation — a Chromium command-line switch, not an
Electron module call, and `app.commandLine` is confirmed unused anyway;
`NSAudioCaptureUsageDescription` for `desktopCapturer` — `desktopCapturer` confirmed unused per
Audit Findings.)*

---

## Electron 40.0

No changes in this release touch the filtered module surface. *(Filtered out: `clipboard` API
renderer-process-access deprecation — `clipboard` module confirmed unused/not in the filtered
list; macOS dSYM `tar.xz` compression — a build/tooling artifact format change, not an app API.)*

---

## Electron 41.0

### `webContents` — PDFs render inline instead of creating a separate guest `WebContents`
`applies: no` — PConAir never loads or embeds PDFs in any `BrowserWindow`/`webContents` (no
`<webview>`, no PDF viewer plugin, no PDF-related code anywhere under `src/main` or `src/renderer`).

### `session` — cookie `'changed'` event's `cause` field gains two new values
(`inserted-no-change-overwrite`, `inserted-no-value-change-overwrite`) for re-sets of an
identical or attribute-only-changed cookie
`applies: no` — PConAir calls `session...cookies.get()`/`cookies.set()` directly
(`src/main/index.ts:371`, `src/main/prompter/doc-transport.ts:21`,
`src/main/slides/window-manager.ts:325`) but never subscribes to the `cookies` `'changed'` event
(`grep -rn "cookies\.on\|'changed'" src/` → no matches), so the new `cause` values have nothing to
break.

### `dialog` — `showHiddenFiles` on Linux deprecated (removed in 43.0, see below)
`applies: no` — `grep -rn "showHiddenFiles" src/` → no matches; PConAir never sets this dialog
option.

---

## Electron 42.0

### `BrowserWindow` — offscreen-rendering default device-scale-factor changes from the primary
display's scale factor to a constant `1.0`
`applies: yes — src/main/l3/cue-renderer.ts:150`. This is PConAir's one offscreen `BrowserWindow`
(`webPreferences: { offscreen: true }`, used by `acquireCaptureWindow()` to render lower-third
cards to PNG for OBS/vMix). It does not set the new `webPreferences.offscreen.deviceScaleFactor`
option, so it is exactly the case this change targets. A pre-existing comment at
`src/main/l3/cue-renderer.ts:241` ("`capturePage()` returns physical pixels, so a 2x display
yields 3840x2160") documents current behavior that will stop being true once this default flips —
on Electron 42+, `capturePage()` on this OSR window will return `1920x1080` (1x) directly instead
of `3840x2160` on a 2x host display. **This is functionally self-mitigated**: the code already
checks the captured size against `EXPORT_WIDTH`/`EXPORT_HEIGHT` and resizes if they don't match
(`src/main/l3/cue-renderer.ts:245-246`), so the exported PNG dimensions stay correct either way.
The only real fallout is the now-stale comment at line 241 and one fewer up-scale/down-scale step
in the pipeline. Recommend: update the comment during Task 16 triage; no functional fix required,
but worth a characterization test asserting the final PNG is exactly `EXPORT_WIDTH × EXPORT_HEIGHT`
regardless of host display scale, if one doesn't already exist.

### `session` — `clearStorageData({ quotas: {...} })` (the whole `quotas` object, distinct from
the singular `quota` removed in 36.0) removed
`applies: no` — `clearStorageData` is unused, as noted under 36.0.

### `nativeImage` — passing a bare array as the second argument to `createFromNamedImage(name, hslShift)`
is deprecated; pass `{ hslShift }` instead
`applies: no` — PConAir never calls `nativeImage.createFromNamedImage` at all; its only
`nativeImage` use is `createFromDataURL` (`src/main/tray.ts:22`).

*(Filtered out from 42.0: macOS notifications switching to `UNNotification` — the `Notification`
API is not in the filtered module list, and this migration plan is out of scope for code-signing
changes anyway; `electron` npm package no longer self-downloading via `postinstall` — an
install-time/build-tooling change, not a runtime API.)*

---

## Electron 43.0

### `BrowserWindow` — frameless windows default to rounded corners on Linux (`roundedCorners`
option now honored there, defaults `true` everywhere)
`applies: no` — no `BrowserWindow` in PConAir sets `roundedCorners`
(`grep -rn "roundedCorners" src/` → no matches), and none of PConAir's frameless windows are
Linux-targeted in a way that a cosmetic corner-rounding change would be noticed (no CI Linux
release job either, as noted under 35.0).

### `BrowserWindow` — Window Controls Overlay now follows the native Linux title-bar layout
`applies: no` — PConAir never sets `titleBarOverlay`
(`grep -rn "titleBarOverlay" src/` → no matches).

### `nativeImage` — `toBitmap()`/`getBitmap()` now normalize pixel data to sRGB by default
(previously returned raw, un-color-converted pixels)
`applies: no` — neither method is called anywhere in PConAir (see 36.0/42.0 `nativeImage` entries).

### `dialog` — `showOpenDialog`/`showOpenDialogSync`/`showSaveDialog`/`showSaveDialogSync` now
default `defaultPath` to the Downloads folder (instead of letting the OS remember/restore the
last-used directory) when the caller doesn't pass one
`applies: yes — src/main/index.ts:391, src/main/index.ts:408`. Both are `dialog.showOpenDialog`
calls (`branding:choose-logo` and `branding:choose-css` IPC handlers) that pass no `defaultPath`.
Today, on macOS, the OS dialog remembers and restores whatever folder the operator last browsed
to for either picker. After the Electron 43 bump, both will instead reopen at the Downloads
folder every time, discarding that memory. `src/main/index.ts:425` (`showSaveDialog`, the CSS
template download) is unaffected — it already passes an explicit `defaultPath`. This is a minor
UX regression, not a crash or functional break; worth a one-line mention in the release notes or
the Task 17 smoke checklist ("branding logo/CSS file pickers now default to Downloads"), and
optionally fixed by tracking and passing the last-used directory per the pattern the upstream doc
gives, but not required for the migration to be safe.

### `dialog` — `showHiddenFiles` option removed on Linux
`applies: no` — see 41.0 entry; unused.

*(Filtered out from 43.0: `chrome.scripting.insertCSS/removeCSS` fallback-frame matching change
— extensions API, and PConAir loads no extensions per the 36.0 finding above.)*

---

## Electron 44.0

### `app` — `select-client-certificate` event's `webContents` argument may now be `null` (for
`net`-module and utility-process-originated requests)
`applies: no` — PConAir has no `app.on('select-client-certificate', ...)` handler
(`grep -rn "select-client-certificate" src/` → no matches).

### `app` — `app.isUnityRunning()` removed
`applies: no` — `grep -rn "isUnityRunning" src/` → no matches.

### `net` — `net.request`/`net.fetch` now reject frame-type destinations
(`Sec-Fetch-Dest: document/frame/iframe/fencedframe`) unless `Sec-Fetch-Mode: navigate` is also set
`applies: no` — PConAir deliberately avoids the top-level `net.fetch`/`net.request` API in favor
of `session.fromPartition(...).fetch(...)`, per the explicit comment at
`src/main/prompter/doc-transport.ts:44-46` ("Issued from the Slides sign-in's own session object
… rather than the top-level `net.fetch`"). `grep -rn "\bnet\." src/` finds no calls into the `net`
module at all — only comments referencing it by name.

### `app` — Pre-macOS-13 login-item attributes removed: `openAsHidden` option dropped from
`app.setLoginItemSettings()`; `openAsHidden`/`wasOpenedAsHidden`/`restoreState` dropped from
`app.getLoginItemSettings()`'s return value
`applies: yes — src/main/index.ts:69`. `applyLaunchAtLogin()` calls
`app.setLoginItemSettings({ openAtLogin: enabled, openAsHidden: false })`. The `openAsHidden` key
is exactly the removed option. On Electron 44 this either becomes a silent no-op (the key is
simply not read) or a TypeScript compile error once `@electron-forge`'s bundled `@types/electron`
updates for v44, depending on how strictly the type gets narrowed — either way this line needs a
one-line fix (drop the `openAsHidden: false` key) as part of Task 16 triage. Low risk: the
intended behavior (`openAsHidden: false`, i.e. "don't start hidden") was already the option's
default, so dropping the key changes nothing functionally — this is a type/lint-level fix, not a
behavior fix.

*(Filtered out from 44.0: macOS 12 support drop, ANGLE static-linking, Windows/Linux 32-bit
binary discontinuation — platform/build-toolchain, not app-surface API; `clipboard` module
removed from the renderer and the whole clipboard W3C rearchitecture — `clipboard` is not in the
filtered module list and PConAir doesn't use it.)*

---

## Summary for Task 15 (Triage)

| Electron major | Applicable change | File:line | Fix needed |
|---|---|---|---|
| 42.0 | Offscreen default scale factor → 1.0 | `src/main/l3/cue-renderer.ts:150` (and stale comment at `:241`) | Comment update only; existing resize guard (`:245-246`) already makes output correct |
| 43.0 | `dialog.show*Dialog` defaults to Downloads | `src/main/index.ts:391`, `src/main/index.ts:408` | None required; optional UX fix to preserve last-used-directory memory |
| 44.0 | `app.setLoginItemSettings` drops `openAsHidden` | `src/main/index.ts:69` | Drop the `openAsHidden: false` key |

None of the three `applies: yes` findings are blocking or high-risk — all are either
self-mitigated already, cosmetic, or a one-line dead-option removal. That is a real, checked
answer, not an assumption: a thorough pass across 34 surviving changes over 12 majors turned up
exactly these three, each with a concrete file:line and a verified (not guessed) fix.

## Open questions for whoever runs Task 15/16

- The two `dialog.showOpenDialog` calls above are worth a quick product decision: is losing the
  remembered last-used directory for the logo/CSS pickers acceptable, or should Task 16 add the
  explicit `defaultPath`-tracking workaround from the 43.0 entry? Either is a fine outcome; this
  doc doesn't decide it.
- This document was produced entirely from the `docs/breaking-changes.md` single-page digest.
  Electron also publishes narrower per-minor "Notable Changes" blog posts for each major (e.g.
  `electronjs.org/blog/electron-44-0`); those were not separately fetched because
  `www.electronjs.org` was blocked by this sandbox's egress proxy for direct `WebFetch` calls
  (only the GitHub-hosted raw markdown was reachable). The breaking-changes doc is Electron's
  authoritative single source for this category, so this gap is believed to be low-risk, but a
  human with unblocked access to `electronjs.org` could double check the blog posts for 42–44
  specifically before Task 14's actual bump, given those are the closest-to-target majors.
