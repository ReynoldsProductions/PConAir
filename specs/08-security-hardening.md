# PC On Air v1 — Security Hardening Specification

## Overview

This document specifies the complete security architecture for PC On Air v1. PC On Air is deployed at live events where it operates on local network connections that may include untrusted attendees on guest Wi-Fi networks. The primary threat is **unauthorized access to the operator or admin control interface by an attendee on the same network**, not nation-state attacks or zero-day exploits. This spec defines how the application prevents, detects, and mitigates that threat class.

---

## 1. Threat Model

### 1.1 Threat Scenarios (In-Scope)

1. **Attendee on guest Wi-Fi accidentally (or intentionally) discovers the app port and accesses the operator UI**
   - An attendee joins the venue's guest Wi-Fi, scans for open services, and finds the PC On Air HTTP server running on a known port (e.g., 8080).
   - Without a PIN, they attempt to access `/operator` or `/admin` routes.
   - **Risk**: Hijack the show by advancing/reversing slides, changing URLs, triggering wrong lower thirds, activating show-mode lock.
   - **Mitigation**: PIN-based authentication; rate limiting to prevent PIN guessing.

2. **Operator accidentally navigates to `/admin` and changes configuration mid-show**
   - An operator with both PINs (or who knows both PINs) accidentally accesses `/admin` and makes a configuration change during live playout.
   - **Risk**: Deck presets disappear, lower thirds are deleted, keying values change, or tunnel settings are misconfigured.
   - **Mitigation**: Show-mode admin lock; strong UI confirmation for destructive operations; separate session cookie scoping.

3. **Replay attacks using captured session tokens**
   - An eavesdropper on the Wi-Fi network captures a session cookie (e.g., `pconair_operator_session=abc123xyz`).
   - They replay the cookie in a new HTTP request or WebSocket connection from a different machine.
   - **Risk**: Attacker controls the show using a stolen session.
   - **Mitigation**: Cryptographically strong session tokens; `SameSite=Strict` cookies; HTTPS on WAN tunnels; short session timeouts.

4. **Brute-force PIN guessing**
   - An attendee scripts repeated attempts to the `/auth/operator` endpoint with common 4-digit PINs (0000, 0001, ..., 9999).
   - **Risk**: Attacker guesses the operator PIN and gains access.
   - **Mitigation**: Rate limiting (5 failed attempts per IP per 5 minutes → 5-minute lockout); minimum PIN length enforcement (4 digits for operator, 8 for admin).

5. **Show-time admin lock bypass**
   - An operator activates show lock via `/admin`, preventing further admin access. A bad actor attempts to unlock it by guessing the admin PIN or exploiting a UI bug.
   - **Risk**: Admin route becomes accessible mid-show without authorization.
   - **Mitigation**: Admin lock is enforced server-side; unlock requires correct admin PIN + explicit confirmation button; no UI bypass.

### 1.2 Out-of-Scope Threats

The following threats are **not addressed by this spec** and are outside the scope of v1:

- **Nation-state attackers** with access to cryptographic backdoors or zero-days.
- **Supply-chain attacks** (compromised npm packages, Electron binary tampering).
- **Physical access to the machine** (someone unplugs the computer, resets the BIOS, or installs a keylogger).
- **Client-side malware** on the operator's machine (e.g., a keylogger recording PIN entry).
- **DNS poisoning** or man-in-the-middle attacks on the WAN tunnel provider's infrastructure.
- **Insider threats** (someone with legitimate admin access sabotages the event).

---

## 2. Operator and Admin Separation

### 2.1 Routes and Permissions

#### `/operator` Route
- **Purpose**: Show-time control surface for the operator.
- **Required Authentication**: Operator PIN or admin PIN.
- **Permitted Actions**:
  - Slides navigation (next, previous, jump to slide).
  - Mode switching (slides, url, l3, idle).
  - Lower thirds triggering (take, clear, stacking mode).
  - URL loading and preset selection.
  - A/B instance switching.
  - View current application state (`GET /api/status`).
  - View display list (`GET /api/displays`).
  - View presets (read-only; no creation/deletion).
  - Trigger operator session logout.
- **Forbidden Actions**: All actions under `/admin` (configuration, profile management, tunnel settings, key management).
- **UI Characteristics**: Large, operator-friendly buttons; minimal configuration options; prominent "SHOW LOCKED" badge when admin lock is active.

#### `/admin` Route
- **Purpose**: Configuration and system administration.
- **Required Authentication**: Admin PIN only (operator PIN does NOT grant access).
- **Permitted Actions**:
  - Create, update, delete URL presets.
  - Create, update, delete lower thirds cues.
  - Create, update, delete background presets.
  - Configure keying (luma key color, solid background).
  - Import/export configuration bundles.
  - Manage IP allowlist.
  - Activate/deactivate show-mode admin lock.
  - Configure session timeouts.
  - View and manage tunnel settings.
  - View and manage user profiles (operator PIN, admin PIN, display routing).
  - Trigger admin session logout.
