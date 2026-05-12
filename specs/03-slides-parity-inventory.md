# PC On Air — Google Slides Controller Parity Inventory

## Overview

This document provides an **exhaustive inventory of all features** from the existing Google Slides Controller application, with each feature mapped to its PC On Air equivalent, generalization, or gap status.

**Purpose:** Ensure that PC On Air v1 retains 100% of Google Slides Controller functionality. This is the definitive parity checklist—developers use it to confirm nothing was accidentally dropped during the generalization and rebuild.

**How to use this document:**
1. Review the Feature Inventory Table below for each Slides Controller feature.
2. For each feature, check the **PC On Air Status** column.
3. If status is `⚠️ Gap`, that feature requires explicit implementation and testing before v1 is considered complete.
4. If status is `🔄 Deferred`, the feature is confirmed out-of-scope for v1 and will not count against parity.
5. Before v1 release, complete the **Parity Acceptance Criteria** section (testable checklist).

---

## Feature Inventory Table

| Feature Category | Feature Name | Description | PC On Air Status | Implementation Note |
|---|---|---|---|---|
| **Deck Management** | Load Presentation by URL | Load a Google Slides presentation by sharing URL or presentation ID | ✅ Retained | Direct mapping: users enter Slides URL/ID, PC On Air opens it |
| **Deck Management** | Load Presentation by Preset | Load one of three pre-configured deck URLs from a saved preset list | ✅ Retained | Presets stored in admin config; operator selects from dropdown |
| **Deck Management** | Switch Between Presentations | Switch active output from one loaded deck to another without losing position | ✅ Retained | Deck switcher in UI; each deck maintains independent slide position |
| **Deck Management** | Display Deck Title | Show the title of the currently-playing presentation | ✅ Retained | Fetched from Slides metadata; displayed in operator UI |
| **Deck Management** | Display Slide Count | Show total number of slides in current deck | ✅ Retained | Fetched from Slides metadata; displayed in operator UI |
| **Slide Navigation** | Next Slide | Advance to the next slide in the presentation | ✅ Retained | Deterministic advance by 1 slide; no race conditions |
| **Slide Navigation** | Previous Slide | Move back to the previous slide | ✅ Retained | Deterministic reverse by 1 slide; no race conditions |
| **Slide Navigation** | Go to Specific Slide Number | Jump directly to a slide by its 1-based index number | ✅ Retained | Input field + Go button; validates range [1, total_slides] |
| **Slide Navigation** | Display Current Slide Index | Show the 1-based slide number currently on screen | ✅ Retained | Updated in real-time; displayed in operator UI |
| **Slide Navigation** | Display Total Slide Count | Show the total number of slides in the current deck | ✅ Retained | Part of "X of Y" display; updated when deck changes |
| **A/B Dual-Instance System** | Primary (A) Instance | Independent slide window; can hold different deck or different position than B | ✅ Retained | Full dual-window architecture preserved in PC On Air |
| **A/B Dual-Instance System** | Backup (B) Instance | Independent slide window; can hold different deck or different position than A | ✅ Retained | Full dual-window architecture preserved in PC On Air |
| **A/B Dual-Instance System** | Switch Active Output | Switch which instance (A or B) is the active/on-air output | ✅ Retained | Toggle button in operator UI; immediate output switch |
| **A/B Dual-Instance System** | Each Instance Holds Independent Deck | Instance A can display Deck 1 while Instance B displays Deck 2 (or same deck at different positions) | ✅ Retained | Each instance has independent deck/position state; no shared state |
| **A/B Dual-Instance System** | Safe Swap Pattern | Switch to B (inactive) while A reloads/refreshes without viewer seeing reload artifact | ✅ Retained | Standard A/B workflow: reload A, switch to B, switch back |
| **Refresh / Reload Controls** | Reload Current Presentation | Reload the Slides iframe/webview without losing current slide position | ✅ Retained | Reload preserves slide position via URL anchor or API state |
| **Refresh / Reload Controls** | Reload Inactive Instance | Reload one instance (A or B) while the other remains on-air | ✅ Retained | Implemented as safe refresh pattern with dual-instance architecture |
| **Refresh / Reload Controls** | Force-Refresh Unresponsive Slides | Hard refresh the Slides webview when it becomes unresponsive | ✅ Retained | Full page reload; may briefly interrupt on-air output if reloading active instance |
| **Refresh / Reload Controls** | Reload via Safe Swap | Reload by switching to the other instance first, then back | ✅ Generalized | Works for Slides; also works for URL-based content (no keying artifacts) |
| **WAN Tunneling / Remote Access** | Internet-Accessible Web UI | The Web UI is accessible over the internet via tunneling solution (ngrok or equivalent) | ✅ Retained | Tunnel integration in PC On Air; configurable in admin panel |
| **WAN Tunneling / Remote Access** | Remote Operator Control | Operators can control slides from remote location over WAN | ✅ Retained | Full remote control via Web UI; all operator actions (next, prev, go-to, deck switch, reload) available |
| **WAN Tunneling / Remote Access** | Admin Tunnel Configuration | Admin can configure tunnel credentials, auth tokens, and settings in UI | ✅ Retained | Admin panel includes tunnel config section (tunnel provider, auth token, subdomain) |
| **Web UI — Operator View** | Slide Navigation Controls | Buttons/controls for Next, Prev, Go To Slide N in operator UI | ✅ Retained | Operator dashboard includes all navigation controls |
| **Web UI — Operator View** | Deck Loading | Interface to load a new deck by URL, ID, or preset | ✅ Retained | Deck load dropdown (presets) + URL input field in operator panel |
| **Web UI — Operator View** | A/B Switching | Button or indicator to switch active output between A and B | ✅ Retained | A/B toggle button in operator UI; shows which is currently active |
| **Web UI — Operator View** | Current Status Display | Real-time display of current slide number, total slides, deck title, active instance | ✅ Retained | Status display panel shows all key metrics in real-time |
| **Web UI — Operator View** | Responsive Layout | Web UI is responsive and usable on tablet/phone at FOH (front of house) | ✅ Retained | Mobile-first responsive design; works on phones, tablets, laptops |
| **Web UI — Admin View** | Configuration Interface | Admin panel for managing presets, tunnel settings, credentials | ✅ Retained | Admin dashboard with tabs: Presets, Tunnel, Auth, Backups |
| **Web UI — Admin View** | Preset Management | Add/edit/delete presentation presets (saved deck URLs) | ✅ Retained | Preset editor in admin panel; up to 3 presets configurable |
| **Web UI — Admin View** | Tunnel Credentials | Configure tunnel provider credentials and auth tokens | ✅ Retained | Tunnel config form with fields for provider, auth token, subdomain, etc. |
| **Web UI — Admin View** | Status Monitoring | View health/status of connections, instances, and tunnel | ✅ Retained | Admin dashboard shows connection status, tunnel status, instance health |
| **Bitfocus Companion Module** | Next Slide Action | Companion action: advance to next slide | ✅ Retained | Companion module supports `next` action; routes to Web API |
| **Bitfocus Companion Module** | Previous Slide Action | Companion action: go to previous slide | ✅ Retained | Companion module supports `prev` action; routes to Web API |
| **Bitfocus Companion Module** | Go to Slide N Action | Companion action: jump to specific slide by number | ✅ Retained | Companion module supports `goto` action with slide number parameter |
| **Bitfocus Companion Module** | Load Deck by Preset Action | Companion action: load one of the three saved deck presets | ✅ Retained | Companion module supports `load_preset` action with preset ID (1, 2, or 3) |
| **Bitfocus Companion Module** | Reload Slide Action | Companion action: reload current presentation | ✅ Retained | Companion module supports `reload` action |
| **Bitfocus Companion Module** | Current Slide Number Variable | Companion variable: current slide number (1-based) | ✅ Retained | Module exposes `current_slide` variable; updated in real-time |
| **Bitfocus Companion Module** | Total Slides Variable | Companion variable: total slide count for current deck | ✅ Retained | Module exposes `total_slides` variable; updated when deck changes |
| **Bitfocus Companion Module** | Deck Title Variable | Companion variable: title of currently-loaded deck | ✅ Retained | Module exposes `deck_title` variable; fetched from Slides metadata |
| **Bitfocus Companion Module** | Connection Status Variable | Companion variable: connection status (connected/disconnected) | ✅ Retained | Module exposes `connection_status` variable; updates when WebSocket connects/disconnects |
| **Bitfocus Companion Module** | Button Feedback — Connected State | Bitfocus button color changes when connected to PC On Air | ✅ Retained | Feedback rule in module: green on connected, red on disconnected |
| **Bitfocus Companion Module** | Button Feedback — Slide Position | Button state reflects current slide position (e.g., highlight current slide in page turner) | ⚠️ Gap | Feedback logic not yet defined; needs implementation in module |
| **Bitfocus Companion Module** | WebSocket Connection | Companion module communicates with PC On Air via WebSocket for real-time updates | ✅ Retained | Module establishes WebSocket connection to PC On Air; falls back to HTTP polling if unavailable |
| **Bitfocus Companion Module** | HTTP Polling Fallback | If WebSocket unavailable, Companion module polls PC On Air via HTTP | ✅ Retained | Polling endpoint: `GET /api/status`; polls every 2 seconds if WebSocket fails |
| **Bitfocus Companion Module** | Module Configuration | Bitfocus config interface to set host, port, PIN for PC On Air connection | ✅ Retained | Companion settings panel includes Host, Port, and PIN inputs |
| **Authentication** | PIN-Based Access Control — Operator | Operator routes protected by PIN code | ✅ Retained | Operator login screen requires PIN; stored securely in config |
| **Authentication** | PIN-Based Access Control — Admin | Admin routes protected by separate PIN code | ✅ Retained | Admin login screen requires separate PIN; different from operator PIN |
| **Authentication** | Session-Based Auth | User doesn't need to re-enter PIN constantly; session tokens persist | ✅ Retained | Session cookies stored in browser; valid for 8 hours by default (configurable) |
| **Authentication** | Logout Functionality | Users can explicitly log out; clears session token | ✅ Retained | Logout button in operator/admin UI; clears session and redirects to login |
| **Triggering Semantics** | Deterministic Cue Execution | Pressing "Next" always advances exactly one slide; no race conditions | ✅ Retained | All slide actions (next, prev, goto) are synchronous and deterministic |
| **Triggering Semantics** | No Dropped Inputs | Under normal operation, no user inputs are lost or skipped | ✅ Retained | Input queue in frontend; no inputs dropped even under high-frequency triggers |
| **Triggering Semantics** | Acceptable Latency | Slide change must be visible on HDMI output within 500ms of trigger — this is a hard requirement, not a soft target | ⚠️ Gap | Latency not yet benchmarked; needs testing and documentation |
| **Background / Keying** | Luma Key Background | Solid color background for downstream keying in video switcher | ✅ Retained | All Slides presentations rendered with configurable luma key background color |
| **Background / Keying** | Background Color Presets | Multiple preset background colors (e.g., green, blue, black) for quick switching | ✅ Retained | Admin can configure luma key background color; stored in config |
| **Background / Keying** | Custom Background Color | Admin can set custom RGB background color for luma key | ✅ Generalized | Can be set via config file or admin UI color picker |

