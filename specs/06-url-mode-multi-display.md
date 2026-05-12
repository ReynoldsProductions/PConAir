# PC On Air v1 — URL Mode and Multi-Display Routing Spec

## Overview

This spec defines **URL Mode** and **multi-display routing** for PC On Air v1. URL Mode allows operators to load and display any arbitrary URL on the Program output (e.g., Slido audience Q&A, social media walls, custom dashboards, sponsor content, live news feeds). Multi-display routing extends this capability to environments with multiple connected displays, enabling different content on different outputs simultaneously.

URL Mode adopts the same **A/B dual-instance failover model** as Slides mode, allowing safe refresh and switching workflows. Each URL instance can use either a persistent session (with stored login state) or an ephemeral (clean) session. URL presets provide a named library of pre-configured URLs that operators can recall with a single click, matching the preset UX of Slides mode.

---

## 1. URL Mode Overview

### 1.1 Purpose and Use Cases

**URL Mode** enables live display of arbitrary web content on the Program output. Primary use cases include:

- **Slido Q&A**: Audience questions displayed live during event
- **Social Media Walls**: Twitter/Instagram feeds with event hashtags
- **Live Dashboards**: Real-time metrics, stock prices, sports scores
- **Sponsor Content**: Custom sponsor websites or promotional content
- **News Feeds**: Live news ticker or breaking news display
- **Custom HTML**: Internally-built web applications with business logic

URL Mode complements Slides mode and operates independently. An operator can switch between modes, or route URLs to different displays while Slides run on another (see **Multi-Display Routing**).

### 1.2 Core Capabilities

1. **Load arbitrary URLs** on the Program output (fullscreen render)
2. **URL presets**: Save and recall named URLs (like Slides presets)
3. **A/B dual-instance** with safe failover and switching
4. **Per-instance refresh** (reload off-air URL while on-air instance stays live)
5. **Session persistence**: Cookies and localStorage survive reloads (logged-in state retained)
6. **Ephemeral sessions**: Clean browser context for each load (useful for demo resets)
7. **Multi-display routing**: Target specific display per URL
8. **Display enumeration**: Real-time list of connected displays with metadata

### 1.3 Session Types

URL instances use one of two session modes:

- **Persistent Session**: Uses Electron's persistent session profile (stored cookies, localStorage, indexedDB, auth tokens). Login state survives page reloads and survives across multiple page loads in the same session. Useful for Slido (stays logged in) or custom apps with user state.
- **Ephemeral Session**: Uses a fresh, temporary session context (no stored state). Each load/reload gets a clean browser environment. Useful for demo pages or pages that cache stale data locally.

The session mode is **per-instance**, not per-URL globally. Admin sets a default; operators can override per-load.

---

## 2. URL Mode Behaviors

### 2.1 Loading a URL

**Operator action**: Enter a URL and optionally select a target display and session mode.

**Flow**:

1. Operator enters URL (e.g., `https://slido.com/event/abc123`) in the Web UI or via Companion
2. Optional: Operator selects target display (defaults to primary Program output display)
3. Optional: Operator selects session mode (defaults to persistent)
4. URL is validated:
   - Must be valid http or https URL
   - Reject invalid URLs (malformed, no scheme, etc.)
   - Warn (but allow) non-HTTPS URLs
5. The URL is loaded into the **off-air instance** (whichever is not currently active)
6. The instance enters `isLoading: true` state; display shows loading indicator if visible
7. Once the URL renders (DOM ready, or after configurable timeout), instance transitions to `isReady: true`
8. Operator can then switch to the new instance (A/B toggle) to bring it on-air

**Validation rules**:
- URL must start with `http://` or `https://`
- URL cannot be empty
- Non-HTTPS URLs are logged as a warning and displayed to the operator ("Loading non-HTTPS URL; consider HTTPS for security")

### 2.2 URL Presets

URL presets are named, saved URLs stored in the active show profile. They allow operators to load frequently-used URLs with a single click, matching the Slides preset workflow.

**Preset properties**:

```typescript
interface UrlPreset {
  id: string;                    // Unique identifier (UUID or sequential)
  name: string;                  // Human-readable label (e.g., "Slido — Conference 2025")
  url: string;                   // The URL to load (must be valid http/https)
  displayTarget?: string;        // Optional default display target (display ID or "primary")
  sessionMode: "persistent" | "ephemeral"; // Session mode for this preset
  createdAt: string;             // ISO 8601 timestamp
  updatedAt: string;             // ISO 8601 timestamp
}
```

**Admin UI** (`/admin`):

- Add preset: Form with fields for name, URL, optional display target, session mode
- Edit preset: Modify any preset fields
- Delete preset: Remove preset from library
- Import/export: Presets included in show profile export/import

**Operator UI** (`/operator`):

- Preset dropdown: List of all presets in active show
- Load preset: One-click load (loads into off-air instance with preset-configured display target and session mode)
- Display preset name: Show currently-loaded preset name (if loaded from preset)

**Limitations**:
- Operator can load but cannot create, edit, or delete presets (admin only)
- Preset name and URL are validated at creation; invalid presets cannot be saved
- Up to 50 presets per show (design decision to prevent UI clutter; can be increased)

