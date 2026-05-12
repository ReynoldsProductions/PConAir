# PC On Air v1 — Still Store and Media Library Specification

## Overview

The **Still Store** and **Media Library** are two distinct subsystems for managing image-based content in PC On Air v1:

- **Still Store**: The primary production-ready cue library for lower thirds. Items are named, themed, and recallable by operators during live broadcasts. Populated by:
  - Manual lower third entry (name + title + theme selection)
  - CSV bulk import (templated rows)
  - Image upload (converted to cues)
  - CSS-based theme rendering
  - Items are composed of metadata + rendered PNG outputs

- **Media Library**: A general-purpose file storage system for arbitrary images and future video. Items are stored as-is, managed by admin, and selectable by operators for display. No templating or theming. Distinct from Still Store.

**Key relationship**: Still Store items are production-ready, named, cued stills. Media Library items are unstructured files. They do not mix; operators interact with them via separate UI surfaces and workflows.

---

## 1. Still Store

### 1.1 Data Model

**TypeScript: Still Store Item**
```typescript
interface StillStoreItem {
  // Core identifiers
  id: string;                           // UUID or hash-based unique ID
  name: string;                         // Human-readable name (e.g., "John Doe")
  title: string;                        // Secondary text (e.g., "CEO")
  subtitle?: string;                    // Optional third line of text
  
  // Rendering and theming
  theme: string;                        // CSS theme name (e.g., "default", "blue-gradient")
  renderedAt: number;                   // ISO 8601 timestamp of last render
  
  // Source and export
  sourceType: "manual" | "csv" | "image";  // How this item was created
  
  // For image uploads: preserve original format
  originalImageFormat?: "png" | "jpg" | "gif" | "webp" | "svg";
  originalImagePath?: string;           // Path to uploaded image (relative to store)
  originalImageWidth?: number;          // Original pixel dimensions (informational)
  originalImageHeight?: number;
  
  // Rendered output (for manual L3 and CSV items)
  renderedPngPath?: string;             // Path to 1920×1080 PNG render (relative to store)
  renderedPngHash?: string;             // Content hash for change detection
  
  // Metadata
  tags?: string[];                      // Optional user-defined tags (nice-to-have)
  createdAt: number;                    // ISO 8601 timestamp
  updatedAt: number;                    // ISO 8601 timestamp
}
```

**TypeScript: Still Store Library**
```typescript
interface StillStore {
  version: string;                      // Schema version (e.g., "1.0")
  items: StillStoreItem[];              // Ordered list of cues
  themes: CSSTheme[];                   // Installed CSS theme definitions
  createdAt: number;                    // Store creation time
  updatedAt: number;                    // Last modification time
}
```

**TypeScript: CSS Theme Definition**
```typescript
interface CSSTheme {
  name: string;                         // Theme identifier (e.g., "default", "blue-gradient")
  displayName: string;                  // Human-readable name shown in UI
  description?: string;                 // Optional description
  cssContent: string;                   // Full CSS template as text (inline)
  previewImageUrl?: string;             // Optional preview image path (relative)
  createdAt: number;                    // When this theme was installed
  isBuiltIn: boolean;                   // True for factory themes; false for user-uploaded
}
```

**Persistence Layer**:
- Still Store items and themes are persisted to a local SQLite database or JSON file (implementation detail; schema above is the contract).
- Rendered PNG files (for manual/CSV items) are stored in a cache directory (e.g., `~/.pconair/still-store/renders/`).
- Uploaded image files (for image-upload items) are stored in (e.g., `~/.pconair/still-store/uploads/`).
- Original formats are preserved; no conversion except where explicitly required.

---

### 1.2 Ingest Paths

#### 1.2.1 Manual Lower Third Entry

**Operator Workflow (Web UI `/operator`):**

1. Navigate to "Lower Thirds" → "New Cue" (or similar UI section).
2. Enter:
   - `name` (required): operator-facing identifier (e.g., "John Doe")
   - `title` (required): secondary text (e.g., "CEO")
   - `subtitle` (optional): third line
   - `theme` (required): dropdown list of installed themes; select one
3. Click "Preview" to see render in real-time (optional).
4. Click "Create Cue" to save.

**Backend Processing:**

1. Receive POST `/api/l3/cues` with `{ name, title, subtitle?, theme }`.
2. Validate:
   - `name` is non-empty string (max 100 chars).
   - `title` is non-empty string (max 100 chars).
   - `subtitle` is string (max 100 chars) if provided.
   - `theme` matches an installed theme name; if not found, default to first available theme and log warning.
3. Generate a UUID for `cueId`.
4. Create a `StillStoreItem` with `sourceType: "manual"`.
5. **Render**: Pass `name`, `title`, `subtitle`, and CSS theme to rendering engine.
   - Engine: Use CSS template to render HTML (containing `name`, `title`, `subtitle` as text nodes).
   - Output: 1920×1080 PNG with transparency support.
   - Store PNG at `~/.pconair/still-store/renders/{cueId}.png`.
   - Compute PNG content hash and store.
6. Save item metadata to database.
7. Return `StillStoreItem` with populated `renderedPngPath`.

**Error Handling:**
- If theme is invalid, log warning and default to first theme (silently; no operator error).
- If rendering fails (e.g., CSS error), fail the request with HTTP 400 and message "Theme rendering failed; check CSS syntax".
- If database save fails, return 500 Internal Server Error.

---

