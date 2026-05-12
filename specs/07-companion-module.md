# PC On Air – Bitfocus Companion Module Specification

## 1. Overview

The PC On Air Companion module extends Bitfocus Companion, a widely-used hardware and software button controller for live event production, to control PC On Air — an Electron-based live event playout application.

**What it enables:**
- **Live operators** can trigger deck loads, slide navigation, URL playback, and lower third cues from physical or virtual Companion button panels
- **Real-time feedback** showing current mode, slide position, active cue names, and connection state
- **Preset buttons** that operators can instantly drop into their layouts for common tasks (next slide, take lower third, switch A/B instances)
- **Multi-display support** allowing operators to target specific displays when multiple are connected

**Typical live show workflow:**
1. Operator loads PC On Air Companion module and configures PC On Air host/port
2. Operator builds a button layout in Companion (using presets and custom actions)
3. During the show, operator clicks buttons to:
   - Load and navigate slides
   - Switch between URL and Slides modes
   - Trigger lower third animations
   - Switch between A/B playback instances
4. Button feedback (colors, text, indicators) updates in real-time, showing current state

---

## 2. Connection and Authentication

### WebSocket Connection (Primary)

The module connects to PC On Air via WebSocket at:
```
ws://<host>:<port>/ws
```

**Connection flow:**
1. Companion opens WebSocket to the configured host/port
2. Module sends operator PIN as authentication (if required by PC On Air)
3. On connection, PC On Air sends full state snapshot
4. Module subscribes to state change events
5. On disconnect, module initiates automatic reconnection

**WebSocket message format** (example):
```json
{
  "type": "action",
  "action_id": "slides_next",
  "params": {}
}
```

### HTTP Polling Fallback

If WebSocket is unavailable (firewall, network config), the module falls back to polling:
```
GET http://<host>:<port>/api/status
```

**Polling behavior:**
- Poll interval: configurable (default: 2000ms, minimum: 500ms)
- Responses include full current state (mode, active slide, URL, lower thirds, etc.)
- Actions still use HTTP POST to the same endpoint

**HTTP action endpoint:**
```
POST http://<host>:<port>/api/action
Content-Type: application/json

{
  "action_id": "slides_next",
  "params": {}
}
```

### Authentication

**Operator PIN header/query param:**
- If PC On Air requires authentication, the module sends the operator PIN on WebSocket connect or with every HTTP request
- **HTTP:** Add as query parameter: `?operator_pin=<pin>`
- **WebSocket:** Send as authentication frame or first message

**Access level:** Operator-level access is sufficient for all Companion actions (no admin-level operations).

---

## 3. Module Configuration

Users configure the following in Companion's module settings panel:

| Parameter | Type | Default | Required | Description |
|-----------|------|---------|----------|-------------|
| `host` | Text | `localhost` | No | IP address or hostname of PC On Air machine |
| `port` | Number | `8080` | No | Port on which PC On Air WebSocket/HTTP API listens |
| `operator_pin` | Text | (empty) | No | PIN for operator-level authentication (if PC On Air requires auth) |
| `polling_interval_ms` | Number | `2000` | No | HTTP polling interval in milliseconds (fallback mode); minimum 500ms |

---

## 4. Actions

Each action is invoked by the operator clicking a button or via Companion command syntax. Actions support **Companion variable substitution** in text inputs (e.g., `$(instance:url_preset_name)`).

### 4.1 URL Mode Actions

#### `load_url`
- **Label:** Load URL
- **Inputs:**
  - `url` (Text, required) — URL to load; supports Companion variables
  - `display` (Text, optional) — Target display name or ID; supports Companion variables
  - `session_mode` (Dropdown: "persistent" | "ephemeral"; default: "persistent") — Whether to restore position on subsequent loads
- **HTTP Call:** `POST /api/action` with body `{ "action_id": "load_url", "params": { "url": "...", "display": "...", "session_mode": "persistent" } }`
- **Use case:** Load a live URL, website, or HTML presentation mid-show