- **Forbidden Actions**: Direct playout control (slide navigation, lower thirds triggering, mode switching).
- **UI Characteristics**: Detailed configuration panels; destructive actions (delete, export) require confirmation; show-lock status prominently displayed.

### 2.2 PIN Requirements

**Operator PIN:**
- **Minimum length**: 4 characters (digits or alphanumeric).
- **Recommended length**: 4–6 characters for rapid entry on-site.
- **Enforcement**: Set at application startup or first launch via CLI flag `--operator-pin=1234`. No UI entry unless setup mode is enabled.
- **Storage**: Bcrypt hash (cost factor 12) in configuration file or database.
- **Prompt**: "Enter operator PIN" on login screen.

**Admin PIN:**
- **Minimum length**: 8 characters (alphanumeric, symbols recommended).
- **Recommended length**: 8–12 characters for security.
- **Enforcement**: Set at application startup or first launch via CLI flag `--admin-pin=abc123XY`. No UI entry unless setup mode is enabled.
- **Storage**: Bcrypt hash (cost factor 12) in configuration file or database.
- **Prompt**: "Enter admin PIN" on login screen.
- **Constraint**: Admin PIN **must be different from operator PIN**. Application enforces this at setup time by rejecting any attempt to set them equal. Error message: "Admin PIN must be different from operator PIN."

### 2.3 Session Cookies

#### Operator Session Cookie

**Name**: `pconair_operator_session`

**Attributes**:
```
Set-Cookie: pconair_operator_session=<token>; 
  Path=/; 
  HttpOnly; 
  SameSite=Strict; 
  Max-Age=28800
```

- **Max-Age**: 28800 seconds (8 hours, configurable at runtime).
- **HttpOnly**: Set to prevent JavaScript access (blocks XSS token theft).
- **SameSite=Strict**: No cross-site requests carry the cookie; prevents CSRF.
- **Scope**: Grants access to `/operator` route and all `/api/*` endpoints that require operator access.
- **Token Format**: 128-bit cryptographically random value, base64-encoded (no guessing).
- **Deletion**: Expired tokens are rejected; logout clears the cookie via `Set-Cookie: pconair_operator_session=; Max-Age=0`.

#### Admin Session Cookie

**Name**: `pconair_admin_session`

**Attributes**:
```
Set-Cookie: pconair_admin_session=<token>; 
  Path=/; 
  HttpOnly; 
  SameSite=Strict; 
  Max-Age=14400
```

- **Max-Age**: 14400 seconds (4 hours, configurable at runtime).
- **HttpOnly**: Set to prevent JavaScript access.
- **SameSite=Strict**: No cross-site requests carry the cookie.
- **Scope**: Grants access to `/admin` route and all `/api/*` endpoints (including operator-level).
- **Token Format**: 128-bit cryptographically random value, base64-encoded.
- **Deletion**: Logout clears the cookie via `Set-Cookie: pconair_admin_session=; Max-Age=0`.

#### Session Isolation

- The two cookies are **independent**. An operator session does NOT grant admin access, and vice versa.
- Clearing one cookie does not affect the other (e.g., operator can log out while admin session remains active).
- WebSocket connections must send the appropriate cookie during the upgrade handshake; a WebSocket authenticated as operator cannot perform admin actions even if both cookies are sent.

---

## 3. Session Management

### 3.1 Session Duration

**Operator Sessions:**
- **Default Duration**: 8 hours (28800 seconds).
- **Configurable**: Set via `--operator-session-timeout=<seconds>` CLI flag at startup.
- **Rationale**: 8 hours covers a typical multi-hour live event; operator can remain logged in throughout.
- **Renewal**: Each request or action resets the idle timer (sliding window expiration is NOT used; absolute expiration is based on login time).

**Admin Sessions:**
- **Default Duration**: 4 hours (14400 seconds).
- **Configurable**: Set via `--admin-session-timeout=<seconds>` CLI flag at startup.
- **Rationale**: Shorter duration reduces risk if admin session is captured.
- **Renewal**: Same as operator (absolute expiration).

### 3.2 Session Token Generation