#### 1.2.2 CSV Bulk Import

**Admin Workflow (Web UI `/admin`):**

1. Navigate to "Still Store" → "Bulk Import" → "CSV Upload".
2. Download sample CSV (provided by app) to understand format.
3. Prepare CSV with columns:
   - `name` (required): operator-facing identifier
   - `title` (required): secondary text
   - `theme` (required): CSS theme name
   - `subtitle` (optional): third line
   - Column names are case-insensitive (implementation normalizes to lowercase).
4. Upload `.csv` file (max 10 MB).
5. App shows:
   - Preview: first 10 rows, highlighting any validation errors.
   - Summary: "X rows will import, Y rows skipped (missing fields)".
6. Click "Import" to commit all valid rows.

**CSV Schema**:

```
name,title,theme,subtitle
John Doe,CEO,default,Head of Company
Jane Smith,CTO,blue-gradient,Technology Lead
Bob Jones,CFO,default,Finance
```

- Header row required.
- Column names are case-insensitive.
- Rows with missing `name`, `title`, or `theme` are **skipped with a logged warning** (not an error; import continues).
- `subtitle` is optional; if omitted for a row, `subtitle` is `undefined`.
- If `theme` value does not match any installed theme name, **silently default to first available theme** and log warning (do not skip row).
- No duplicate detection; duplicate rows are imported as separate cues with unique IDs.
- Max file size: 10 MB.
- Max rows: 10,000 (configurable; implementation detail).

**Backend Processing**:

1. Receive POST `/api/l3/cues/import` with multipart file upload.
2. Parse CSV (using standard CSV parser; handle quoted values, escaped commas).
3. Normalize column names to lowercase.
4. Iterate rows:
   - Extract `name`, `title`, `theme`, `subtitle`.
   - If any of `name`, `title`, `theme` are missing/empty, skip with warning log: `"CSV import: row N skipped (missing required field: X)"`.
   - If `theme` not found in installed themes, log warning: `"CSV import: row N theme '{theme}' not found; using '{defaultTheme}'"`. Use default theme.
   - Otherwise, process as manual entry (same rendering and storage).
5. After iteration, return summary:
   ```json
   {
     "imported": 15,
     "skipped": 2,
     "warnings": [
       "Row 5: missing 'title' field",
       "Row 12: theme 'fancy' not found; using 'default'"
     ]
   }
   ```
6. Save all valid items to database in a single transaction.

**Sample CSV (Downloadable)**:

Provided at `GET /api/l3/csv-sample`:

```csv
name,title,theme,subtitle
John Doe,CEO,default,Head of Company
Jane Smith,CTO,blue-gradient,
```

---

#### 1.2.3 Image Upload

**Admin Workflow (Web UI `/admin`):**

1. Navigate to "Still Store" → "Upload Image".
2. Select image file (PNG, JPG, GIF, WEBP, SVG; multiple selection allowed).
3. Select destination: "Still Store" (cue library) or "Media Library" (file storage).
4. For Still Store upload:
   - Select a theme (dropdown).
   - (Optional) Enter `name` and `title` metadata; if omitted, use image filename as name.
5. Click "Upload".
6. App shows upload progress.

**Still Store Image Upload Processing**:

1. Receive POST `/api/l3/cues/upload-image` with multipart file(s) and optional `name`, `title`, `theme`.
2. For each file:
   - Validate:
     - File extension matches browser-supported format (PNG, JPG, GIF, WEBP, SVG).
     - File size < 50 MB (configurable).
   - If validation fails, skip file with warning.
   - Otherwise, process:
     - Generate UUID for `cueId`.
     - Determine original format from file extension.
     - Store uploaded image at `~/.pconair/still-store/uploads/{cueId}.{extension}` (preserve original format).
     - Compute file hash.
     - Create `StillStoreItem` with:
       - `sourceType: "image"`
       - `originalImageFormat`: detected from extension
       - `originalImagePath`: stored path
       - `name`: user-provided or filename without extension
       - `title`: user-provided or empty string
       - `theme`: user-provided theme (or first available if not provided)
       - No `renderedPngPath` (image is not rendered; kept as-is)
3. Save items to database.
4. Return summary:
   ```json
   {
     "imported": 3,
     "failed": 1,
     "items": [
       {
         "id": "cue-xyz",
         "name": "chart",
         "sourceType": "image",
         "originalImageFormat": "png"
       }
     ]
   }
   ```

**Transparency**:
- PNG and SVG formats with alpha channel are preserved.
- JPG images without transparency upload as-is.
- GIF and WEBP transparency is respected if present.
- On display, transparency in still-output renders the luma-key background through transparent areas.

---

### 1.3 CSS Theme System

#### 1.3.1 Theme Structure

A CSS theme is a CSS template file that defines how lower thirds are rendered. The template contains placeholders for operator-entered text.

**Sample CSS Theme (`default.css`)**:

```css
/* Default lower third theme */
:root {
  --color-bg: rgba(0, 0, 0, 0.8);
  --color-text: #ffffff;
  --font-family: 'Arial', sans-serif;
}

body {
  margin: 0;
  padding: 0;
  width: 1920px;
  height: 1080px;
  background: transparent;
  font-family: var(--font-family);
  overflow: hidden;
}

.lower-third {
  position: fixed;
  bottom: 0;
  left: 0;
  width: 100%;
  height: 200px;
  background: var(--color-bg);
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding-left: 40px;
  box-sizing: border-box;
}

.name {
  font-size: 48px;
  font-weight: bold;
  color: var(--color-text);
  margin: 0;
  padding: 0;
}

.title {
  font-size: 32px;
  color: var(--color-text);
  margin: 5px 0 0 0;
  padding: 0;
}

.subtitle {
  font-size: 24px;
  color: rgba(255, 255, 255, 0.8);
  margin: 5px 0 0 0;
  padding: 0;
}
```