#### `load_url_preset`
- **Label:** Load URL Preset
- **Inputs:**
  - `preset` (Text, required) — Preset ID or name; supports Companion variables
  - `display` (Text, optional) — Target display name or ID; supports Companion variables
- **HTTP Call:** `POST /api/action` with body `{ "action_id": "load_url_preset", "params": { "preset": "...", "display": "..." } }`
- **Use case:** Load a pre-configured URL (e.g., "Sponsor 1", "Live Chat") without typing the full URL

#### `reload_url`
- **Label:** Reload Current URL (On-Air)
- **Inputs:** (none)
- **HTTP Call:** `POST /api/action` with body `{ "action_id": "reload_url", "params": {} }`
- **Use case:** Refresh the active URL instance (e.g., reload a live scoreboard)

#### `reload_url_offair`
- **Label:** Reload Current URL (Off-Air)
- **Inputs:** (none)
- **HTTP Call:** `POST /api/action` with body `{ "action_id": "reload_url_offair", "params": {} }`
- **Use case:** Refresh the off-air URL instance while another display is live

#### `url_switch_ab`
- **Label:** Switch URL Instance (A ↔ B)
- **Inputs:** (none)
- **HTTP Call:** `POST /api/action` with body `{ "action_id": "url_switch_ab", "params": {} }`
- **Use case:** Flip between two prepared URLs without clicking a dropdown

#### `url_switch_to`
- **Label:** Switch URL Instance To…
- **Inputs:**
  - `instance` (Dropdown: "A" | "B"; required)
- **HTTP Call:** `POST /api/action` with body `{ "action_id": "url_switch_to", "params": { "instance": "A" } }`
- **Use case:** Explicitly switch to a specific instance (useful for triggering transition animations)

---

### 4.2 Slides Mode Actions

#### `slides_next`
- **Label:** Next Slide
- **Inputs:** (none)
- **HTTP Call:** `POST /api/action` with body `{ "action_id": "slides_next", "params": {} }`
- **Use case:** Advance to the next slide

#### `slides_prev`
- **Label:** Previous Slide
- **Inputs:** (none)
- **HTTP Call:** `POST /api/action` with body `{ "action_id": "slides_prev", "params": {} }`
- **Use case:** Go back to the previous slide

#### `slides_goto`
- **Label:** Go to Slide…
- **Inputs:**
  - `slide_number` (Number, required) — Slide number (**1-based**; e.g., `1` = first slide, `5` = fifth slide); supports Companion variables
- **HTTP Call:** `POST /api/action` with body `{ "action_id": "slides_goto", "params": { "slide_number": 5 } }`
- **Use case:** Jump directly to a specific slide (e.g., Q&A slide near the end)
- **Index conversion:** `slide_number` is 1-based (human-friendly for operators). The server or module adapter **subtracts 1** before calling `POST /api/slides/goto` (which expects a 0-based `slideIndex`). E.g., `slide_number: 1` → `slideIndex: 0`.

#### `slides_load`
- **Label:** Load Slides Deck
- **Inputs:**
  - `deck_url` (Text, required) — URL of Slides deck (Google Slides link, local file path, etc.); supports Companion variables
  - `instance` (Dropdown: "A" | "B" | "active"; default: "active") — Which A/B instance to load into
- **HTTP Call:** `POST /api/action` with body `{ "action_id": "slides_load", "params": { "deck_url": "...", "instance": "active" } }`
- **Use case:** Load a new presentation deck at any point

#### `slides_reload`
- **Label:** Reload Slides (Keep Position)
- **Inputs:**
  - `instance` (Dropdown: "A" | "B" | "active"; default: "active")
- **HTTP Call:** `POST /api/action` with body `{ "action_id": "slides_reload", "params": { "instance": "active" } }`
- **Use case:** Refresh a deck without resetting to slide 1 (e.g., if content updated)