### 2.3 A/B Dual-Instance in URL Mode

URL Mode uses the same A/B failover model as Slides mode.

**State**:
- Instance A: holds a URL, session state, loading status
- Instance B: holds a different URL, session state, loading status
- Only one instance is "active" (on-air) at a time

**Workflow: Safe Refresh**

Scenario: Slido is on-air (Instance A). New questions have arrived; operator wants to reload Slido without interrupting the live view.

1. Instance A is active (on-air, displaying Slido)
2. Instance B is inactive (off-air, may hold a different URL or be empty)
3. Operator clicks "Reload Off-Air Instance" (reloads Instance B)
4. Instance B is reloaded silently (no visible change; Instance A still on-air)
5. Instance B transitions to `isLoading: true`, then `isReady: true`
6. Operator clicks A/B toggle to switch to Instance B (Instance B now on-air, showing refreshed Slido)
7. If needed, operator reloads Instance A again and switches back

**Workflow: Load Different Content**

Scenario: Operator wants to switch from Slido to a different URL (e.g., sponsor page) without interruption.

1. Instance A is active (on-air, displaying Slido)
2. Instance B is off-air
3. Operator clicks "Load URL" and enters the sponsor URL, target display, session mode
4. Sponsor URL loads into Instance B (off-air)
5. Instance B transitions to `isLoading: true`, then `isReady: true`
6. Operator clicks A/B toggle; Instance B is now on-air (showing sponsor page)
7. Slido is now off-air in Instance A; can be reloaded later or replaced with new content

**API state for URL Mode**:

```typescript
// (in AppState, from spec 02)
abState: {
  activeInstance: "A" | "B";
  instanceA: {
    url: string | null;          // Current URL (URL mode)
    displayTarget: string | null; // Target display ID or "primary"
    sessionMode: "persistent" | "ephemeral";
    isLoading: boolean;
    isReady: boolean;
  };
  instanceB: {
    url: string | null;
    displayTarget: string | null;
    sessionMode: "persistent" | "ephemeral";
    isLoading: boolean;
    isReady: boolean;
  };
}
```

---

## 3. Multi-Display Routing

### 3.1 Display Enumeration

PC On Air enumerates all connected displays at startup and whenever displays are connected or disconnected.

**Display metadata**:

```typescript
interface Display {
  id: string;           // System-unique identifier (e.g., UUID or display port ID)
  name: string;         // Human-readable name (e.g., "Built-in Retina Display", "HDMI-1", "DELL U2720Q")
  width: number;        // Display width in pixels
  height: number;       // Display height in pixels
  isPrimary: boolean;   // True if this is the primary Program output display
  refreshRate?: number; // Refresh rate in Hz (optional)
}
```

**Enumeration logic**:
- On app startup, query OS display list (Electron `screen` module)
- Store current display list in app state
- Listen for display change events (connect/disconnect/reconfigure) and update state
- API endpoint returns current display list (see **API Surface**)

**Primary display**:
- Exactly one display has `isPrimary: true` at all times
- Primary display is the default Program output target
- Admin can configure which display is primary in `/admin` settings
- If primary display is disconnected, system chooses next available display as primary

### 3.2 Per-URL Display Targeting

When loading a URL, the operator can optionally specify a target display:

**Default behavior**: Load on the primary Program output display (configured in `/admin`)

**Custom targeting**: Operator can select a different display when loading a URL

**API call example** (see **API Surface** for full spec):

```
POST /api/url/load
{
  "url": "https://slido.com/event/abc123",
  "displayTarget": "HDMI-1",  // Optional; defaults to primary
  "sessionMode": "persistent",
  "instance": "B"  // Optional; defaults to off-air instance
}
```

**Display routing semantics**:
- Each display runs an independent Electron BrowserWindow (Program output window)
- Each window has its own display target stored in app state
- Only one URL can be on-air per display at a time
- Different displays can show different content simultaneously
- When a URL is loaded with a specific display target, it renders only on that display

**Example multi-display scenario**:
- Display 1 (HDMI-1, primary): Slides mode active, showing presentation slide 5
- Display 2 (HDMI-2): URL mode active, showing Slido page
- Display 3 (HDMI-3): Idle, showing luma key background

All three displays are independent. Switching slides on Display 1 does not affect Display 2 or 3. Loading a new URL on Display 2 does not affect Display 1 or 3.

### 3.3 Web UI Display Controls

The operator Web UI (`/operator`) shows display awareness:

**Display list section**:
- Displays a card or section for each connected display
- For each display:
  - Display name and resolution (e.g., "HDMI-1 (1920×1080)")
  - Current content (e.g., "Slido: Live Q&A", "Slide 5 of 12", "Idle")
  - Active instance indicator (A or B, if applicable)
  - Load URL button (for that display)
  - A/B switch button (for that display)
  - Refresh buttons (reload on-air or off-air instance)

**Load URL dialog**:
- Includes optional "Display Target" dropdown (selects from enumerated displays)
- Defaults to primary display
- Operator can select a different display when loading

**Preset loading with display**:
- Each preset can have an optional default display target
- When operator loads a preset, it uses the preset's target display (or primary if not set)
- Preset target can be overridden at load time

### 3.4 Default Program Output Display (Admin Setting)

