# PC On Air v1 — Reliability & Runbook Specification

## Overview

This document specifies the reliability features, guardrails, and recovery procedures for PC On Air v1. PC On Air runs during live events where failures are highly visible and costly. This spec defines:

1. **How the app prevents common operator mistakes** (guardrails)
2. **How operators recover when things go wrong** (failure runbook)
3. **Pre-show preparation procedures** (checklists)
4. **Operational patterns** (arm/take, panic, safe reload)

The philosophy is **graceful degradation with rapid recovery**: the app provides automated guardrails where possible, gives operators immediate fallback options, and can recover from most failures in under 30 seconds.

---

## 1. Run Modes

PC On Air operates in two conceptual run states:

### 1.1 Rehearsal Mode

- **Purpose**: Freedom to test, configure, and experiment
- **Configuration state**: Fully editable
  - Operators can create, modify, and delete URL presets, lower thirds, backgrounds
  - Profile changes are instant
  - Bundle import/export is permitted
- **Admin routes**: Accessible without confirmation
  - `/admin` is available to anyone with admin PIN
  - Destructive actions (delete lower third, clear all stills) execute immediately
- **Typical timeline**: From load through 30 minutes before audience arrival
- **Operator UI**: Standard view; no "locked" badge

### 1.2 Show Mode

- **Purpose**: Prevent accidental changes during live playout
- **Activation**: Operator or admin enables "Show Lock" via `/admin` interface
  - Show Lock activation requires **Arm/Take**: arm (confirm "You are about to lock admin") → take (confirm)
  - Once active, all admin routes are blocked (403 Forbidden) without going through the unlock flow
  - Unlock requires the admin PIN via the in-page PIN entry form (not a full login)
  - `/operator` remains fully functional
- **Configuration state**: Immutable during show
  - All presets (URLs, lower thirds, backgrounds) are read-only in UI
  - Profile switching is blocked
  - Bundle import is blocked
- **Admin routes**: Inaccessible (403 Forbidden)
  - Attempting to access `/admin` during show mode shows: "Admin locked for show. Enter admin PIN to unlock."
  - **Standard unlock**: Enter the admin PIN on the `/admin` page (calls `POST /auth/unlock-admin`). This is the normal unlock path during show.
  - **Emergency unlock** (if admin PIN is forgotten): Physically approach the machine and restart the app (Show Lock clears on restart) or use the `--reset-admin-pin` CLI flag.
- **Typical timeline**: Audience arrives through end of show
- **Operator UI**: Prominent red badge: "SHOW LOCKED" with unlock instructions

### 1.3 Transition Between Modes

**Rehearsal → Show:**
1. In `/admin`, locate "Show Lock" button (clearly visible)
2. Click "Arm Show Lock" button
   - UI shows: "About to lock admin — confirm?"
3. Click "Take" (or confirm button)
   - Show Lock is now active
   - `/admin` is now blocked
   - Operator UI shows red "SHOW LOCKED" badge
4. If you need to undo: navigate to `/admin`, enter the admin PIN on the lock prompt, and confirm unlock (standard path). Emergency: restart app or use `--reset-admin-pin` CLI flag if PIN is forgotten.

**Show → Rehearsal:**
1. Navigate to `/admin` — the lock prompt appears with a PIN entry form.
2. Enter the admin PIN and confirm unlock.
   - Show Lock is cleared; `/admin` is accessible again.
3. **If admin PIN is forgotten** (emergency only):
   - Restart the app (Show Lock is in-memory and clears on restart), **or**
   - Use `--reset-admin-pin` CLI flag (requires physical terminal access) to set a new admin PIN.

---

## 2. Arm / Take Pattern