#### `slides_switch_ab`
- **Label:** Switch Slides Instance (A ↔ B)
- **Inputs:** (none)
- **HTTP Call:** `POST /api/action` with body `{ "action_id": "slides_switch_ab", "params": {} }`
- **Use case:** Switch between two prepared decks

---

### 4.3 Lower Third Actions

#### `l3_take`
- **Label:** Take Lower Third Cue
- **Inputs:**
  - `cue_id` (Text, required) — Cue ID or name from the lower thirds database; supports Companion variables
  - `name` (Text, optional) — Override the cue's preset name; supports Companion variables
  - `title` (Text, optional) — Override the cue's preset title; supports Companion variables
  - `theme` (Text, optional) — Override the cue's preset theme; supports Companion variables
- **HTTP Call:** `POST /api/action` with body `{ "action_id": "l3_take", "params": { "cue_id": "speaker_1", "name": "Jane Smith", "title": "Lead Designer", "theme": "default" } }`
- **Use case:** Trigger a pre-configured lower third with optional live overrides (e.g., different speaker name)

#### `l3_clear`
- **Label:** Clear Lower Third
- **Inputs:** (none)
- **HTTP Call:** `POST /api/action` with body `{ "action_id": "l3_clear", "params": {} }`
- **Use case:** Remove the currently displayed lower third

#### `l3_stacking_on`
- **Label:** Enable Lower Third Stacking
- **Inputs:** (none)
- **HTTP Call:** `POST /api/action` with body `{ "action_id": "l3_stacking_on", "params": {} }`
- **Use case:** Allow multiple lower thirds to appear on-screen simultaneously

#### `l3_stacking_off`
- **Label:** Disable Lower Third Stacking
- **Inputs:** (none)
- **HTTP Call:** `POST /api/action` with body `{ "action_id": "l3_stacking_off", "params": {} }`
- **Use case:** Revert to single-lower-third mode (new cues replace the old one)

---

### 4.4 A/B and Display Control

#### `ab_switch`
- **Label:** Switch Active A/B Instance (Current Mode)
- **Inputs:** (none)
- **HTTP Call:** `POST /api/action` with body `{ "action_id": "ab_switch", "params": {} }`
- **Use case:** Flip the active A/B instance for whichever mode is currently running (Slides or URL)

#### `set_display`
- **Label:** Set Target Display
- **Inputs:**
  - `display` (Text, required) — Display name or ID; supports Companion variables
- **HTTP Call:** `POST /api/action` with body `{ "action_id": "set_display", "params": { "display": "Main Screen" } }`
- **Use case:** Change which physical display PC On Air renders to

---

### 4.5 Mode Control

#### `set_mode`
- **Label:** Switch Mode
- **Inputs:**
  - `mode` (Dropdown: "slides" | "url" | "l3" | "idle"; required)
- **HTTP Call:** `POST /api/action` with body `{ "action_id": "set_mode", "params": { "mode": "slides" } }`
- **Use case:** Switch PC On Air to a specific operational mode (e.g., go to slides after showing a URL)

---

## 5. Variables

Variables expose PC On Air's current state for display on buttons or use in Companion expressions. Variables are updated in real-time over WebSocket or polled via HTTP.

| Variable ID | Description | Example Value | Type |
|-----------|-------------|----------------|------|
| `current_mode` | Currently active mode | `"slides"` | String: "slides" \| "url" \| "l3" \| "idle" |
| `current_url` | Currently loaded URL (empty if not in URL mode) | `"https://www.example.com"` | String |
| `current_preset_name` | Name of active URL preset (empty if none) | `"Sponsor 1"` | String |
| `slide_index` | Current slide number, **1-based** for display (converted from 0-based `AppState.slides.slideIndex`; empty if not in Slides mode) | `"3"` | String |
| `slide_count` | Total slides in current deck (empty if not in Slides mode) | `"42"` | String |
| `deck_title` | Title of current Slides deck | `"Q4 Earnings Presentation"` | String |
| `l3_active_cue` | Name of currently active lower third cue (empty if none) | `"Jane Smith – Lead Designer"` | String |
| `l3_stacking` | Lower third stacking mode state | `"on"` | String: "on" \| "off" |
| `ab_active_instance` | Current active A/B instance | `"A"` | String: "A" \| "B" |
| `connected` | Connection status (boolean as string) | `"1"` | String: "1" (connected) \| "0" (disconnected) |
| `connection_status` | Human-readable connection state | `"connected"` | String: "connected" \| "connecting" \| "disconnected" |