Admin configures the default Program output display in `/admin`:

**Setting**: "Default Program Output Display"

- Dropdown list of enumerated displays
- Default value: primary display (as reported by OS)
- When a URL is loaded without explicit display target, it loads on this display
- Admin can change this setting at any time

**Fallback**: If the configured default display becomes unavailable (disconnected), the system:
1. Logs a warning
2. Falls back to the OS-reported primary display
3. Notifies operator via UI alert

---

## 4. Session Management

### 4.1 Persistent vs. Ephemeral Sessions

Each URL instance uses one of two session modes:

**Persistent Session**:
- Uses Electron's persistent session profile (named profile, stored on disk)
- Cookies, localStorage, indexedDB, session storage all preserved across reloads
- Auth tokens and login state persist
- User remains logged in across reloads and app restarts
- Useful for: Slido, custom apps with user auth, pages that retain user state
- Profile path: `~/.pconair/sessions/persistent/[show-name]/`

**Ephemeral Session**:
- Uses a temporary, in-memory session context
- No disk persistence; all state cleared on reload or app restart
- User sees "logged out" view; no cookies or auth retained
- Useful for: Demo pages, pages that cache stale data locally, reset-state scenarios
- Context is destroyed when instance is cleared or reloaded

### 4.2 Session Selection

**Default**: Admin sets a default session mode in `/admin` settings (persistent or ephemeral)

**Override at load time**: Operator can override the default when loading a URL:
- "Load with persistent session" (uses stored cookies/auth)
- "Load with ephemeral session" (clean browser context)

**Per-instance**: Session mode is stored per-instance (A or B). Instance A can use persistent; Instance B can use ephemeral.

### 4.3 Login Workflow

**Scenario**: Admin needs to log into Slido before the show, so operators can use the logged-in view during the event.

**Steps**:

1. Admin opens the "Session Login" window from `/admin` UI (menu option: "Session Management" > "Login to Persistent Session")
2. A visible browser window opens (not fullscreen Program output, but an admin-only window)
3. User navigates to the URL to log in (e.g., slido.com) and enters credentials
4. Login is complete; cookies are stored in the persistent session profile
5. Admin closes the login window
6. Operator later loads Slido (e.g., from preset) in URL Mode with persistent session
7. Slido loads already logged in (cookies restore login state)

**Login window**:
- Not the Program output window (separate, visible window)
- Shows address bar, navigation controls, and browser UI
- Admin can navigate, log in, configure, etc.
- Cookies/state stored to the persistent session profile
- Supports opening multiple login windows for different sessions

**Day-before-show checklist items**:
- [ ] Log into Slido in persistent session (verify account, permissions, event settings)
- [ ] Log into any other URLs requiring authentication
- [ ] Refresh all persistent sessions (optional, but recommended to ensure freshness)
- [ ] Test loading all URL presets; verify they display correctly
- [ ] Verify display connections and default Program output display setting
- [ ] Confirm URL presets load on correct displays

### 4.4 Session Refresh

**Refresh semantics**:
- Reloading a URL does not clear the session (persistent sessions keep cookies)
- Reloading a URL does reload the page content (fresh HTML, CSS, JS)
- Useful for: Refreshing Slido questions, reloading live dashboards, etc.

**Hard refresh**:
- Hard refresh (Ctrl+Shift+R or API call) clears the Chromium cache for that URL
- Useful for: Forcing fresh JS bundle if code was updated, recovering from stale page state
- Does not clear persistent session cookies

---

## 5. URL Presets

### 5.1 Data Model

```typescript
interface UrlPreset {
  id: string;                    // Unique identifier (UUID or sequential integer)
  name: string;                  // Human-readable label (100 chars max)
  url: string;                   // Valid http/https URL
  displayTarget?: string | null; // Optional display ID or "primary" (null = use default)
  sessionMode: "persistent" | "ephemeral"; // Session mode for this preset
  description?: string;          // Optional description (500 chars max)
  createdAt: string;             // ISO 8601 timestamp (UTC)
  updatedAt: string;             // ISO 8601 timestamp (UTC)
}

interface ShowProfile {
  // ... (other profile fields from spec 05)
  urlPresets: UrlPreset[];       // Array of URL presets for this show
}
```

### 5.2 Admin CRUD Operations

All preset management is admin-only (`/admin` route).

**Create preset**:
- Form with fields: Name (required), URL (required), Display Target (optional), Session Mode (required), Description (optional)
- Validate URL (must be valid http/https)
- Validate name (non-empty, unique within show, ≤ 100 chars)
- On save, generate unique ID, set timestamps
- Preset stored in active show profile

**Read presets**:
- Admin sees list of all presets for active show
- Shows: preset name, URL (truncated), target display, session mode
- Can sort by name, creation date, or last updated

**Update preset**:
- Admin clicks "Edit" on a preset
- Form pre-filled with current values
- Admin modifies any fields
- On save, update preset, update `updatedAt` timestamp
- Changes take effect immediately (no app restart needed)

**Delete preset**:
- Admin clicks "Delete" on a preset
- Confirmation dialog ("Delete preset 'Slido — Conference 2025'?")
- On confirm, remove preset from list
- Already-loaded instances using this preset are unaffected (preset is just a named configuration)

