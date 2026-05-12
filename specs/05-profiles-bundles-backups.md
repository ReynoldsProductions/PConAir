# PC On Air v1 — Show Profiles, Export Bundles, and Backup/Restore

## Overview

A **show profile** is a named configuration set that captures everything needed to run a specific show. Profiles enable operators to switch between entirely different configurations (different decks, presets, keying settings, etc.) without manual reconfiguration. **Export bundles** (`*.zip` files) enable portable sharing and archival of complete show configurations including all assets. **Backups** provide automatic and manual recovery mechanisms to protect against data loss.

This spec defines:
1. Profile schema and storage
2. Export bundle format and import workflow
3. Backup strategy (automatic + manual)
4. CLI flag for profile selection
5. API endpoints for profile CRUD, export, and import
6. Schema migration strategy for future versions

---

## 1. Show Profile Concept

A profile is a complete, self-contained configuration set. It includes:

- **URL presets** — saved presentation and live URL slots (name, URL, target display)
- **Still Store** — all lower thirds cues and associated assets (items, themes, rendered images)
- **CSS themes** — custom theme templates (included in bundle)
- **Background presets** — luma key and solid color configurations
- **Operator and Admin PINs** — stored as bcrypt hashes (never plaintext)
- **Display preference** — which physical display is designated for Program output
- **Companion settings** — connection host and port for Bitfocus Companion
- **WAN tunneling settings** — provider (ngrok) and authentication token
- **App preferences** — stacking toggle default, session duration, IP allowlist, admin lockdown flag

**Multiple profiles**: The app supports many profiles (e.g., "Morning Show", "Evening News", "Event A"). One profile is **active** at a time. Switching profiles requires an app restart or graceful reload.

**Active profile indicator**: The Web UI (`/operator` and `/admin` routes) displays the currently active profile name in the header or sidebar.

---

## 2. Profile Schema v1

All profiles follow a versioned JSON schema. The schema version is explicitly declared so future versions can be migrated automatically.

### 2.1 TypeScript Interface: ShowProfile

```typescript
interface ShowProfile {
  // Schema versioning
  schemaVersion: "1.0";

  // Core identifiers
  id: string;              // UUID
  name: string;            // Human-readable profile name (e.g., "Morning Show")
  createdAt: string;       // ISO 8601 timestamp
  updatedAt: string;       // ISO 8601 timestamp

  // URL and Slides presets
  urlPresets: UrlPreset[];

  // Background and keying presets
  backgroundPresets: BackgroundPreset[];

  // Display routing
  displayPreference: string | null;   // display ID or null for default

  // Third-party integrations
  companionSettings: CompanionSettings;
  tunnelSettings: TunnelSettings;

  // App-level configuration
  appPreferences: AppPreferences;

  // Authentication (hashed)
  operatorPinHash: string;  // bcrypt hash of operator PIN
  adminPinHash: string;     // bcrypt hash of admin PIN

  // Still Store and themes (included in bundle; separate persistence for large assets)
  stillStoreIncluded: boolean;    // True if still-store data is bundled with profile
  themesIncluded: boolean;        // True if custom themes are bundled
}
```

### 2.2 TypeScript Interface: UrlPreset

> **Note:** The canonical `UrlPreset` shape is defined in `02-api-state-contract.md`, Section 2.8. This interface mirrors that definition for use in export bundles.

```typescript
interface UrlPreset {
  id: string;                             // UUID
  name: string;                           // Human-readable name (e.g., "Slido Poll 1") — ≤ 100 chars
  url: string;                            // Full URL (http/https)
  displayTarget: string | null;           // display ID, "primary", or null for default Program output
  sessionMode: "persistent" | "ephemeral"; // Session mode for this preset
  description?: string;                   // Optional description — ≤ 500 chars
  createdAt: string;                      // ISO 8601
  updatedAt: string;                      // ISO 8601
}
```

### 2.3 TypeScript Interface: BackgroundPreset

```typescript
interface BackgroundPreset {
  id: string;              // UUID
  name: string;            // Human-readable name (e.g., "Studio Green")
  type: "luma" | "solid";  // "luma" for chroma key, "solid" for solid background
  value: string;           // Hex color (#RRGGBB)
  createdAt: string;       // ISO 8601
  updatedAt: string;       // ISO 8601
}
```

### 2.4 TypeScript Interface: CompanionSettings