---

## Generalized Features

These features exist in PC On Air and are **expanded or generalized** beyond the original Slides Controller:

### 1. **Refresh / Reload Controls (URL-Based Content)**
- **Original:** Reload controls were specific to Google Slides presentations.
- **Generalization in PC On Air:** Reload/refresh now applies to:
  - Google Slides presentations (retained)
  - URL-based content (new: any HTTP/HTTPS URL can be displayed and reloaded)
  - Custom HTML/web content (new: embedded HTML can be displayed and refreshed)
- **Impact on Parity:** Fully backward-compatible. Slides users will see identical behavior; URL users gain new capability.

### 2. **Safe Swap Pattern (Generalized to All Content Types)**
- **Original:** Safe swap was designed for Slides, allowing reload of one instance while the other stays on-air.
- **Generalization in PC On Air:** Safe swap now works for:
  - Google Slides (retained)
  - URL-based content (new: reload URLs without keying artifacts)
  - Custom HTML (new: refresh custom content without on-air disruption)
- **Impact on Parity:** Fully backward-compatible. Slides functionality unchanged; additional content types gain the same workflow.

### 3. **Background / Keying (Expanded to All Content Types)**
- **Original:** Luma key background was specific to Slides.
- **Generalization in PC On Air:** Luma key background now applies to:
  - Google Slides (retained)
  - URL-based content (new: displayed within a keyed frame)
  - Custom HTML (new: keyed frame for downstream keying)