### 5.3 Operator Access

Operators can load but not manage presets.

**Operator Web UI** (`/operator`):
- Preset dropdown: list of all presets for active show
- Load button: loads selected preset into off-air instance
- Display: currently-loaded preset name (if loaded from preset, not direct URL)

**Companion action** (see **Companion Actions** below):
- "Load URL Preset": select preset by name or ID
- Preset is loaded with preset-configured display target and session mode

---

## 6. Refresh and Reload Mechanics

### 6.1 Reload Types

Three types of reload available to operators:

#### **Soft Reload** (Standard Reload)
- Reloads the page (GET request to URL)
- Preserves persistent session (cookies remain)
- Preserves scroll position, form state, etc. (if page supports)
- Clears in-memory caches (JavaScript, images, etc.)
- Typical use: Refresh Slido questions, refresh live dashboard, etc.

#### **Reload Off-Air Instance**
- Reloads the non-active instance (A or B) while the other stays on-air
- No visible disruption to on-air content
- Safe workflow: reload off-air, test, then switch
- Typical use: Prepare next URL while current one is live

#### **Hard Refresh** (Full Reload / Cache Clear)
- Performs a full page reload with cache bypass (Ctrl+Shift+R equivalent)
- Clears browser HTTP cache for this URL (Chromium disk cache)
- Reloads all resources (HTML, CSS, JS, images) from server
- Preserves persistent session (cookies remain)
- Use when: Page is unresponsive, stale JS causing issues, CSS changes need to appear immediately
- May cause brief flash/delay due to fresh resource fetch

### 6.2 Reload Button UI

**Operator controls** (`/operator`):
- "Reload On-Air": Reload the active (on-air) instance (use with caution; brief flash visible)
- "Reload Off-Air": Reload the inactive (off-air) instance (safe; no visible impact)
- "Hard Refresh": Full cache clear and reload of active instance

**Keyboard shortcuts** (optional, can be added):
- `R`: Reload on-air instance
- `Shift+R`: Reload off-air instance
- `Ctrl+Shift+R`: Hard refresh on-air instance

### 6.3 Refresh API Endpoints

See **API Surface** below.

---

## 7. API Surface

All endpoints return JSON. URLs in request/response bodies are validated (must be http/https).

### 7.1 URL Mode Endpoints

#### `POST /api/url/load`
Load a URL into the off-air instance.

**Request**:
```json
{
  "url": "https://slido.com/event/abc123",
  "displayTarget": "HDMI-1",           // Optional; defaults to admin-configured default
  "sessionMode": "persistent",         // Optional; defaults to admin-configured default
  "instance": "B"                      // Optional; auto-select off-air if omitted
}
```

**Validation**:
- `url` must be valid http/https URL
- `displayTarget` must match a connected display ID or "primary"
- `sessionMode` must be "persistent" or "ephemeral"
- `instance` must be "A", "B", or omitted

**Response (200 OK)**:
```json
{
  "success": true,
  "message": "URL loaded into instance B",
  "instance": "B",
  "url": "https://slido.com/event/abc123",
  "displayTarget": "HDMI-1",
  "sessionMode": "persistent"
}
```

**Response (400 Bad Request)**:
```json
{
  "success": false,
  "error": "Invalid URL: must start with http:// or https://"
}
```

---

#### `POST /api/url/preset/load`
Load a URL preset (by ID or name) into the off-air instance.

**Request**:
```json
{
  "presetId": "preset-001",            // OR "presetName": "Slido — Conference 2025"
  "overrideDisplayTarget": "HDMI-2"    // Optional; overrides preset's display target
}
```

**Response (200 OK)**:
```json
{
  "success": true,
  "message": "Preset loaded into instance A",
  "instance": "A",
  "preset": {
    "id": "preset-001",
    "name": "Slido — Conference 2025",
    "url": "https://slido.com/event/abc123",
    "displayTarget": "HDMI-1"
  }
}
```

---

#### `GET /api/url/presets`
List all URL presets for the active show.

**Response (200 OK)**:
```json
{
  "presets": [
    {
      "id": "preset-001",
      "name": "Slido — Conference 2025",
      "url": "https://slido.com/event/abc123",
      "displayTarget": "HDMI-1",
      "sessionMode": "persistent",
      "description": "Q&A for main stage",
      "createdAt": "2026-05-01T10:00:00Z",
      "updatedAt": "2026-05-01T10:00:00Z"
    },
    {
      "id": "preset-002",
      "name": "Sponsor Page",
      "url": "https://sponsors.example.com",
      "displayTarget": "primary",
      "sessionMode": "ephemeral",
      "createdAt": "2026-05-01T11:00:00Z",
      "updatedAt": "2026-05-01T11:00:00Z"
    }
  ]
}
```

---

#### `POST /api/url/reload`
Reload a URL instance.

**Request**:
```json
{
  "instance": "A",           // Which instance to reload (A or B)
  "hard": false              // Optional; true for hard refresh (cache clear)
}
```

**Response (200 OK)**:
```json
{
  "success": true,
  "message": "Instance A reloaded",
  "instance": "A",
  "hard": false
}
```

---

#### `POST /api/url/switch`
Switch active (on-air) instance between A and B.