**Usage in Companion:**
Variables are accessible in button text, conditions, and action inputs using Companion syntax:
```
$(pc_on_air:current_mode)
$(pc_on_air:slide_index) / $(pc_on_air:slide_count)
$(pc_on_air:l3_active_cue)
```

---

## 6. Feedbacks

Feedbacks trigger visual changes on buttons based on PC On Air's state (color, text style, background, borders). Each feedback is configured per-button.

### 6.1 Connection Status

#### `is_connected`
- **Label:** Is Connected
- **Description:** Button color changes based on connection state
- **Checks:** `connected` variable
- **Options:** (none)
- **Visual behavior:**
  - Connected: Green background + white text
  - Disconnected: Red background + white text
- **Use case:** Always-visible status button so operator knows if Companion is controlling PC On Air

### 6.2 Mode Feedback

#### `is_mode`
- **Label:** Is Mode Active
- **Description:** Button highlights when a specific mode is active
- **Checks:** `current_mode` variable
- **Options:**
  - `mode` (Dropdown: "slides" | "url" | "l3" | "idle")
- **Visual behavior:**
  - When active: Highlight (e.g., cyan background, bold text)
  - When inactive: Dim or default color
- **Use case:** Mode indicator buttons (e.g., a button labeled "Slides" highlights cyan when Slides mode is active)

### 6.3 A/B Instance Feedback

#### `is_ab_instance`
- **Label:** Is A/B Instance Active
- **Description:** Button highlights when a specific A/B instance is active
- **Checks:** `ab_active_instance` variable
- **Options:**
  - `instance` (Dropdown: "A" | "B")
- **Visual behavior:**
  - When active: Highlight (e.g., gold background)
  - When inactive: Default color
- **Use case:** Two buttons labeled "Instance A" and "Instance B" to show which one is on-air

### 6.4 Slide Position Feedback

#### `slide_at`
- **Label:** At Slide Number
- **Description:** Button color changes when a specific slide is active; also displays dynamic slide counter
- **Checks:** `slide_index` variable
- **Options:**
  - `slide_number` (Number) — Which slide number to watch
- **Visual behavior:**
  - When at slide: Highlight (e.g., green background)
  - When not at slide: Default color
  - Button text can include `$(pc_on_air:slide_index) / $(pc_on_air:slide_count)` to show live slide counter
- **Use case:** Buttons for important slides (e.g., "Closing – Slide 40" highlights green when you reach slide 40)

### 6.5 Lower Third Stacking Feedback

#### `l3_stacking_active`
- **Label:** Lower Third Stacking On
- **Description:** Button highlights when stacking mode is enabled
- **Checks:** `l3_stacking` variable
- **Options:** (none)
- **Visual behavior:**
  - When ON: Highlight (e.g., orange background)
  - When OFF: Default color
- **Use case:** Toggle button for stacking mode; operator can see the current state at a glance

### 6.6 Active Cue Feedback

#### `l3_has_active_cue`
- **Label:** Has Active Lower Third Cue
- **Description:** Button highlights when any lower third is currently on-air
- **Checks:** `l3_active_cue` variable (non-empty)
- **Options:** (none)
- **Visual behavior:**
  - When active: Highlight (e.g., purple background)
  - When clear: Default color
- **Use case:** Visual indicator showing that a lower third is on-screen; also useful for confirming that a cue was triggered

---

## 7. Presets

Presets are pre-built button configurations that operators can instantly add to their Companion layouts. Each preset includes:
- Action(s)
- Feedback(s)
- Text label and styling