- **Impact on Parity:** Fully backward-compatible. Slides behavior unchanged.

### 4. **Admin Configuration (Expanded)**
- **Original:** Presets, tunnel, credentials only.
- **Generalization in PC On Air:** Admin panel also manages:
  - Backup/export settings
  - Content-type-specific configurations (URL templates, HTML editor)
  - Advanced logging and diagnostics
  - Update notifications
- **Impact on Parity:** Fully backward-compatible. Original admin features all retained; new features are additive.

---

## Gaps and Risks

### ⚠️ Gap 1: Bitfocus Companion Button Feedback — Slide Position
**Description:** The Bitfocus Companion module in the original Slides Controller may support button feedback based on current slide position (e.g., highlighting the "page 3" button when on slide 3, or dimming a "next" button on the last slide).

**Status:** Not yet verified in PC On Air implementation.

**Risk:** If the original module supports this, PC On Air may be missing button state feedback logic.

**Remediation:**
- [ ] Review original Bitfocus Companion module source code to confirm if slide position feedback is supported.
- [ ] If supported, implement feedback rules in PC On Air Companion module.
- [ ] Test feedback logic end-to-end with Bitfocus Companion.

**Acceptance:** Companion module feedback matches original behavior, or feature is explicitly documented as not supported in original.

---

