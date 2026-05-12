# PC On Air v1 MVP — Source of Truth

## 1. Product Definition

**PC On Air** is an Electron-based controlled browser application for live event graphics and playout. It unifies Google Slides, lower thirds templates, and arbitrary live URLs (including Slido) into a single, operator-friendly interface with full HDMI output, remote Web UI control, and Bitfocus Companion integration. The system enforces an operator/admin split with PIN-based access control, enabling reliable, on-air-safe operation.

---

## 2. In-Scope Features (v1)

### 2.1 Core Output and Rendering
- **Program Output:** Fullscreen output on any connected display (HDMI-first); rendered by Electron
- **Luma Key Background:** Keying with configurable luma value (hex, RGB, HSL entry; preset library support)
- **Multi-display Routing (URL mode):** Ability to route arbitrary URLs to specific enumerated displays (Display 1, Display 2, etc.), including HDMI outputs; each display can have its own Program output managed independently
- **Stacking Toggle (Lower Thirds):** Option to stack multiple stills on the same output or replace on new trigger

### 2.2 Content Modes
- **Google Slides Mode**
  - Deck management and slide navigation (next, previous, jump to slide)
  - Primary/backup ("A/B") failover with live switching capability
  - Slide presets (save/recall specific slides)
  - Refresh/reload controls with single-instance refresh while keeping peer live
  - Full parity with existing Google Slides Controller functionality
  
- **Lower Thirds Mode**
  - Still Store: templated lower thirds with name, title, and theme selection
  - Still Store inputs: manual entry, CSV bulk import (with per-row theme), image upload (browser-supported formats, transparency respected)
  - CSV Schema (for Still Store import):
    - Required columns: `name`, `title`, `theme` (case-insensitive column names)
    - Optional columns: `subtitle` (secondary line)
    - Rows with missing required fields are skipped with a logged warning
    - `theme` must match an installed CSS theme name; unmatched themes default to the first available theme
    - Sample CSV (downloadable from admin): header row + 2 example rows provided
  - Media Library: separate store for arbitrary uploaded files (images, future video)
  - CSS-based template system with downloadable sample template
  - Playlist management (operator-accessible): manually trigger lower thirds one at a time (no auto-advance)
    - Queue: operator can pre-load/arm a cue before going on-air; armed cue can be taken with single button press
    - Trigger: take the armed cue to Program output immediately
    - Clear: remove the current lower third from Program output (fade/cut depending on settings)
    - Playlists (ordered lists of cues) are configured in Admin and recallable by name from Operator view
  - Still Store items distinct from Media Library (Stills are a subset)
  
- **Arbitrary URL Mode**
  - Load and display any live URL (e.g., Slido, custom web apps, dashboards)
  - URL presets library: save/recall URLs the same way Slides decks are managed
  - Refresh/reload controls with same A/B failover pattern as Slides
  - Multi-display routing: ability to target specific display

### 2.3 Control Surfaces and Interfaces
- **Web UI (Primary)**
  - Operator route (`/operator`): show-time controls only (mode switching, slide navigation, lower thirds triggering, URL loading)
  - Admin route (`/admin`): configuration access (deck management, URL presets, lower thirds templates, keying settings, system settings)
  - PIN-based access control: separate operator and admin PINs
  - Responsive design suitable for tablets and desktop browsers
  
- **Bitfocus Companion Integration**
  - Action groups: Load URL/preset, Lower thirds cues, Slides controls
  - All key inputs support Companion variables
  - Feedback: boolean, text, and color status
  - Key statuses: current URL/preset, slide number/deck, current mode/source
  - Connection: WebSocket first; HTTP polling fallback
  
- **HTTP API (Tertiary)**
  - RESTful endpoints for all operator and admin actions
  - JSON request/response format
  - Documented and versioned

### 2.4 Primary/Backup ("A/B") System
- **Dual-instance capability** for Slides and URLs only (Lower Thirds uses single-instance mode)
- **Live failover switching:** operator can swap primary/backup without interruption
- **Independent refresh:** refresh one instance while keeping the peer on-air
- **Same workflow semantics** as existing Google Slides Controller
- **Lower Thirds on-air safety:** Lower Thirds uses stacking-mode as its on-air-safe mechanism (multiple stills can stack or replace depending on operator toggle)

### 2.5 Authentication and Access Control
- **PIN-based separation:** distinct operator and admin PINs
- **Route-based access:** `/operator` and `/admin` served on single port
- **IP allowlist (optional, admin configurable):** restrict admin access to known networks
- **Admin lockdown option:** ability to disable/lock `/admin` route during live show
- **Rate limiting and lockout:** protect against brute-force PIN attacks