**Request**:
```json
{
  "instance": "B"  // Which instance to make active
}
```

**Response (200 OK)**:
```json
{
  "success": true,
  "message": "Switched to instance B",
  "activeInstance": "B"
}
```

---

#### `POST /api/url/clear`
Clear the current URL and return to idle mode.

**Request**: (empty body or null)

**Response (200 OK)**:
```json
{
  "success": true,
  "message": "URL cleared; mode set to idle"
}
```

---

### 7.2 Display Endpoints

#### `GET /api/displays`
List all connected displays.

**Response (200 OK)**:
```json
{
  "displays": [
    {
      "id": "display-1",
      "name": "Built-in Retina Display",
      "width": 2880,
      "height": 1800,
      "isPrimary": true,
      "refreshRate": 60
    },
    {
      "id": "display-2",
      "name": "DELL U2720Q",
      "width": 2560,
      "height": 1440,
      "isPrimary": false,
      "refreshRate": 60
    }
  ]
}
```

---

### 7.3 Admin URL Preset Endpoints

> **Note:** The canonical URL preset endpoint paths are defined in `02-api-state-contract.md`, Section 2.8. All implementations must use those paths. This section documents the request/response details specific to URL mode's richer preset model.

All admin endpoints require admin PIN authentication.

#### `GET /api/presets`
List all URL presets. (Canonical path from spec 02.)

See `02-api-state-contract.md`, Section 2.8 for base definition. The response includes the full URL mode preset shape:

```json
{
  "presets": [
    {
      "id": "preset-001",
      "name": "Slido — Conference 2025",
      "url": "https://slido.com/event/abc123",
      "displayTarget": "HDMI-1",
      "sessionMode": "persistent",
      "description": "Q&A for main stage",
      "createdAt": "2026-05-11T12:00:00Z",
      "updatedAt": "2026-05-11T12:00:00Z"
    }
  ]
}
```

---

#### `POST /api/presets`
Create a new URL preset. (Canonical path from spec 02.)

**Request**:
```json
{
  "name": "Slido — Conference 2025",
  "url": "https://slido.com/event/abc123",
  "displayTarget": "HDMI-1",
  "sessionMode": "persistent",
  "description": "Q&A for main stage"
}
```

**Response (201 Created)**:
```json
{
  "id": "preset-001",
  "name": "Slido — Conference 2025",
  "url": "https://slido.com/event/abc123",
  "displayTarget": "HDMI-1",
  "sessionMode": "persistent",
  "description": "Q&A for main stage",
  "createdAt": "2026-05-11T12:00:00Z",
  "updatedAt": "2026-05-11T12:00:00Z"
}
```

---

#### `DELETE /api/presets/:id`
Delete a preset. (Canonical path from spec 02.)

**Response (204 No Content)**

---

#### `GET /api/admin/url/sessions`
List all available persistent sessions (for login window management).

**Response (200 OK)**:
```json
{
  "sessions": [
    {
      "id": "persistent-show-abc",
      "name": "Show ABC Persistent Session",
      "createdAt": "2026-05-01T10:00:00Z",
      "lastUsed": "2026-05-11T11:00:00Z"
    }
  ]
}
```

---

#### `POST /api/admin/url/session/login-window`
Open a login window for a persistent session.

**Request**:
```json
{
  "sessionId": "persistent-show-abc",
  "initialUrl": "https://slido.com"  // Optional; pre-fill address bar
}
```

**Response (200 OK)**:
```json
{
  "success": true,
  "message": "Login window opened",
  "windowId": "login-window-001"
}
```

---

### 7.4 WebSocket Events

The WebSocket event stream includes URL mode state changes.

**Event: `url-loading`**
```json
{
  "type": "url-loading",
  "instance": "B",
  "url": "https://slido.com/event/abc123"
}
```

**Event: `url-ready`**
```json
{
  "type": "url-ready",
  "instance": "B",
  "url": "https://slido.com/event/abc123"
}
```

**Event: `url-error`**
```json
{
  "type": "url-error",
  "instance": "A",
  "url": "https://slido.com/event/abc123",
  "error": "Failed to load URL: ERR_NAME_NOT_RESOLVED"
}
```

**Event: `instance-switched`**
```json
{
  "type": "instance-switched",
  "activeInstance": "B"
}
```

**Event: `displays-changed`**
```json
{
  "type": "displays-changed",
  "displays": [
    { "id": "display-1", "name": "Built-in", "isPrimary": true, ... },
    { "id": "display-2", "name": "HDMI-1", "isPrimary": false, ... }
  ]
}
```

---

## 8. Companion Actions and Variables

### 8.1 Companion Actions

The Bitfocus Companion module for PC On Air includes the following URL mode-specific actions:

#### **Load URL**
Load an arbitrary URL on specified display.

**Parameters**:
- `url` (required): URL to load
- `displayTarget` (optional, supports variables): Display ID or "primary"
- `sessionMode` (optional): "persistent" or "ephemeral"

**Example button command**:
```
Load URL https://slido.com/event/abc123 on display $(default_display)
Load URL https://twitter.com/search?q=$(event_hashtag) on display HDMI-1 with ephemeral session
```

---