### ⚠️ Gap 2: Latency Benchmarking and Documentation
**Description:** The original Slides Controller is noted as having "acceptable latency" (< 500ms expected) between a user input (e.g., "next slide" button press) and the slide change being visible on HDMI output.

**Status:** Not yet benchmarked in PC On Air.

**Risk:** PC On Air may have higher latency due to architectural differences (e.g., Electron app → Web UI → API → Slides render). This could impact live broadcast quality.

**Remediation:**
- [ ] Benchmark end-to-end latency: button press → slide visible on HDMI output.
- [ ] Document acceptable latency thresholds for PC On Air.
- [ ] If latency exceeds threshold, investigate optimization opportunities (WebSocket vs polling, rendering performance, API response time).
- [ ] Test latency under various network conditions (LAN, WAN over tunnel).

**Acceptance:** Latency benchmarked and documented; meets or exceeds original Slides Controller performance.

---

### ⚠️ Gap 3: Bitfocus Companion Module — Full Feature Parity
**Description:** The Bitfocus Companion module in PC On Air may not expose all actions, variables, and feedback rules of the original Slides Controller module.

**Status:** Not yet verified against original module.

**Risk:** Operators may lose Companion integration features, breaking existing control setups.

**Remediation:**
- [ ] The original Companion module source is available at: https://github.com/TomsFaire/PConAir.git — review the existing module before implementation to ensure action/variable/feedback parity.
- [ ] Obtain source code or documentation of original Bitfocus Companion module for Google Slides Controller.
- [ ] Cross-reference against PC On Air Companion module implementation.
- [ ] For each action/variable/feedback rule in the original, confirm PC On Air module implements it or explicitly document the gap.
- [ ] Test module integration with live Bitfocus installation.

**Acceptance:** Companion module passes full feature parity test (see Parity Acceptance Criteria below).

---

### ⚠️ Gap 4: HTML/CSS/JavaScript Rendering of Slides
**Description:** The original Slides Controller uses Google Slides' web rendering. PC On Air may use a different rendering engine or browser context, which could affect:
- Font rendering and text layout
- Image scaling and aspect ratio
- Animation playback (if Slides has slide transitions or animations)
- Color accuracy and gamma

**Status:** Not yet verified.