```typescript
interface CompanionSettings {
  enabled: boolean;        // True if Companion integration is active
  listenPort: number;      // Port Companion connects to (e.g., 8080)
}
```

### 2.5 TypeScript Interface: TunnelSettings

```typescript
interface TunnelSettings {
  provider: "ngrok" | "none";  // "ngrok" for ngrok tunneling; "none" for local-only
  token: string;               // ngrok API token (encrypted in storage; plaintext in transit if needed)
  region: string;              // ngrok region (e.g., "us", "eu", "au")
}
```

### 2.6 TypeScript Interface: AppPreferences

```typescript
interface AppPreferences {
  // Stacking behavior for lower thirds
  defaultStackingEnabled: boolean;      // True if new L3 cues stack; false if they replace

  // Session timeouts (minutes)
  operatorSessionDurationMinutes: number;  // How long operator session stays active (e.g., 60)
  adminSessionDurationMinutes: number;     // How long admin session stays active (e.g., 240)

  // Security
  ipAllowlist: string[] | null;         // Array of allowed IP addresses (CIDR notation); null = no restriction
  adminLockOnShow: boolean;             // True to disable /admin route during live show (manual toggle)

  // Display and UI
  operatorUiScale: number;              // UI scale factor (e.g., 1.0, 1.2); optional, defaults to 1.0
}
```

---

## 3. Profile Storage Layout

Profiles are stored locally on the machine running PC On Air. Platform-specific paths:

### 3.1 macOS

```
~/Library/Application Support/pc-on-air/
├── profiles/                          # Active profiles directory
│   ├── profile-{id}.json              # Individual profile JSON (loaded on startup/switch)
│   └── ...
├── active-profile.json                # Current active profile: { "id": "...", "name": "..." }
└── backups/                           # Automatic and manual backups
    ├── {profileName}-backup-{id}-{timestamp}.json
    └── ...
```

### 3.2 Linux (Future Support)

```
~/.config/pc-on-air/
├── profiles/
├── active-profile.json
└── backups/
```

### 3.3 Windows (Future Support)

```
%APPDATA%\pc-on-air\
├── profiles\
├── active-profile.json
└── backups\
```

### 3.4 Naming Convention

- **Profile file**: `profile-{uuid}.json` where `uuid` is the profile's `id` field
- **Active profile marker**: `active-profile.json` (always exactly one)
- **Backup file**: `{profileName}-backup-{backupId}-{timestamp}.json` where `timestamp` is ISO 8601 (e.g., `Morning Show-backup-a1b2c3d4-2025-05-11T14-30-45Z.json`)

---

## 4. Export Bundle Format

An **export bundle** is a `.zip` file containing a complete, portable profile along with all its assets (Still Store items, themes, media library files).

### 4.1 Bundle Filename Convention

```
pc-on-air-{profileName}-{YYYY-MM-DD}.zip
```

Example: `pc-on-air-Morning Show-2025-05-11.zip`

### 4.2 Bundle Contents (Directory Structure Inside Zip)

```
{bundleRoot}/
├── profile.json                       # The profile JSON (schemaVersion, all presets, settings)
├── still-store/
│   ├── index.json                     # Array of StillStoreItem metadata (no large assets inline)
│   ├── assets/                        # Original image uploads
│   │   ├── {itemId}.{ext}             # Uploaded image file (preserves format: png, jpg, gif, webp, svg)
│   │   └── ...
│   └── renders/                       # Pre-rendered 1920×1080 PNG files
│       ├── {itemId}.png               # Rendered output for manual/CSV items
│       └── ...
├── themes/                            # Custom CSS themes (built-in themes NOT included)
│   ├── {themeName}.css                # CSS template file
│   └── ...
├── media-library/
│   ├── index.json                     # Array of MediaLibraryItem metadata
│   └── files/
│       ├── {itemId}.{ext}             # Original media file
│       └── ...
└── bundle-metadata.json               # Bundle info (creation time, app version that created it)
```

### 4.3 Profile JSON Inside Bundle

The `profile.json` in the bundle is the complete ShowProfile object (schemaVersion, all presets, PINs as hashes, etc.). It is self-contained; no external references.

### 4.4 Still Store Index Schema