#### **Load URL Preset**
Load a preset by name or ID.

**Parameters**:
- `presetId` or `presetName` (required): Preset identifier
- `overrideDisplayTarget` (optional, supports variables): Override preset's target display

**Example button command**:
```
Load preset: Slido — Conference 2025
Load preset: Sponsor Page on display HDMI-2
```

---

#### **Reload Active Instance**
Reload the on-air URL instance.

**Parameters**:
- `hard` (optional): true for hard refresh (cache clear)

---

#### **Reload Off-Air Instance**
Reload the off-air URL instance (safe; no on-air impact).

**Parameters**: None

---

#### **Switch A/B Instance**
Switch to the other instance (toggle active/inactive).

**Parameters**: None

---

### 8.2 Companion Variables

The module exposes the following variables for button feedback and text display:

- `current_url`: Currently on-air URL (or empty if idle)
- `current_preset_name`: Name of currently-loaded preset (or "None" if loaded directly)
- `active_instance`: "A" or "B"
- `target_display`: Display ID or name of on-air instance
- `instance_a_url`: URL in instance A (or empty if none)
- `instance_b_url`: URL in instance B (or empty if none)
- `displays_list`: Comma-separated list of connected displays (for buttons)

### 8.3 Example Companion Setup

**Scenario**: Operator has a Slido button and a sponsor page button on their Companion control surface.

**Button 1: Slido Q&A**
- Action: Load URL Preset "Slido — Conference 2025"
- Feedback (text): Shows current URL
- Feedback (color): Green when loaded, red when loading

**Button 2: Sponsor Page**
- Action: Load URL Preset "Sponsor Page"
- Feedback (text): Shows current URL
- Feedback (color): Green when loaded, red when loading

**Button 3: A/B Toggle**
- Action: Switch A/B Instance
- Feedback (color): Bright when Instance B active, dim when Instance A active
- Feedback (text): Shows "A" or "B"

**Button 4: Reload**
- Action: Reload Active Instance
- Feedback (color): Red while loading, green when ready
- Feedback (text): Shows URL being loaded

---

## 9. URL Validation and Error Handling

### 9.1 URL Validation Rules

1. **Format**: Must be valid http:// or https:// URL
2. **Non-empty**: URL cannot be empty or whitespace
3. **Scheme required**: Must include http:// or https:// prefix
4. **No spaces**: URL must not contain unencoded spaces (space must be %20)
5. **Valid hostname**: Domain must resolve or be a valid IP address

**Validation errors** (returned in response):
```json
{
  "success": false,
  "error": "Invalid URL: missing http:// or https:// scheme"
}
```

### 9.2 HTTPS Warning

Non-HTTPS URLs are allowed but flagged:
- Operator UI shows warning icon next to URL
- Warning message: "This URL uses HTTP (not HTTPS). Consider using HTTPS for security."
- Log entry: `[WARN] URL loaded with HTTP scheme: https://...`
- Does not block loading; operator can dismiss and continue

### 9.3 Loading Errors

If a URL fails to load (network error, DNS failure, timeout, invalid certificate):

**Error event (WebSocket)**:
```json
{
  "type": "url-error",
  "instance": "B",
  "url": "https://slido.com/event/abc123",
  "error": "Net::ERR_NAME_NOT_RESOLVED",
  "timestamp": "2026-05-11T12:00:00Z"
}
```

**Error handling**:
- Instance remains in `isLoading: false`, `isReady: false` state
- Operator sees error message in UI ("Failed to load URL")
- Operator can retry loading or try a different URL
- Existing on-air content (from other instance) continues unaffected

### 9.4 Timeout Handling

URL loading times out after 10 seconds (configurable):
- If URL does not reach DOM ready state within timeout, loading fails
- Error event sent to clients
- Operator can retry (recommended after 2-3 seconds)

---

## 10. Day-Before-Show Checklist

Operators and admins should perform these tasks before a live event:

### Admin Tasks
- [ ] Configure default Program output display in `/admin` (matches physical HDMI cable/output)
- [ ] Create or import URL presets for all URLs to be used (Slido, sponsor page, dashboards, etc.)
- [ ] Log into each URL that requires authentication (Slido, custom dashboards, etc.) using Session Login window
- [ ] Verify persistent sessions are saved (check logged-in state)
- [ ] Verify all URL presets load correctly and display on expected displays
- [ ] Test A/B switching and refresh workflows with at least one preset
- [ ] Confirm all connected displays appear in `/api/displays` list
- [ ] Test Bitfocus Companion integration (if in use): verify URL load actions work

### Operator Tasks
- [ ] Verify all displays are connected and functional
- [ ] Test loading one or more URL presets from Web UI
- [ ] Test switching between A/B instances
- [ ] Test reloading off-air instance (verify on-air instance unchanged)
- [ ] Verify Slido is logged in (if used in event)
- [ ] Test Companion control surface buttons (if in use)
- [ ] Confirm operator Web UI is responsive and accessible
- [ ] Review preset list and familiarize with preset names and order

---

## 11. Implementation Notes

### 11.1 Electron Integration

**Session Management**:
- Persistent sessions use Electron `session.defaultSession` and named session objects (`session.fromPartition()`)
- Each show has a separate persistent session directory: `~/.pconair/sessions/persistent/[show-name]/`
- Ephemeral sessions use in-memory session contexts (no disk storage)