### 7.1 Slide Navigation

#### Preset: Next Slide
- **Action:** `slides_next`
- **Feedback:** None
- **Text:** "Next" (or icon)
- **Color:** Light blue

#### Preset: Previous Slide
- **Action:** `slides_prev`
- **Feedback:** None
- **Text:** "Prev" (or icon)
- **Color:** Light blue

#### Preset: Slide Counter
- **Action:** None (display-only)
- **Feedback:** None
- **Text:** `$(pc_on_air:slide_index) / $(pc_on_air:slide_count)`
- **Color:** Gray (non-interactive)

---

### 7.2 Deck Loading

#### Preset: Load Deck (Slot 1)
- **Action:** `slides_load` with deck_url = (user-configurable URL, e.g., Google Slides link for "Deck 1")
- **Feedback:** None
- **Text:** "Deck 1"
- **Color:** Cyan

#### Preset: Load Deck (Slot 2)
- **Action:** `slides_load` with deck_url = (user-configurable URL)
- **Feedback:** None
- **Text:** "Deck 2"
- **Color:** Cyan

#### Preset: Load Deck (Slot 3)
- **Action:** `slides_load` with deck_url = (user-configurable URL)
- **Feedback:** None
- **Text:** "Deck 3"
- **Color:** Cyan

---

### 7.3 A/B Switching

#### Preset: Switch A/B Instance
- **Action:** `ab_switch`
- **Feedback:** `is_ab_instance` (watches both A and B)
- **Text:** `$(pc_on_air:ab_active_instance)` (shows "A" or "B")
- **Color:** Gold when active, gray otherwise

#### Preset: Instance A
- **Action:** `slides_switch_ab` or `url_switch_ab` (context-dependent)
- **Feedback:** `is_ab_instance` with instance = "A"
- **Text:** "Instance A"
- **Color:** Gold when active, light gray otherwise

#### Preset: Instance B
- **Action:** `slides_switch_ab` or `url_switch_ab` (context-dependent)
- **Feedback:** `is_ab_instance` with instance = "B"
- **Text:** "Instance B"
- **Color:** Gold when active, light gray otherwise

---

### 7.4 Mode Switching

#### Preset: Mode – Slides
- **Action:** `set_mode` with mode = "slides"
- **Feedback:** `is_mode` with mode = "slides"
- **Text:** "SLIDES"
- **Color:** Cyan when active, gray otherwise

#### Preset: Mode – URL
- **Action:** `set_mode` with mode = "url"
- **Feedback:** `is_mode` with mode = "url"
- **Text:** "URL"
- **Color:** Cyan when active, gray otherwise

#### Preset: Mode – Lower Third
- **Action:** `set_mode` with mode = "l3"
- **Feedback:** `is_mode` with mode = "l3"
- **Text:** "L3"
- **Color:** Cyan when active, gray otherwise

#### Preset: Mode – Idle
- **Action:** `set_mode` with mode = "idle"
- **Feedback:** `is_mode` with mode = "idle"
- **Text:** "IDLE"
- **Color:** Cyan when active, gray otherwise

---

### 7.5 Lower Third Control

#### Preset: Take Lower Third (Slot 1)
- **Action:** `l3_take` with cue_id = (user-configurable, e.g., "speaker_1")
- **Feedback:** `l3_has_active_cue`
- **Text:** "Speaker 1" (or user label)
- **Color:** Purple when active, dark gray otherwise

#### Preset: Take Lower Third (Slot 2)
- **Action:** `l3_take` with cue_id = (user-configurable)
- **Feedback:** `l3_has_active_cue`
- **Text:** "Speaker 2" (or user label)
- **Color:** Purple when active, dark gray otherwise

#### Preset: Clear Lower Third
- **Action:** `l3_clear`
- **Feedback:** None
- **Text:** "Clear L3"
- **Color:** Red

#### Preset: Stacking On
- **Action:** `l3_stacking_on`
- **Feedback:** `l3_stacking_active`
- **Text:** "Stacking ON"
- **Color:** Orange when active, gray otherwise