**still-store/index.json:**
```typescript
interface StillStoreExport {
  version: "1.0";
  items: Array<{
    id: string;
    name: string;
    title: string;
    subtitle?: string;
    theme: string;
    sourceType: "manual" | "csv" | "image";
    originalImageFormat?: "png" | "jpg" | "gif" | "webp" | "svg";
    originalImagePath?: string;  // Relative to bundle root (still-store/assets/...)
    originalImageWidth?: number;
    originalImageHeight?: number;
    renderedPngPath?: string;     // Relative to bundle root (still-store/renders/...)
    tags?: string[];
    createdAt: string;            // ISO 8601
    updatedAt: string;            // ISO 8601
  }>;
  themes: Array<{
    name: string;
    displayName: string;
    description?: string;
    previewImageUrl?: string;
    isBuiltIn: boolean;
  }>;
}
```

### 4.5 Media Library Index Schema

**media-library/index.json:**
```typescript
interface MediaLibraryExport {
  version: "1.0";
  items: Array<{
    id: string;
    name: string;
    type: "image" | "video" | "other";
    fileFormat: string;           // e.g., "png", "jpg", "mp4"
    filePath: string;             // Relative to bundle root (media-library/files/...)
    fileSize: number;             // Bytes
    width?: number;               // For images
    height?: number;              // For images
    duration?: number;            // Seconds, for video
    tags?: string[];
    createdAt: string;            // ISO 8601
    updatedAt: string;            // ISO 8601
  }>;
}
```

### 4.6 Bundle Metadata

**bundle-metadata.json:**
```typescript
interface BundleMetadata {
  version: "1.0";
  createdAt: string;              // ISO 8601, when bundle was exported
  appVersion: string;             // Version of PC On Air that created the bundle (e.g., "1.0.0")
  profileId: string;              // UUID of the profile contained
  profileName: string;            // Name of the profile
}
```

### 4.7 Bundle Size and Asset Inclusion

- **Still Store**: Included in bundle by default (all items, renders, and original images). If a profile has no Still Store items, the `still-store/` directory is omitted from the bundle.
- **Media Library**: Included in bundle by default. If empty, `media-library/` is omitted.
- **Themes**: Only custom (user-uploaded) themes are included. Built-in themes are not bundled (the importing app provides them).
- **PINs**: bcrypt hashes are included (safe for sharing with trusted team members). Never plaintext.

---

## 5. Import Workflow

Importing a bundle is a multi-step process with validation, diff display, and conflict resolution.

### 5.1 Admin Upload and Validation

**UI Flow (Admin Route `/admin`):**

1. Admin navigates to **Configuration** → **Import Profile** (or similar).
2. Admin selects a `.zip` file via file picker.
3. App validates the bundle:
   - Checks `profile.json` exists and is valid JSON.
   - Checks `schemaVersion` is recognized (currently "1.0").
   - Verifies required directories and files are present.
   - If validation fails, show clear error message and stop.

### 5.2 Diff Summary

Once validated, the app displays a **diff summary** showing:

```
Profile: Morning Show (created 2025-05-10)

What's New:
  - URL Preset: "Slido Poll 1" (new)
  - Background Preset: "Studio Green" (new)
  - Still Store: 12 items (new)
    - John Doe, CEO
    - Jane Smith, VP Sales
    - ... (list first 5, collapse rest)

What Would Be Overwritten (if profile name exists):
  - Operator PIN (hash will be replaced)
  - Admin PIN (hash will be replaced)
  - URL Presets: 3 existing presets will be replaced
  - Background Presets: 2 existing presets will be replaced

What's Missing (warnings):
  - Theme "custom-blue" referenced in Still Store items not found in bundle
    (Recommendation: will default to first available theme on import)
```

### 5.3 Conflict Resolution: Profile Name Exists

If a profile with the same `name` already exists:

**Option 1: Overwrite**
- Replace the existing profile with the imported one.
- Operator's existing settings are lost (unless backed up separately).

**Option 2: Import as Copy**
- Rename the profile (suggest: `"{name} (imported {timestamp)}"` or `"{name} #2"`)
- Create a new profile rather than overwriting.

**Option 3: Cancel**
- Abort the import without changes.

### 5.4 Import Confirmation

Admin clicks **Confirm Import**. App proceeds with:

1. **Extract and validate assets**:
   - Extract `still-store/assets/` and `still-store/renders/` to local Still Store directory.
   - Extract `media-library/files/` to local Media Library directory.
   - Verify all files are present; warn if any are missing.