### 2.6 Remote Access (WAN Tunneling)
- **Existing tunneling model:** retain WAN tunneling / remote access capability from Google Slides Controller
- **Operator and admin routes tunneled separately** with same PIN-based protection

### 2.7 Configuration and Persistence
- **Local-first configuration:** all settings stored locally (file-based or SQLite)
- **Exportable bundles:** ability to export full configuration (decks, presets, lower thirds, keying) as portable archive
- **Importable bundles:** ability to import previously exported configurations
- **Clear configuration UI:** accessible from `/admin`

### 2.8 Monitoring and Feedback
- **Status indicators:** current mode, active deck/URL, slide number, last triggered lower third
- **Error messages:** clear, operator-facing feedback for invalid URLs, failed Slides loads, etc.
- **Bitfocus Companion feedback:** boolean, text, and color indicators available to control surface

---

## 3. Out-of-Scope (v1 Explicitly Excluded)

### 3.1 Authentication & SSO
- **Google SSO (admin login):** deferred to v1.1 or v2. v1 uses PIN codes only.
- **OAuth for Slides access:** v1 assumes token-based auth (existing model) or simplified setup; full OAuth flow deferred.

### 3.2 Output Formats & Protocols
- **NDI output:** nice-to-have, v1.5 target
- **SDI/DeckLink output:** v2 feature
- **Streaming protocols (RTMP, HLS, SRT):** not in scope; HDMI only for v1

### 3.3 Advanced Key/Fill Pipeline
- **Key/fill alpha output:** complex compositing pipeline is v2+. v1 uses luma key only.
- **Chroma key:** deferred beyond v1

### 3.4 Video Playback and VLC Integration
- **Video file playback in Lower Thirds:** Still Store is image-only in v1. Video playback is v2 (hence "Still Store" naming for future video support).
- **VLC integration:** no direct VLC control in v1

### 3.5 Input Methods
- **QR scanning for URL intake:** nice-to-have; v2 feature
- **OSC control:** likely overkill for MVP; not in scope

### 3.6 Platform and Deployment
- **Linux kiosk-style "player" build:** v2 goal. v1 targets macOS, with Windows and Linux support as standard Electron builds.
- **Headless/CLI mode:** out of scope for v1
- **Containerization (Docker):** deferred

### 3.7 Companion Module Advanced Features
- **Custom variable expressions:** basic variable support only
- **Advanced macro/script workflows:** not in scope

### 3.8 Analytics and Logging
- **Detailed audit logs:** not in scope
- **Analytics dashboard:** not in scope

### 3.9 Internationalization
- **Multi-language UI:** English-only for v1

### 3.10 Performance Optimization (Beyond MVP)
- **GPU acceleration for video:** not needed for v1 (images/URLs only)
- **Memory optimization for large deck/preset libraries:** v1 assumes reasonable library sizes; optimization is v1.5+

---

## 4. Non-Negotiables

These requirements **must not regress, be dropped, or skipped** during implementation:

1. **100% Google Slides Controller parity:** All existing Slides functionality, A/B failover, refresh controls, preset management, and deck workflows must work identically in PC On Air v1. Zero functionality loss.

2. **Refresh/reload applies to all modes:** The single-instance refresh pattern (refresh one A/B instance while keeping peer on-air) **must apply identically to Slides, URLs, and applicable Lower Thirds workflows**.

3. **Bitfocus Companion integration:** Full action, variable, and feedback support as specified. WebSocket connection required; HTTP polling fallback permitted.

4. **Operator/admin PIN split:** Two separate routes with two separate PINs. Operator controls do not access admin functions.

5. **HDMI output (single fullscreen):** Program output must be rendered fullscreen on HDMI without compromise.

6. **Luma key as default background:** All modes must support luma key with exact color specification (hex, RGB, HSL) and preset recall.

7. **WAN tunneling capability:** Remote access model from Google Slides Controller must remain functional.

8. **Local configuration first:** No required cloud config or online-only operation. Configuration must be exportable and portable.

9. **Deterministic triggering:** Cue/action triggering must be predictable and repeatable (same semantics as Google Slides Controller).

---

## 5. Acceptance Criteria

All acceptance criteria must pass before v1 is considered done. These are testable conditions:

