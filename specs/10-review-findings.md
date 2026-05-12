# PC On Air v1 — Cross-Spec Review Findings

**Review Date:** 2026-05-11  
**Reviewer:** Pre-implementation cross-spec review  
**Specs Reviewed:** 01 through 09  
**Status:** FINAL — Action required before implementation begins

---

## 1. Summary

The specs are well-structured and thorough. The product definition (spec 01), API contract (spec 02), and feature specs (03–09) show consistent product thinking. However, **there are enough contradictions and gaps to cause developer confusion or wasted work if left unresolved**. The most serious issues are:

1. A new `currentMode` value (`"media-library"`) is introduced in spec 04 but never added to the canonical state model in spec 02.
2. The URL mode API surface in specs 02, 06, and 07 uses three different endpoint signatures for the same actions.
3. The show-mode admin lock mechanism is defined differently between spec 08 and spec 09 — one allows PIN-based unlock via HTTP, the other requires physical machine access or a CLI flag.
4. The `abState` model in spec 02 is missing `displayTarget` and `sessionMode` fields that spec 06 says must be there.
5. Playlist CRUD endpoints are explicitly called out as missing in spec 04, but spec 01 lists playlist management as an acceptance criterion.

**Overall assessment:** Not ready to implement. At minimum, the Critical and Important items below must be resolved before a developer writes a single line of code. Estimated resolution time: 1–2 days of spec editing.

---

## 2. API/State Contract Consistency

### 2.1 Missing `"media-library"` Mode in AppState

**Spec 02** defines `currentMode` as `"slides" | "url" | "l3" | "idle"`.

**Spec 04** (section 2.3 and the `POST /api/media-library/take` endpoint) returns `{ "currentMode": "media-library" }` and references a `mediaLibrary` top-level state field. Neither is defined in spec 02's `AppState` interface.

**Impact:** A developer building the state model from spec 02 will not add `"media-library"` as a valid mode. A developer building the media library feature from spec 04 will return a mode value that the state model rejects. The `POST /api/media-library/take` response also references a `mediaLibrary` field that does not exist in `AppState`.

Spec 04 itself acknowledges this (section 4.5, item 4: "TBD") but leaves the resolution open. This is a blocking ambiguity.

**Required action:** Decide and document: does Media Library display use `"l3"` mode (as a variant), a new `"media-library"` mode (extend spec 02), or a separate field not tied to `currentMode`? Update spec 02 before implementation begins.

---

### 2.2 `abState` Missing `displayTarget` and `sessionMode` Fields

**Spec 02** defines `abState.instanceA` and `abState.instanceB` as:
```typescript
{
  url: string | null;
  isLoading: boolean;
  isReady: boolean;
}
```

**Spec 06** (section 2.3) says the AppState `abState` must include `displayTarget` and `sessionMode` per instance:
```typescript
{
  url: string | null;
  displayTarget: string | null;
  sessionMode: "persistent" | "ephemeral";
  isLoading: boolean;
  isReady: boolean;
}
```

**Impact:** A developer implementing the state model from spec 02 will omit these fields. A developer implementing URL mode from spec 06 will expect them. The WebSocket `state_patch` messages for URL loading/switching will silently drop these fields for WebSocket clients built against spec 02.

**Required action:** Add `displayTarget` and `sessionMode` to `abState` instance fields in spec 02.

---

### 2.3 `l3` AppState Missing Stack Depth

**Spec 02** defines `l3` as:
```typescript
{
  activeCueId: string | null;
  activeCueName: string | null;
  isStacking: boolean;
}
```

**Spec 04** (section 4.4) proposes extending `AppState` to include `l3Cues.stackSize` (number of currently stacked cues) and `l3Cues.availableCues` (the full cue list). The spec describes this as "forward-looking design" but does not resolve it.

Additionally, the WebSocket event in spec 04 (section 4.3) pushes `l3.availableCues` as a `state_patch` field — but `availableCues` is not part of the `l3` object in spec 02.

**Impact:** Clients built against spec 02 will ignore `availableCues` patches, meaning the Web UI won't know the available cue list unless it separately calls `GET /api/l3/cues`. This is workable but inconsistent — spec 04 implies this list is pushed via WebSocket while spec 02 has no room for it.

**Required action:** Decide whether `l3Cues` is part of `AppState` (update spec 02) or strictly a REST-only query (`GET /api/l3/cues`). Document the decision.

---

### 2.4 Playlist Endpoints Missing from All Specs

**Spec 01** (section 5.3) lists as an acceptance criterion: "Playlist management: Operator can queue (arm), trigger (take to output), and clear lower thirds; playlists (ordered lists) are configured in Admin and recallable by name from Operator view."

**Spec 04** (section 4.5, item 1) explicitly calls out: "TODO: Add `POST /api/playlists`, `GET /api/playlists`, etc." — but no spec defines these endpoints. They are absent from spec 02 entirely.