2. **Merge or replace profile data**:
   - Write the `profile.json` to `~/Library/Application Support/pc-on-air/profiles/profile-{id}.json`.
   - Merge URL presets, background presets, and themes as appropriate (see merge strategy below).

3. **Update theme library**:
   - For each theme in `themes/`, check if it already exists.
   - If not, add it to the app's theme library.
   - If yes, warn admin (skip duplicate or replace).

4. **Update Still Store**:
   - For each item in `still-store/index.json`, check if it already exists by ID or name.
   - If not, add the item (links rendered images and assets).
   - If yes, offer: "Replace", "Keep existing", or "Import as duplicate".

5. **Final prompt**:
   - Show success message: "Profile imported successfully."
   - Offer: **"Switch to this profile now?"** (restart required) or **"Keep current profile"** (no restart).

### 5.5 Merge Strategy

**For URL Presets and Background Presets:**
- If `overwrite` is chosen, replace all presets from the imported bundle.
- If `import-as-copy` is chosen, merge new presets into the existing set (no overwrites; duplicates by ID are skipped with a warning).

**For Still Store Items:**
- Items are identified by UUID (`id` field).
- If importing a copy (same profile name exists), skip items with duplicate IDs (or prompt admin per-item).
- If replacing, delete old items and insert new ones.

**For Themes:**
- Themes are identified by `name` field.
- If a theme with the same name exists, offer: "Replace" or "Keep existing".

---

## 6. Schema Migration Strategy

The `schemaVersion` field enables safe upgrades. All profiles are versioned; future versions of the app can auto-migrate.

### 6.1 Current Version: "1.0"

- Supports all fields defined in Section 2.
- No migrations needed yet.

### 6.2 Future Migration Pattern (e.g., "2.0")

When the app is updated with a new schema version:

1. **On profile load**, check `schemaVersion`.
2. **If version < current**, apply migration chain:
   ```
   1.0 → 1.5 (if exists) → 2.0
   ```
3. **Migration function** transforms old schema to new.
   - Example: "1.0 → 2.0" might add a new field `cloudSyncEnabled: false` to all profiles.
4. **After migration**, rewrite profile JSON with `schemaVersion: "2.0"`.
5. **Log the migration** for debugging.

### 6.3 Backward Compatibility

- The app should support **reading** profiles up to one major version back (e.g., app v2.0 reads v1.x, but v3.0 may drop v1.x support).
- Exporting always uses the current schema version.

---

## 7. Backup Strategy

### 7.1 Automatic Backups

**Trigger**: On every profile save or update (after any change to the profile JSON).

**Action**:
1. Write a full copy of the profile JSON to `~/Library/Application Support/pc-on-air/backups/`.
2. Filename: `{profileName}-backup-{backupId}-{timestamp}.json` where:
   - `{profileName}` is the human-readable name (sanitized: replace spaces with `-`, remove special chars)
   - `{backupId}` is a UUID
   - `{timestamp}` is ISO 8601 (e.g., `2025-05-11T14-30-45Z`)

**Retention Policy**:
- Keep the last 5 backups per profile (rotate oldest out).
- Backups are standalone profile JSONs (not bundles; assets are separate).
- Backups do **not** include Still Store items or themes (those are stored separately; restore of those is manual via export bundles).

### 7.2 Manual Backups

**Admin Action (via `/admin` UI):**

1. Admin navigates to **Configuration** → **Backup & Restore**.
2. Admin clicks **Create Manual Backup**.
3. App creates a backup JSON (same as automatic backup, but marked as manual).
4. App displays list of recent backups (automatic + manual) with timestamps and options:
   - **Restore** — load this backup (requires confirmation; app will overwrite current profile)
   - **Download** — download the backup JSON to the user's computer
   - **Delete** — remove from backup list

### 7.3 Manual Restore

**Admin Action:**

1. Admin clicks **Restore** on a backup from the list.
2. App shows a confirmation dialog: "Restore profile to state from {timestamp}? This will overwrite the current settings."
3. Admin clicks **Confirm Restore**.
4. App loads the backup JSON, overwrites the current profile, and displays: "Profile restored. Restart to apply?"

### 7.4 Export Full Bundle (vs. Backup)

Backups are **internal recovery snapshots** (JSON only, fast). Export bundles are **portable archives** (ZIP with all assets, for sharing or archival).