**Token Creation:**
- On successful PIN authentication (via `POST /auth/operator` or `POST /auth/admin`), the server generates a session token.
- Token generation uses `crypto.getRandomValues()` (Electron's Node.js `crypto` module) to produce 128 random bits.
- Token is base64-encoded and stored in memory (in-process session store or Redis if distributed).
- Token is returned to the client via `Set-Cookie` header.

**Token Validation:**
- On each HTTP request or WebSocket message, the server validates the session token by:
  1. Extracting the cookie (e.g., `pconair_operator_session` from the `Cookie` header or WebSocket handshake headers).
  2. Looking up the token in the session store.
  3. Verifying the token has not expired.
  4. Verifying the token corresponds to the correct role (operator or admin).
  5. If valid, extracting the user role and permitting the action.
  6. If invalid or expired, returning `401 AUTH_REQUIRED`.

**Token Storage (v1):**
- In-memory session store (JavaScript `Map` or similar).
- Tokens are **never logged** (neither to console nor to disk).
- Tokens are **never included** in API response bodies or status messages.
- On application restart, all sessions are invalidated (acceptable for an event-focused app; operators re-authenticate post-restart).

---

## 3.3 Session Scoping

**Geographic Scope:**
- Sessions are tied to a single HTTP host/port (e.g., `http://192.168.1.100:8080`).
- `SameSite=Strict` prevents the cookie from being sent to other domains, so cross-domain attacks are blocked.

**Transport Scope:**
- Operator and admin sessions are independent; holding one does not grant the other's permissions.
- Separate cookies ensure clear separation and prevent accidental privilege escalation.

---

## 4. Rate Limiting and Lockout

### 4.1 Rate Limit Policy

**Endpoints Subject to Rate Limiting:**
- `POST /auth/operator`
- `POST /auth/admin`

**Policy:**
- **Limit**: 5 failed authentication attempts per IP per 5-minute sliding window.
- **Failure Definition**: Any request that results in a `401 AUTH_REQUIRED` response (incorrect PIN).
- **Success Definition**: A request that results in `200 OK` and sets a session cookie (correct PIN).

**Lockout Behavior:**
- After 5 failures within the 5-minute window, the source IP is locked out.
- Locked-out requests return `429 Too Many Requests` with error code `RATE_LIMITED`.
- Lockout duration: 5 minutes (starting from the 5th failed attempt).
- After 5 minutes, the lockout is automatically cleared; the IP can attempt authentication again.
- **No persistent ban**: Lockout state is in-memory only. On application restart, all lockouts are cleared. (This is intentional for event-safe operation; a restart should not permanently lock anyone out.)

### 4.2 Rate Limit Response

**HTTP Response (429):**
```json
{
  "error": {
    "code": "RATE_LIMITED",
    "message": "Too many failed authentication attempts. Please try again in 5 minutes.",
    "details": {
      "retryAfter": 300
    }
  }
}
```

**Response Headers:**
```
HTTP/1.1 429 Too Many Requests
X-RateLimit-Limit: 5
X-RateLimit-Remaining: 0
X-RateLimit-Reset: <unix-timestamp-when-lockout-expires>
X-Retry-After: 300
Content-Type: application/json
```

### 4.3 Implementation Details

**Tracking:**
- Rate limit state is maintained in-memory per source IP.
- Data structure: `Map<ipAddress, { failures: number, timestamp: number, lockedUntil: number }>`.
- On each failed request, increment the failure count and record the timestamp.
- On each successful request, clear the failure count for that IP.
- Periodically (every minute), clean up stale entries (older than 5 minutes).

**IP Detection:**
- Extract source IP from `req.socket.remoteAddress` (HTTP) or WebSocket upgrade request headers.
- For proxied requests (e.g., behind ngrok), respect `X-Forwarded-For` header if explicitly configured (not default).

---

## 5. IP Allowlist

### 5.1 Purpose and Behavior

**Purpose:**
- Allow an operator to restrict app access to specific trusted IPs or networks (e.g., their laptop's static IP, the venue's control room network).
- Provides an additional layer of defense against unauthorized access from other machines on the guest Wi-Fi.

**Default Behavior:**
- IP allowlist is **disabled by default** to allow operators to set up the app on-site without complex network configuration.
- When disabled, all IPs can connect.

**Enabled Behavior:**
- When enabled, **only requests from IPs in the allowlist can access any route** (`/operator`, `/admin`, `/api/*`, `/ws`).
- Requests from non-listed IPs receive `403 Forbidden`.

### 5.2 Allowlist Configuration

**Format:**
- Comma-separated list of CIDR blocks or individual IPs.
- Examples: `192.168.1.100`, `192.168.1.0/24`, `10.0.0.5,10.0.1.0/24`.
- IPv4 and IPv6 supported.

**Management:**
- Configured in `/admin` UI under a "Network Security" section.
- An admin-authenticated user can add/remove entries.
- Changes take effect immediately (no restart required).
- Stored in the persistent configuration file (SQLite or JSON).

**Escape Hatch (CLI):**
- If an operator locks themselves out with an overly restrictive allowlist, they can clear the list via CLI flag:
  ```
  pconair --clear-allowlist
  ```
- This clears the allowlist and allows all IPs to connect again.
- Requires command-line access (can only be run on the machine running PC On Air).

### 5.3 IP Matching

**Logic:**
- On each request, extract the source IP (via `req.socket.remoteAddress` or `X-Forwarded-For` if configured).
- Check if the IP matches any CIDR block in the allowlist using a standard IP matching library (e.g., `ip` npm package).
- If the allowlist is enabled and the IP does not match any entry, return `403 Forbidden`.

**CIDR Matching:**
- Use the `ip-address` library or equivalent to validate CIDR blocks and perform matching.
- Example: `192.168.1.0/24` matches any IP from `192.168.1.0` to `192.168.1.255`.

---

## 6. Show-Mode Admin Lock

### 6.1 Purpose

The show-mode admin lock prevents accidental or malicious changes to configuration during a live show. While the operator maintains control of `/operator` (for show-time playout), the admin cannot access `/admin` to make configuration changes.

### 6.2 Behavior

**Activation:**
- An admin accesses `/admin` and clicks "Lock Admin During Show" button.
- Admin is prompted: "Lock the admin panel for the duration of this show? You can unlock it by entering the admin PIN again."
- Admin clicks "Confirm."
- Application sets a flag: `adminShowLocked = true`.

**While Locked:**
- Any request to `/admin` route (and admin-specific `/api/*` endpoints like `POST /api/background`) returns `403 Forbidden` with message: "Admin locked for show. Enter admin PIN to unlock."
- The message includes a form or button prompting for admin PIN entry.
- The form submits to `POST /auth/unlock-admin` endpoint (see Section 6.3).
- Operator view (`/operator`) displays a prominent "SHOW LOCKED" badge or banner in the header.
- Operator can see the lock status but cannot deactivate it (requires admin PIN).

**Deactivation (Unlock):**
- Operator or someone with admin PIN navigates to `/admin` and encounters the lock message.
- Admin PIN entry form appears.
- Admin enters PIN and clicks "Unlock."
- Application verifies PIN, then prompts: "Unlock the admin panel? This will allow configuration changes during the show."
- On confirmation, `adminShowLocked` flag is set to `false`.
- Admin route becomes accessible again.

### 6.3 Unlock Endpoint

**Endpoint:** `POST /auth/unlock-admin`

**Request:**
```json
{
  "pin": "abc123XY"
}
```

**Response (200 OK):**
```json
{
  "locked": false
}
```

**Error Codes:**
- `AUTH_REQUIRED` (401): PIN is incorrect.
- `RATE_LIMITED` (429): Too many failed PIN attempts (subject to same rate limiting as login).

**Semantics:**
- Validates the provided PIN against the configured admin PIN (bcrypt comparison).
- If correct, sets `adminShowLocked = false` and returns success.
- If incorrect, increments the failed attempt counter (applies to rate limiting).

### 6.4 State Persistence

- The `adminShowLocked` flag is stored in memory (not persisted to disk).
- On application restart, the flag is reset to `false` (show lock is deactivated).
- **Rationale**: Event-based operation; operator can restart the app if needed during setup without being permanently locked out.

---

## 7. HTTPS and TLS

### 7.1 v1 Design (HTTP Only on Localhost)

**In v1, PC On Air serves HTTP (not HTTPS) on localhost.**

**Rationale:**
- The operator machine and the app run on the same physical computer; traffic does not leave the machine.
- Local network exposure is intentional: the app must accept connections from operator's browser (running on the same machine or nearby network device).
- TLS termination and encryption are handled by the WAN tunneling provider (ngrok, Cloudflare Tunnel, etc.) when remote access is needed.
- Adding HTTPS locally would require self-signed certificates or a local CA, adding complexity without security benefit for local connections.

**Use of WAN Tunneling:**
- If an operator needs to access PC On Air from outside the event venue (e.g., from a mobile phone at the venue entrance), they use a WAN tunneling provider.
- Example: `ngrok http 8080` exposes `http://localhost:8080` as `https://abc123.ngrok.io` with TLS termination by ngrok.
- The operator accesses `https://abc123.ngrok.io/operator` (encrypted, verified TLS cert).
- PC On Air itself remains HTTP; ngrok forwards decrypted traffic to `http://localhost:8080`.
- Session cookies are still `HttpOnly` and `SameSite=Strict`, protecting them from XSS and CSRF even over the encrypted tunnel.

### 7.2 Certificate Management

- No certificate pinning is required.
- Operators trust the WAN tunneling provider's certificate chain (ngrok, Cloudflare, etc.).
- In future versions, if direct HTTPS is desired, self-signed certificates can be used locally and accepted by the operator's browser.

---

## 8. Security Headers

All HTTP responses include security headers to mitigate common attacks (XSS, clickjacking, etc.). Headers are set globally via middleware.

### 8.1 Headers Applied to All Routes

```
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Cache-Control: no-store
```

### 8.2 Headers by Route

#### `/operator` and `/admin` (HTML Pages)

```
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Cache-Control: no-store
Content-Security-Policy: default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' https:; font-src 'self'
```

**Rationale:**
- `default-src 'self'`: Only scripts and styles from the app itself are loaded.
- `'unsafe-inline'` for styles: Allows inline CSS from the React app (if using CSS-in-JS or inline `<style>` tags). For stricter CSP, use CSS modules with nonces.
- No external CDNs or third-party scripts.
- Images can be from the app or HTTPS sources (e.g., user-uploaded icons from the still store).

#### `/api/*` (JSON Endpoints)

```
X-Content-Type-Options: nosniff
Cache-Control: no-store
Content-Type: application/json
```

#### `/ws` (WebSocket Endpoint)

- Standard HTTP upgrade handshake applies.
- Same security headers as HTML pages (set on the upgrade response).

---

## 9. Sensitive Data Handling

### 9.1 PIN Storage

**Storage Method:**
- PINs are **never stored in plaintext**.
- All PINs (operator and admin) are hashed using **bcrypt** with **cost factor 12**.

**Bcrypt Configuration:**
```typescript
const bcrypt = require('bcrypt');
const costFactor = 12;
const hashedPin = await bcrypt.hash(plainTextPin, costFactor);
```

**Verification:**
```typescript
const isValid = await bcrypt.compare(enteredPin, hashedPin);
```

**Rationale:**
- Bcrypt is slow by design (cost factor 12 = ~0.1 seconds per hash); prevents rapid PIN guessing even if the hash file is stolen.
- Bcrypt includes a salt, preventing rainbow table attacks.

### 9.2 Session Tokens

**Generation:**
- 128-bit (16 bytes) random values generated via `crypto.getRandomBytes()`.
- Base64-encoded for transmission.

**Storage:**
- Stored in-memory in a JavaScript `Map` or similar data structure.
- **Never logged** to console, file, or error tracking systems.
- **Never included** in API responses, error messages, or status reports.

**Transmission:**
- Sent to the client via `Set-Cookie` header only.
- Sent back by the client via `Cookie` header (standard HTTP behavior).

### 9.3 Tunnel Tokens and Secrets

**Storage:**
- Tunnel provider tokens (e.g., ngrok auth token) are encrypted at rest using Electron's `safeStorage` API.
- Electron `safeStorage` uses the OS keychain (Windows DPAPI, macOS Keychain, Linux SECRET_SERVICE).
- Encrypted tokens are stored in the application configuration file.

**Retrieval:**
- On application start, encrypted tokens are decrypted using `safeStorage.decryptString()`.
- Decrypted tokens are used for tunnel authentication.
- **Never logged or exposed** in plaintext.

### 9.4 What Never Appears in Logs or Responses

The following data **must never** be logged or returned in API responses:

- Plaintext PINs (operator or admin).
- Session tokens (partial or complete).
- Bcrypt PIN hashes (not in responses; can be in secure config files).
- User passwords (N/A in v1; no user accounts).
- Tunnel provider tokens.
- API keys or secrets.
- Decrypted sensitive configuration.

**Enforcement:**
- Code review and testing to ensure no `console.log(pin)`, `console.log(token)`, etc.
- Response payloads are validated to exclude these fields.
- Error messages do not include sensitive details.

---

## 10. API Changes and New Endpoints

This section defines security-related HTTP endpoints and modifications to spec 02.

### 10.1 Authentication Endpoints

#### `POST /auth/operator`

Already defined in spec 02, Section 5.1. No changes.

- **Request:** `{ "pin": "1234" }`
- **Response (200 OK):** `{ "role": "operator" }`
- **Set-Cookie:** `pconair_operator_session=<token>; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800`
- **Error:** `AUTH_REQUIRED` (401) or `RATE_LIMITED` (429).

#### `POST /auth/admin`

Already defined in spec 02, Section 5.1. No changes.

- **Request:** `{ "pin": "5678" }`
- **Response (200 OK):** `{ "role": "admin" }`
- **Set-Cookie:** `pconair_admin_session=<token>; Path=/; HttpOnly; SameSite=Strict; Max-Age=14400`
- **Error:** `AUTH_REQUIRED` (401) or `RATE_LIMITED` (429).

#### `POST /auth/logout` (New)

Logout and clear the session cookie.

**Request:**
```json
{
  "role": "operator" | "admin"
}
```

**Response (200 OK):**
```json
{
  "message": "Logged out successfully."
}
```

**Set-Cookie:**
```
Set-Cookie: pconair_operator_session=; Max-Age=0; Path=/
```
(or `pconair_admin_session` if admin)

**Semantics:**
- Clears the specified session cookie (operator or admin).
- Does not invalidate the token server-side (in-memory tokens are discarded on restart anyway).
- Both UI routes include a logout button that calls this endpoint.

#### `POST /auth/unlock-admin` (New)

Unlock the admin panel during show lock. (Defined in Section 6.3.)

### 10.2 Rate Limit Error Response

Already defined in spec 02, Section 6. Response structure:

```json
{
  "error": {
    "code": "RATE_LIMITED",
    "message": "Too many failed authentication attempts. Please try again in 5 minutes.",
    "details": {
      "retryAfter": 300
    }
  }
}
```

**Headers:**
```
X-RateLimit-Remaining: 0
X-Retry-After: 300
```

### 10.3 Protected Routes Update

Update spec 02, Section 5.2 to reflect new routing:

| Route/Endpoint | Required Role | Notes |
|---|---|---|
| `GET /operator` | operator or admin | Render operator UI. |
| `GET /admin` | admin | Render admin UI (returns 403 if show-locked). |
| `/api/status` | operator | Already defined; operator access. |
| `/api/displays` | operator | Already defined; operator access. |
| `/api/background` | admin | Already defined; admin access. |
| `/api/presets` | operator | Preset CRUD; operator access for read-only presets, admin for management (can be scoped in future). |
| All other `/api/*` | operator | Operator-level actions. |
| `/ws` | operator or admin | WebSocket; authenticated connections only. |
| `POST /auth/logout` | operator or admin | Logout (new endpoint). |
| `POST /auth/unlock-admin` | any (IP-restricted) | Unlock admin panel (new endpoint). |

---

## 11. Operational Workflow: Show Day Security Checklist

### 11.1 Setup Phase (1–2 Hours Before Show)

1. **Start PC On Air**
   - Run: `pconair --operator-pin=1234 --admin-pin=abc123XY` (replace with secure values).
   - Verify both PINs are at least minimum length and are different.
   - App starts on `http://localhost:8080`.

2. **Verify Connectivity**
   - Open a browser on the operator's machine.
   - Navigate to `http://localhost:8080/operator`.
   - Verify the operator login screen appears.
   - Navigate to `http://localhost:8080/admin`.
   - Verify the admin login screen appears.

3. **Log in as Admin**
   - Enter admin PIN on admin login screen.
   - Verify `/admin` route loads.
   - Confirm access to configuration panels (presets, lower thirds, keying, tunnel settings).

4. **Configure IP Allowlist (Optional)**
   - From `/admin`, enable IP allowlist.
   - Add the operator's machine IP (e.g., `192.168.1.100`) or the control room network (e.g., `192.168.1.0/24`).
   - Test that accessing the app from outside the allowlist returns 403.
   - If needed, use `pconair --clear-allowlist` to reset.

5. **Verify Session Timeouts (Optional)**
   - From `/admin`, review configured operator and admin session timeouts.
   - Default: 8 hours (operator), 4 hours (admin).
   - Adjust if the show is shorter (e.g., 2-hour event → 2-hour timeout).

6. **Test Rate Limiting (Optional)**
   - From a different machine on the network, attempt to log in with an incorrect PIN 6 times in quick succession.
   - Verify the 6th attempt is rate-limited (429 response with `X-Retry-After: 300`).
   - Wait 5 minutes and verify a 7th attempt succeeds (if PIN is correct).

7. **Log Out as Admin**
   - Click logout on `/admin`.
   - Verify the admin session cookie is cleared.

### 11.2 Pre-Show Phase (30 Minutes Before Show)

1. **Load Presets and Content**
   - Log in as admin to `/admin`.
   - Verify all URL presets, lower thirds cues, and slide decks are loaded and accessible.
   - Test slide navigation and lower thirds triggering via `/operator` (log in as operator).

2. **Activate Show Lock**
   - Log in as admin.
   - Click "Lock Admin During Show" button.
   - Confirm the lock activation.
   - Verify that attempting to access `/admin` now shows "Admin locked for show" message.
   - Verify that `/operator` displays "SHOW LOCKED" badge.

3. **Hand Control to Operator**
   - Log out as admin (the show lock remains active even after logout).
   - Operator logs in with operator PIN.
   - Operator navigates to `/operator` and verifies the "SHOW LOCKED" badge is visible.
   - Operator verifies all show controls are accessible (slides, URLs, lower thirds, mode switching).

### 11.3 During Show

1. **Operator Controls Playout**
   - Operator uses `/operator` to control the show.
   - No configuration changes can be made (admin route is locked).

2. **Monitor for Unauthorized Access**
   - If unexpected users appear on the network, check application logs for failed login attempts.
   - If rate limiting triggers, the attacker is locked out for 5 minutes.

3. **Emergency Admin Access**
   - If the operator needs to unlock admin mid-show (to fix a critical issue), they enter the admin PIN on the "Admin locked for show" prompt.
   - A confirmation dialog appears: "Unlock the admin panel? This will allow configuration changes during the show."
   - Admin confirms.
   - Admin route becomes accessible.

### 11.4 Post-Show Phase

1. **Deactivate Show Lock**
   - Log in as admin.
   - Verify the lock is still active.
   - Click "Unlock" and confirm.
   - Verify `/admin` is now accessible without the lock message.

2. **Export Configuration (Optional)**
   - From `/admin`, export the show configuration as a portable bundle (for archival or next event).

3. **Log Out**
   - Log out as operator and admin.
   - Verify both session cookies are cleared.

4. **Shutdown**
   - Cleanly shut down PC On Air.
   - All in-memory session tokens and rate limit state are discarded.

---

## 12. Acceptance Criteria

The following criteria **must** be satisfied for the security hardening specification to be considered complete and testable:

### 12.1 Authentication

- [ ] Unauthenticated access to `/operator` returns `401 AUTH_REQUIRED` (no HTML page served).
- [ ] Unauthenticated access to `/admin` returns `401 AUTH_REQUIRED`.
- [ ] Correct operator PIN grants access to `/operator` and `/api/*` (operator-level endpoints).
- [ ] Correct admin PIN grants access to `/admin` and `/api/*` (all endpoints).
- [ ] Incorrect PIN returns `401 AUTH_REQUIRED` with error code `AUTH_REQUIRED`.
- [ ] Session cookie `pconair_operator_session` is set after operator login and has correct attributes (HttpOnly, SameSite=Strict, Max-Age=28800).
- [ ] Session cookie `pconair_admin_session` is set after admin login and has correct attributes (HttpOnly, SameSite=Strict, Max-Age=14400).
- [ ] Operator PIN and admin PIN are different; attempting to set them equal returns an error during setup.
- [ ] Operator PIN is at least 4 characters; admin PIN is at least 8 characters.

### 12.2 Operator vs Admin Access

- [ ] Operator session can access `/operator`, all `/api/*` operator endpoints (slides, URL, mode, l3).
- [ ] Operator session cannot access `/admin` (returns `403 Forbidden`).
- [ ] Operator session cannot call `/auth/unlock-admin` (if locked during show).
- [ ] Admin session can access `/admin` and all `/api/*` endpoints (including operator and admin endpoints).
- [ ] Admin session can access `/operator` (superuser).
- [ ] Admin PIN does not grant operator access to `/operator` alone (admin must also know operator PIN if they log in as operator).

### 12.3 Session Cookies and Tokens

- [ ] Session tokens are 128-bit random values (no predictable pattern).
- [ ] Session tokens are never logged or included in API responses.
- [ ] Expired tokens (beyond Max-Age) are rejected; request returns `401 AUTH_REQUIRED`.
- [ ] Logout endpoint clears the session cookie via `Set-Cookie` with `Max-Age=0`.
- [ ] After logout, subsequent requests with that cookie return `401 AUTH_REQUIRED`.
- [ ] Clearing operator session does not affect admin session (and vice versa).

### 12.4 Rate Limiting

- [ ] First failed authentication attempt is accepted (status 401, no rate limit headers).
- [ ] After 5 failed attempts within 5 minutes, the 6th attempt returns `429 Too Many Requests`.
- [ ] Rate-limited response includes headers: `X-RateLimit-Remaining: 0`, `X-Retry-After: 300`.
- [ ] After 5 minutes, lockout expires; IP can attempt authentication again.
- [ ] Successful authentication (correct PIN) clears the failure count for that IP.
- [ ] Rate limiting is per-source IP (two clients from different IPs have independent limits).
- [ ] Application restart clears all rate limit state.

### 12.5 Show-Mode Admin Lock

- [ ] Before activation, `/admin` is accessible to admin sessions.
- [ ] Clicking "Lock Admin During Show" requires confirmation.
- [ ] After confirmation, admin sessions to `/admin` receive `403 Forbidden` with message "Admin locked for show."
- [ ] Locked admin responses include a PIN entry form for unlock.
- [ ] `/operator` displays "SHOW LOCKED" badge while lock is active.
- [ ] Operator can see the badge but cannot deactivate the lock (no button or action on operator UI).
- [ ] Entering incorrect PIN on unlock form returns `401 AUTH_REQUIRED` and increments rate limit counter.
- [ ] Entering correct PIN displays confirmation: "Unlock the admin panel? This will allow configuration changes during the show."
- [ ] Confirming unlock sets `adminShowLocked = false`; `/admin` becomes accessible.
- [ ] Application restart clears the lock (flag resets to false).

### 12.6 IP Allowlist

- [ ] IP allowlist is disabled by default (all IPs can connect).
- [ ] Admin can enable allowlist and add IP or CIDR blocks from `/admin`.
- [ ] When enabled, requests from unlisted IPs return `403 Forbidden`.
- [ ] Requests from listed IPs are accepted (pass through to authentication).
- [ ] Adding `0.0.0.0/0` or similar (all IPs) is allowed but not recommended (warnings displayed).
- [ ] CLI flag `--clear-allowlist` clears the list and allows all IPs.
- [ ] Changes to allowlist take effect immediately (no restart required).

### 12.7 Security Headers

- [ ] All responses include `X-Content-Type-Options: nosniff`.
- [ ] All responses include `X-Frame-Options: DENY`.
- [ ] All API responses include `Cache-Control: no-store`.
- [ ] `/operator` and `/admin` HTML responses include appropriate `Content-Security-Policy` header.
- [ ] CSP does not allow unsafe external scripts or inline scripts (except inline CSS if necessary).

### 12.8 Sensitive Data Protection

- [ ] PIN hashes in configuration files are bcrypt hashes (cost factor 12).
- [ ] Bcrypt comparison is used for PIN verification (timing-safe comparison).
- [ ] Session tokens are not logged to console or files.
- [ ] API responses do not include PIN hashes, session tokens, or plaintext PINs.
- [ ] Error messages do not reveal whether authentication failed due to invalid PIN or rate limiting (avoid leaking information).
- [ ] Tunnel tokens are encrypted via Electron `safeStorage` API.

### 12.9 Logout and Session Termination

- [ ] `POST /auth/logout` endpoint exists and is callable by authenticated users.
- [ ] Logout clears the appropriate session cookie.
- [ ] Logout returns `200 OK` with success message.
- [ ] After logout, WebSocket connections are closed (if any).

### 12.10 WebSocket Authentication

- [ ] WebSocket upgrade requires valid session cookie.
- [ ] WebSocket without valid cookie is rejected (connection denied).
- [ ] WebSocket actions inherit the role of the authenticated session (operator or admin).
- [ ] Operator-level WebSocket actions cannot be called with an admin session only (if admin logs in as operator, they must use operator PIN or a separate operator session).

### 12.11 Configuration and CLI

- [ ] `--operator-pin=<pin>` CLI flag sets the operator PIN at startup.
- [ ] `--admin-pin=<pin>` CLI flag sets the admin PIN at startup.
- [ ] `--operator-session-timeout=<seconds>` configures operator session timeout.
- [ ] `--admin-session-timeout=<seconds>` configures admin session timeout.
- [ ] `--clear-allowlist` clears the IP allowlist and allows all IPs.
- [ ] Attempting to set identical operator and admin PINs returns an error and exits.

### 12.12 Error Responses

- [ ] `401 AUTH_REQUIRED` is returned for missing or invalid authentication.
- [ ] `403 Forbidden` is returned for valid authentication but insufficient permissions.
- [ ] `429 Too Many Requests` is returned for rate limit violations.
- [ ] Error response structure matches spec 02 format: `{ "error": { "code": "...", "message": "...", "details": {...} } }`.

---

## 13. Threat Mitigations Summary

| Threat | Mitigation | Spec Section |
|--------|-----------|---|
| Attendee guesses PIN | Rate limiting (5 failures → 5-min lockout); strong PIN length (4–8 chars) | Section 4 |
| Attendee accesses operator UI | PIN authentication on `/operator` | Section 2 |
| Unauthorized admin access | Separate admin PIN; role-based access control | Section 2 |
| Replay attack on session cookie | 128-bit random tokens; `SameSite=Strict` | Section 3.1–3.2 |
| Operator changes config mid-show | Show-mode admin lock; confirmation dialogs | Section 6 |
| XSS stealing session cookie | `HttpOnly` cookie flag; CSP headers | Section 8 |
| CSRF attacks | `SameSite=Strict` cookie flag; WebSocket uses same cookies | Section 8 |
| Unauthorized from guest Wi-Fi | IP allowlist (optional); PIN as gate | Section 5 |
| WAN tunnel interception | Use HTTPS tunneling provider (ngrok, Cloudflare) | Section 7 |

---

## Document Metadata

- **Spec Version**: 1.0
- **Date**: 2026-05-11
- **Status**: ACTIVE (v1)
- **Related Specs**: `02-api-state-contract.md`, `01-source-of-truth.md`
- **Author**: Security Hardening Task
- **Review Checklist**: Self-review (threat model, rate limiting thresholds, cookie flags, acceptance criteria).