### 5.1 Slides Mode
- [ ] **Deck load:** Operator can load a Google Slides deck via the `/operator` Web UI without accessing admin controls
- [ ] **Slide navigation:** Next, previous, and jump-to-slide actions work correctly and display on Program output
- [ ] **A/B failover:** Primary and backup instances can be toggled; switching from backup to primary displays new slide immediately
- [ ] **Preset save/recall:** Operator can save a named preset pointing to a specific slide; preset recall displays that slide
- [ ] **Single-instance refresh:** Operator can refresh primary while backup remains on-air; then switch to refreshed primary without seeing stale content
- [ ] **Bitfocus integration:** Companion module can load deck, navigate slides, and receive feedback on current slide number

### 5.2 URL Mode
- [ ] **URL load:** Operator can load any arbitrary URL (including Slido test URL) via `/operator`
- [ ] **Display on Program:** URL renders fullscreen on HDMI with luma key background
- [ ] **URL presets:** Operator can save/recall named URL presets from `/operator`
- [ ] **Single-instance refresh:** Operator can refresh one A/B instance while keeping peer on-air (same as Slides)
- [ ] **Multi-display targeting:** Admin can configure URL to target specific display; operator can load onto selected display
- [ ] **Bitfocus integration:** Companion can load preset and receive feedback on current URL

### 5.3 Lower Thirds Mode
- [ ] **Manual still entry:** Operator can trigger a lower third via name and title in `/operator` UI
- [ ] **Still Store templating:** Admin can create CSS template; lower thirds respect theme selection
- [ ] **CSV bulk import:** Admin can upload CSV with required columns (name, title, theme) and optional subtitle; all valid rows import and are recallable by operator; rows with missing required fields are skipped with warning; unmatched themes default to first available theme
- [ ] **Image upload:** Admin can upload PNG/JPG with transparency; image displays correctly on Program output
- [ ] **Still Store distinct from Media Library:** Still Store items show lower thirds; Media Library shows other content; they do not mix
- [ ] **Media Library upload:** Admin can upload arbitrary browser-supported image files to Media Library
- [ ] **Media Library list:** Uploaded Media Library items appear in Media Library list, not in Still Store
- [ ] **Media Library display:** Operator can select a Media Library item to display it as a still on the Program output
- [ ] **Media Library delete:** Admin can delete items from Media Library
- [ ] **Media Library persistence:** Media Library items persist across app restarts
- [ ] **Stacking toggle:** When ON, multiple triggered stills stack; when OFF, new still replaces previous
- [ ] **Clear command:** Operator can clear all active lower thirds from Program output
- [ ] **Playlist management:** Operator can queue (arm), trigger (take to output), and clear lower thirds; playlists (ordered lists) are configured in Admin and recallable by name from Operator view; triggering is manual per cue (no auto-advance)

### 5.4 Luma Key and Background
- [ ] **Luma key applied:** All modes show luma key background behind content
- [ ] **Color configuration:** Admin can specify key color via hex, RGB, or HSL in `/admin`
- [ ] **Preset recall:** Admin can save named key presets; presets are recallable in `/admin`
- [ ] **Visual confirmation:** Program output visibly reflects key color change within 1 second of admin change

### 5.5 Web UI and Access Control
- [ ] **PIN-based access:** Accessing `/operator` without correct operator PIN shows login; same for `/admin`
- [ ] **Separate PINs:** Operator PIN differs from admin PIN; operator PIN does not grant admin access
- [ ] **Rate limiting:** After 5 failed PIN attempts, login locked for 5 minutes (example values; configurable)
- [ ] **Admin lockdown:** Admin can toggle `/admin` route ON/OFF; when OFF, `/admin` returns 403 Forbidden
- [ ] **IP allowlist (optional):** Admin can configure allowlist; non-allowlisted IPs cannot access `/admin`
- [ ] **Responsive design:** Web UI is usable on tablet (iPad) and desktop browsers at 1024x768 and above

### 5.6 Bitfocus Companion
- [ ] **WebSocket connection:** Companion connects to PC On Air via WebSocket; connection status visible in Companion UI
- [ ] **HTTP fallback:** If WebSocket unavailable, Companion falls back to HTTP polling without error
- [ ] **Action: Load Slides deck:** Companion action loads specified deck; Slides mode activates on Program
- [ ] **Action: Load URL preset:** Companion action loads specified URL preset; URL mode activates on Program
- [ ] **Action: Trigger lower third:** Companion action triggers specified lower third by name
- [ ] **Feedback: Current slide number:** Companion displays current slide as text feedback
- [ ] **Feedback: Current URL:** Companion displays current URL as text feedback
- [ ] **Feedback: Current mode:** Companion displays current mode (Slides/URL/Lower Thirds) as text or boolean feedback
- [ ] **Variables in actions:** All key inputs (deck name, URL, lower third name, PIN) support Companion variable substitution