- **Backup**: Fast, local, for recovery only, 5-item retention.
- **Export Bundle**: Portable, includes all assets, can be shared, manually managed.

---

## 8. Profile Switching

Profile switching happens in the **Admin route (`/admin`)**.

### 8.1 UI: Profile Selector

**Admin Route `/admin`:**

1. Header or sidebar displays: **Current Profile: {name}** with a dropdown or button to switch.
2. Admin clicks **Switch Profile**.
3. App shows a list of available profiles:
   ```
   • Morning Show (active)
   • Evening News
   • Event A
   • Create New Profile
   ```
4. Admin selects a different profile.

### 8.2 Switch Action

When admin selects a new profile:

1. App shows a prompt: **"Switch to '{profileName}'? The app will restart to apply this change."**
2. Admin clicks **Confirm** or **Cancel**.
3. On confirm:
   - Update `active-profile.json` to point to the new profile.
   - Close all connections gracefully (WebSocket, Companion).
   - Reload the app (or restart the Electron main process).
   - Load the new profile's configuration.
   - Restore state (URL presets, Still Store, keying settings, Companion port, etc.).
   - Reconnect to Companion (if enabled in new profile).

### 8.3 Profile Not Found

If the referenced profile is deleted or missing:

1. App logs a warning.
2. App falls back to the **first available profile** in the profiles directory.
3. Update `active-profile.json` to reflect the fallback.
4. Show a toast/alert to admin: "Profile not found; switched to {fallback name}."

---

## 9. CLI Flag: `--profile`

The Electron app accepts a command-line flag to start with a specific profile active.

### 9.1 Usage

```bash
# Start with "Morning Show" profile
./pc-on-air --profile "Morning Show"

# Start with profile UUID (fallback if name is ambiguous)
./pc-on-air --profile "a1b2c3d4-e5f6-..."
```

### 9.2 Behavior

1. **On startup**, check for `--profile` argument.
2. **If provided**:
   - Search profiles by name (preferred) or UUID.
   - If found, set it as active in `active-profile.json` and load it.
   - If not found, log warning and fall back to last active profile (or first available).
3. **If not provided**:
   - Use the profile in `active-profile.json` (existing behavior).

### 9.3 Use Cases

- **CI/CD or automated playout**: `./pc-on-air --profile "Event A"` (start directly with the right config)
- **Manual testing**: Switch profiles without restarting the full app
- **Multi-machine setups**: Different machines can start with different profiles (e.g., `studio-1` and `studio-2` profiles)

---

## 10. API Endpoints: Profiles, Export, and Import

All endpoints return JSON. Authentication: operator or admin PIN required (depending on endpoint).

### 10.1 Profile CRUD

#### `GET /api/profiles`

**Description**: List all available profiles.

**Authentication**: None (public)

**Response (200 OK):**
```json
{
  "profiles": [
    {
      "id": "uuid",
      "name": "Morning Show",
      "createdAt": "2025-05-10T10:00:00Z",
      "updatedAt": "2025-05-11T08:30:00Z"
    },
    {
      "id": "uuid",
      "name": "Evening News",
      "createdAt": "2025-05-08T14:00:00Z",
      "updatedAt": "2025-05-10T18:00:00Z"
    }
  ]
}
```

---

#### `GET /api/profiles/active`

**Description**: Get the currently active profile (metadata only, not full config).

**Authentication**: None (public)

**Response (200 OK):**
```json
{
  "id": "uuid",
  "name": "Morning Show",
  "createdAt": "2025-05-10T10:00:00Z",
  "updatedAt": "2025-05-11T08:30:00Z"
}
```

---

#### `GET /api/profiles/{profileId}`

**Description**: Retrieve the full profile JSON.

**Authentication**: Admin PIN required

**Note on PIN hashes:** PIN hashes are **never returned in API responses**. The profile JSON stored on disk includes `operatorPinHash` and `adminPinHash`, but the API omits them. To check whether PINs are set, use the `hasPins` field in the response.

**Response (200 OK):**
```json
{
  "schemaVersion": "1.0",
  "id": "uuid",
  "name": "Morning Show",
  "createdAt": "2025-05-10T10:00:00Z",
  "updatedAt": "2025-05-11T08:30:00Z",
  "urlPresets": [...],
  "backgroundPresets": [...],
  "displayPreference": null,
  "companionSettings": {...},
  "tunnelSettings": {...},
  "appPreferences": {...},
  "hasPins": {
    "operator": true,
    "admin": true
  },
  "stillStoreIncluded": true,
  "themesIncluded": true
}
```