#### Preset: Stacking Off
- **Action:** `l3_stacking_off`
- **Feedback:** `l3_stacking_active` (inverted)
- **Text:** "Stacking OFF"
- **Color:** Gray when off, orange otherwise

---

### 7.6 Status & Connection

#### Preset: Connection Status
- **Action:** None (display-only)
- **Feedback:** `is_connected`
- **Text:** `$(pc_on_air:connection_status)`
- **Color:** Green when connected, red when disconnected

#### Preset: Current Mode Display
- **Action:** None (display-only)
- **Feedback:** None
- **Text:** `$(pc_on_air:current_mode)` (uppercase)
- **Color:** Gray (non-interactive)

---

## 8. Companion Variable Syntax

Companion uses a standardized syntax for variable substitution in action inputs and button text:

```
$(module_name:variable_id)
```

**In PC On Air module:**
```
$(pc_on_air:current_mode)
$(pc_on_air:slide_index)
$(pc_on_air:slide_count)
$(pc_on_air:l3_active_cue)
$(pc_on_air:ab_active_instance)
$(pc_on_air:connected)
```

**Example usage in an action input:**
- Action: `load_url_preset`
- Input: `preset = $(pc_on_air:current_preset_name)` (loads the last-used preset)

**Example usage in button text:**
```
Slide $(pc_on_air:slide_index) of $(pc_on_air:slide_count)
Currently: $(pc_on_air:l3_active_cue)
```

---

## 9. Example Button Layouts

### 9.1 All-in-One FOH (Front-of-House) Control

**Purpose:** A single 4×4 button grid for a general operator running a multi-mode show.

```
[Slides]     [Deck 1]      [Deck 2]      [Deck 3]
[Prev Slide] [Counter]     [Next Slide]  [Instance A/B]
[URL]        [Load URL 1]  [Load URL 2]  [Switch A/B]
[L3 Mode]    [Speaker 1]   [Speaker 2]   [Clear L3]
```

**Row 1: Mode selection** — Quickly switch between operational modes
- Button 1: `Mode – Slides` preset
- Button 2: `Load Deck 1` preset
- Button 3: `Load Deck 2` preset
- Button 4: `Load Deck 3` preset

**Row 2: Slide control** — Navigate slides and A/B instances
- Button 5: `Previous Slide` preset
- Button 6: `Slide Counter` preset (displays current slide; no action)
- Button 7: `Next Slide` preset
- Button 8: `Instance A/B` preset (shows which instance is active; toggles on click)

**Row 3: URL mode** — Load URLs and switch between them
- Button 9: `Mode – URL` preset
- Button 10: `load_url` action with url = "https://example.com/sponsor1"
- Button 11: `load_url` action with url = "https://example.com/sponsor2"
- Button 12: `url_switch_ab` action (flip between two prepared URLs)

**Row 4: Lower thirds** — Take cues and manage stacking
- Button 13: `Mode – Lower Third` preset
- Button 14: `l3_take` with cue_id = "speaker_1"
- Button 15: `l3_take` with cue_id = "speaker_2"
- Button 16: `l3_clear` preset

---

### 9.2 Slides-Only Layout (Single Operator)

**Purpose:** Minimalist design for an operator running a slide presentation with minimal mode switching.

```
[Prev]      [Slide Info]   [Next]       [Connection]
[Deck 1]    [Deck 2]       [Deck 3]     [Reload]
```

**Row 1: Navigation**
- Button 1: `Previous Slide` preset
- Button 2: `Slide Counter` preset (display-only)
- Button 3: `Next Slide` preset
- Button 4: `Connection Status` preset (always visible red/green)

**Row 2: Deck loading**
- Button 5: `Load Deck 1` preset
- Button 6: `Load Deck 2` preset
- Button 7: `Load Deck 3` preset
- Button 8: `slides_reload` action (refresh current deck)

---

### 9.3 URL Playout + Lower Thirds (Event Streams)