### 5.7 Configuration and Export/Import
- [ ] **Export bundle:** Admin can export full configuration (all decks, presets, lower thirds, key settings) as `.zip` or tarball
- [ ] **Import bundle:** Admin can import previously exported bundle; all settings restore identically
- [ ] **Deck persistence:** Decks added in v1 session persist across app restart
- [ ] **Preset persistence:** URL presets and lower thirds persist across app restart

### 5.8 Error Handling and Feedback
- [ ] **Invalid URL:** If operator loads unreachable URL, error message displays on Program (e.g., "URL unreachable") and operator sees feedback
- [ ] **Slides load failure:** If deck token invalid/expired, error displays; operator sees clear message in Web UI
- [ ] **Missing template:** If lower third uses template that no longer exists, operator sees error in Web UI
- [ ] **General errors:** All system errors logged; error state recoverable by operator without restart

### 5.9 Remote Access (WAN Tunneling)
- [ ] **Remote operator control:** Remote user can access `/operator` via tunnel and control Slides/URLs/Lower thirds with same latency/reliability as local
- [ ] **Remote admin access:** Remote admin can access `/admin` via tunnel with same PIN and IP allowlist protections

### 5.10 Performance and Stability
- [ ] **HDMI output timing:** Program output refreshes at monitor refresh rate (60Hz typical) with no perceptible lag (<50ms from action to display)
- [ ] **Stability under load:** System remains stable for 8+ hours of continuous operation with frequent mode switches and triggering
- [ ] **Memory footprint:** App footprint <500MB at startup, <1GB with typical library (50 decks, 100 presets, 200 lower thirds)

### 5.11 Bitfocus Companion Connection
- [ ] **Auto-reconnect:** Companion re-establishes connection after brief network interruption (5 seconds) without user intervention
- [ ] **Connection feedback:** Companion displays connection status (connected/disconnected) in UI

---

## 6. Why This MVP is Safe to Run Live

### Output Predictability
PC On Air v1 renders deterministic, reproducible output. All content modes (Slides, URLs, Lower Thirds) support the same A/B failover and refresh patterns that have proven safe in the existing Google Slides Controller. The luma key background is fixed by configuration and does not change unexpectedly. Triggering is synchronous and immediate: an operator action produces on-air output with <50ms latency, ensuring cueing is precise and predictable.

### Operator/Admin Separation
The system enforces strict role separation via PIN codes and route-based access control. Operators access only `/operator`, which provides show-time controls (mode switching, slide navigation, URL loading, lower thirds triggering). All configuration (deck management, keying settings, URL presets, templates) is locked behind the `/admin` route with a distinct PIN. Operators cannot accidentally access or modify configuration during a live show. Admin can further lock the `/admin` route entirely during broadcast, preventing any configuration changes until the route is explicitly re-enabled.

### Constrained and Reversible Actions
All operator actions are reversible. Slide navigation can jump backward. URL presets are pre-verified before broadcast (saved in `/admin`). Lower thirds can be cleared with a single action. Refresh controls allow A/B failover: if primary output becomes corrupted or stale, the operator immediately switches to backup (or refreshes backup and switches). This is the same pattern used in the existing Google Slides Controller and has proven safe in production.

### Clear Feedback and Error Handling
All operator actions produce immediate visual feedback on the Program output or in the Web UI. If an error occurs (invalid URL, failed Slides load, missing template), the error is displayed clearly to the operator, and the system remains in a known, recoverable state. Error states do not crash the application or drop output without operator action. Remote operators receive the same feedback as local operators via the Web UI.

### WAN Tunneling and Remote Safety
Remote access (for both operator and admin) uses the same PIN-based protection and route separation as local access. Remote latency for operator actions is non-deterministic (dependent on network), but trigger actions are queued and executed reliably by the server, ensuring that missed cues or delayed actions do not cause output glitches. IP allowlist and rate limiting on `/admin` prevent unauthorized remote configuration changes.

In combination, these safeguards make PC On Air v1 suitable for live broadcast use, with the same confidence level as the proven Google Slides Controller it generalizes.

---

## Document Metadata

- **Spec Version:** 1.0
- **Last Updated:** 2026-05-11
- **Status:** ACTIVE (v1 MVP)
- **Related Specs:** (to be linked as more specs are written)