**Impact:** A developer has no spec to implement playlists against. This is a product requirement (spec 01 acceptance criterion) with zero API definition.

**Required action:** Either write playlist endpoints into spec 02 or spec 04 before implementation, OR explicitly defer playlists to v1.1 in spec 01 and remove from v1 acceptance criteria.

---

### 2.5 `POST /api/presets` in Spec 02 vs URL Preset Endpoints in Spec 06

**Spec 02** (section 2.8) defines URL preset management at:
- `GET /api/presets`
- `POST /api/presets`
- `DELETE /api/presets/:id`

**Spec 06** (section 7.3) defines URL preset management at completely different paths:
- `POST /api/admin/url/preset/create`
- `POST /api/admin/url/preset/update`
- `DELETE /api/admin/url/preset/:id`
- `GET /api/url/presets`

These are **two different API schemas for the same resource**. Spec 06 also adds a `sessionMode` field to presets that does not exist in spec 02's preset shape. Spec 02's `UrlPreset` has `{ id, name, url }`; spec 06's has `{ id, name, url, displayTarget, sessionMode, description, createdAt, updatedAt }`.

**Impact:** This is a direct contradiction. A developer will implement one schema and break the other. The Companion module spec (07) further uses its own action names (`load_url_preset`) that reference neither.

**Required action:** Consolidate URL preset endpoints to a single canonical path in spec 02. Recommend spec 06's richer model as the correct one (add `sessionMode`, `displayTarget`). Update spec 02 accordingly.

---

### 2.6 URL Load Endpoint Signature Mismatch

**Spec 02** defines: `POST /api/url` with body `{ url, display? }`

**Spec 06** defines: `POST /api/url/load` with body `{ url, displayTarget?, sessionMode?, instance? }`

**Spec 07 (Companion)** sends to: `POST /api/action` with body `{ action_id: "load_url", params: { url, display, session_mode } }`

Three different endpoint paths and field names for the same action. The Companion spec uses a generic `POST /api/action` dispatcher that is not defined in spec 02 at all.

**Impact:** If a developer implements spec 02 as the canonical API, the Companion module (built from spec 07) will fail to connect. If they implement spec 06's paths, spec 02's example workflows break.

**Required action:** Decide on one canonical URL load endpoint path and field names. Update spec 02 to be the definitive source. Spec 07's `POST /api/action` dispatcher either needs to be added to spec 02 or removed from spec 07 in favor of direct endpoint calls.

---

### 2.7 A/B Switch Endpoint Mismatch

**Spec 02** defines: `POST /api/ab/switch` with body `{ instance: "A" | "B" }`

**Spec 06** defines: `POST /api/url/switch` with body `{ instance: "B" }`

These are different paths. Spec 09 adds another path: `POST /api/reload-instance` for the reload operation and `GET /api/instance-status` for status polling — neither of which is in spec 02.

**Required action:** Canonicalize A/B switch to one path in spec 02. If URL-mode and Slides-mode use different switch endpoints, document why.

---

### 2.8 `POST /api/panic` Auth Level Contradiction

**Spec 09** (section 10.2) defines `POST /api/panic` as "(admin-only, operator-only)" — this is contradictory within the same parenthetical. In context, panic must be operator-accessible (operators trigger it during shows). This appears to be a typo.

**Required action:** Clarify that `POST /api/panic` requires operator or admin session. Update spec 09.

---

### 2.9 `GET /api/profiles` Declared Public in Spec 05

**Spec 05** (section 10.1) declares `GET /api/profiles` with `Authentication: None (public)`. Same for `GET /api/profiles/active`.

**Spec 08** states all endpoints require authentication. Exposing the list of profile names to unauthenticated users leaks information about the system's configuration.

**Required action:** Decide whether profile listing requires authentication. Recommend requiring at least operator-level authentication for consistency with spec 08.

---

### 2.10 `POST /auth/logout` Cookie Name Mismatch

**Spec 02** uses cookie name `pc-on-air-session`.  
**Spec 08** uses cookie names `pconair_operator_session` and `pconair_admin_session`.

These are different names across the same authentication system.

**Required action:** Standardize cookie names across specs 02 and 08.

---

### 2.11 `POST /api/slides/reload` Uses Query Parameter in Workflow Example

In spec 02, section 9.1, step 5: "Operator refreshes the peer instance via `POST /api/slides/reload?instance=B`" — this shows the `instance` parameter as a URL query parameter, but the endpoint definition (section 2.4) shows it as a JSON body field. Inconsistent usage.

**Required action:** Fix the workflow example in spec 02 to pass `instance` in the request body.

---

### 2.12 `INVALID_URL` Error Code Overloaded