**Purpose:** Layout for operators managing URL displays (scoreboards, live chat, graphics) plus lower third crawls.

```
[URL Mode]   [Reload]       [Switch A/B]  [Preset]
[URL 1]      [URL 2]        [URL 3]       [Connection]
[L3 Mode]    [Speaker 1]    [Speaker 2]   [Clear L3]
[Stacking On][Stacking Off] [Emergency]   [Idle]
```

**Row 1: URL management**
- Button 1: `Mode – URL` preset
- Button 2: `reload_url` preset
- Button 3: `url_switch_ab` preset (toggle between two prepared URLs)
- Button 4: `load_url_preset` action (load a pre-configured URL)

**Row 2: URL selection**
- Button 5: `load_url` with url = "https://scorekeeper.app/live"
- Button 6: `load_url` with url = "https://twitch.tv/mychannel/chat"
- Button 7: `load_url` with url = "https://graphics.internal/hud"
- Button 8: `Connection Status` preset

**Row 3: Lower thirds**
- Button 9: `Mode – Lower Third` preset
- Button 10: `l3_take` with cue_id = "speaker_main"
- Button 11: `l3_take` with cue_id = "speaker_guest"
- Button 12: `l3_clear` preset

**Row 4: Advanced controls**
- Button 13: `l3_stacking_on` preset
- Button 14: `l3_stacking_off` preset
- Button 15: Emergency action (e.g., `set_mode` with mode = "idle")
- Button 16: `Mode – Idle` preset

---

## 10. Module Configuration Interface

When users add the PC On Air module in Companion, they configure:

### Configuration Panel Fields

1. **Host**
   - Type: Text input
   - Default: `localhost`
   - Placeholder: `192.168.1.100` or `pc-on-air.local`
   - Description: "IP address or hostname of the PC On Air machine"

2. **Port**
   - Type: Number input (spinner or text)
   - Default: `8080`
   - Min: `1024`, Max: `65535`
   - Description: "Port number for PC On Air's WebSocket/HTTP API"

3. **Operator PIN**
   - Type: Password input
   - Default: (empty)
   - Description: "Optional PIN for operator-level authentication (if required by PC On Air)"

4. **Polling Interval (ms)**
   - Type: Number input
   - Default: `2000`
   - Min: `500`, Max: `30000`
   - Description: "Fallback HTTP polling interval if WebSocket unavailable (milliseconds)"

### Connection Verification

After configuration, Companion should attempt to connect and display:
- ✓ "Connected to PC On Air at `<host>:<port>`" (green)
- ✗ "Failed to connect to `<host>:<port>`. Retrying..." (red)
- Status updates in real-time as connection state changes

---

## 11. Acceptance Criteria

The Companion module implementation is complete and testable when:

### Functional Requirements

- [ ] **WebSocket Connection:** Module establishes persistent WebSocket connection to `ws://[host]:[port]/ws` with configurable host/port
- [ ] **HTTP Fallback:** If WebSocket fails, module automatically falls back to HTTP polling (GET `/api/status`) at configurable interval
- [ ] **Authentication:** Operator PIN is sent with connection/requests if configured
- [ ] **Reconnection:** Module auto-reconnects on network failure with exponential backoff
- [ ] **State Synchronization:** Module receives and updates full state snapshot on connect and on every state change

### Actions

- [ ] All 19 actions defined above (`load_url`, `slides_next`, `l3_take`, etc.) are implemented
- [ ] Each action sends correct HTTP POST or WebSocket message to PC On Air
- [ ] Action inputs support Companion variable substitution (e.g., `$(pc_on_air:slide_index)`)
- [ ] Dropdown inputs (mode, instance) have correct options
- [ ] Optional inputs are handled correctly (no error if not provided)

### Variables

- [ ] All 11 variables are defined and populated correctly
- [ ] Variables update in real-time when state changes
- [ ] Variables are accessible in button text and action inputs via `$(pc_on_air:variable_id)` syntax
- [ ] Empty/null values are represented as empty strings, not undefined