For disruptive actions (actions that change what's on Program output), PC On Air uses an "Arm / Take" workflow to prevent accidental triggers.

### 2.1 What Requires Arm/Take

**Actions that require Arm/Take:**
- Switching A/B instance (arm = verify off-air instance is ready; take = switch)
- Loading a new URL preset into active instance (arm = load in off-air; take = switch)
- Loading a new slide deck into active instance (arm = load deck in off-air; take = switch)
- Activating Show Lock (arm = confirm lock dialog; take = confirm again)
- Clearing all stills during show (Show Lock active) (arm = "Delete all stills?"; take = confirm)

**Actions that do NOT require Arm/Take:**
- Advancing/reversing within current slide deck
- Triggering a lower third (take is already armed — just take it)
- Switching L3 overlays
- Adjusting keying/background color
- Triggering Panic (designed to be instant, no confirmation)

### 2.2 UX Pattern

**Arm Step:**
- Operator initiates action (e.g., "Load URL preset 'Agenda'")
- UI shows action in "staging" or "preview" state
- For instance switching: off-air instance immediately begins loading in background
- Dialog or banner appears: "Action armed — [action name]. Click 'Take' when ready."
- **No change to on-air output yet**

**Verify Step:**
- Operator reviews off-air content is loading/ready
- For URL: visual indicator "Instance B — Ready" or "Loading..." appears
- For slide deck: first 2–3 slides load and operator can preview

**Take Step:**
- Operator clicks "Take" button (or equivalent keyboard shortcut)
- Action executes immediately
- Active and off-air instances swap roles
- Previous active instance becomes off-air and available for next prep

### 2.3 Implementation in Operator UI

The `/operator` route displays:
- **Active Instance** (left side): current on-air content + label "ON AIR"
- **Off-Air Instance** (right side): next queued content + label "OFF-AIR"
- **Arm buttons** (between instances): "Arm A→B" (switch to instance B) or "Arm B→A"
  - Clicking arm queues the switch and shows "Take" button prominently
- **Take button**: large, green, prominent
  - Only visible after an action is armed
  - Clicking executes the switch

---

## 3. Panic Button

### 3.1 Purpose & Behavior

The **Panic button** provides instant output safety when something on-air goes wrong (wrong content visible, error page, blank screen, etc.).

**What Panic does:**
- Instantly switches Program output to a safe "panic slate"
- Does NOT stop background processes (slides still advance off-air if in slide mode, URL still loads)
- Does NOT disconnect Companion or stop the app
- Panic state is **visually prominent** in operator UI (red border, banner: "PANIC — OUTPUT HIDDEN")
- Un-panic (toggle): another click of panic button or "Un-panic" button restores previous active content

**What Panic does NOT do:**
- Does not restart the app
- Does not clear errors or reload URLs
- Does not disconnect displays

### 3.2 Panic Slate Configuration

**Default panic slate:** Solid black background (RGB 0, 0, 0)

**Configurable via `/admin`:**
- Color (hex code, RGB, or preset: black, white, solid color)
- Logo or image overlay (optional — load from Still Store)
- Example alternatives:
  - Black with white "TECHNICAL DIFFICULTY" text
  - Venue logo on black background
  - Custom slate image

**Slate rendering:**
- Rendered as a simple DOM element (no network request, no JavaScript execution)
- If custom image is used: pre-loaded into app cache (not fetched from network at panic time)
- Fallback to solid black if custom image is missing

### 3.3 Panic Button Location & Accessibility

**In `/operator` Web UI:**
- **Top-right corner**, large red button labeled "PANIC" (or pause icon + "PANIC")
- Visible at all times
- Single click = panic
- Single click again = un-panic (toggles)

**Via Companion module:**
- A dedicated Companion button: "PANIC" (one-press action, toggles on/off)
- Alternative: A two-button pattern (button 1 = Panic On, button 2 = Panic Off)
- No confirmation required

**Keyboard shortcut (operator Web UI):**
- Default: `P` key (single press toggles)
- Configurable via `/admin` > Keyboard shortcuts

**Accessibility:**
- 1-click activation (no modal, no confirmation)
- Sub-100ms response time from button press to output switch
- Accessible even if Program output window is unresponsive

### 3.4 Panic State Indicators

When Panic is active, the operator UI shows:
- **Red banner at top**: "PANIC — OUTPUT HIDDEN" with prominent icon
- **Red border** around the off-air instances (visual alert)
- **"Un-panic" button** (same location as panic button, clearly labeled)
- **Current panic slate preview** (small thumbnail showing what's on-air)
- **How to exit**: "Click Un-panic or press P"

---

## 4. Safe Reload Procedure

### 4.1 Purpose

The "safe reload" technique allows operators to refresh a URL or slide deck content during a live show **without interrupting Program output**. This is the standard procedure for updating live content (e.g., refreshing a web-based slideshow or updating a web page feed) during playout.

### 4.2 Step-by-Step SOP

**Scenario:** Content on Program output is stale or has an error. You need to reload the URL or deck.

**Steps:**

1. **Identify the off-air instance**
   - Check operator UI: locate the instance NOT labeled "ON AIR"
   - Verify it is ready (green "Ready" indicator or similar)

2. **Arm reload on off-air instance**
   - If in URL mode: Click "Arm Reload" button on off-air instance
   - If in Slides mode: Click "Arm Reload Deck" on off-air instance
   - Off-air instance begins loading/refreshing immediately
   - UI shows "Reloading..." status

3. **Verify reload is complete**
   - Wait for off-air instance to finish loading (usually 2–5 seconds)
   - Look for "Instance [A/B] — Ready" indicator (green, no spinner)
   - For URL: inspect off-air content (confirm page loaded)
   - For Slides: advance 2–3 slides in off-air to verify deck loaded
   - If reload fails: see Failure Runbook section below

4. **Take: Switch off-air to on-air**
   - Click "Take" button (same button as regular instance switch)
   - Program output instantly switches to reloaded content
   - Previous on-air instance becomes off-air
   - Audience sees no interruption (instant switch, no blank frame)

5. **Resume show**
   - New active instance is fresh and ready
   - Off-air instance is now available for next reload prep

### 4.3 Safe Reload in Detail

**URL Mode Safe Reload:**
- Off-air instance fetches the URL again (full page load, not just refresh)
- Network request is made in background; user sees loading indicator in off-air pane
- Once response arrives and DOM is rendered, operator clicks "Take"
- New content goes on-air; old content remains off-air for fallback if needed

**Slides Mode Safe Reload:**
- Off-air instance re-fetches the Google Slides deck metadata and first N slides
- Operator can advance a few slides in off-air to verify data is current
- Once verified, click "Take" to switch on-air
- Previous on-air deck remains cached off-air (no loss if new deck fails)

**Time to completion:** 3–10 seconds (network dependent)

---

## 5. Health Page

### 5.1 Purpose

The `/admin/health` page is a diagnostic dashboard for operators and support staff to quickly assess application and infrastructure health during a show.

### 5.2 Access

- **Route**: `/admin/health` (admin-only, requires admin PIN)
- **Also available as JSON API**: `GET /api/health` (JSON response, admin-only)
- **Browser access**: Operator can view in browser tab at any time during show

### 5.3 Information Displayed

**Application Status:**
- App version (e.g., "1.0.0-beta.2")
- Build date (e.g., "2025-05-10T14:22:00Z")
- Current run mode ("Rehearsal" or "Show Locked")
- Uptime (time since app last started, e.g., "2h 34m 12s")

**Environment:**
- Node.js version (e.g., "18.16.0")
- Electron version (e.g., "25.3.1")
- OS (e.g., "macOS 14.4.1 arm64")

**Operator & System State:**
- Active profile name (e.g., "2025-05-11 Keynote")
- Current mode (e.g., "Slides", "URL", "L3 Only", "Idle")
- Connected clients count (e.g., "3 Web UI, 2 Companion")
- WebSocket connections: list of connected clients with timestamps

**Companion Integration:**
- Companion module: "Connected" or "Disconnected"
- Last heartbeat time (e.g., "5 seconds ago")
- Companion app version (if available)
- Connection method (e.g., "WebSocket @ 192.168.1.5:8000")

**Errors & Alerts:**
- Last error (if any): timestamp, error type, brief description
  - Example: "2025-05-11 14:03:22 UTC — Slide deck load timeout"
- Warnings: list of any active warnings
  - Example: "Memory usage at 78% (7.2 GB / 9.2 GB)"

**Infrastructure:**
- WAN tunnel: "Active" or "Inactive"
  - If active: tunnel URL (e.g., "https://tunnel.pconair.app/abc123")
  - Tunnel status: "Connected", "Reconnecting", or "Down"
  - Last heartbeat time
- Display list:
  - Each connected display: ID, name, assigned instance (A/B), current content URL, last update time
  - Example: "Display-1 (Main Screen) — Instance A — https://slides.google.com/... — updated 15s ago"

**Resource Usage:**
- Memory: Heap used / Heap total (both in MB)
  - Example: "4.2 GB / 6.0 GB (70%)"
- Heap usage trend: "Stable" or "Rising" (indicator of potential leak)
- CPU usage (if available from Electron): percentage or "N/A"

**Display & Render Health:**
- Display refresh rate (e.g., "60 Hz")
- Frame drop count (cumulative, since app start)
- Renderer process status: "OK" or "Warning"

### 5.4 UI Design

- **Layout**: Dashboard with sections (Application, System, Operator State, Errors, Infrastructure, Resources)
- **Color coding**: Green for healthy, yellow for warnings, red for errors
- **Auto-refresh**: Page auto-refreshes every 5 seconds (configurable)
- **Manual refresh**: "Refresh Now" button at top
- **Timestamps**: All times in UTC with timezone offset indicator

### 5.5 API Endpoint

**`GET /api/health`** (admin-only)

**Response:**
```json
{
  "app": {
    "version": "1.0.0-beta.2",
    "buildDate": "2025-05-10T14:22:00Z",
    "mode": "Show Locked",
    "uptime": 9252
  },
  "environment": {
    "node": "18.16.0",
    "electron": "25.3.1",
    "os": "macOS"
  },
  "operator": {
    "activeProfile": "2025-05-11 Keynote",
    "currentMode": "Slides",
    "connectedClients": 5
  },
  "companion": {
    "connected": true,
    "lastHeartbeat": "2025-05-11T14:15:32Z"
  },
  "errors": [
    {
      "timestamp": "2025-05-11T14:03:22Z",
      "type": "SlidedeckLoadTimeout",
      "description": "Slides deck failed to load within 10s"
    }
  ],
  "infrastructure": {
    "wanTunnel": {
      "status": "Active",
      "url": "https://tunnel.pconair.app/abc123",
      "lastHeartbeat": "2025-05-11T14:15:31Z"
    },
    "displays": [
      {
        "id": "display-1",
        "name": "Main Screen",
        "instance": "A",
        "url": "https://slides.google.com/...",
        "lastUpdate": "2025-05-11T14:15:20Z"
      }
    ]
  },
  "resources": {
    "memory": {
      "heapUsed": 4400,
      "heapTotal": 6144,
      "percentUsed": 72
    },
    "trend": "Stable"
  }
}
```

---

## 6. Guardrails

Guardrails are automated features that prevent common operator mistakes or alert operators when something is wrong.

### 6.1 No Accidental URL Navigation

**Goal:** Prevent the Program output window from being navigated away from the intended URL by accident (e.g., accidental keyboard shortcuts, browser back button, or swipe gestures).

**Implementation:**
- Program output window has no address bar, back/forward buttons, or tab bar
- Keyboard shortcuts that navigate (Cmd+[ / Cmd+], Alt+Left, browser back) are disabled
- Swipe gestures (if on touchscreen) do NOT trigger navigation
- Only URL changes are allowed via the `/api/program-url` endpoint (controlled, server-authorized)
- If operator or user accidentally triggers a navigation attempt, it is silently ignored (no error message)

**Triggers:** None (always active)

**What it shows:** Nothing (silently prevents navigation)

### 6.2 Unresponsive Page Watchdog

**Goal:** Detect when the Program output page becomes unresponsive and alert the operator.

**Implementation:**
- Main process sends a heartbeat ping to the Program output renderer process every 2 seconds
- Ping is a lightweight message: `{ type: "ping", timestamp }` (no DOM inspection, no heavy JS evaluation)
- Renderer responds immediately with `{ type: "pong", timestamp }`
- If main process does not receive a pong within 5 seconds of sending a ping, the page is considered unresponsive
- Error is logged: `[WARN] Program output unresponsive for 5s — renderer may be frozen`

**Triggers:**
- Renderer process is hung (infinite loop, blocking operation)
- JavaScript on the loaded page is blocking (rare for well-behaved web content)
- Browser is processing a very large DOM update
- WebGL or canvas rendering is blocking the event loop

**What it shows:**
- Alert banner in `/operator` UI: "⚠ Program Output Unresponsive"
- Button offered: "Force Reload" (reloads the current URL)
- If watchdog detects unresponsiveness for > 15 seconds, banner changes: "Program output not responding. Force reload strongly recommended."
- Operator can click "Force Reload" to restart the renderer

**Recovery:** See Failure Runbook, Scenario 1 (Slides/URL becomes unresponsive).

### 6.3 Memory Pressure Alert

**Goal:** Prevent out-of-memory crashes by warning the operator when heap usage is high.

**Implementation:**
- Every 10 seconds, main process checks Electron's heap usage: `process.memoryUsage()`
- If `heapUsed / heapTotal > 0.80` (80%), a warning is triggered
- Warning is logged: `[WARN] Memory pressure: heap at 85% (5.1 GB / 6.0 GB)`
- Only one warning per 60 seconds (do not spam)

**Triggers:**
- Memory leak in main process (rare)
- Memory leak in a renderer process (e.g., URL page accumulating DOM nodes)
- Very large slide deck loaded
- Companion module consuming excess memory (rare)

**What it shows:**
- Yellow banner in `/operator` UI: "⚠ Memory Usage High — 85% (5.1 GB / 6.0 GB)"
- Additional text: "Consider restarting app after this show"
- Link to `/admin/health` page for detailed memory info
- Banner auto-dismisses after 10 seconds, but reappears if memory stays above 80%

**Recovery:**
- Short-term: ignore warning and continue show
- After show: restart app (clears memory)
- See Failure Runbook if app crashes due to memory

### 6.4 Network Loss Detection

**Goal:** Alert operator if WAN tunnel (if enabled) goes down so they know remote playout is unavailable.

**Implementation:**
- If WAN tunnel is enabled (configured in `/admin`), main process maintains a WebSocket connection to tunnel server
- Every 30 seconds, a heartbeat is sent to the tunnel
- If heartbeat fails (timeout > 10 seconds), the connection is considered lost
- Error is logged: `[ERROR] WAN tunnel disconnected — local operation continues`
- Main process attempts automatic reconnect (exponential backoff: 5s, 10s, 20s, 60s, then every 60s)

**Triggers:**
- Internet connectivity lost (Wi-Fi disconnected, Ethernet unplugged, ISP down)
- Tunnel server is down or unreachable
- Firewall or proxy is blocking tunnel traffic
- Local machine is in airplane mode (rare, but possible)

**What it shows:**
- Orange banner in `/operator` UI: "⚠ WAN Tunnel Down — Local Operation OK"
- Current status: "Reconnecting... (attempt 3/5)"
- Once reconnected: "WAN Tunnel Restored" (green banner, auto-dismisses after 5s)
- In `/admin/health`: Tunnel status shows "Reconnecting" with retry count

**Recovery:**
- Operator continues running show locally (no remote playout capability)
- Once network is restored, tunnel auto-reconnects
- See Failure Runbook, Scenario 3 (Network issues) for manual recovery

### 6.5 Auto-Recovery for Renderer Crash

**Goal:** Restart the Program output renderer if it crashes, minimizing on-air downtime.

**Implementation:**
- Main process watches the Program output window (renderer process)
- If renderer crashes (process exits unexpectedly or is killed), main process detects it
- Main process waits 1 second, then creates a new renderer window
- New renderer loads the last known URL/mode from state
- Elapsed time from crash to restart: ~3 seconds
- Error is logged: `[ERROR] Program output crashed — restarting renderer with last known state`

**Triggers:**
- Segmentation fault or fatal error in Chromium/Electron
- Out-of-memory condition causing renderer to be killed
- Third-party script on loaded URL causing crash
- Rare memory corruption or hardware issue

**What it shows:**
- Brief flash (1–3 second delay, may appear as black screen to audience)
- Status banner in `/operator` UI (appears after restart): "Program Output Restarted — State Restored"
- List of what was restored: URL or slide deck, instance (A/B), mode
- If state restoration succeeds: no further action needed
- If state restoration fails: banner changes to "Program Output Error — Manual Recovery Required"

**Recovery:**
- If output reappears automatically: no operator action needed
- If output does not reappear: see Failure Runbook, Scenario 4 (App crash)

### 6.6 Show-Time Action Confirmation for Destructive Operations

**Goal:** Prevent fat-finger errors on destructive actions that can only be undone by manually editing config files or restoring a backup.

**Implementation:**
- When Show Lock is active and operator tries to perform a destructive action, a confirmation modal appears
- Modal is admin-only anyway (operator PIN does NOT permit access to `/admin`), but an extra confirmation adds a safety layer
- Actions requiring confirmation during show:
  - Switching profiles (requires 2 clicks: "Arm" + "Confirm Profile Switch")
  - Clearing all stills (requires 2 clicks: "Clear All Stills" + "Confirm")
  - Importing a bundle (requires confirmation: "This will replace all presets. Continue?")
- Modal text is clear and explicit: "Action is destructive and cannot be undone. Type 'DELETE' to confirm."
- Or: simple "Cancel" and "Confirm" buttons with clear warning text

**Triggers:**
- Show Lock is active (show mode)
- Operator attempts destructive action via `/admin` (requires admin PIN)

**What it shows:**
- Modal dialog with:
  - Title: "Confirm Destructive Action"
  - Description: "This will [action]. This action cannot be undone."
  - Optional: type-to-confirm field ("Type 'DELETE' to confirm") or explicit Confirm/Cancel buttons
  - Example: "Clearing all stills will remove every image from the Still Store. This cannot be undone without re-importing."
- If operator cancels: modal closes, action does not execute
- If operator confirms: action executes and is logged

**Recovery:**
- If action was executed by mistake: restore from backup (see Profiles & Backups spec)
- If action was not yet confirmed: cancel modal, no harm done

---

## 7. Failure Runbook

This section provides step-by-step recovery procedures for common failure scenarios during a live show. Each scenario lists symptoms, immediate actions, and escalation steps.

### 7.1 Scenario 1: Slides Becomes Unresponsive / Frozen

**Symptoms:**
- Slides don't advance when you click "Next"
- Presenter is stuck on one slide
- Presentation appears frozen or hanging
- Operator UI is responsive, but Program output is not responding

**Immediate Action (< 10 seconds):**

1. Check operator UI for alert banner
   - If banner says "Program Output Unresponsive", click "Force Reload" button
   - This reloads the slide deck in the current instance (brief visual hiccup, audience sees 1–2 second flash)
   - Wait 5 seconds for reload to complete

2. If reload completes:
   - Slides should resume responding
   - Operator can continue advancing
   - Root cause: slide deck JavaScript was blocking the event loop (now reset by reload)

3. If reload does NOT complete or deck is still frozen (after 10s):
   - Do not wait — proceed to Secondary Action

**Secondary Action (10–30 seconds):**

1. Safe reload procedure:
   - Click "Arm Reload Deck" on off-air instance
   - Wait for off-air instance to load (watch for "Ready" indicator, 5–10s)
   - Click "Take" to switch off-air to on-air
   - Program output now shows fresh copy of slide deck
   - Off-air instance has old frozen deck (fallback if new one also fails)

2. If secondary action succeeds:
   - Slides are now responsive
   - Presenter can continue
   - Note the time and notify production team after show (may indicate deck is too large or has bad JavaScript)

3. If secondary action does NOT work (new instance also frozen):
   - Proceed to Escalation

**Escalation (30+ seconds):**

1. Switch to URL mode with fallback content:
   - In operator UI, switch mode from "Slides" to "URL"
   - Load a fallback URL preset (if configured): blank slide, holding slide, or web-based notes
   - Audience sees fallback content instead of stuck slide
   - Production can troubleshoot slide deck separately after show

2. If no fallback URL preset exists:
   - Load a simple image (e.g., from Still Store) in L3-only mode
   - Or: activate Panic button to show black slate (gives you time to think)
   - Notify production lead that slides are down; coordinate next steps

3. Long-term fix:
   - After show: restart PC On Air app (clears memory, resets renderer)
   - Investigate slide deck for memory leaks or problematic JavaScript
   - If issue persists: contact support with deck file

---

### 7.2 Scenario 2: URL Content Fails to Load

**Symptoms:**
- Program output shows blank page or browser error (404, DNS error, connection refused)
- Page was working 5 minutes ago
- Operator UI shows correct URL in input field
- May indicate web server is down or network connectivity issue

**Immediate Action (< 15 seconds):**

1. Activate Panic button
   - Program output switches to black slate
   - Audience sees uniform black (safe, no error message visible)
   - Gives you 30 seconds to recover without showing broken state

2. Check URL loading status in operator UI
   - Look for error message: "Failed to load: [URL]"
   - Error details: timeout, DNS error, 5xx error, etc.

3. Determine if the URL service is down:
   - If you have a phone: quickly open the URL in a mobile browser to test it
   - If URL loads on phone: it's a network connectivity issue (see step 4)
   - If URL does NOT load on phone: web service is down (see step 5)

**If it's a network connectivity issue (URL works on phone):**

1. Check WAN connection status in `/admin/health`
   - If tunnel is down, that might be the issue
   - Wait 10 seconds for auto-reconnect to attempt
   - If tunnel reconnects: try reloading URL again

2. Reload the URL in off-air instance:
   - Click "Arm Reload" on off-air instance
   - Wait for off-air to load (should succeed if network is OK)
   - Click "Take" to switch on-air
   - Un-panic to show the content

3. If reload succeeds:
   - You're back on air
   - Continue show
   - Investigate network issue after show

**If web service is down (URL doesn't load on phone):**

1. Switch to fallback content:
   - If you have a backup content source (different URL, static site, Slides deck):
     - Arm load of backup URL in off-air instance
     - Verify it loads
     - Click "Take" to switch on-air
     - Un-panic to show it

2. If no backup URL:
   - Switch mode to "Slides" (if deck is available and working)
   - Or: load an image from Still Store in L3-only mode
   - Or: stay in Panic (black slate) and notify production

3. Communicate with production:
   - "Web service is down, switching to [backup source]"
   - Coordinate timeline for service recovery

**Recovery Verification:**

- Once back on air with alternate content: notify production team
- Ask: can web service be fixed, or should we stay on alternate content?
- After show: investigate why service went down and add redundancy if needed

---

### 7.3 Scenario 3: Companion Disconnects Mid-Show

**Symptoms:**
- Companion buttons stop working
- Companion app shows "Offline" or "Disconnected"
- All Companion buttons are grayed out or offline
- Web UI (/operator) is still fully responsive
- Show is still running, but operator has lost wireless control

**Immediate Action (< 5 seconds):**

1. Switch to Web UI fallback:
   - Open `/operator` in browser (via laptop, tablet, or phone on same network)
   - All operator controls are available in Web UI (slides, URL, L3, A/B switch, Panic, etc.)
   - Continue show using Web UI for remaining duration
   - Companion outage is now transparent to the show

2. Confirm Companion is disconnected:
   - In Web UI, look for Companion status (usually in a sidebar or health area)
   - Status should show "Disconnected" or "Last seen: 45 seconds ago"

**Secondary Action (if Web UI also not working, unlikely):**

1. If Web UI is unreachable (app may have crashed):
   - See Scenario 4 (App crash) below
   - Likely you will need to restart the app

**Resolution (after show is safe):**

1. Diagnose Companion connection issue:
   - Is Companion app still running on the control machine?
   - Check Companion logs / console output
   - Check PC On Air logs for WebSocket errors

2. Re-connect Companion:
   - In Companion app: re-enter host/port in settings (should be same as before)
   - Click "Connect"
   - Companion should connect and show "Online"
   - All buttons should show correct state (green for active, etc.)
   - WebSocket reconnect is automatic within 30 seconds of fix

3. If reconnect doesn't work:
   - Restart Companion app
   - Or: restart PC On Air (may require brief on-air interruption if critical)
   - Contact support if persistent

**Prevention for Future Shows:**

- Dual operator setup: have two control machines (one with Companion, one with Web UI as backup)
- Separate Companion control machine from PC On Air machine (more robust than same-machine control)
- Use 5 GHz Wi-Fi for Companion if available (more reliable than 2.4 GHz)

---

### 7.4 Scenario 4: App Crashes (Electron Process Dies)

**Symptoms:**
- All outputs go black (Program output window closes)
- Web UI (/operator) is unreachable (HTTP error or connection refused)
- App is no longer responding to any input
- System may show a crash notification (macOS: "PC On Air quit unexpectedly")

**Immediate Action (< 10 seconds):**

1. Pause the show (if possible):
   - Notify production lead: "PC On Air crashed, restarting now"
   - Ask for 30 seconds of live silence or hold on current slide/content

2. Restart PC On Air:
   - Click the app icon in Dock (macOS) or taskbar (Windows)
   - Or: Command-Q and restart from Applications folder
   - Or: use CLI: `pconair &` (if in terminal)
   - App launch should be < 10 seconds

3. Wait for app to restore state:
   - App loads
   - Previous profile is automatically loaded (saved on graceful shutdown, restored on crash)
   - Web UI (/operator) becomes responsive (usually within 5 seconds of launch)
   - Program output window opens and loads the previous URL / slide deck

**Verify Recovery:**

1. Check Web UI (/operator) is responsive:
   - Open `/operator` in browser
   - Confirm controls are working
   - Slides advance, mode switching works, etc.

2. Check Program output window:
   - Verify it shows the expected content (slides, URL, or mode)
   - Confirm output is visible on the main display

3. Check Companion (if using):
   - Companion should auto-reconnect within 30 seconds
   - If not: manually reconnect in Companion settings

4. Resume show:
   - Operator can continue from where it crashed
   - There may be a 20–30 second on-air blackout (audience saw black during restart)
   - Notify production that recovery is complete

**If App Does Not Restart:**

1. Check system resources:
   - Is disk space available? (app needs ~500 MB free to extract Electron)
   - Is system out of memory? (check Activity Monitor / Task Manager)
   - Restart the machine if out of memory

2. If app crashes again immediately on launch:
   - Likely a corrupted profile or configuration
   - Restart with flag: `pconair --reset-config`
   - This loads default configuration (you'll lose custom presets, but app will start)
   - After show: restore from backup or reconfigure

3. If still crashing:
   - App may be corrupted
   - Reinstall: uninstall and re-download from distribution
   - As last resort: switch to fallback (manual PowerPoint, static image on projector, etc.)

**Recovery Verification:**

- App is running and responsive: ✓
- Web UI is accessible: ✓
- Program output is visible: ✓
- Show can resume: ✓

**Post-Crash Investigation:**

- After show: check app logs (usually in `~/.pconair/logs/`)
- Look for error message before crash: may indicate which component failed
- If crash is repeatable with specific content: isolate and report to support
- If random/intermittent: may be memory leak (restart app between shows as preventive measure)

---

### 7.5 Scenario 5: Wrong Content Accidentally Put On Air

**Symptoms:**
- Audience sees wrong slide, URL, or lower third
- Operator made a mistake (clicked wrong button, selected wrong preset, etc.)
- Content is on-air and visible to everyone
- Need to switch to correct content immediately

**Immediate Action (< 3 seconds):**

1. Hit the Panic button:
   - Program output switches to black slate
   - Audience sees uniform black instead of wrong content
   - Wrong content is hidden; crisis averted
   - Operator has 30 seconds to fix

2. Assess what went wrong:
   - What content is currently on-air? (check operator UI)
   - What should have been on-air?
   - Was it a slide number error, wrong URL preset, or wrong L3 cue?

**Correct the Content (< 30 seconds):**

1. Locate and arm the correct content:
   - If wrong slide: load the correct slide deck in off-air instance → verify → take
   - If wrong URL: load correct URL preset in off-air instance → verify → take
   - If wrong L3 cue: load correct cue in off-air L3 instance → verify → take

2. Verify content is correct:
   - Look at off-air instance in operator UI
   - Confirm it shows the right content
   - Take (switch on-air)

3. Un-panic:
   - Click Panic button again to restore on-air output
   - Audience now sees correct content
   - Show resumes

**Prevention for Future Shows:**

- Slow down: take a breath before clicking "Take"
- Label presets clearly (e.g., "Agenda Slide Deck #3 — First Section")
- Use visual confirmation (preview off-air content before taking it)
- Buddy system: have a second person verify before taking (if possible)

---

### 7.6 Scenario 6: Admin Accidentally Locked During Show

**Symptoms:**
- Tried to access `/admin` (for any reason during show)
- Page shows "Admin is locked" or "403 Forbidden"
- Show Lock is active (red "SHOW LOCKED" badge visible)
- Need to reconfigure something urgently (e.g., add a new preset mid-show)

**Note:** This is intentional — Show Lock is a safety feature to prevent accidental config changes during live playout. Recovery steps assume you have a legitimate reason to access admin during show.

**Immediate Option 1: Use Operator UI Instead**

- Many tasks can be done from `/operator` without accessing `/admin`:
  - Load URL presets
  - Switch slides/URL modes
  - Trigger lower thirds
  - Switch A/B instances
  - Adjust keying/background (if controls are exposed in operator UI)
- If the task you need can be done from `/operator`: do it there and skip unlock steps

**Immediate Option 2: Unlock Admin Using Admin PIN (Standard Path)**

1. Navigate to `/admin` in the browser.
   - The page shows "Admin locked for show. Enter admin PIN to unlock."
   - An admin PIN entry form is displayed.

2. Enter the admin PIN and click "Unlock."
   - Server validates the PIN via `POST /auth/unlock-admin`.
   - A confirmation dialog appears: "Unlock the admin panel? This will allow configuration changes during the show."

3. Confirm unlock.
   - `adminShowLocked` is set to `false`.
   - `/admin` route is now accessible again.
   - Make the urgent configuration change.
   - When done: voluntarily re-enable Show Lock (for safety):
     - Go to `/admin` > Show Lock
     - Click "Arm Show Lock"
     - Click "Take" to re-lock

**Emergency Option 3: Physical Machine Access (Admin PIN Forgotten)**

If the admin PIN has been forgotten and the in-app unlock is not possible:

1. **Restart the app**:
   - Close PC On Air (Cmd-Q or click close button)
   - Reopen PC On Air from Dock or Applications folder
   - Show Lock state is not persisted across restarts → admin is unlocked on restart
   - Drawback: 20–30 second on-air interruption while app is closed and restarting

2. **Or: Use CLI flag to force unlock** (requires physical machine access):
   - Open Terminal on the machine
   - Run: `pconair --reset-admin-pin --admin-pin=<new-pin>`
   - Restart the app with the new PIN set
   - Drawback: requires terminal access and results in a new admin PIN

**Recommended Prevention:**

- Before show: configure everything that might be needed (add URL presets, lower thirds, etc.)
- Use checklists (see Pre-Show Checklist below)
- Keep the admin PIN readily accessible to authorized personnel
- If something is missing mid-show: add it to `/operator` web UI if possible, or use Panic + fallback content while you prepare the new asset

---

## 8. Day-Before-Show Checklist (Operator)

This checklist should be completed by the operator the day before the live event (ideally 2–4 hours before audience arrival).

- [ ] **1. Verify all URL preset links load correctly**
  - Go to `/admin` > URL Presets
  - For each preset, click "Test" or copy the URL into a browser tab
  - Confirm the page loads completely (no 404, no DNS error, no auth required if not configured)
  - Note: some sites may require login — if so, log in now and keep the session alive
  - Expected time: 2–3 minutes

- [ ] **2. Verify Google account is logged in for Slides**
  - Open Google Chrome (or the browser PC On Air will use for slides)
  - Visit https://slides.google.com
  - Confirm you're logged into the correct Google account
  - This prevents "permission denied" errors during show
  - Expected time: 30 seconds

- [ ] **3. Verify Slido (or other persistent-session sites) are logged in**
  - For any URL presets that require authentication (Slido, Menti, Typeform, etc.):
    - Open the site in a browser tab
    - Log in if needed and verify you're authenticated
    - Keep the tab open or bookmark it (persistent session)
  - This ensures the session remains active during the show
  - Expected time: 2–3 minutes (depends on number of auth sites)

- [ ] **4. Verify Companion module connects**
  - If using Companion (wireless control):
    - Open Companion app on the control machine
    - Check Companion settings for host/port (should match PC On Air machine)
    - Click "Connect"
    - Verify Companion shows "Online" or green status
    - Look at Companion buttons — they should show current state (green for active mode, etc.)
  - Expected time: 1 minute

- [ ] **5. Load each slide deck preset and advance through 2–3 slides**
  - Go to `/operator`
  - For each slide deck preset in your profile:
    - Load it in the off-air instance
    - Wait for it to load (watch for "Ready" indicator)
    - Take (switch to on-air)
    - Advance 2–3 slides to verify navigation works
    - Verify slides are legible and not corrupted
  - Expected time: 3–5 minutes (depends on number of decks)

- [ ] **6. Test A/B switch for both Slides and URL modes**
  - In Slides mode:
    - Load deck in off-air instance
    - Take (switch on-air)
    - Verify on-air instance is showing the fresh deck
    - Switch back to off-air (arm switch, take) to verify toggle works both directions
  - In URL mode:
    - Load a URL preset in off-air instance
    - Take to switch on-air
    - Verify on-air instance shows the URL
    - Switch back to off-air to verify toggle works
  - Expected time: 2 minutes

- [ ] **7. Test panic button (verify output goes black, verify un-panic restores)**
  - Click Panic button in `/operator`
  - Confirm Program output window shows black slate
  - Confirm operator UI shows red "PANIC — OUTPUT HIDDEN" banner
  - Click Panic button again (or "Un-panic" button)
  - Confirm Program output restores to previous content
  - Expected time: 1 minute

- [ ] **8. Test each lower third cue in the Still Store**
  - Go to `/operator` and switch mode to "Lower Third"
  - For each L3 preset:
    - Click the cue to trigger it
    - Verify the L3 appears on-air (on the Program output window)
    - Verify text/graphics are legible
    - Clear it (click "Clear" or press hotkey)
    - Verify L3 disappears
  - Expected time: 2–3 minutes (depends on number of L3 cues)

- [ ] **9. Confirm background/luma key is configured correctly for switcher**
  - Go to `/admin` > Keying / Background
  - Check the configured luma key color (should match your chroma key suit or background)
  - Confirm the color picker shows the right color (RGB values or hex code)
  - If you're using a chroma key suit: put on the suit and verify the keying looks correct in Program output
  - If you're using a solid background: verify the background layer loads
  - Expected time: 1 minute

- [ ] **10. Activate Show Lock before audience arrives**
  - 30 minutes before audience arrival (or when setup is complete):
    - Go to `/admin`
    - Click "Arm Show Lock" button
    - Review the confirmation dialog: "You are about to lock admin..."
    - Click "Take" (or confirm) button
    - Verify red "SHOW LOCKED" badge appears in `/operator` UI
    - Verify `/admin` route now shows 403 Forbidden (or "Admin is locked")
  - Expected time: 30 seconds

**Expected Total Time:** 15–25 minutes

**Troubleshooting During Checklist:**
- If any step fails (preset doesn't load, Companion doesn't connect, etc.):
  - **Do not proceed with show until fixed**
  - Document the failure (note time, URL, error message)
  - Contact support or production lead
  - Have a fallback plan (e.g., manual PowerPoint if Slides won't load)

---

## 9. Show-Start Checklist

This checklist is completed immediately before the show starts (5–10 minutes before going live).

**Prerequisite:** Day-Before Checklist must be complete and passing.

- [ ] **1. Show Lock active: confirm "SHOW LOCKED" badge visible**
  - Open `/operator` in the web browser
  - Look for red badge or banner: "SHOW LOCKED"
  - If NOT visible: go to `/admin` and re-enable Show Lock (Arm → Take)
  - If Admin shows 403: that's correct (admin is locked)

- [ ] **2. Companion: all buttons green, showing correct state**
  - If using Companion:
    - Look at Companion app on control machine
    - All buttons should show status (green for "armed", gray for "standby")
    - Try one test button (e.g., "Slides mode") to verify it works
    - Look for "Last seen" timestamp — should be "now" or within 5 seconds
  - If Companion is not connected: do NOT start show; reconnect or use Web UI fallback

- [ ] **3. Slides: correct deck loaded in active instance**
  - In `/operator`, check the on-air (left) instance
  - Verify the correct slide deck is loaded (title should match expected first slide deck of show)
  - Verify it shows the first slide (or the slide you intend to start on)
  - If wrong deck: arm correct deck in off-air → take

- [ ] **4. Background/keying: confirmed with production engineer**
  - Production engineer should verify the chroma key looks correct:
    - Talent (if present) should be keyed correctly (green screen or luma key color)
    - Background should be visible behind talent
    - No fringing or transparency issues
  - If this is URL mode or lower-thirds-only: verify keying is not needed or is disabled
  - Get a thumbs-up from production before proceeding

- [ ] **5. Operator has physical fallback plan (know who to call if PC On Air fails)**
  - Operator should know the backup procedure if entire system fails:
    - Who do you call? (production lead, tech manager, on-site IT)
    - What is the fallback? (PowerPoint on different machine, static image on projector, recorded video)
    - Is backup content ready and tested? (slides on backup laptop, static graphic on thumb drive)
  - Confirm production lead is aware and reachable during show

**Expected Total Time:** 3–5 minutes

**Go/No-Go Decision:**
- If all 5 items are ✓: **GO LIVE** (show can start)
- If any item is ✗: **NO-GO** (resolve before starting):
  - Unlocked admin? Re-lock it.
  - Companion offline? Reconnect or use Web UI.
  - Wrong deck loaded? Load correct deck.
  - Keying issue? Fix with production engineer.
  - No fallback plan? Create one now (30 minutes delay if necessary).

---

## 10. API Additions

This section documents new API endpoints introduced for reliability and health monitoring. All endpoints require authentication (admin PIN).

### 10.1 Health Endpoint

**`GET /api/health`** (admin-only)

Returns comprehensive health and status information as JSON.

**Request:**
```
GET /api/health HTTP/1.1
Authorization: Bearer <admin-session-token>
```

**Response (200 OK):**
```json
{
  "app": {
    "version": "1.0.0-beta.2",
    "buildDate": "2025-05-10T14:22:00Z",
    "mode": "Show Locked",
    "uptime": 9252
  },
  "environment": {
    "node": "18.16.0",
    "electron": "25.3.1",
    "os": "macOS",
    "platform": "darwin",
    "arch": "arm64"
  },
  "operator": {
    "activeProfile": "2025-05-11 Keynote",
    "currentMode": "Slides",
    "connectedClients": 5
  },
  "companion": {
    "connected": true,
    "lastHeartbeat": "2025-05-11T14:15:32Z",
    "version": "5.2.0"
  },
  "errors": [
    {
      "timestamp": "2025-05-11T14:03:22Z",
      "type": "SlidedeckLoadTimeout",
      "description": "Slides deck failed to load within 10s"
    }
  ],
  "warnings": [
    {
      "timestamp": "2025-05-11T14:10:00Z",
      "type": "MemoryPressure",
      "description": "Heap usage at 78%"
    }
  ],
  "infrastructure": {
    "wanTunnel": {
      "status": "Active",
      "url": "https://tunnel.pconair.app/abc123",
      "lastHeartbeat": "2025-05-11T14:15:31Z"
    },
    "displays": [
      {
        "id": "display-1",
        "name": "Main Screen",
        "instance": "A",
        "url": "https://slides.google.com/presentation/d/.../edit",
        "lastUpdate": "2025-05-11T14:15:20Z"
      }
    ]
  },
  "resources": {
    "memory": {
      "heapUsed": 4400,
      "heapTotal": 6144,
      "percentUsed": 72
    },
    "trend": "Stable"
  }
}
```

**Response codes:**
- `200 OK` — Health info returned successfully
- `401 Unauthorized` — Invalid or missing auth token
- `403 Forbidden` — Auth token present but insufficient privilege (operator PIN)

### 10.2 Panic Endpoint

**`POST /api/panic`** (admin-only, operator-only)

Toggles the panic state (hide/show Program output).

**Request:**
```
POST /api/panic HTTP/1.1
Authorization: Bearer <session-token>
Content-Type: application/json

{
  "action": "toggle"
}
```

**Body Parameters:**
- `action` (string, required): `"toggle"` (panic on if off, off if on), `"on"` (force panic on), or `"off"` (force panic off)

**Response (200 OK):**
```json
{
  "panicActive": true,
  "slate": {
    "type": "color",
    "value": "#000000"
  },
  "message": "Panic activated — output hidden"
}
```

**Response codes:**
- `200 OK` — Panic state toggled successfully
- `400 Bad Request` — Invalid action or request body
- `401 Unauthorized` — Invalid or missing auth token
- `403 Forbidden` — Token present but insufficient privilege

### 10.3 Safe Reload Endpoint

**`POST /api/reload-instance`** (operator-only)

Reloads the off-air instance (URL or slide deck) without interrupting Program output.

**Request:**
```
POST /api/reload-instance HTTP/1.1
Authorization: Bearer <session-token>
Content-Type: application/json

{
  "instance": "B",
  "timeout": 15
}
```

**Body Parameters:**
- `instance` (string, required): `"A"` or `"B"` (which instance to reload)
- `timeout` (integer, optional): seconds to wait for reload before timeout (default: 15)

**Response (202 Accepted):**
```json
{
  "status": "reloading",
  "instance": "B",
  "startTime": "2025-05-11T14:15:32Z",
  "estimatedComplete": "2025-05-11T14:15:40Z"
}
```

**After reload completes (poll endpoint):**

**`GET /api/instance-status`** (operator-only)

```
GET /api/instance-status?instance=B HTTP/1.1
Authorization: Bearer <session-token>
```

**Response (200 OK):**
```json
{
  "instance": "B",
  "status": "ready",
  "url": "https://slides.google.com/...",
  "lastUpdate": "2025-05-11T14:15:35Z",
  "message": "Instance B — Ready"
}
```

Or if reload failed:
```json
{
  "instance": "B",
  "status": "error",
  "error": "SlidedeckLoadTimeout",
  "message": "Failed to load slides — timeout after 15s"
}
```

**Response codes:**
- `202 Accepted` — Reload initiated
- `400 Bad Request` — Invalid instance or timeout
- `401 Unauthorized` — Invalid or missing auth token
- `403 Forbidden` — Token present but insufficient privilege

### 10.4 Show Lock Endpoint

**`POST /api/show-lock`** (admin-only)

Activates or deactivates Show Lock (admin route locking).

**Request:**
```
POST /api/show-lock HTTP/1.1
Authorization: Bearer <session-token>
Content-Type: application/json

{
  "action": "lock",
  "confirmationToken": "abc123xyz"
}
```

**Body Parameters:**
- `action` (string, required): `"lock"` or `"unlock"`
- `confirmationToken` (string, required for lock): two-factor confirmation token (returned by first call without token)

**Initial request (without token):**
```
POST /api/show-lock HTTP/1.1
Authorization: Bearer <session-token>
Content-Type: application/json

{
  "action": "lock"
}
```

**Response (202 Accepted):**
```json
{
  "status": "confirmation_required",
  "message": "You are about to lock admin. To unlock, enter the admin PIN on the /admin page. Emergency unlock (if PIN forgotten): restart app or use --reset-admin-pin CLI flag.",
  "confirmationToken": "abc123xyz_deadline_2025-05-11T14:16:32Z"
}
```

**Confirmation request (with token):**
```
POST /api/show-lock HTTP/1.1
Authorization: Bearer <session-token>
Content-Type: application/json

{
  "action": "lock",
  "confirmationToken": "abc123xyz_deadline_2025-05-11T14:16:32Z"
}
```

**Response (200 OK):**
```json
{
  "showLockActive": true,
  "message": "Admin is now locked — access to /admin is blocked"
}
```

**Response codes:**
- `200 OK` — Show lock state changed successfully
- `202 Accepted` — Confirmation required (return confirmationToken)
- `400 Bad Request` — Invalid token or already expired
- `401 Unauthorized` — Invalid or missing auth token
- `403 Forbidden` — Token present but insufficient privilege

---

## 11. Acceptance Criteria

All items below must be tested and verified before v1 release.

### 11.1 Run Modes

- [ ] Rehearsal mode allows full editing of presets, profiles, and bundles
- [ ] Show mode (Show Lock active) blocks all `/admin` routes (403 Forbidden)
- [ ] Activating Show Lock requires Arm/Take confirmation
- [ ] Show Lock state is in-memory only (clears on app restart; no disk persistence)
- [ ] Standard Show Lock disable: enter admin PIN on `/admin` lock prompt (calls `POST /auth/unlock-admin`)
- [ ] Emergency disable (PIN forgotten): restart app or use `--reset-admin-pin` CLI flag (requires physical machine access)
- [ ] Operator UI shows "SHOW LOCKED" badge prominently when Show Lock is active

### 11.2 Arm / Take Pattern

- [ ] Switching A/B instance uses Arm/Take workflow
- [ ] Loading new URL preset uses Arm/Take workflow
- [ ] Loading new slide deck uses Arm/Take workflow
- [ ] Off-air instance begins loading immediately upon Arm (not upon Take)
- [ ] Program output does not change until Take is clicked
- [ ] Take button is only visible when an action is armed
- [ ] Subsequent Arm cancels previous armed action (only one armed action at a time)

### 11.3 Panic Button

- [ ] Panic button switches Program output to configured panic slate (< 100ms)
- [ ] Panic button is accessible in 1 click (no confirmation)
- [ ] Panic can be toggled via Web UI button, Companion button, or keyboard shortcut
- [ ] Un-panic (toggle) restores previous active content
- [ ] Panic state is visually prominent in operator UI (red banner, red border)
- [ ] Panic state persists across page refresh (stays hidden if refreshed)
- [ ] Default panic slate is solid black
- [ ] Custom panic slate can be configured in `/admin` (color, logo, image)

### 11.4 Safe Reload

- [ ] Safe reload procedure loads off-air instance without interrupting on-air
- [ ] Safe reload for URL mode fetches fresh URL and renders in off-air
- [ ] Safe reload for Slides mode re-fetches deck metadata in off-air
- [ ] Operator can preview reloaded content in off-air before taking
- [ ] Reload takes < 15 seconds for typical web content and slide decks
- [ ] Failed reload shows error message in off-air instance (does not switch on-air)
- [ ] Take button after reload is clearly labeled and prominent

### 11.5 Health Page

- [ ] `/admin/health` page displays all required information (app version, uptime, memory, etc.)
- [ ] Health page auto-refreshes every 5 seconds
- [ ] Health page has manual "Refresh Now" button
- [ ] `/api/health` returns JSON with same info as web page
- [ ] Both endpoints require admin authentication (403 if not authenticated)
- [ ] Memory usage is displayed as percentage and absolute values (MB)
- [ ] Companion connection status shows "Connected" or "Disconnected"
- [ ] WAN tunnel status shows "Active" or "Inactive" with last heartbeat time
- [ ] Display list shows all connected displays with current content URL

### 11.6 Guardrails

**No accidental URL navigation:**
- [ ] Program output window has no address bar, back/forward buttons
- [ ] Keyboard shortcuts (Cmd+[, Alt+Left, etc.) that navigate are disabled
- [ ] Swipe gestures do not trigger navigation (if touch-enabled)
- [ ] Only `/api/program-url` endpoint can change URL on-air

**Unresponsive page watchdog:**
- [ ] Main process sends heartbeat pings every 2 seconds
- [ ] If pong not received within 5 seconds, alert is shown
- [ ] Alert banner in operator UI: "Program Output Unresponsive"
- [ ] Force Reload button is offered in alert
- [ ] Force Reload reloads current URL without switching instances

**Memory pressure alert:**
- [ ] If heap usage exceeds 80%, yellow warning is shown
- [ ] Warning is displayed in operator UI banner
- [ ] Warning includes heap usage percentage and absolute values
- [ ] Only one warning per 60 seconds (not spammed)
- [ ] Warning suggests restarting after show

**Network loss detection:**
- [ ] If WAN tunnel is enabled and connection drops, orange alert is shown
- [ ] Alert shows tunnel status and reconnect attempts
- [ ] Local operation continues unaffected while tunnel is down
- [ ] Auto-reconnect attempts with exponential backoff (5s, 10s, 20s, 60s, then 60s)
- [ ] When tunnel reconnects, green success message is shown

**Auto-recovery for renderer crash:**
- [ ] If Program output renderer crashes, main process detects it
- [ ] Main process restarts renderer within 3 seconds
- [ ] Renderer reloads last known URL/mode
- [ ] Operator UI shows status message: "Program Output Restarted — State Restored"
- [ ] If state restoration fails, operator UI shows error message with manual recovery instructions

**Show-time action confirmation for destructive operations:**
- [ ] During show (Show Lock active), destructive actions require confirmation modal
- [ ] Modal clearly describes the action and warns it is destructive
- [ ] Modal offers "Cancel" and "Confirm" buttons
- [ ] Canceling modal does not execute the action
- [ ] Confirming action executes and is logged

### 11.7 Failure Runbook Scenarios

**Scenario 1: Slides unresponsive**
- [ ] Unresponsive watchdog detects frozen slides and alerts operator
- [ ] Force Reload button reloads slides without switching instances
- [ ] If Force Reload fails, Safe Reload procedure can be executed (load in off-air, take)
- [ ] If reload still fails, operator can switch to URL mode with fallback

**Scenario 2: URL content fails to load**
- [ ] Failed URL shows error message in Program output (or blank page)
- [ ] Operator can panic to hide the error
- [ ] Operator can reload URL in off-air instance and verify before taking
- [ ] If URL service is down, operator can switch to fallback content (backup URL, Slides, L3)

**Scenario 3: Companion disconnects**
- [ ] Companion shows "Offline" or "Disconnected" status
- [ ] Web UI (`/operator`) is fully functional and can replace Companion
- [ ] Web UI has all operator controls (slides, URL, L3, A/B, Panic, etc.)
- [ ] Companion auto-reconnects within 30 seconds after fix
- [ ] Manually reconnecting Companion restores connection

**Scenario 4: App crashes**
- [ ] App crash is detected (renderer process exits)
- [ ] Main process restarts renderer within 3 seconds
- [ ] Previous profile is automatically restored
- [ ] Web UI becomes responsive after restart
- [ ] Operator can resume show
- [ ] If app does not restart, operator can restart manually with `pconair` CLI

**Scenario 5: Wrong content on air**
- [ ] Panic button instantly hides wrong content (< 100ms)
- [ ] Operator can use Safe Reload or A/B switch to prepare correct content
- [ ] Correct content can be taken (switched on-air) without further pause
- [ ] Un-panic restores Program output to new correct content

**Scenario 6: Admin locked during show**
- [ ] `/admin` route shows "Admin is locked" message or 403 Forbidden with PIN entry form
- [ ] Standard unlock path: enter admin PIN on the `/admin` page (via `POST /auth/unlock-admin`)
- [ ] On correct PIN, confirmation dialog appears before unlocking
- [ ] Most tasks can be performed from `/operator` without unlocking admin
- [ ] Emergency unlock (admin PIN forgotten): restart app (Show Lock clears on restart) or use `--reset-admin-pin` CLI flag with physical machine access

### 11.8 Checklists

**Day-Before Checklist:**
- [ ] All 10 checklist items can be completed in 15–25 minutes
- [ ] Each item has clear pass/fail criteria
- [ ] If any item fails, operator knows how to troubleshoot

**Show-Start Checklist:**
- [ ] All 5 checklist items can be completed in 3–5 minutes
- [ ] Show Lock status is confirmed before show starts
- [ ] Companion status is confirmed before show starts
- [ ] Correct content is loaded before show starts
- [ ] Keying is confirmed before show starts
- [ ] Fallback plan is in place before show starts

### 11.9 Documentation

- [ ] All 6 failure scenarios have step-by-step recovery procedures
- [ ] All recovery procedures are written for operators (non-technical language)
- [ ] Recovery times are realistic and tested
- [ ] All 6 guardrails are clearly described with triggers and indicators
- [ ] Arm/Take pattern is explained with visual examples
- [ ] Panic button behavior is fully specified
- [ ] Safe reload procedure is step-by-step with expected timing

---

## Appendix A: Configuration

### Default Panic Slate

```json
{
  "panic": {
    "enabled": true,
    "slate": {
      "type": "color",
      "value": "#000000",
      "overlayImage": null,
      "overlayText": null
    },
    "keyboardShortcut": "P"
  }
}
```

### Guardrail Defaults

```json
{
  "guardrails": {
    "watchdog": {
      "enabled": true,
      "pingInterval": 2000,
      "pongTimeout": 5000,
      "alertThreshold": 15000
    },
    "memoryPressure": {
      "enabled": true,
      "threshold": 0.8,
      "checkInterval": 10000
    },
    "networkLoss": {
      "enabled": true,
      "heartbeatInterval": 30000,
      "reconnectBackoff": [5000, 10000, 20000, 60000]
    }
  }
}
```

---

## Appendix B: Error Codes

| Code | Type | Description | Recovery |
|------|------|-------------|----------|
| SLIDE_TIMEOUT | SlidedeckLoadTimeout | Slides deck failed to load within timeout | Force reload or switch to URL/L3 |
| URL_LOAD_FAILED | URLLoadFailed | URL failed to load (DNS, 404, 5xx) | Panic, reload in off-air, verify, take |
| COMPANION_OFFLINE | CompanionOffline | Companion module disconnected | Use Web UI, reconnect Companion |
| RENDERER_CRASH | RendererCrash | Program output renderer process crashed | Auto-restart renderer, verify state restored |
| MEMORY_HIGH | MemoryPressure | Heap usage exceeds 80% | Continue show, restart after show |
| TUNNEL_DOWN | WanTunnelDown | WAN tunnel connection lost | Continue local operation, reconnect tunnel |
| SHOW_LOCK_ACTIVE | ShowLockActive | Admin is locked (show is active) | Unlock via restart or CLI, or use `/operator` only |

---

## Document Metadata

| Field | Value |
|-------|-------|
| Title | PC On Air v1 — Reliability & Runbook Specification |
| Spec Number | 09 |
| Version | 1.0 |
| Status | Final |
| Created | 2025-05-11 |
| Last Updated | 2025-05-11 |
| Author | Specification Team |
| Target Audience | Operators, developers, production engineers |