**Spec 02** (section 4.2) maps `INVALID_URL` to both URL validation failures AND invalid hex color values (section 2.6, `POST /api/background`). Using the same error code for two unrelated validation errors will confuse clients.

**Required action:** Introduce `INVALID_COLOR` as a distinct error code for background/keying endpoint validation failures. Update the error table in spec 02.

---

### 2.13 `POST /api/l3/take` Missing `subtitle` Field

**Spec 02** (section 2.5) defines the `POST /api/l3/take` request body as `{ cueId?, name?, title?, theme? }`.

**Spec 04** shows `StillStoreItem` has an optional `subtitle` field, and spec 01 (section 2.2) lists `subtitle` as an optional CSV column for lower thirds. The `POST /api/l3/take` endpoint for inline cues should also accept `subtitle` but spec 02 does not include it.

**Required action:** Add `subtitle?` to the `POST /api/l3/take` request body in spec 02.

---

## 3. Slides Parity Gaps

All five ⚠️ Gap items in spec 03 are unresolved in other specs. Here is the status of each:

### Gap 1: Bitfocus Companion Button Feedback — Slide Position
**Status in other specs:** Spec 07 defines a `slide_at` feedback (section 6.4) that addresses this. The gap appears to be resolved by spec 07, though spec 03 was not updated to reflect this.

**Required action:** Mark Gap 1 as resolved in spec 03, citing spec 07, section 6.4. Verify the `slide_at` feedback logic matches what the original Companion module did.

---

### Gap 2: Latency Benchmarking
**Status in other specs:** Not addressed. Spec 01 (section 5.10) states "<50ms from action to display," but spec 03 (Gap 2) requires benchmarking against the original Slides Controller's "<500ms" threshold and documenting the result.

**Impact:** These targets contradict each other — spec 01 sets a 50ms requirement and spec 03 documents 500ms as the threshold from the original. Developers don't know which target to build for.

**Required action:** Reconcile the latency targets. Is 50ms a soft target or a hard requirement? Document that benchmarking is a pre-release task, not a pre-implementation blocker.

---