### Feedbacks

- [ ] All 6 feedbacks are implemented (`is_connected`, `is_mode`, `is_ab_instance`, `slide_at`, `l3_stacking_active`, `l3_has_active_cue`)
- [ ] Feedbacks apply visual changes (color, highlighting) based on their conditions
- [ ] Dropdown options (mode, instance, slide_number) are editable per-button
- [ ] Feedbacks update instantly when variable state changes

### Presets

- [ ] All 20 presets are pre-built and available in Companion's "Add Preset" menu
- [ ] Each preset has correct label, action(s), feedback(s), and styling
- [ ] Users can add presets to their layouts without manual configuration
- [ ] Presets are draggable and configurable (e.g., change deck URL for "Load Deck 1")

### Configuration

- [ ] Module settings panel displays all 4 parameters (host, port, operator_pin, polling_interval_ms)
- [ ] Defaults are correct (localhost, 8080, empty PIN, 2000ms)
- [ ] Connection status indicator shows green when connected, red when disconnected
- [ ] Module recognizes and uses operator PIN if provided

### Testing Scenarios

- [ ] **Scenario 1: Basic Slide Navigation** — Operator clicks "Next Slide" button; PC On Air advances to next slide; variable `slide_index` updates; "Slide Counter" button displays new position
- [ ] **Scenario 2: Mode Switching** — Operator clicks "Mode – URL"; `current_mode` variable changes to "url"; all URL-related action buttons become active; non-URL buttons are grayed out (via feedback)
- [ ] **Scenario 3: A/B Switching** — Operator clicks "Switch A/B"; `ab_active_instance` toggles; "Instance A" and "Instance B" buttons update highlight
- [ ] **Scenario 4: Lower Third with Override** — Operator clicks a lower third button with cue_id = "speaker_1" and overrides name/title; PC On Air takes the cue with custom name; `l3_active_cue` variable displays overridden name
- [ ] **Scenario 5: Connection Loss & Recovery** — Network connection drops; `connected` variable changes to "0"; "Connection Status" button turns red; connection is restored; variable changes to "1"; button turns green
- [ ] **Scenario 6: WebSocket to HTTP Fallback** — WebSocket becomes unavailable; module switches to HTTP polling; actions continue to work via HTTP POST; variable updates continue via polled responses
- [ ] **Scenario 7: Variable in Action Input** — Action input contains `$(pc_on_air:current_preset_name)`; when action is executed, variable value is substituted before sending to PC On Air
- [ ] **Scenario 8: Multiple Displays** — Operator uses `set_display` action with display name "Main Screen"; PC On Air renders to the correct display; other displays are unaffected

### Documentation

- [ ] All action IDs, variable IDs, and feedback IDs match those documented here
- [ ] Module provides help text / tooltips for all configuration parameters
- [ ] Actions and presets include descriptions visible in Companion's action/preset menus
- [ ] Example button layouts are clearly documented and easy to replicate

---

## 12. Implementation Notes for Developers

### State Update Frequency

- **WebSocket:** Immediate state updates on every change (recommended)
- **HTTP Polling:** State updates at poll interval (2000ms default); assume ~2-second delay between action and visual feedback

### Error Handling

- **Connection errors:** Display user-friendly message in Companion debug console; continue retrying silently
- **Action errors:** Log error response from PC On Air; do not crash module
- **Invalid input:** Companion's variable system handles validation; module assumes inputs are well-formed

### Performance Considerations

- **Polling fallback:** Use reasonable interval (2–5 seconds); avoid flooding PC On Air with requests
- **Variable updates:** Only update variables that have changed (compare to previous state)
- **Button feedback:** Feedbacks should be responsive (< 100ms visual update)

### Compatibility

- Companion version: ≥ 3.0 (uses modern API)
- PC On Air API version: ≥ 1.0 (implements WebSocket and HTTP endpoints as documented)

---

## Document Control

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-05-11 | Initial specification |

---