**Display Enumeration**:
- Use Electron `screen` module to enumerate displays at startup
- Listen for `display-added`, `display-removed`, `display-metrics-changed` events
- Update app state and broadcast to all WebSocket clients

**Program Output Windows**:
- Each display target has an independent Electron `BrowserWindow`
- Windows are created on-demand when URL is loaded with that target display
- Window is hidden/shown based on A/B instance active state
- Window is closed when URL is cleared or display is disconnected

### 11.2 Rendering and Keying

All URL content is rendered with the configured luma key background (or solid background):
- URL is rendered within an Electron webview or BrowserWindow
- Background color (luma or solid) is set on the surrounding frame
- Content is rendered on top of background

### 11.3 Cookie and Session Storage

Persistent sessions store cookies in:
- `~/.pconair/sessions/persistent/[show-name]/Cookies` (SQLite database)
- `~/.pconair/sessions/persistent/[show-name]/Local Storage/` (IndexedDB-like files)
- `~/.pconair/sessions/persistent/[show-name]/Service Workers/` (Service Worker cache)

Ephemeral sessions use in-memory storage only (cleared on reload or app restart).

### 11.4 Performance Considerations

- Multiple displays with active URLs: each display runs an independent renderer (CPU/GPU load increases with each active display)
- URL presets with session login: persistent sessions can be heavy if many URLs are logged in; recommend limiting to <10 concurrent sessions
- Refresh operations: off-air refresh is non-blocking; on-air refresh may cause brief frame drop (500ms–2s depending on URL complexity and network)

---

## 12. Acceptance Criteria

This section provides a testable checklist for URL Mode and multi-display routing acceptance.

### 12.1 URL Loading

- [ ] **AC 1.1**: Operator can load a valid HTTPS URL via Web UI; URL displays on Program output
- [ ] **AC 1.2**: Operator can load a valid HTTP URL (with warning shown) via Web UI
- [ ] **AC 1.3**: Invalid URLs (missing scheme, malformed) are rejected with error message
- [ ] **AC 1.4**: Non-HTTPS URLs show warning icon in operator UI
- [ ] **AC 1.5**: Loading URL puts instance into `isLoading: true` state; `isReady: true` when DOM ready
- [ ] **AC 1.6**: URL is loaded into off-air instance (not active instance)

### 12.2 URL Presets

- [ ] **AC 2.1**: Admin can create a URL preset with name, URL, display target, session mode
- [ ] **AC 2.2**: Admin can edit an existing preset (any field)
- [ ] **AC 2.3**: Admin can delete a preset (with confirmation)
- [ ] **AC 2.4**: Operator can load a preset from Web UI (appears in dropdown)
- [ ] **AC 2.5**: Preset loads with preset-configured display target
- [ ] **AC 2.6**: Preset loads with preset-configured session mode
- [ ] **AC 2.7**: Operator can override preset's display target at load time
- [ ] **AC 2.8**: Presets are stored in show profile and exported/imported with bundle
- [ ] **AC 2.9**: Currently-loaded preset name is displayed in operator UI (if loaded from preset)

### 12.3 A/B Dual-Instance

- [ ] **AC 3.1**: URL mode supports A/B dual instances (like Slides mode)
- [ ] **AC 3.2**: Instance A and B can hold different URLs independently
- [ ] **AC 3.3**: Instance A and B can have different display targets
- [ ] **AC 3.4**: Instance A and B can have different session modes
- [ ] **AC 3.5**: Only one instance is active (on-air) at a time
- [ ] **AC 3.6**: Switching A/B toggle changes active instance immediately
- [ ] **AC 3.7**: Switching A/B does not lose state in off-air instance
- [ ] **AC 3.8**: Loading a new URL into off-air instance does not interrupt on-air instance
- [ ] **AC 3.9**: Refreshing off-air instance does not interrupt on-air instance

### 12.4 Session Management

- [ ] **AC 4.1**: Persistent session option preserves cookies across reloads
- [ ] **AC 4.2**: Ephemeral session option uses clean browser context (no cookies)
- [ ] **AC 4.3**: Login window opens for admin to log into URLs
- [ ] **AC 4.4**: Login window is separate from Program output window (not fullscreen)
- [ ] **AC 4.5**: Cookies from login window are saved to persistent session
- [ ] **AC 4.6**: Operator can load URL with persistent session and see logged-in state
- [ ] **AC 4.7**: Admin can override default session mode at load time

### 12.5 Multi-Display Routing

- [ ] **AC 5.1**: `GET /api/displays` returns list of connected displays
- [ ] **AC 5.2**: Each display has id, name, width, height, isPrimary, refreshRate
- [ ] **AC 5.3**: Exactly one display has `isPrimary: true`
- [ ] **AC 5.4**: Operator can select target display when loading URL
- [ ] **AC 5.5**: URL loads on the specified target display
- [ ] **AC 5.6**: Multiple displays can show different content simultaneously
- [ ] **AC 5.7**: Changing slides on Display 1 does not affect Display 2
- [ ] **AC 5.8**: Admin can configure default Program output display in `/admin`
- [ ] **AC 5.9**: URL loads on default display if no target display specified
- [ ] **AC 5.10**: Operator Web UI shows display list with current content per display
- [ ] **AC 5.11**: URL preset can have optional default display target
- [ ] **AC 5.12**: Preset with no display target uses admin-configured default