> `hasPins.operator` is `true` if an operator PIN hash is stored for this profile; `false` if no PIN is set. Same for `hasPins.admin`. The actual bcrypt hashes are never included in API responses.

---

#### `POST /api/profiles`

**Description**: Create a new profile with default settings.

**Authentication**: Admin PIN required

**Request:**
```json
{
  "name": "New Profile"
}
```

**Response (201 Created):**
```json
{
  "id": "new-uuid",
  "name": "New Profile",
  "createdAt": "2025-05-11T09:00:00Z",
  "updatedAt": "2025-05-11T09:00:00Z"
}
```

---

#### `PATCH /api/profiles/{profileId}`

**Description**: Update a profile (partial update).

**Authentication**: Admin PIN required

**Request:**
```json
{
  "name": "Updated Profile Name",
  "appPreferences": {
    "defaultStackingEnabled": true
  }
}
```

**Response (200 OK):**
Full updated profile JSON (same as `GET /api/profiles/{profileId}`).

---

#### `DELETE /api/profiles/{profileId}`

**Description**: Delete a profile (and all associated backups).

**Authentication**: Admin PIN required

**Validation**:
- Cannot delete the currently active profile.
- Confirmation required via request body: `{"confirm": true}`.

**Response (204 No Content):** on success

**Response (400 Bad Request):** if trying to delete active profile

---

#### `POST /api/profiles/{profileId}/activate`

**Description**: Switch to a different profile (sets as active, triggers restart/reload).

**Authentication**: Admin PIN required

**Request:** (empty or optional metadata)

**Response (200 OK):**
```json
{
  "message": "Profile activated. App will restart.",
  "profileId": "...",
  "profileName": "..."
}
```

---

### 10.2 Export Endpoint

#### `POST /api/profiles/{profileId}/export`

**Description**: Export a profile as a `.zip` bundle.

**Authentication**: Admin PIN required

**Request:**
```json
{
  "includeStillStore": true,  // Optional, defaults to true
  "includeMediaLibrary": true // Optional, defaults to true
}
```

**Response (200 OK):**
- Content-Type: `application/zip`
- Content-Disposition: `attachment; filename="pc-on-air-{profileName}-{YYYY-MM-DD}.zip"`
- Body: Binary zip file

---

### 10.3 Import Endpoint

#### `POST /api/profiles/import`

**Description**: Upload and validate a bundle for import (returns diff summary without applying).

**Authentication**: Admin PIN required

**Request**: Multipart form data
- `file`: The `.zip` bundle

**Response (200 OK):**
```json
{
  "bundle": {
    "profileId": "imported-uuid",
    "profileName": "Morning Show",
    "createdAt": "2025-05-10T10:00:00Z"
  },
  "validation": {
    "isValid": true,
    "errors": [],
    "warnings": [
      "Theme 'custom-blue' not found in bundle"
    ]
  },
  "diff": {
    "new": {
      "urlPresets": 2,
      "backgroundPresets": 1,
      "stillStoreItems": 12
    },
    "overwrite": {
      "urlPresets": 3,
      "backgroundPresets": 2
    },
    "missing": [
      "Theme: custom-blue"
    ]
  },
  "conflictResolution": {
    "profileExists": true,
    "existingProfileId": "existing-uuid",
    "options": ["overwrite", "import_as_copy", "cancel"]
  }
}
```

---

#### `POST /api/profiles/import/confirm`

**Description**: Confirm and apply an import (must call `/import` first).

**Authentication**: Admin PIN required

**Request:**
```json
{
  "bundleId": "from-previous-import-response",
  "action": "overwrite" | "import_as_copy",
  "switchToProfileAfter": true  // Optional, defaults to false
}
```

**Response (200 OK):**
```json
{
  "profileId": "new-or-updated-uuid",
  "profileName": "Morning Show",
  "message": "Profile imported successfully.",
  "actionTaken": "overwrite",
  "restartRequired": true
}
```

---

### 10.4 Backup Endpoints

#### `GET /api/profiles/{profileId}/backups`

**Description**: List recent backups for a profile.

**Authentication**: Admin PIN required