**Risk:** Slides may render differently in PC On Air than in the original Slides Controller, or differently than the actual Google Slides app.

**Remediation:**
- [ ] Create a test deck with various fonts, images, and layouts.
- [ ] Compare rendering between original Slides Controller, PC On Air, and Google Slides directly.
- [ ] Document any rendering differences and their visual impact.
- [ ] If differences are significant, investigate root cause and potential fixes (browser engine, CSS override, font loading).

**Acceptance:** Rendering matches or is visually equivalent to original Slides Controller.

---

### ⚠️ Gap 5: Bitfocus Companion Connection Reliability
**Description:** The original Slides Controller supports both WebSocket and HTTP polling for Companion connectivity. Under poor network conditions, the connection may be unreliable or drop frequently.

**Status:** Not yet tested under adverse network conditions.

**Risk:** In WAN environments (FOH control over internet), connection drops could cause lost commands or stale status.

**Remediation:**
- [ ] Test Companion connectivity under simulated poor network conditions (packet loss, latency, jitter).
- [ ] Verify WebSocket reconnection logic; confirm fallback to HTTP polling works correctly.
- [ ] Test that commands are not lost during brief connection interruptions.
- [ ] Document expected behavior and recovery time.

**Acceptance:** Connection remains stable under normal and degraded network conditions; reconnection completes within 3 seconds.

---

### 🔄 Deferred Feature: Slide Animations and Transitions
**Description:** Google Slides supports slide animations and transitions (e.g., dissolve, wipe, fade). The original Slides Controller may or may not trigger these animations.

**Status:** Deferred to post-v1.

**Rationale:** For live event production, slides are typically static (no animations). Animations are rarely used in broadcast contexts. If needed, animations can be added post-v1 via a toggle in the admin panel.

**Acceptance Criteria for Deferral:** Documented in release notes as out-of-scope for v1.

---

### 🔄 Deferred Feature: Presenter Notes
**Description:** Google Slides presentations contain presenter notes (speaker notes) visible only to the presenter. The original Slides Controller may or may not expose these.

**Status:** Deferred to post-v1.

**Rationale:** Presenter notes are for the presenter, not for the on-air output. PC On Air is designed to control the on-air output, not provide presenter tools. If notes are needed for operator reference, they can be added post-v1 via an optional operator panel view.

**Acceptance Criteria for Deferral:** Documented in release notes as out-of-scope for v1.

---

### 🔄 Deferred Feature: Speaker Notes Display for Operators
**Description:** A view showing the next slide preview or presenter notes in the operator UI to help the operator prepare for the next cue.

**Status:** Deferred to post-v1.

**Rationale:** Not in scope for initial launch. Can be added post-v1 if feedback indicates need.

**Acceptance Criteria for Deferral:** Documented in release notes as out-of-scope for v1.

---

### 🔄 Deferred Feature: Slide Thumbnail Navigation
**Description:** A visual thumbnail strip showing all slides in the deck, allowing the operator to click a thumbnail to jump to that slide.

**Status:** Deferred to post-v1.

**Rationale:** Numeric "Go to Slide N" input is sufficient for v1. Thumbnails are a UX enhancement that can be added post-v1.

**Acceptance Criteria for Deferral:** Documented in release notes; "Go to Slide N" input is the primary method for direct navigation in v1.

---

## Parity Acceptance Criteria

Before PC On Air v1 is considered complete, the following testable checklist must be satisfied:

### Deck Management ✅ / ⚠️ / ❌

- [ ] **Test 1.1:** Load a Google Slides presentation by URL; verify it renders correctly.
- [ ] **Test 1.2:** Load a Google Slides presentation by ID; verify it renders correctly.
- [ ] **Test 1.3:** Add three presets in admin panel; verify each preset loads the correct deck.
- [ ] **Test 1.4:** Switch between two loaded decks; verify active output switches without losing position.
- [ ] **Test 1.5:** Verify deck title is displayed in operator UI.
- [ ] **Test 1.6:** Verify total slide count is displayed in operator UI.

### Slide Navigation ✅ / ⚠️ / ❌