### 12.6 Refresh and Reload

- [ ] **AC 6.1**: "Reload On-Air" button reloads active instance URL (may show brief flash)
- [ ] **AC 6.2**: "Reload Off-Air" button reloads inactive instance without interrupting on-air
- [ ] **AC 6.3**: "Hard Refresh" clears Chromium cache and reloads page
- [ ] **AC 6.4**: Reload preserves persistent session cookies
- [ ] **AC 6.5**: Hard refresh does not clear persistent session cookies
- [ ] **AC 6.6**: Reload can be triggered via Web UI button
- [ ] **AC 6.7**: Reload can be triggered via HTTP API (`POST /api/url/reload`)
- [ ] **AC 6.8**: Reload can be triggered via Companion action

### 12.7 API Endpoints

- [ ] **AC 7.1**: `POST /api/url/load` loads URL with validation
- [ ] **AC 7.2**: `POST /api/url/preset/load` loads preset by ID or name
- [ ] **AC 7.3**: `GET /api/url/presets` returns all presets for active show
- [ ] **AC 7.4**: `POST /api/url/reload` reloads instance (soft or hard)
- [ ] **AC 7.5**: `POST /api/url/switch` switches active instance
- [ ] **AC 7.6**: `POST /api/url/clear` clears URL and sets mode to idle
- [ ] **AC 7.7**: `GET /api/displays` returns display list
- [ ] **AC 7.8**: Admin endpoints require admin PIN authentication
- [ ] **AC 7.9**: All API responses include proper error handling (4xx/5xx codes)

### 12.8 WebSocket Events

- [ ] **AC 8.1**: WebSocket emits `url-loading` event when URL starts loading
- [ ] **AC 8.2**: WebSocket emits `url-ready` event when URL is ready
- [ ] **AC 8.3**: WebSocket emits `url-error` event on load failure
- [ ] **AC 8.4**: WebSocket emits `instance-switched` event when A/B toggles
- [ ] **AC 8.5**: WebSocket emits `displays-changed` event when display list changes

### 12.9 Companion Integration

- [ ] **AC 9.1**: Companion action "Load URL" loads URL with optional display target
- [ ] **AC 9.2**: Companion action "Load URL Preset" loads preset by name/ID
- [ ] **AC 9.3**: Companion action "Reload Active Instance" reloads on-air URL
- [ ] **AC 9.4**: Companion action "Reload Off-Air Instance" reloads off-air URL
- [ ] **AC 9.5**: Companion action "Switch A/B Instance" toggles active instance
- [ ] **AC 9.6**: Companion variables include `current_url`, `current_preset_name`, `active_instance`, `target_display`
- [ ] **AC 9.7**: Companion buttons show correct feedback (color, text) based on state
- [ ] **AC 9.8**: Companion variables support Companion substitutions (e.g., `$(event_hashtag)`)

### 12.10 Error Handling

- [ ] **AC 10.1**: Invalid URL format is rejected before loading
- [ ] **AC 10.2**: URL that fails to load (network error) triggers error event and message
- [ ] **AC 10.3**: Operator can retry loading failed URL
- [ ] **AC 10.4**: Failed load does not interrupt existing on-air content
- [ ] **AC 10.5**: Timeout after 10 seconds if URL does not respond
- [ ] **AC 10.6**: Disconnected display triggers fallback to default display

### 12.11 Day-Before-Show Checklist

- [ ] **AC 11.1**: Admin can log into Slido and persist login across reloads
- [ ] **AC 11.2**: Operator can verify all URL presets load correctly
- [ ] **AC 11.3**: All connected displays appear in display list and can be targeted
- [ ] **AC 11.4**: Bitfocus Companion actions work (if in use)
- [ ] **AC 11.5**: Default Program output display is correctly configured and functional

---

## 13. Out-of-Scope (v1)

The following features are explicitly deferred to v2 or later:

- **QR code scanning** for URL intake (v2)
- **URL content screenshot capture** for preview thumbnails (v2)
- **Proxy/VPN support** for accessing restricted URLs (v2)
- **Custom user-agent** configuration per URL (v2)
- **SSL certificate pinning** for security-critical URLs (v2)
- **Headless browser rendering** for performance optimization (v2)
- **URL rewrite rules** for URL substitution (v2)
- **Content filtering** (ad blocking, cookie consent popup auto-dismiss) (v2)

---

## 14. References

- **Spec 01**: Source of Truth (product definition, in-scope features)
- **Spec 02**: API State Contract (app state model, HTTP/WebSocket API contract)
- **Spec 03**: Slides Parity Inventory (A/B dual-instance model, refresh workflows)
- **Spec 05**: Profiles, Bundles, Backups (show profile storage, export/import)
- **Spec 07**: Bitfocus Companion Integration (Companion action/variable model)
- **Electron Screen API**: https://www.electronjs.org/docs/api/screen
- **Electron Session API**: https://www.electronjs.org/docs/api/session