**Rendering Model**:

The rendering engine:
1. Loads the CSS template.
2. Generates HTML:
   ```html
   <!DOCTYPE html>
   <html>
   <head>
     <style>{CSS_TEMPLATE}</style>
   </head>
   <body>
     <div class="lower-third">
       <p class="name">John Doe</p>
       <p class="title">CEO</p>
       <p class="subtitle">Head of Company</p>
     </div>
   </body>
   </html>
   ```
3. Renders HTML to 1920×1080 PNG using a headless browser (e.g., Puppeteer, playwright).
4. Crops or pads to exactly 1920×1080.
5. Preserves transparency (PNG alpha channel).

---

#### 1.3.2 Theme Installation and Management

**Built-in Themes**:
- At least one factory theme is shipped with the app (e.g., "default").
- Located in app bundle or a read-only system directory.
- Users cannot delete built-in themes.

**User-Installed Themes**:

**Admin Workflow**:
1. Navigate to "Settings" → "Lower Third Themes".
2. View list of installed themes (built-in + custom).
3. To upload a custom theme:
   - Click "Upload Theme".
   - Select a `.css` file (max 1 MB).
   - Enter a theme name (identifier, e.g., "blue-gradient", alphanumeric + hyphens).
   - Enter a display name (human-readable, e.g., "Blue Gradient").
   - (Optional) Provide a preview image (PNG/JPG; max 5 MB).
   - Click "Install".
4. App validates CSS (basic syntax check; logs warnings if invalid).
5. Theme appears in lower third creation UI.

**Backend Processing**:

1. Receive POST `/api/l3/themes` with multipart: `{ cssFile, name, displayName, previewImage? }`.
2. Validate:
   - `name` matches pattern `[a-z0-9-]+` (lowercase alphanumeric + hyphens); fail if not.
   - `name` does not already exist (user-defined or built-in); fail if duplicate.
   - CSS file is < 1 MB; fail if too large.
   - CSS file is valid UTF-8; fail if not.
   - (Optional) Preview image is < 5 MB; fail if too large.
3. Parse CSS (basic syntax check; log warnings if invalid).
4. Store CSS at `~/.pconair/still-store/themes/{name}.css`.
5. Store preview image at `~/.pconair/still-store/themes/{name}-preview.{ext}` (if provided).
6. Create `CSSTheme` entry with `isBuiltIn: false`.
7. Save to database.
8. Return theme metadata.

**Theme Deletion**:

1. Receive DELETE `/api/l3/themes/{name}`.
2. Validate:
   - Theme exists.
   - Theme is not built-in (fail if it is).
3. Delete CSS file and preview image.
4. Remove from database.
5. For any still-store items using this theme, log warning and default them to first available theme (items remain; theme reference is updated).

**Theme Download (Operator Reference)**:

Provide a downloadable sample theme at `GET /api/l3/themes/sample.css`:

```css
/* Sample Lower Third Theme
 * 
 * Customize this template to create your own theme:
 * 1. Replace CSS properties (colors, fonts, layout).
 * 2. Keep the class names (.name, .title, .subtitle) unchanged.
 * 3. Upload the modified CSS via /admin -> Themes -> Upload.
 * 
 * Notes:
 * - Background must be transparent or use rgba() to support luma key.
 * - Text is always rendered in operator-provided strings.
 * - Do not change HTML structure; rendering engine injects operator text.
 */

:root {
  --color-bg: rgba(0, 0, 0, 0.8);
  --color-text: #ffffff;
  --font-family: 'Arial', sans-serif;
}

body {
  margin: 0;
  padding: 0;
  width: 1920px;
  height: 1080px;
  background: transparent;
  font-family: var(--font-family);
  overflow: hidden;
}

.lower-third {
  position: fixed;
  bottom: 0;
  left: 0;
  width: 100%;
  height: 200px;
  background: var(--color-bg);
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding-left: 40px;
  box-sizing: border-box;
}

.name {
  font-size: 48px;
  font-weight: bold;
  color: var(--color-text);
  margin: 0;
  padding: 0;
}

.title {
  font-size: 32px;
  color: var(--color-text);
  margin: 5px 0 0 0;
  padding: 0;
}

.subtitle {
  font-size: 24px;
  color: rgba(255, 255, 255, 0.8);
  margin: 5px 0 0 0;
  padding: 0;
}
```

---

### 1.4 Stacking Behavior

**Definition**: When multiple lower thirds are triggered in succession, "stacking" determines whether they overlay or replace.

#### 1.4.1 Stacking Modes

**When `isStacking: true`** (Stack mode):
- Each triggered still is added to a **stack** on the target output.
- Later stills appear **on top** (higher z-index).
- Clear removes **all stills** from the stack.
- Stack persists until explicit Clear or mode toggle OFF.

**When `isStacking: false`** (Replace mode):
- New still replaces the previous still.
- Internally: clear the stack, then push the new still.
- Only one still visible at a time.
- Clear removes the single still.