- [ ] **Test 2.1:** Press "Next Slide" button; verify advance by exactly 1 slide.
- [ ] **Test 2.2:** Press "Previous Slide" button; verify move back by exactly 1 slide.
- [ ] **Test 2.3:** Use "Go to Slide N" input to jump to slide 5 in a 10-slide deck; verify correct slide displays.
- [ ] **Test 2.4:** Verify current slide index (1-based) is displayed in operator UI.
- [ ] **Test 2.5:** Verify total slide count is displayed in operator UI and updates when deck changes.
- [ ] **Test 2.6:** Press "Next" on the last slide; verify no error and no unintended behavior.
- [ ] **Test 2.7:** Press "Previous" on the first slide; verify no error and no unintended behavior.

### A/B Dual-Instance System ✅ / ⚠️ / ❌

- [ ] **Test 3.1:** Load Deck 1 in instance A; verify it displays in A.
- [ ] **Test 3.2:** Load Deck 2 in instance B; verify it displays in B independently.
- [ ] **Test 3.3:** Advance to slide 5 in instance A; navigate to slide 2 in instance B; verify each instance maintains independent position.
- [ ] **Test 3.4:** Switch active output from A to B; verify B becomes the on-air output.
- [ ] **Test 3.5:** Switch active output from B back to A; verify A becomes the on-air output.
- [ ] **Test 3.6:** With A active, reload A; switch to B before reload completes; verify no reload artifact visible during B output.

### Refresh / Reload Controls ✅ / ⚠️ / ❌

- [ ] **Test 4.1:** Load a deck, navigate to slide 5; press "Reload"; verify slide 5 reloads and position is preserved.
- [ ] **Test 4.2:** With A active at slide 5, switch to B and reload B; verify A remains at slide 5.
- [ ] **Test 4.3:** Perform a "safe swap" reload: reload A, switch to B, verify B is on-air during A reload, then switch back to A; verify no on-air disruption.

### WAN Tunneling / Remote Access ✅ / ⚠️ / ❌

- [ ] **Test 5.1:** Configure tunnel in admin panel (provider, auth token); verify tunnel initializes.
- [ ] **Test 5.2:** From remote location over WAN, access the tunneled Web UI; verify login works.
- [ ] **Test 5.3:** From remote location, press "Next Slide" via remote operator UI; verify slide advances on local HDMI output.
- [ ] **Test 5.4:** From remote location, switch A/B output; verify output switches on local display.
- [ ] **Test 5.5:** From remote location, reload the presentation; verify reload completes without disruption.

### Web UI — Operator View ✅ / ⚠️ / ❌

- [ ] **Test 6.1:** Operator UI displays "Next", "Previous", and "Go to Slide" controls; verify controls are clickable.
- [ ] **Test 6.2:** Operator UI displays preset deck selector; verify presets load when selected.
- [ ] **Test 6.3:** Operator UI displays A/B toggle; verify active output is indicated.
- [ ] **Test 6.4:** Operator UI displays current slide number and total count in real-time; verify updates immediately after navigation.
- [ ] **Test 6.5:** Operator UI displays deck title; verify title matches loaded deck.
- [ ] **Test 6.6:** Operator UI is responsive; access from mobile phone and tablet; verify layout adapts and controls are functional.

### Web UI — Admin View ✅ / ⚠️ / ❌

- [ ] **Test 7.1:** Admin UI accessible only after entering admin PIN.
- [ ] **Test 7.2:** Admin can add/edit/delete presets; verify changes are saved and persisted across restarts.
- [ ] **Test 7.3:** Admin can configure tunnel provider, auth token, subdomain; verify settings are saved.
- [ ] **Test 7.4:** Admin UI displays connection status and instance health; verify status updates in real-time.

### Authentication ✅ / ⚠️ / ❌

- [ ] **Test 8.1:** Operator routes require operator PIN; verify unauthenticated access is denied.
- [ ] **Test 8.2:** Admin routes require admin PIN; verify unauthenticated access is denied.
- [ ] **Test 8.3:** Admin and Operator PINs are different; verify mixing them fails.
- [ ] **Test 8.4:** After entering PIN, session is established; verify user doesn't need to re-enter PIN for 8 hours (or configured duration).
- [ ] **Test 8.5:** User logs out; verify session is cleared and re-login is required.