**Response (200 OK):**
```json
{
  "profileId": "uuid",
  "backups": [
    {
      "id": "backup-uuid-1",
      "timestamp": "2025-05-11T08:30:00Z",
      "type": "automatic" | "manual",
      "note": "Before import"  // Optional user note for manual backups
    },
    {
      "id": "backup-uuid-2",
      "timestamp": "2025-05-10T18:00:00Z",
      "type": "automatic"
    }
  ]
}
```

---

#### `POST /api/profiles/{profileId}/backups`

**Description**: Create a manual backup of the current profile.

**Authentication**: Admin PIN required

**Request:**
```json
{
  "note": "Before major config change"  // Optional
}
```

**Response (201 Created):**
```json
{
  "id": "backup-uuid",
  "timestamp": "2025-05-11T09:00:00Z",
  "type": "manual",
  "note": "Before major config change"
}
```

---

#### `POST /api/profiles/{profileId}/backups/{backupId}/restore`

**Description**: Restore a profile from a backup.

**Authentication**: Admin PIN required

**Request:** (empty or optional confirmation)

**Response (200 OK):**
```json
{
  "message": "Profile restored from backup.",
  "timestamp": "2025-05-10T18:00:00Z",
  "restartRequired": true
}
```

---

#### `GET /api/profiles/{profileId}/backups/{backupId}/download`

**Description**: Download a backup as JSON.

**Authentication**: Admin PIN required

**Response (200 OK):**
- Content-Type: `application/json`
- Content-Disposition: `attachment; filename="{profileName}-backup-{timestamp}.json"`
- Body: Profile JSON

---

#### `DELETE /api/profiles/{profileId}/backups/{backupId}`

**Description**: Delete a specific backup.

**Authentication**: Admin PIN required

**Response (204 No Content):** on success

---

## 11. Acceptance Criteria

All items below are testable and must be validated before v1 release.

### 11.1 Profile Creation and Management

- [ ] Create a new profile with default settings (name, UUID auto-generated)
- [ ] List all profiles via API and Web UI
- [ ] Display currently active profile name in Web UI header
- [ ] Update profile name and settings via API
- [ ] Delete a profile (except active profile; confirmation required)
- [ ] Cannot switch to a non-existent profile (graceful fallback)

### 11.2 Profile Schema and Storage

- [ ] Profile JSON adheres to ShowProfile schema v1.0
- [ ] Profile file stored at `~/Library/Application Support/pc-on-air/profiles/profile-{id}.json`
- [ ] `active-profile.json` always exists and points to current active profile
- [ ] bcrypt PIN hashes never exposed in API responses (`operatorPinHash`/`adminPinHash` are stripped; `hasPins: { operator: boolean, admin: boolean }` is returned instead)
- [ ] Profile JSON is loadable and parseable after disk write

### 11.3 Export Bundle

- [ ] Export creates a valid `.zip` file with correct filename format
- [ ] Bundle contains `profile.json`, `still-store/index.json`, `media-library/index.json`, `bundle-metadata.json`
- [ ] Still Store assets (images, renders) included in bundle with correct relative paths
- [ ] Media Library files included in bundle
- [ ] Custom themes included; built-in themes NOT included
- [ ] Bundle is portable (can be extracted on different machine and imported)
- [ ] Zip structure matches documented layout (no extra directories)

### 11.4 Import Workflow

- [ ] Upload `.zip` bundle via `/admin` UI
- [ ] Validate bundle structure and schema version
- [ ] Show diff summary (new, overwrite, missing)
- [ ] Handle conflict when profile name exists (offer overwrite/copy/cancel)
- [ ] Extract assets to correct local directories
- [ ] Merge or replace presets as appropriate
- [ ] Import as copy creates new profile with renamed name
- [ ] Imported profile is immediately usable (switch to it works)
- [ ] Schema version mismatch handled gracefully (warning logged, import proceeds)

### 11.5 Backup Strategy

- [ ] Automatic backup created on every profile save
- [ ] Last 5 backups per profile retained (older ones deleted)
- [ ] Backup JSON is valid and restoreable
- [ ] Manual backup created on admin request
- [ ] Restore from backup overwrites current profile correctly
- [ ] Backup list displayed in `/admin` with timestamps
- [ ] Download backup as JSON file works
- [ ] Delete backup removes it from list

### 11.6 Profile Switching

- [ ] Admin can see profile list in `/admin` UI
- [ ] Switching to different profile triggers app restart/reload
- [ ] New profile's settings load correctly after switch
- [ ] URL presets, Still Store, keying, and Companion settings all restored
- [ ] Active profile indicator updates in UI