#### 1.4.2 Stack Implementation

**State Tracking**:

```typescript
interface StillStackEntry {
  id: string;                     // UUID of this render instance (not the cue ID)
  cueId: string;                  // Reference to the original still cue
  displayPath: string;            // Path to PNG file (rendered or uploaded)
  zIndex: number;                 // Stack position (0 = bottom; increments upward)
  triggeredAt: number;            // ISO 8601 timestamp
}

interface StillStack {
  outputId: string;               // Target display/output
  isEnabled: boolean;             // Whether stacking mode is on
  entries: StillStackEntry[];     // Ordered entries (0 = back; last = front)
}
```

**Rendering Pipeline**:

1. When a still is triggered (via `/api/l3/take`):
   - Get the still's PNG path (rendered or uploaded).
   - Create a new `StillStackEntry` with a unique `id` and `zIndex = current count`.
   - If `isStacking: false`, remove all entries from stack (clear first).
   - Add entry to stack.
   - Notify renderer to composite stack and display.

2. **Composite rendering**:
   - Load base image (luma-key background).
   - For each entry in stack (in order, starting with `zIndex: 0`):
     - Load PNG from `displayPath`.
     - Composite onto base using z-index order (respecting transparency).
   - Render composite to display (HDMI).

3. **Clear command** (via `/api/l3/clear`):
   - Remove all entries from stack.
   - Render blank output (luma-key background only).

#### 1.4.3 Stacking Toggle Behavior

**Toggle OFF → ON**:
- `isStacking` changes from `false` to `true`.
- Current still (if any) remains on output.
- Next trigger stacks on top.

**Toggle ON → OFF**:
- `isStacking` changes from `true` to `false`.
- **Prompt operator**: "Stacking is now OFF. Clear the current stack?"
- If operator confirms: clear all stills (show luma key background).
- If operator declines: keep current top still (remove others from stack; show only the last-triggered still).

#### 1.4.4 Persistence and Recovery

- Stack is **not persisted** across app restarts (cleared on startup).
- Stack is **cleared when mode switches away** from lower-thirds (e.g., switching to Slides or URL mode).
- Stack is **cleared when a different playlist is selected** (if playlists feature is in scope; see below).

---

### 1.5 Export Rules

**Image Export**:

When an operator or admin exports/saves a still cue:

1. **If `sourceType: "image"`** (uploaded image):
   - Export in original format (PNG, JPG, etc.).
   - Use original file from `originalImagePath`.

2. **If `sourceType: "manual"` or `"csv"`** (rendered lower third):
   - Export as 1920×1080 PNG with transparency.
   - Use rendered PNG from `renderedPngPath`.

**Export Endpoint**:

`GET /api/l3/cues/{cueId}/export`

Response: Binary PNG/JPG file with appropriate Content-Type header.

---

### 1.6 Still Store in Profile Bundles (Nice-to-Have for v1)

**Scope**: Export/import of Still Store items in profile bundles is deferred to v1.1 if time-constrained. However, the data model must support it:

- When exporting a profile (at `/admin`), include a manifest that lists all Still Store items.
- Manifest includes metadata (name, title, theme) and paths to rendered PNGs or original images.
- On import, recreate Still Store items from manifest + embedded files.

**For MVP v1**: Skip this feature. Ensure the data model and storage are structured to support it in future.

---

### 1.7 Admin vs Operator Access

| Operation | Admin | Operator |
|-----------|-------|----------|
| Manual lower third entry | ✗ | ✓ |
| CSV bulk import | ✓ | ✗ |
| Image upload to Still Store | ✓ | ✗ |
| Theme installation/deletion | ✓ | ✗ |
| View Still Store cue list | ✓ | ✓ |
| Trigger a cue (take to output) | ✗ | ✓ |
| Queue/arm cue (set next) | ✗ | ✓ |
| Clear cues from output | ✗ | ✓ |
| Toggle stacking mode | ✗ | ✓ |
| Export cue as PNG/JPG | ✗ | ✓ (own-triggered cues) |
| Delete cue from library | ✓ | ✗ |
| Rename/edit cue metadata | ✓ | ✗ |

---

## 2. Media Library

### 2.1 Data Model

**TypeScript: Media Library Item**
```typescript
interface MediaLibraryItem {
  // Core identifiers
  id: string;                         // UUID
  filename: string;                   // Original filename (e.g., "chart.png")
  displayName: string;                // User-friendly name (may differ from filename)
  
  // File metadata
  mimeType: string;                   // MIME type (image/png, image/jpeg, etc.)
  filePath: string;                   // Path to stored file (relative to library root)
  fileSize: number;                   // Bytes
  fileHash: string;                   // Content hash (SHA256 or similar)
  
  // Image dimensions (optional; populated for images)
  width?: number;                     // Pixel width
  height?: number;                    // Pixel height
  hasTransparency?: boolean;          // True if PNG/SVG with alpha channel
  
  // Metadata
  uploadedBy?: string;                // Username of uploader (optional)
  uploadedAt: number;                 // ISO 8601 timestamp
  updatedAt: number;                  // Last modified time
  
  // Organization (nice-to-have for v1)
  tags?: string[];                    // User-defined tags
  folderPath?: string;                // Hierarchy (e.g., "charts/sales")
}
```

**TypeScript: Media Library**
```typescript
interface MediaLibrary {
  version: string;                    // Schema version
  items: MediaLibraryItem[];          // All uploaded files
  createdAt: number;                  // Library creation time
  updatedAt: number;                  // Last modification time
}
```