### Bitfocus Companion Module ✅ / ⚠️ / ❌

- [ ] **Test 9.1:** Configure Bitfocus Companion module with PC On Air host, port, PIN.
- [ ] **Test 9.2:** Module successfully connects to PC On Air via WebSocket; verify "connected" feedback.
- [ ] **Test 9.3:** Module disconnects or connection fails; verify fallback to HTTP polling.
- [ ] **Test 9.4:** Module supports "Next Slide" action; press in Companion; verify slide advances in PC On Air.
- [ ] **Test 9.5:** Module supports "Previous Slide" action; press in Companion; verify slide moves back in PC On Air.
- [ ] **Test 9.6:** Module supports "Go to Slide N" action; press in Companion; verify correct slide displays.
- [ ] **Test 9.7:** Module supports "Load Preset" action; press in Companion; verify correct deck loads.
- [ ] **Test 9.8:** Module supports "Reload" action; press in Companion; verify presentation reloads.
- [ ] **Test 9.9:** Module exposes "Current Slide" variable; verify it reflects current slide number in real-time.
- [ ] **Test 9.10:** Module exposes "Total Slides" variable; verify it reflects total slide count.
- [ ] **Test 9.11:** Module exposes "Deck Title" variable; verify it reflects loaded deck title.
- [ ] **Test 9.12:** Module exposes "Connection Status" variable; verify it reflects connected/disconnected state.
- [ ] **Test 9.13:** Module button feedback: verify button turns green when connected, red when disconnected.
- [ ] **Test 9.14 (Gap):** Module button feedback for slide position; verify button state reflects current slide position if supported in original (or document as not supported).

### Triggering Semantics ✅ / ⚠️ / ❌

- [ ] **Test 10.1:** Rapidly press "Next" button 10 times; verify all 10 advances occur (no dropped inputs).
- [ ] **Test 10.2:** Measure latency from "Next" button press to slide visible on HDMI output; document result (target: < 500ms).
- [ ] **Test 10.3:** Concurrent inputs from operator UI and Companion; verify no race conditions or dropped inputs.

### Background / Keying ✅ / ⚠️ / ❌

- [ ] **Test 11.1:** Admin sets luma key background to green; verify all Slides presentations render with green background.
- [ ] **Test 11.2:** Change luma key background color to blue; verify change is applied immediately to on-air output.
- [ ] **Test 11.3:** Use green background in a video switcher; verify chroma key is effective (background is keyed out cleanly).

### Rendering Fidelity ✅ / ⚠️ / ❌

- [ ] **Test 12.1 (Gap):** Create a test Slides deck with various fonts, images, and layouts; compare rendering between original Slides Controller, PC On Air, and Google Slides directly; document any visual differences.
- [ ] **Test 12.2 (Gap):** Test text-heavy slide; verify text is readable and not corrupted.
- [ ] **Test 12.3 (Gap):** Test slide with embedded images; verify images render at correct size and aspect ratio.

---

## Sign-Off

_This document should be reviewed and approved before the v1 implementation begins._

---

## Appendix: Original Slides Controller Feature Reference

This section serves as a historical reference. If this document is out-of-date with respect to the original Google Slides Controller, please file an issue to update this inventory.

### Known Source Material

- Product requirements: Google Slides Controller is an Electron app for live event production.
- Key capabilities: deck loading (URL, preset), slide navigation, A/B dual-instance system, safe swap pattern, refresh controls, WAN tunneling, Web UI, Bitfocus Companion module, PIN-based auth, deterministic cue execution, luma key background.

### How to Verify Completeness

If the original Slides Controller is still in use or archived:

1. Review the original source code repository (Electron app).
2. List all user-facing features (UI buttons, actions, configuration options).
3. Cross-reference against this inventory.
4. File issues for any missing features.

If the original controller is no longer available:

1. Interview operators and admins who used it.
2. Request feature list from the original development team.
3. Review any internal documentation or wiki.
4. Update this inventory with any missing features.

---