### 11.7 CLI Flag

- [ ] `--profile "Morning Show"` starts app with correct profile active
- [ ] `--profile "{uuid}"` works as fallback if name is ambiguous
- [ ] Non-existent profile via CLI flag falls back to last active (with warning)
- [ ] No CLI flag uses existing `active-profile.json`

### 11.8 API Endpoints

- [ ] `GET /api/profiles` returns list of all profiles
- [ ] `GET /api/profiles/active` returns current active profile metadata
- [ ] `GET /api/profiles/{id}` returns full profile JSON (admin PIN required)
- [ ] `POST /api/profiles` creates new profile with default settings
- [ ] `PATCH /api/profiles/{id}` updates profile settings
- [ ] `DELETE /api/profiles/{id}` deletes profile (except active; confirmation required)
- [ ] `POST /api/profiles/{id}/activate` switches to profile (restart prompt)
- [ ] `POST /api/profiles/{id}/export` downloads `.zip` bundle
- [ ] `POST /api/profiles/import` validates and returns diff summary
- [ ] `POST /api/profiles/import/confirm` applies import with conflict resolution
- [ ] All admin endpoints require admin PIN (rate-limited for brute-force protection)

### 11.9 Error Handling

- [ ] Invalid `.zip` file rejected with clear error message
- [ ] Schema version mismatch handled (future versions auto-migrate)
- [ ] Missing required fields in profile JSON caught and reported
- [ ] Corrupted backup files detected and skipped (with warning)
- [ ] Disk write failures logged and user alerted
- [ ] PIN hash comparison is constant-time (bcrypt native)

### 11.10 Data Integrity

- [ ] Profile JSON write is atomic (temp file + rename pattern)
- [ ] Backup rotation is thread-safe (no race conditions)
- [ ] Export bundle checksums validated on import (optional, nice-to-have)
- [ ] Still Store and Media Library assets correctly linked after import
- [ ] No data loss if app crashes during profile switch or import

---

## 12. Implementation Notes

### 12.1 Atomic File Operations

Profile JSON writes should use atomic patterns (write to temp file, then rename) to prevent corruption if the app crashes mid-write.

### 12.2 bcrypt PIN Hashing

- Hash operator and admin PINs using bcrypt (cost factor 10–12) before storing.
- Never store or log plaintext PINs.
- Use constant-time comparison for PIN verification (bcrypt native).
- PIN setup happens in `/admin` UI (admin must set both PINs for a profile).

### 12.3 Backup Retention

Implement a simple rotation: on each automatic backup, check if >= 5 backups exist. If so, delete the oldest by timestamp.

### 12.4 Threading and Concurrency

- Profile loading and switching should be serialized (not concurrent).
- Backup creation should not block UI (async task).
- Export bundle ZIP creation can be async (may be large with Still Store assets).

### 12.5 Future: Schema Version 2.0

If future development requires new profile fields:
1. Add fields to ShowProfile interface with defaults.
2. Increment schemaVersion to "2.0".
3. Define migration function "1.0 → 2.0" that adds defaults.
4. App checks on load and auto-migrates.

---

## 13. Storage Platform Notes

### macOS (Primary v1 Target)

- Use `NSSearchPathForDirectoriesInDomains` or Electron's `app.getPath("appData")` to find `~/Library/Application Support/`.
- File permissions: mode 0700 for profile directories (owner only).
- Backup rotation managed in JavaScript (no external cron needed).

### Linux / Windows (v2+ Consideration)

- Linux: `~/.config/pc-on-air/` (XDG Base Directory spec)
- Windows: `%APPDATA%\pc-on-air\` (via Electron `app.getPath()`)
- Same filename and directory structure across all platforms.

---

## Summary

Profiles, bundles, and backups provide a complete configuration management and portability layer for PC On Air:

1. **Profiles** enable rapid context switching between shows without manual reconfiguration.
2. **Export bundles** enable sharing and archival of complete show setups (portable, all-in-one).
3. **Backups** protect against accidental loss and enable easy recovery.
4. **CLI flag** enables headless and automated playout scenarios.
5. **API and Web UI** provide intuitive admin controls for all operations.
6. **Schema versioning** future-proofs configuration management.

All acceptance criteria are testable and enforce data integrity, security, and usability.