### Gap 3: Bitfocus Companion Module Full Feature Parity
**Status in other specs:** Spec 07 defines a comprehensive Companion module. Whether it achieves parity with the original requires code review of the original module (referenced at https://github.com/TomsFaire/PConAir.git). This cannot be resolved by spec editing — it requires inspection of the original source.

**Required action:** This is an implementation-phase task. Before the Companion module is declared complete, a developer must review the original source and validate all actions/variables/feedbacks match. Add this as a mandatory pre-release checklist item.

---

### Gap 4: HTML/CSS/JavaScript Rendering of Slides
**Status in other specs:** Not addressed. No spec discusses rendering fidelity differences between the original Slides Controller and PC On Air.

**Impact:** Rendering differences will only be discovered during testing. There is no specification for what "visually equivalent" means precisely.

**Required action:** This is an implementation-phase testing task, not a spec gap per se. Note it in spec 03 as a pre-release testing requirement. No spec changes needed.

---

### Gap 5: Bitfocus Companion Connection Reliability
**Status in other specs:** Spec 09 (section 7.3, Scenario 3) describes the recovery procedure for Companion disconnection but does not address the reliability testing. Spec 07 describes reconnection logic with exponential backoff. Neither spec defines acceptable reliability thresholds under degraded network conditions.

**Required action:** This is a testing task. Define a test: "connection must re-establish within 3 seconds of reconnection opportunity" (per spec 03 acceptance criterion). No blocking spec changes needed.

---

## 4. Security Coherence

### 4.1 Show Lock Mechanism: Two Incompatible Definitions

**Spec 08** (section 6) defines show-mode admin lock as follows:
- Admin activates lock via `/admin` UI.
- While locked, accessing `/admin` shows a PIN entry form.
- Admin enters PIN at `POST /auth/unlock-admin`.
- Admin PIN unlocks the route.
- Lock is **in-memory only** and clears on app restart.

**Spec 09** (section 1.2 and 7.6) defines it differently:
- Once Show Lock is active, `/admin` is inaccessible even with admin PIN.
- Unlock requires **physical machine access** (restart app or use `--unlock-admin-show` CLI flag).
- There is NO in-app unlock mechanism.
- Show Lock IS persisted across restarts (spec 09, section 11.1: "Show Lock state is persisted in configuration").

These are **directly contradictory** on three dimensions:
1. Can admin PIN unlock it in-app? Spec 08 says yes; spec 09 says no.
2. Does it persist across restarts? Spec 08 says no (in-memory); spec 09 says yes (persisted).
3. Is there an HTTP endpoint for unlock? Spec 08 defines `POST /auth/unlock-admin`; spec 09 says no such mechanism exists.

**Impact:** This is the most operationally significant contradiction in the spec set. A developer implementing spec 08 will build a PIN-unlock flow. A developer implementing spec 09 will make it physically impossible to unlock remotely. These behaviors cannot coexist.

**Required action (Critical):** Decide which model is correct before any implementation. Recommendation: spec 09's model is more secure (physical unlock). If adopted, remove `POST /auth/unlock-admin` from spec 08 and update spec 02's protected routes table.

---

### 4.2 Companion Authentication: PIN in Query Parameter

**Spec 07** (section 2) states the Companion module sends the operator PIN as a URL query parameter: `?operator_pin=<pin>`.

**Spec 08** does not address this. However, query parameters appear in server access logs, proxy logs, browser history, and Companion debug output. Sending a PIN as a query parameter is a security risk — it is less safe than a header or cookie-based approach.

**Spec 02** and spec 08 use session cookies exclusively; no other authentication transport is defined.

**Impact:** Companion integration would require a different auth mechanism than every other client, with weaker security properties.

**Required action:** Define how Companion authenticates via WebSocket. Options: (a) send PIN as a JSON message on first WebSocket frame after connection (already partially described in spec 07 section 2), (b) require Companion to obtain a session token via `POST /auth/operator` first, then send the cookie in WebSocket upgrade headers. Remove or deprecate the query parameter approach.

---

### 4.3 IP Allowlist Applied to WebSocket Endpoint

**Spec 08** (section 5.1) states "only requests from IPs in the allowlist can access any route (`/operator`, `/admin`, `/api/*`, `/ws`)." The WebSocket endpoint `/ws` is explicitly listed.

**Impact:** If Companion connects from a different machine (common configuration), and an IP allowlist is enabled, Companion will be blocked unless its IP is included. This is operationally correct but needs to be documented in spec 07 as a requirement for operators to configure.

**Required action:** Add a note in spec 07 (Module Configuration) warning that IP allowlists must include Companion's IP address. No spec contradiction, but a documentation gap.

---

### 4.4 `POST /auth/logout` Does Not Invalidate Server-Side Token

**Spec 08** (section 10.1) defines logout as: "Does not invalidate the token server-side (in-memory tokens are discarded on restart anyway)."

This means a captured session cookie remains valid until its `Max-Age` expires (8 hours for operator, 4 hours for admin) even after logout. This weakens the protection against the replay attack threat scenario defined in spec 08, section 1.1.

**Impact:** An attacker who captures a session cookie can continue using it after the legitimate user logs out. For an event-focused app this is a known tradeoff, but it contradicts the replay attack mitigation stated in the threat model.

**Required action:** Either (a) maintain a server-side token revocation list (add invalidated tokens to a set, check on each request), or (b) explicitly document in spec 08 that logout provides client-side cleanup only and does not prevent replayed captured tokens. The decision should be documented.

---

### 4.5 Admin Actions in Spec 02 Protected Routes Table vs Spec 08

**Spec 02** (section 5.2, protected routes table) lists `/api/presets` as requiring "operator" role, with the note "creation/deletion may be restricted to admin in future versions."

**Spec 08** (section 2.1, admin permitted actions) explicitly lists "Create, update, delete URL presets" as admin-only.

**Spec 04** (section 1.7) also says CSV import, image upload, theme installation, and cue deletion are admin-only.

**Impact:** If a developer builds from spec 02's table, they will make preset creation an operator-level action. If they build from spec 08's permissions section, it's admin-only. This affects what the operator Web UI can do.

**Required action:** Update spec 02's protected routes table to correctly reflect admin-only operations. At minimum: `POST /api/presets` and `DELETE /api/presets/:id` should be admin-only.

---

### 4.6 `GET /api/health` Authorization Header vs Cookie

**Spec 09** (section 10.1) shows `GET /api/health` using `Authorization: Bearer <admin-session-token>` in the request example.

**Spec 02** and spec 08 define authentication exclusively via session cookies. There is no Bearer token mechanism anywhere else in the specs.

**Impact:** A developer building the health endpoint may implement Bearer token auth for this one endpoint while every other endpoint uses cookies — an inconsistent authentication approach.

**Required action:** Update the spec 09 health endpoint example to use cookie-based authentication (consistent with the rest of the API).

---

## 5. Cross-Spec Contradictions

### 5.1 Operator Can / Cannot Create Manual Lower Third Entries

**Spec 04** (section 1.7, admin vs operator access table) says manual lower third entry is operator-only (checkmark under Operator, X under Admin).

**Spec 01** (section 2.2) says "manual entry" is listed under Lower Thirds Mode without specifying role.

**Spec 08** (section 2.1) lists "Create, update, delete lower thirds cues" under admin permitted actions, with forbidden for operator.

This is a direct contradiction: spec 04 says operators create manual L3 entries; spec 08 says only admins can.

**Required action:** Decide and document. The most logical interpretation (for show-time usability) is that operators can enter inline lower thirds from `/operator` (ad-hoc name/title/theme that is not saved), while admins manage the saved Still Store library. If this is the intent, spec 04's table is correct and spec 08's "Create lower thirds cues" means the saved library only.

---

### 5.2 Stacking Toggle: Operator vs Admin

**Spec 04** (section 1.7) says "Toggle stacking mode" is operator-only.

**Spec 08** does not list stacking toggle under admin permitted actions, implying operators can do it.

**Spec 01** is silent on who can toggle stacking.

These are consistent, but spec 08 does not explicitly confirm operators can toggle stacking. Since spec 08 defines operator permitted actions (section 2.1), and stacking toggle is not listed, there is a gap.

**Required action:** Add "Toggle lower thirds stacking mode" to the operator permitted actions list in spec 08 section 2.1.

---

### 5.3 `UrlPreset` Interface Defined Twice with Different Shapes

**Spec 05** (section 2.2) defines `UrlPreset` as:
```typescript
{ id, name, url, displayTarget, createdAt, updatedAt }
```
(No `sessionMode`, no `description`)

**Spec 06** (section 5.1) defines `UrlPreset` as:
```typescript
{ id, name, url, displayTarget?, sessionMode, description?, createdAt, updatedAt }
```

These are different TypeScript interfaces for the same entity. Spec 06's version is richer and correct per the URL mode feature spec. Spec 05 defines the shape as part of the `ShowProfile` export bundle schema.

**Impact:** A developer implementing the export bundle (spec 05) will use the simpler shape. A developer implementing URL mode (spec 06) will use the richer one. Exported bundles will be missing `sessionMode`, causing import failures when the importing app tries to load presets with that field.

**Required action:** Update spec 05's `UrlPreset` interface to match spec 06's (add `sessionMode` and `description`).

---

### 5.4 Timestamp Types: `number` vs `string`

**Spec 04** uses `createdAt: number` (Unix timestamp in milliseconds) for `StillStoreItem` and `MediaLibraryItem`.

**Spec 05** uses `createdAt: string` (ISO 8601) for `ShowProfile`, `UrlPreset`, `BackgroundPreset`, and in the bundle index schemas.

**Spec 06** uses `createdAt: string` (ISO 8601) for `UrlPreset`.

Mixed timestamp formats will cause serialization bugs, especially in export bundles that include both Still Store items (number) and profile metadata (string).

**Required action:** Standardize on one format. Recommendation: ISO 8601 strings throughout (consistent with JSON best practices and spec 05/06). Update spec 04 to use `string` for all timestamp fields.

---

### 5.5 Companion Uses `slides_goto` with 1-Based Index; API Uses 0-Based Index

**Spec 03** (feature table, "Go to Specific Slide Number") says the jump action uses "1-based index number."

**Spec 07** (section 4.2, `slides_goto` action) sends `slide_number` described as "slide number (1-based)."

**Spec 02** (section 2.4, `POST /api/slides/goto`) uses `slideIndex` as "0-based index."

The Companion module sends a 1-based number to an endpoint that expects a 0-based index. The server will display the wrong slide (always one slide behind), or throw `SLIDE_OUT_OF_RANGE` when requesting the last slide.

**Required action (Critical):** Either (a) the server converts Companion's 1-based number to 0-based internally, OR (b) spec 07 must specify that `slides_goto` sends a 0-based index. Document this explicitly. The `slide_index` Companion variable also needs clarity: spec 07 says it's "1-based" but it comes from `AppState.slides.slideIndex` which is 0-based (spec 02). Either the module converts on read, or there's a silent off-by-one everywhere.

---

### 5.6 `DELETE /api/admin/url/preset/:id` Returns 200 in Spec 06, Should Be 204

**Spec 06** (section 7.3) defines `DELETE /api/admin/url/preset/:id` returning `200 OK` with body `{ "success": true, "message": "Preset deleted" }`.

**Spec 02** (section 4.3, HTTP status codes) states 204 No Content is used for successful delete operations. `DELETE /api/presets/:id` in spec 02 returns 204.

**Required action:** Standardize delete responses. Recommend 204 No Content for consistency. Update spec 06.

---

### 5.7 `ShowProfile.operatorPinHash` and `adminPinHash` Exposed in `GET /api/profiles/:id`

**Spec 05** (section 10.1, `GET /api/profiles/{profileId}`) returns the full profile JSON including `operatorPinHash` and `adminPinHash`.

**Spec 08** (section 9.4) states: "Bcrypt PIN hashes — not in responses; can be in secure config files."

These directly contradict each other. The profile GET endpoint would expose bcrypt hashes via API.

**Required action:** Strip `operatorPinHash` and `adminPinHash` from the `GET /api/profiles/:id` response body. These fields should never be returned in API responses. Update spec 05.

---

### 5.8 Session Duration Inconsistency

**Spec 02** sets operator `Max-Age: 28800` (8 hours) but does not mention admin session duration.

**Spec 08** sets both: operator 8 hours (`Max-Age=28800`), admin 4 hours (`Max-Age=14400`).

**Spec 05** `AppPreferences` includes `operatorSessionDurationMinutes` and `adminSessionDurationMinutes` as configurable profile settings.

There is no contradiction per se, but spec 02 should reference that session durations are configurable per profile (from spec 05) rather than hardcoded. Otherwise a developer building from spec 02 will hardcode the values.

**Required action:** Add a note in spec 02, section 5.1, that `Max-Age` values are configurable via profile settings (see spec 05, `AppPreferences`).

---

## 6. Recommended Actions

### Critical (block implementation)

| # | Issue | Spec(s) | Action |
|---|-------|---------|--------|
| C1 | Show Lock unlock mechanism contradicts between specs | 08 vs 09 | Decide: PIN unlock (spec 08) or physical-only (spec 09). Remove the losing option. |
| C2 | `"media-library"` mode undefined in AppState | 02, 04 | Add mode and field to spec 02, or define alternative approach. |
| C3 | URL preset endpoints exist at two different API paths | 02 vs 06 | Consolidate to one canonical path in spec 02. |
| C4 | `slides_goto` off-by-one (Companion 1-based vs API 0-based) | 02, 07 | Document conversion responsibility; clarify `slide_index` variable base. |
| C5 | Playlists are an acceptance criterion with no API definition | 01, 04 | Either spec the endpoints or explicitly defer to v1.1. |
| C6 | `operatorPinHash`/`adminPinHash` exposed in profile GET response | 05, 08 | Strip PIN hashes from `GET /api/profiles/:id` response. |

### Important (fix before development of affected module begins)

| # | Issue | Spec(s) | Action |
|---|-------|---------|--------|
| I1 | `abState` missing `displayTarget` and `sessionMode` fields | 02, 06 | Add fields to spec 02's `abState` interface. |
| I2 | Operator vs admin for manual L3 entry contradicts | 04 vs 08 | Define inline (ad-hoc) vs saved cue distinction; update permissions tables. |
| I3 | `UrlPreset` interface defined twice with different shapes | 05 vs 06 | Update spec 05 to use spec 06's richer shape. |
| I4 | Timestamp type inconsistency (`number` vs `string`) | 04, 05, 06 | Standardize on ISO 8601 strings throughout. |
| I5 | Companion auth via query parameter is insecure and inconsistent | 07, 08 | Define WebSocket auth mechanism; remove query parameter approach. |
| I6 | Latency target contradiction (50ms in spec 01 vs 500ms in spec 03) | 01, 03 | Reconcile and document the single authoritative target. |
| I7 | Cookie name mismatch (`pc-on-air-session` vs `pconair_operator_session`) | 02, 08 | Standardize cookie names in both specs. |
| I8 | Preset creation/deletion role: spec 02 says operator, spec 08 says admin | 02, 08 | Update spec 02 routes table: `POST`/`DELETE /api/presets` are admin-only. |
| I9 | `POST /api/panic` auth level says "(admin-only, operator-only)" | 09 | Fix to "operator or admin." |

### Minor (clean up before or during development)

| # | Issue | Spec(s) | Action |
|---|-------|---------|--------|
| m1 | `slides/reload` uses query param in workflow example, body param in definition | 02 | Fix workflow example in section 9.1. |
| m2 | `INVALID_URL` error code overloaded for URLs and hex colors | 02 | Add `INVALID_COLOR` error code. |
| m3 | `POST /api/l3/take` missing `subtitle` field | 02 | Add `subtitle?` to request body definition. |
| m4 | `l3` AppState ambiguity: `availableCues` in WebSocket patch not in interface | 02, 04 | Decide and document whether cue list is in AppState or REST-only. |
| m5 | Gap 1 in spec 03 is resolved by spec 07; spec 03 not updated | 03, 07 | Mark Gap 1 resolved in spec 03 with reference to spec 07 section 6.4. |
| m6 | Stacking toggle not listed under operator permitted actions in spec 08 | 08 | Add to operator permitted actions list. |
| m7 | `GET /api/health` uses Bearer token auth, inconsistent with cookie pattern | 09 | Update example to use cookie auth. |
| m8 | `DELETE` endpoint in spec 06 returns 200, spec 02 convention is 204 | 06 | Standardize to 204 No Content. |
| m9 | `GET /api/profiles` declared public (no auth) | 05 | Require at least operator auth. |
| m10 | IP allowlist behavior for Companion not documented in Companion spec | 07 | Add note about allowlist configuration requirement. |
| m11 | Session duration hardcoded in spec 02, configurable in spec 05 | 02, 05 | Add cross-reference note in spec 02, section 5.1. |
| m12 | Logout does not revoke server-side token; replay attack remains | 08 | Document the tradeoff explicitly in spec 08. |

---

## 7. Implementation Order Recommendation

Based on dependencies between specs, the following build order minimizes blocked work:

### Phase 1: Foundation (no dependencies, unblock everything else)
1. **Resolve all Critical spec contradictions** (see Section 6) before writing code.
2. **Core state model and API server** (spec 02) — the contract everything builds against.
3. **Auth system** (spec 08, spec 02 section 5) — PIN hashing, session cookies, rate limiting. Everything downstream requires auth.
4. **Profiles and persistence layer** (spec 05) — the configuration backbone. All features store data in profiles. Build read/write before feature data exists.

### Phase 2: Core Output Modes (can be built in parallel after Phase 1)
5. **Slides mode** (spec 02 sections 2.4, spec 03) — the primary parity requirement; de-risk first.
6. **URL mode** (spec 06) — builds on A/B state; straightforward once spec contradictions (C3) are resolved.
7. **Background/keying** (spec 02 section 2.6) — simple, needed by all modes.
8. **Display enumeration** (spec 06 section 3, spec 02 section 2.7) — needed by URL mode multi-display routing.

### Phase 3: Lower Thirds (after Phase 2, highest internal complexity)
9. **Still Store data model and ingest** (spec 04 section 1) — CSV import, image upload, CSS themes.
10. **Still Store rendering engine** (spec 04 section 1.3) — headless browser; most complex piece; build before UI.
11. **Media Library** (spec 04 section 2) — simpler than Still Store; no rendering required.
12. **Stacking system** (spec 04 section 1.4) — requires Still Store items to exist.
13. **Playlists** — only after the playlist API is defined (see C5).

### Phase 4: Integrations (after core modes are working)
14. **Bitfocus Companion module** (spec 07) — requires stable API endpoints and WebSocket events.
15. **Export/import bundles** (spec 05) — requires all data models to be stable; can be built last without blocking other features.
16. **Reliability features** (spec 09) — watchdog, panic button, health endpoint, arm/take UX. Build on top of stable output infrastructure.

### Phase 5: Security hardening and final testing
17. **IP allowlist, show lock, security headers** (spec 08 remaining items) — easier to layer on after the core is built.
18. **Companion parity verification** (spec 03 Gap 3) — verify against original source code.
19. **Latency benchmarking** (spec 03 Gap 2) — measure and document against resolved latency target.
20. **Rendering fidelity testing** (spec 03 Gap 4) — visual comparison with original.

### Implementation snapshot (2026-05-12)

The phase list above is still the **recommended dependency order** for greenfield planning. The **live codebase** has progressed unevenly across phases: foundation and core modes are largely done; L3 ingest/themes/media library APIs and profiles export·import exist; **`set_display`** is implemented in-app; IP allowlist and security headers are present; operator UI covers slides, URL, L3, and media library; a Companion package lives under `packages/companion-module-pconair/` but release parity QA remains.

**Canonical file-level status** (what shipped, what is left, test layout) is maintained in **`11-implementation-status.md`**, which is updated more frequently than this section.

---

## Post-Fix Review

**Review Date:** 2026-05-11  
**Reviewer:** Post-implementation cross-spec verification  
**Files Checked:** `02-api-state-contract.md`, `05-profiles-bundles-backups.md`, `06-url-mode-multi-display.md`, `07-companion-module.md`, `09-reliability-runbook.md`

### Critical Issues — Verification Results

| # | Issue | Status | Evidence |
|---|-------|--------|----------|
| C1 | Show Lock unlock mechanism contradiction | ✅ FIXED | Spec 09 §1.2 and §7.6 now establish PIN-based in-app unlock (`POST /auth/unlock-admin`) as the primary path; restart and `--reset-admin-pin` are emergency-only (PIN forgotten). Show Lock is documented as in-memory only (§11.1 acceptance criteria). The original contradiction — spec 09 previously requiring physical access always — is resolved. |
| C2 | `"media-library"` mode undefined in AppState | ✅ FIXED | Spec 02 `AppState.currentMode` now includes `"media-library"`. A `mediaLibrary: { activeItemId, activeItemName }` field is added to `AppState`. Mode semantics documented in §1.2. |
| C3 | URL preset endpoints at two different API paths | ✅ FIXED | Spec 06 §7.3 now contains an explicit note: "The canonical URL preset endpoint paths are defined in `02-api-state-contract.md`, Section 2.8. All implementations must use those paths." All three admin CRUD entries in spec 06 use `GET/POST /api/presets` and `DELETE /api/presets/:id`. Spec 02 §2.8 has a reciprocal cross-reference to spec 06. The `UrlPreset` interface in spec 02 §2.8 now includes `sessionMode`, `displayTarget`, and `description` (the richer shape from spec 06). |
| C4 | `slides_goto` off-by-one (Companion 1-based vs API 0-based) | ✅ FIXED | Spec 07 §4.2 now explicitly documents `slide_number` as 1-based and states the module adapter subtracts 1 before calling `POST /api/slides/goto`. The `slide_index` variable (§5) is documented as "1-based for display (converted from 0-based `AppState.slides.slideIndex`)". Spec 02 §2.4 (`POST /api/slides/goto`) now states `slideIndex` is 0-based and cross-references spec 07 for the conversion. |
| C5 | Playlist endpoints missing (acceptance criterion with no API) | ✅ FIXED | Spec 02 now has a complete §2.9 "L3 Playlist Management" with six endpoints: `GET /api/l3/playlists`, `POST /api/l3/playlists`, `GET /api/l3/playlists/:id`, `PUT /api/l3/playlists/:id`, `DELETE /api/l3/playlists/:id`, `POST /api/l3/playlists/:id/activate`. The `l3` state object in `AppState` now includes `currentPlaylistId: string | null`. |
| C6 | `operatorPinHash`/`adminPinHash` exposed in profile GET | ✅ FIXED | Spec 05 §10.1 now includes an explicit "Note on PIN hashes" block stating hashes are never returned. The `GET /api/profiles/{profileId}` response now returns `hasPins: { operator: boolean, admin: boolean }` instead of raw hash fields. §11.2 acceptance criteria also confirms this behaviour. |

### Important Issue — Verification Result

| # | Issue | Status | Notes |
|---|-------|--------|-------|
| I1 | `abState` missing `displayTarget` and `sessionMode` fields | ✅ FIXED | Spec 02 `AppState.abState.instanceA` and `instanceB` now include `displayTarget: string \| null` and `sessionMode: "persistent" \| "ephemeral"`. Semantics documented in §1.2. The `GET /api/status` example response also shows both fields. |

### Remaining Issues

The following Important and Minor issues from the original review were **not in scope** for this fix pass and remain open. They should be resolved before the relevant module enters development:

**Important (still open):**
- **I2**: Operator vs admin permissions for manual L3 entry (spec 04 vs spec 08 contradiction)
- **I3**: `UrlPreset` interface in spec 05 now matches spec 06 (this was resolved as a side-effect of C3 — spec 05 §2.2 now carries a note pointing to spec 02 §2.8 as canonical, and its interface includes `sessionMode` and `description`)
- **I4**: Timestamp type inconsistency (`number` in spec 04 vs `string` in spec 05/06) — still open
- **I5**: Companion auth via query parameter is insecure and inconsistent with cookie pattern — still open
- **I6**: Latency target contradiction (50ms in spec 01 vs 500ms in spec 03) — still open
- **I7**: Cookie name mismatch (`pc-on-air-session` vs `pconair_operator_session`) — still open
- **I8**: Preset creation/deletion role: spec 02 protected routes table still lists `/api/presets` as operator-level (the new §2.8 note says creation/deletion are admin-only, but the §5.2 protected routes table still says "operator") — **partially fixed; routes table needs update**
- **I9**: `POST /api/panic` auth level says "(admin-only, operator-only)" — still contradictory in spec 09 §10.2

**Minor (still open):** m1–m12 as listed in original review (none were in scope for this fix pass), with the exception of m8 (DELETE 200 vs 204): spec 06 §7.3 now returns 204 No Content for `DELETE /api/presets/:id`, consistent with spec 02 convention. ✅ Resolved as side-effect.

### Overall Go/No-Go Status

**GO — cleared for implementation of core modules.**

All 6 Critical issues are resolved. The `abState` Important issue (I1) is also resolved. The remaining open issues are scoped to specific modules:

- **Safe to start now**: Core state model and API server (spec 02), auth system, profiles persistence, slides mode, URL mode, media library, background/keying, display enumeration. Spec 02 is now internally consistent and complete enough to implement against.
- **Resolve before Companion module development**: I5 (query param auth), I7 (cookie name), and the Companion-specific sections of I4/I6.
- **Resolve before auth/security hardening**: I9 (`POST /api/panic` role typo), I7 (cookie name).
- **Resolve before playlist UI development**: I2 (L3 operator vs admin permissions) — playlists now have an API but the role assignment for manual vs saved cues needs clarification.
- **Partially open**: I8 — spec 02 §5.2 protected routes table should be updated to reflect `POST /api/presets` and `DELETE /api/presets/:id` as admin-only (the §2.8 note says this correctly, but the table in §5.2 still says "operator").

---

## Document Metadata

- **Review Version:** 1.1
- **Date:** 2026-05-11
- **Status:** UPDATED — Post-fix verification complete
- **Critical Issues Resolved:** 6 of 6
- **Important Issues Resolved:** 2 of 9 (I1 fully; I3 and m8 as side-effects)
- **Blocking:** No — critical items resolved; remaining issues are module-scoped