**Persistence**:
- Media Library items are stored in a local SQLite database or JSON manifest.
- Uploaded files are stored in a directory (e.g., `~/.pconair/media-library/`).
- Files are organized by UUID (e.g., `~/.pconair/media-library/{itemId}.{ext}`).

---

### 2.2 Ingest Workflow

**Admin Workflow (Web UI `/admin`):**

1. Navigate to "Media Library" → "Upload".
2. Select image file(s) (PNG, JPG, GIF, WEBP, SVG, and future video formats).
3. For each file:
   - Option: rename from filename to custom display name (optional).
   - Option: assign tags or folder path (nice-to-have).
4. Click "Upload".
5. App shows progress.
6. Success: files appear in Media Library list.

**Backend Processing**:

1. Receive POST `/api/media-library/upload` with multipart file(s).
2. For each file:
   - Validate:
     - File size < 500 MB (configurable).
     - MIME type is in allowlist (image/* for v1; video/* for future).
   - If validation fails, skip file with warning.
   - Otherwise, process:
     - Generate UUID for `itemId`.
     - Determine MIME type from file header (not just extension).
     - Store uploaded file at `~/.pconair/media-library/{itemId}.{original-ext}`.
     - Compute file hash.
     - Extract image dimensions (if image) using image library.
     - Detect transparency support (if image).
     - Create `MediaLibraryItem` with all metadata.
     - (Optional) Generate thumbnail image for preview (nice-to-have).
3. Save items to database.
4. Return summary:
   ```json
   {
     "imported": 3,
     "failed": 1,
     "items": [
       {
         "id": "media-abc",
         "displayName": "chart.png",
         "mimeType": "image/png",
         "fileSize": 51200,
         "width": 1920,
         "height": 1080
       }
     ]
   }
   ```

---

### 2.3 Recall Workflow

**Operator Workflow (Web UI `/operator`):**

1. Navigate to "Media Library" section.
2. View list of uploaded items (with thumbnail previews; nice-to-have).
3. Select an item (click or tap).
4. Item displays on Program output as a still.
5. Operator can:
   - Switch to a different Media Library item (replaces current).
   - Navigate to Still Store and trigger a cue (switches to that cue).
   - Clear all content (returns to luma-key background).

**Backend Processing**:

1. Receive POST `/api/media-library/take` with `{ itemId }`.
2. Validate:
   - `itemId` exists in Media Library.
3. Retrieve item metadata and file path.
4. Set `currentMode: "media-library"` (or keep in lower-thirds mode; TBD by integration).
5. Load and display file on Program output.
6. Return updated state.

**Note on Integration**: The exact interaction between Media Library and the existing `currentMode` state (slides, url, l3, idle) is defined in the API contract (spec 02). For v1, Media Library items are treated as a variant of lower-thirds mode but distinct from Still Store (they do not trigger stacking; they replace). **TBD: Should Media Library items use a separate `mediaLibrary` field in AppState, or be treated as a special case of `l3` mode?** See **API Surface** section below.

---

### 2.4 Admin vs Operator Access

| Operation | Admin | Operator |
|-----------|-------|----------|
| Upload to Media Library | ✓ | ✗ |
| View Media Library | ✓ | ✓ |
| Display Media Library item | ✗ | ✓ |
| Delete Media Library item | ✓ | ✗ |
| Rename/edit item metadata | ✓ | ✗ |

---

### 2.5 Persistence and Lifecycle

- Media Library items **persist across app restarts**.
- Items can be manually deleted by admin (no auto-expiration).
- Deletion is permanent (no trash/recycle bin in v1).
- No backup or versioning of deleted items.

---

## 3. Relationship Between Still Store and Media Library

| Aspect | Still Store | Media Library |
|--------|-----------|----------------|
| **Purpose** | Production-ready named cues for lower thirds | General-purpose file storage |
| **Source** | Manual entry, CSV import, image upload | Image upload only |
| **Templating** | CSS themes; automatic rendering | No templating; files stored as-is |
| **Naming** | Structured (name + title + subtitle) | Flat (displayName + filename) |
| **Persistence** | Metadata + rendered PNG or original image | Original file only |
| **Triggering** | By cue ID or name (via playlist or direct) | By item ID (list selection) |
| **Stacking** | Supported (configurable ON/OFF) | Not supported; replaces |
| **Export** | PNG (rendered or original) | Original format |
| **Admin vs Operator** | Both roles; separate workflows | Admin uploads; operator selects |
| **UI Surface** | Playlist/cue selector | File browser/list |

**Key Distinction**: Still Store is "show-time cues"; Media Library is "file storage". They serve different purposes and are accessed via different UI surfaces.

---

## 4. API Surface

### 4.1 Still Store HTTP Endpoints

#### `GET /api/l3/cues`
List all Still Store cues.

**Request:** No body.

**Response (200 OK):**
```json
{
  "cues": [
    {
      "id": "cue-001",
      "name": "John Doe",
      "title": "CEO",
      "subtitle": "Head of Company",
      "theme": "default",
      "sourceType": "manual",
      "renderedPngPath": "cue-001.png",
      "createdAt": 1715450000000,
      "updatedAt": 1715450000000
    }
  ]
}
```

---

#### `POST /api/l3/cues`
Create a new manual lower third cue.

**Request:**
```json
{
  "name": "John Doe",
  "title": "CEO",
  "subtitle": "Head of Company",
  "theme": "default"
}
```

**Response (201 Created):**
```json
{
  "id": "cue-xyz",
  "name": "John Doe",
  "title": "CEO",
  "subtitle": "Head of Company",
  "theme": "default",
  "sourceType": "manual",
  "renderedPngPath": "cue-xyz.png"
}
```

**Error Codes:**
- `INVALID_THEME` (400): Theme not found; will default to first available (logged as warning).
- `RENDER_FAILED` (500): CSS rendering failed.

---

#### `POST /api/l3/cues/import`
Bulk import lower third cues from CSV.

**Request:** Multipart form-data with file `csvFile`.

**Response (200 OK):**
```json
{
  "imported": 15,
  "skipped": 2,
  "warnings": [
    "Row 5: missing 'title' field",
    "Row 12: theme 'fancy' not found; using 'default'"
  ]
}
```

---

#### `POST /api/l3/cues/upload-image`
Upload one or more images to Still Store.

**Request:** Multipart form-data with:
- `imageFiles[]`: one or more image files
- `name` (optional): override filename
- `title` (optional): metadata
- `theme` (optional): CSS theme name

**Response (200 OK):**
```json
{
  "imported": 3,
  "failed": 1,
  "items": [...]
}
```

---

#### `GET /api/l3/cues/{cueId}/export`
Download a cue as PNG or JPG (depending on source type).

**Response (200 OK):** Binary PNG/JPG file.

---

#### `DELETE /api/l3/cues/{cueId}`
Delete a cue from Still Store. (Admin only.)

**Response (204 No Content).**

---

#### `GET /api/l3/csv-sample`
Download sample CSV template.

**Response (200 OK):** CSV file with headers and 2 example rows.

---

#### `GET /api/l3/themes`
List installed CSS themes.

**Response (200 OK):**
```json
{
  "themes": [
    {
      "name": "default",
      "displayName": "Default",
      "description": "Classic lower third",
      "isBuiltIn": true,
      "previewImageUrl": null,
      "createdAt": 1715400000000
    }
  ]
}
```

---

#### `POST /api/l3/themes`
Install a new CSS theme. (Admin only.)

**Request:** Multipart form-data with:
- `cssFile`: CSS template file
- `name`: theme identifier (alphanumeric + hyphens)
- `displayName`: human-readable name
- `previewImage` (optional): preview image

**Response (201 Created):**
```json
{
  "name": "blue-gradient",
  "displayName": "Blue Gradient",
  "isBuiltIn": false
}
```

---

#### `DELETE /api/l3/themes/{name}`
Delete a custom CSS theme. (Admin only; built-in themes cannot be deleted.)

**Response (204 No Content).**

---

#### `GET /api/l3/themes/sample.css`
Download sample CSS template for reference.

**Response (200 OK):** CSS file.

---

### 4.2 Media Library HTTP Endpoints

#### `GET /api/media-library`
List all Media Library items.

**Request:** No body.

**Response (200 OK):**
```json
{
  "items": [
    {
      "id": "media-abc",
      "displayName": "chart.png",
      "filename": "chart.png",
      "mimeType": "image/png",
      "fileSize": 51200,
      "width": 1920,
      "height": 1080,
      "hasTransparency": false,
      "uploadedAt": 1715450000000
    }
  ]
}
```

---

#### `POST /api/media-library/upload`
Upload files to Media Library. (Admin only.)

**Request:** Multipart form-data with `files[]`.

**Response (200 OK):**
```json
{
  "imported": 3,
  "failed": 1,
  "items": [...]
}
```

---

#### `POST /api/media-library/take`
Display a Media Library item on Program output.

**Request:**
```json
{
  "itemId": "media-abc"
}
```

**Response (200 OK):**
```json
{
  "currentMode": "media-library",
  "mediaLibrary": {
    "activeItemId": "media-abc",
    "activeItemName": "chart.png"
  }
}
```

---

#### `GET /api/media-library/{itemId}/download`
Download a Media Library item.

**Response (200 OK):** Binary file (original format).

---

#### `DELETE /api/media-library/{itemId}`
Delete a Media Library item. (Admin only.)

**Response (204 No Content).**

---

### 4.3 WebSocket Events (Still Store & Media Library)

**Cue List Update:**
```json
{
  "type": "state_patch",
  "payload": {
    "l3": {
      "availableCues": [
        { "id": "cue-001", "name": "John Doe", "title": "CEO" }
      ]
    }
  }
}
```

**Media Library Update:**
```json
{
  "type": "state_patch",
  "payload": {
    "mediaLibrary": {
      "availableItems": [
        { "id": "media-abc", "displayName": "chart.png" }
      ]
    }
  }
}
```

---

### 4.4 AppState Extension (Spec 02 Integration)

The AppState model (defined in spec 02) should be extended to include:

```typescript
interface AppState {
  // ... existing fields ...
  
  // Lower Thirds cue library
  l3Cues?: {
    availableCues: Array<{ id: string; name: string; title: string; subtitle?: string; theme: string }>;
    currentCueId: string | null;          // Currently displayed cue (if any)
    currentCueName: string | null;
    stackingEnabled: boolean;
    stackSize: number;                    // Number of cues currently stacked
  };
  
  // Media Library
  mediaLibrary?: {
    availableItems: Array<{ id: string; displayName: string; filename: string; mimeType: string }>;
    activeItemId: string | null;          // Currently displayed item (if any)
    activeItemName: string | null;
  };
}
```

**Note**: This is a **forward-looking design**. For MVP v1, if the above fields cause API bloat, they can be split into separate endpoints (`GET /api/l3/cues` and `GET /api/media-library`). The core lower-thirds triggering remains via `POST /api/l3/take` (as defined in spec 02).

---

### 4.5 API Gaps and TODOs

1. **Playlist management**: The source of truth (spec 01) mentions playlists as "ordered lists of cues" configured in Admin and recallable by name from Operator view. This spec does not fully define playlist CRUD endpoints. **TODO**: Add:
   - `POST /api/playlists` (create)
   - `GET /api/playlists` (list)
   - `GET /api/playlists/{playlistId}` (fetch cues in playlist)
   - `POST /api/playlists/{playlistId}/take` (trigger entire playlist or next cue)
   - `DELETE /api/playlists/{playlistId}` (delete)

2. **Theme preview/thumbnail generation**: The spec assumes preview images can be provided, but does not specify the mechanism for auto-generating thumbnails. **TODO**: Define or defer thumbnail generation.

3. **Stacking state in API**: The current API (`POST /api/l3/stacking`) sets `isStacking` but does not expose the current stack depth or entry list. **TODO**: Extend response or WebSocket event to include stack size and/or entries (useful for UI display).

4. **Media Library mode integration**: The spec assumes Media Library items trigger a separate `currentMode: "media-library"`, but the existing AppState model (spec 02) does not include this mode. **TODO**: Either:
   - Extend `currentMode` to include `"media-library"`, OR
   - Treat Media Library items as a variant of lower-thirds mode and add a flag, OR
   - Defer Media Library display mode to v1.1 and implement as a separate HTTP endpoint (display but do not change mode).

---

## 5. Acceptance Criteria

### 5.1 Manual Lower Third Entry

- [ ] **Manual L3 creation**: Operator can navigate to `/operator` → "Lower Thirds" → "New Cue", enter name, title, and select a theme, and click "Create". Cue appears in cue list and is immediately recallable.
- [ ] **Theme selection**: Dropdown lists all installed CSS themes. Selecting a theme shows a preview of how the lower third will render.
- [ ] **Rendering**: After creation, lower third is rendered to 1920×1080 PNG with transparency. Rendered PNG is stored and verified (no render errors).
- [ ] **Persistence**: Cue persists across app restart.

### 5.2 CSV Bulk Import

- [ ] **CSV upload**: Admin can navigate to `/admin` → "Still Store" → "Bulk Import", select a CSV file, and click "Import".
- [ ] **Sample CSV**: Sample CSV is downloadable and has correct format (header row + 2 example rows).
- [ ] **Column validation**: CSV with missing required columns (`name`, `title`, `theme`) is rejected with error message.
- [ ] **Row skipping**: Rows with missing required fields are skipped with logged warning; import continues.
- [ ] **Theme defaulting**: Rows with unmatched theme names default to first available theme with logged warning.
- [ ] **Import summary**: After import, admin sees summary: "X rows imported, Y rows skipped" with warning list.
- [ ] **Cue availability**: All imported cues are immediately available in operator's cue list and are recallable.

### 5.3 Image Upload (Still Store)

- [ ] **Image upload**: Admin can upload PNG, JPG, GIF, WEBP, or SVG to Still Store.
- [ ] **Transparency**: PNG and SVG images with transparency are preserved (verified on display).
- [ ] **Storage**: Uploaded image is stored in original format; no conversion unless required (e.g., for rendering).
- [ ] **Cue creation**: Each uploaded image becomes a Still Store cue with auto-generated name (or user-provided name) and is recallable by operator.
- [ ] **Persistence**: Cues persist across restart.

### 5.4 CSS Theme System

- [ ] **Theme installation**: Admin can upload a `.css` file via `/admin` → "Settings" → "Lower Third Themes" → "Upload Theme".
- [ ] **CSS validation**: Basic CSS syntax check; invalid CSS is rejected with error.
- [ ] **Theme in dropdown**: After installation, theme appears in lower-third creation UI.
- [ ] **Theme deletion**: Admin can delete custom themes (not built-in themes).
- [ ] **Affected cues**: Deleting a theme updates or warns for any cues using that theme.
- [ ] **Sample template**: Sample CSS template is downloadable and is well-commented for reference.

### 5.5 Stacking Behavior

- [ ] **Stacking OFF (default)**: When stacking is OFF, triggering a new cue replaces the previous cue on output.
- [ ] **Stacking ON**: When stacking is ON, triggering a new cue overlays it (higher z-index) on the previous cue.
- [ ] **Stack limit**: App enforces reasonable stack limit (e.g., 10 cues max) or displays warning if stack grows large.
- [ ] **Clear command**: Operator can clear all stacked cues in one action; output returns to luma-key background.
- [ ] **Toggle safety**: Toggling stacking OFF while cues are stacked prompts operator: "Stacking is now OFF. Clear the current stack?" and respects choice.
- [ ] **Multiple stills render correctly**: All cues in stack render correctly with transparency respected (verified visually on output).

### 5.6 Media Library

- [ ] **Upload to Media Library**: Admin can upload images to Media Library (separate from Still Store).
- [ ] **List Media Library**: Operator can view list of Media Library items in Web UI.
- [ ] **Display item**: Operator can select a Media Library item and display it on Program output.
- [ ] **Distinct from Still Store**: Media Library items do not appear in Still Store cue list; Still Store cues do not appear in Media Library list.
- [ ] **Admin delete**: Admin can delete Media Library items (permanent; no trash).
- [ ] **Persistence**: Media Library items persist across app restart.

### 5.7 Admin vs Operator Access

- [ ] **Operator cannot access `/admin`**: Attempting to navigate to `/admin` without admin PIN shows login; operator PIN does not grant access.
- [ ] **CSV import admin-only**: CSV import button is hidden from `/operator` UI.
- [ ] **Image upload admin-only**: Image upload to Still Store is restricted to `/admin`.
- [ ] **Theme management admin-only**: Theme installation/deletion is restricted to `/admin`.
- [ ] **Operator can trigger**: Operator can trigger stills and Media Library items from `/operator` without admin access.

### 5.8 Export

- [ ] **Still Store export (manual/CSV)**: Exporting a manual or CSV-imported cue downloads a 1920×1080 PNG.
- [ ] **Image export**: Exporting an uploaded image cue downloads the original image file (PNG, JPG, etc.).
- [ ] **Media Library export**: Operator can download Media Library items (admin can as well).

### 5.9 HTTP and WebSocket API

- [ ] **GET /api/l3/cues**: Returns list of all Still Store cues with metadata.
- [ ] **POST /api/l3/cues**: Creates a new manual lower third cue; returns cue ID and metadata.
- [ ] **POST /api/l3/cues/import**: Accepts CSV upload; returns import summary.
- [ ] **POST /api/l3/cues/upload-image**: Accepts image file(s); returns upload summary.
- [ ] **POST /api/l3/take** (existing; spec 02): Triggers a cue or inline lower third; respects stacking mode.
- [ ] **POST /api/l3/clear** (existing; spec 02): Clears all cues from stack.
- [ ] **POST /api/l3/stacking** (existing; spec 02): Toggles stacking mode.
- [ ] **GET /api/media-library**: Returns list of Media Library items.
- [ ] **POST /api/media-library/upload**: Accepts image file(s); returns upload summary.
- [ ] **POST /api/media-library/take**: Displays a Media Library item on Program output.
- [ ] **WebSocket state updates**: Cue list and Media Library updates are broadcast to connected clients.

### 5.10 Error Handling

- [ ] **Invalid CSV**: Malformed CSV is rejected with clear error message.
- [ ] **Render failure**: If CSS theme rendering fails, error is returned with message and logged.
- [ ] **Missing theme**: If a cue references a deleted theme, app defaults theme to first available and logs warning (cue remains; no data loss).
- [ ] **File upload size**: Files > max size are rejected with error message; valid files in batch continue.
- [ ] **Unsupported format**: Files with unsupported MIME types are rejected; valid files in batch continue.

### 5.11 Persistence and Restart

- [ ] **Still Store cues persist**: Creating a manual cue or importing CSV, then restarting the app, shows all cues in the list.
- [ ] **Media Library persists**: Uploading a file to Media Library, then restarting, shows file in list and accessible for display.
- [ ] **Stack clears on restart**: On app startup, any stacked cues are cleared; output shows luma-key background.
- [ ] **Themes persist**: Installed custom themes are available after restart.

---

## 6. Implementation Notes

### 6.1 Rendering Engine

Still Store rendering (for manual and CSV-imported cues) requires a headless browser or similar rendering system:

- **Recommended**: Puppeteer (Node.js) or Playwright for headless Chrome rendering.
- **Alternative**: Electron's native rendering (if app is Electron-based, may be feasible).
- **Output**: 1920×1080 PNG with transparency (use `png-stream` or similar for file writing).
- **Performance**: Rendering is synchronous (blocks UI briefly) or async (queued); batch imports should use async rendering with a queue to avoid timeout.

### 6.2 File Storage

- **Database**: SQLite or JSON files in `~/.pconair/` for metadata.
- **File directory structure**:
  ```
  ~/.pconair/
    still-store/
      renders/              # 1920×1080 PNG files (manual/CSV)
        {cueId}.png
      uploads/              # Original image files (image source type)
        {cueId}.{ext}
      themes/               # Custom CSS theme files
        {themeName}.css
        {themeName}-preview.{ext}
    media-library/
      {itemId}.{ext}        # Original uploaded files
  ```

### 6.3 Concurrency

- File uploads, rendering, and database writes should be handled serially or with a queue to avoid race conditions.
- Rendering is CPU-intensive; consider rate-limiting concurrent renders (e.g., max 2 concurrent renders).

### 6.4 Testing Strategy

- **Unit tests**: CSV parsing, theme validation, file I/O.
- **Integration tests**: Full workflow (manual entry → render → store → retrieve).
- **Visual tests**: Rendered lower thirds display correctly with transparency, fonts, colors.
- **Stacking tests**: Multiple cues stack correctly; clear removes all; toggling respects choice.
- **API tests**: All HTTP endpoints return correct status codes and payloads.

---

## Document Metadata

- **Spec Version:** 1.0
- **Last Updated:** 2026-05-11
- **Status:** DRAFT (Task 4 of spec series)
- **Related Specs:** 
  - 01-source-of-truth.md (product definition)
  - 02-api-state-contract.md (HTTP/WebSocket API)
  - 03-slides-parity-inventory.md (Slides mode inventory)
