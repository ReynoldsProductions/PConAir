# PC On Air v1 — API State Contract

## Overview

This document defines the canonical state model and HTTP/WebSocket API contract for PC On Air v1. All components (Web UI, Companion module, Electron main process, renderer) build against this contract. The contract is precise enough that two engineers could independently implement a server and client and have them interoperate without ambiguity.

---

## 1. Application State Model

### 1.1 TypeScript Interface Definition

```typescript
interface AppState {
  // Current mode of operation
  currentMode: "slides" | "url" | "l3" | "media-library" | "idle";

  // Active URL preset (if any)
  currentPreset: {
    id: string;
    name: string;
  } | null;

  // Current URL being displayed (URL mode only)
  currentUrl: string | null;

  // Slides state (Slides mode only)
  slides: {
    deckId: string;           // Unique identifier for the deck
    deckTitle: string;        // Human-readable deck name
    slideIndex: number;       // 0-based index of currently displayed slide
    slideCount: number;       // Total number of slides in deck
    isLoading: boolean;       // True while deck/slides are loading
  } | null;

  // Lower Thirds state (L3 mode only)
  l3: {
    activeCueId: string | null;      // ID of currently displayed cue
    activeCueName: string | null;    // Name of currently displayed cue
    isStacking: boolean;             // True if multiple cues can stack; false if new cue replaces
    currentPlaylistId: string | null; // ID of the active L3 playlist (null if no playlist loaded)
  } | null;

  // Media Library state (media-library mode only)
  mediaLibrary: {
    activeItemId: string | null;   // ID of the Media Library item currently on Program output
    activeItemName: string | null; // Human-readable name of the active item
  } | null;

  // Background/luma key configuration
  background: {
    presetId: string | null;    // ID of active preset (if saved)
    presetName: string | null;  // Human-readable preset name
    type: "luma" | "solid";     // "luma" for chroma key, "solid" for background color
    value: string;              // Hex color (#RRGGBB) or luma key value (e.g., #00FF00)
  };

  // Connected display list
  displays: Array<{
    id: string;       // System-unique identifier for display
    name: string;     // Human-readable name (e.g., "HDMI-1", "Display 2")
    isPrimary: boolean; // True if this is the primary Program output display
  }>;

  // A/B instance state (Slides and URL modes only; ignored in L3 mode)
  abState: {
    activeInstance: "A" | "B";  // Which instance is currently on-air
    instanceA: {
      url: string | null;               // Current URL (URL mode) or null
      displayTarget: string | null;     // Display ID this instance targets (null = default primary display)
      sessionMode: "persistent" | "ephemeral"; // Session mode for URL instances (only relevant in URL mode)
      isLoading: boolean;               // True while content is loading
      isReady: boolean;                 // True if content is loaded and ready to display
    };
    instanceB: {
      url: string | null;
      displayTarget: string | null;
      sessionMode: "persistent" | "ephemeral";
      isLoading: boolean;
      isReady: boolean;
    };
  };

  // Connection and client status
  connectionStatus: {
    webSocketClients: number;      // Number of connected WebSocket clients
    companionConnected: boolean;   // True if Bitfocus Companion is connected
  };
}
```

### 1.2 State Semantics

#### `currentMode`
- **`"idle"`**: No content is displayed; Program output is blank or shows luma key background only.
- **`"slides"`**: Google Slides deck is loaded and displayed.
- **`"url"`**: Arbitrary URL is loaded and displayed.
- **`"l3"`**: Lower third (still) is active.
- **`"media-library"`**: A Media Library item (image, video, or other media) is on Program output. The `mediaLibrary` state field is populated; the `l3` field is `null` in this mode.

#### `currentPreset`
- Populated when the current URL or Slides deck was loaded from a saved preset.
- When a URL or deck is loaded directly (not from preset), this field is `null`.
- Clearing the current content sets this to `null`.

#### `slides`
- **All fields are `null`** when `currentMode` is not `"slides"`.
- `slideIndex` is 0-based; a deck with 10 slides has `slideIndex` in range [0, 9].
- `slideCount` is the total number of slides in the deck (always ≥ 1 if slides is non-null).
- `isLoading` is `true` while the deck is being fetched or slides are being rendered; `false` once ready.

#### `l3`
- **All fields are `null`** when `currentMode` is not `"l3"`.
- `activeCueId` is the unique identifier of the lower third template/content being displayed.
- `activeCueName` is the human-readable name of the cue.
- When `isStacking` is `true`, new triggers overlay previous cues. When `false`, new cue replaces previous.
- Calling "clear" sets both `activeCueId` and `activeCueName` to `null` but does not change `isStacking`.
- `currentPlaylistId` is the ID of the currently loaded L3 playlist; `null` if no playlist is active.

#### `mediaLibrary`
- **All fields are `null`** when `currentMode` is not `"media-library"`.
- `activeItemId` is the unique identifier of the Media Library item on Program output.
- `activeItemName` is the human-readable name of that item.
- Calling the media library clear endpoint sets both fields to `null` and resets `currentMode` to `"idle"`.

#### `background`
- Always present; defines the keying color for all modes.
- **`type: "luma"`**: `value` is a hex color (#RRGGBB) used as luma key. All pixels matching this color are transparent/keyed.
- **`type: "solid"`**: `value` is a hex color (#RRGGBB) used as solid background color.
- `presetId` and `presetName` are non-null only if the current color is a saved preset. If the color was set directly (not from preset), both are `null`.
- **Validation**: `value` must be a valid hex color in format `#RRGGBB` where `RR`, `GG`, `BB` are 00–FF.

#### `displays`
- Array of all connected displays as reported by the OS.
- `isPrimary` is `true` for exactly one display (the Program output).
- Populated by querying the system display list on startup and whenever displays change (e.g., HDMI plug/unplug).
- Empty array `[]` if no displays are connected.

#### `abState`
- **Active in Slides and URL modes only.**
- `activeInstance` indicates which instance ("A" or "B") is currently on-air.
- For Slides: `instanceA.url` and `instanceB.url` are both `null` (Slides state lives in `slides` object).
- For URL: `instanceA.url` and `instanceB.url` contain the URL for each instance.
- `isLoading` and `isReady` are independent per instance. E.g., instance A can be loading while instance B is ready.
- `displayTarget`: The display ID this instance targets. `null` means the default primary Program output display. Only meaningful in URL mode; ignored in Slides mode.
- `sessionMode`: The session persistence mode for URL instances. `"persistent"` retains cookies/localStorage across reloads; `"ephemeral"` uses a clean browser context. Only meaningful in URL mode; ignored in Slides mode.
- **Ignored in L3 and media-library modes**: Both `instanceA` and `instanceB` have `url: null`, `displayTarget: null`, `sessionMode: "persistent"`, `isLoading: false`, `isReady: false`.

#### `connectionStatus`
- `webSocketClients`: count of active WebSocket client connections (including Companion and Web UI clients).
- `companionConnected`: `true` if at least one Bitfocus Companion instance is connected; `false` otherwise.
- These fields are updated in real-time and reported to all clients.

---

## 2. HTTP API Endpoints

All HTTP endpoints accept and return JSON. All responses include a standard error wrapper on failure (see **Error Responses**).

### 2.1 Status Endpoints

#### `GET /api/status`
Returns the complete application state.

**Request:**
- No body.

**Response (200 OK):**
```json
{
  "currentMode": "slides",
  "currentPreset": null,
  "currentUrl": null,
  "slides": {
    "deckId": "abc123",
    "deckTitle": "Q1 Results",
    "slideIndex": 2,
    "slideCount": 15,
    "isLoading": false
  },
  "l3": null,
  "background": {
    "presetId": null,
    "presetName": null,
    "type": "luma",
    "value": "#00FF00"
  },
  "displays": [
    {
      "id": "HDMI-1",
      "name": "HDMI-1",
      "isPrimary": true
    }
  ],
  "abState": {
    "activeInstance": "A",
    "instanceA": {
      "url": null,
      "displayTarget": null,
      "sessionMode": "persistent",
      "isLoading": false,
      "isReady": true
    },
    "instanceB": {
      "url": null,
      "displayTarget": null,
      "sessionMode": "persistent",
      "isLoading": false,
      "isReady": false
    }
  },
  "connectionStatus": {
    "webSocketClients": 2,
    "companionConnected": true
  }
}
```

**Error Codes:** None expected under normal operation.

---

### 2.2 Mode Control

#### `POST /api/mode`
Set the current mode.

**Request:**
```json
{
  "mode": "slides" | "url" | "l3" | "media-library" | "idle"
}
```

**Response (200 OK):**
```json
{
  "currentMode": "url"
}
```

**Error Codes:**
- `INVALID_MODE` (400): `mode` is not one of the allowed values.

**Semantics:**
- Switching modes does not automatically clear state from the previous mode.
- E.g., switching from Slides to URL does not clear the current deck; it remains in state but is not displayed.
- Switching to `"idle"` clears `currentMode` but leaves other state intact.

---

### 2.3 URL Mode

#### `POST /api/url`
Load a URL on the Program output or a specific display.

**Request:**
```json
{
  "url": "https://example.com",
  "display": "HDMI-1"  // Optional; if omitted, uses primary display
}
```

**Response (200 OK):**
```json
{
  "currentMode": "url",
  "currentUrl": "https://example.com",
  "abState": {
    "activeInstance": "A",
    "instanceA": {
      "url": "https://example.com",
      "displayTarget": null,
      "sessionMode": "persistent",
      "isLoading": true,
      "isReady": false
    },
    "instanceB": {
      "url": null,
      "displayTarget": null,
      "sessionMode": "persistent",
      "isLoading": false,
      "isReady": false
    }
  }
}
```

**Error Codes:**
- `INVALID_URL` (400): `url` is malformed or unreachable.
- `DISPLAY_NOT_FOUND` (404): Specified `display` ID does not exist in `displays`.

**Semantics:**
- Sets `currentMode` to `"url"`.
- Loads the URL into the active instance (determined by `abState.activeInstance`).
- Sets `isLoading: true` and `isReady: false` on the active instance.
- Once the URL has fully loaded (DOM ready, resources fetched), sets `isReady: true`.
- If `display` is specified, the URL is routed to that display instead of the primary.

---

#### `POST /api/url/reload`
Reload the current URL in one or both instances.

**Request:**
```json
{
  "instance": "A" | "B"  // Optional; if omitted, reloads the active instance
}
```

**Response (200 OK):**
```json
{
  "abState": {
    "activeInstance": "A",
    "instanceA": {
      "url": "https://example.com",
      "displayTarget": null,
      "sessionMode": "persistent",
      "isLoading": true,
      "isReady": false
    },
    "instanceB": {
      "url": null,
      "displayTarget": null,
      "sessionMode": "persistent",
      "isLoading": false,
      "isReady": false
    }
  }
}
```

**Error Codes:**
- `INVALID_URL` (400): The URL to reload is malformed or unreachable.

**Semantics:**
- Reloads the URL in the specified instance (or active instance if not specified).
- The non-reloaded instance continues to display the previous URL.
- E.g., if `activeInstance: "A"` and instance A is displaying a URL, calling `reload` without specifying instance reloads A while B remains unchanged.
- Sets `isLoading: true` and `isReady: false` on the reloading instance.

---

#### `POST /api/ab/switch`
Switch the active A/B instance (URL and Slides modes).

**Request:**
```json
{
  "instance": "A" | "B"
}
```

**Response (200 OK):**
```json
{
  "abState": {
    "activeInstance": "B"
  }
}
```

**Error Codes:** None expected if instance is valid.

**Semantics:**
- Sets `activeInstance` to the specified instance.
- Immediately displays the content of the specified instance on Program output.
- If the instance is not ready (`isReady: false`), switching to it may show a blank or loading state.

---

### 2.4 Slides Mode

#### `POST /api/slides/load`
Load a Google Slides deck.

**Request:**
```json
{
  "deckUrl": "https://docs.google.com/presentation/d/...",
  "instance": "A" | "B"  // Optional; if omitted, loads into active instance
}
```

**Response (200 OK):**
```json
{
  "currentMode": "slides",
  "slides": {
    "deckId": "abc123",
    "deckTitle": "Q1 Results",
    "slideIndex": 0,
    "slideCount": 15,
    "isLoading": true
  },
  "abState": {
    "activeInstance": "A",
    "instanceA": {
      "url": null,
      "displayTarget": null,
      "sessionMode": "persistent",
      "isLoading": true,
      "isReady": false
    },
    "instanceB": {
      "url": null,
      "displayTarget": null,
      "sessionMode": "persistent",
      "isLoading": false,
      "isReady": false
    }
  }
}
```

**Error Codes:**
- `INVALID_URL` (400): `deckUrl` is malformed or inaccessible.
- `NO_ACTIVE_DECK` (404): Deck could not be found or token is invalid/expired.

**Semantics:**
- Sets `currentMode` to `"slides"`.
- Loads the deck into the specified instance (or active instance if not specified).
- Initializes `slideIndex: 0` (first slide).
- Sets `isLoading: true` on the loading instance until the deck metadata and first slide are ready.
- If loading into a specific instance, does not change `activeInstance`.

---

#### `POST /api/slides/next`
Navigate to the next slide.

**Request:** No body.

**Response (200 OK):**
```json
{
  "slides": {
    "slideIndex": 3
  }
}
```

**Error Codes:**
- `NO_ACTIVE_DECK` (400): No deck is currently loaded.
- `SLIDE_OUT_OF_RANGE` (400): Already at the last slide.

**Semantics:**
- Increments `slideIndex` by 1 in the active instance.
- If `slideIndex >= slideCount - 1`, do not increment; return `SLIDE_OUT_OF_RANGE`.

---

#### `POST /api/slides/prev`
Navigate to the previous slide.

**Request:** No body.

**Response (200 OK):**
```json
{
  "slides": {
    "slideIndex": 1
  }
}
```

**Error Codes:**
- `NO_ACTIVE_DECK` (400): No deck is currently loaded.
- `SLIDE_OUT_OF_RANGE` (400): Already at the first slide.

**Semantics:**
- Decrements `slideIndex` by 1 in the active instance.
- If `slideIndex <= 0`, do not decrement; return `SLIDE_OUT_OF_RANGE`.

---

#### `POST /api/slides/goto`
Jump to a specific slide by index.

**Request:**
```json
{
  "slideIndex": 5
}
```

**Response (200 OK):**
```json
{
  "slides": {
    "slideIndex": 5
  }
}
```

**Error Codes:**
- `NO_ACTIVE_DECK` (400): No deck is currently loaded.
- `SLIDE_OUT_OF_RANGE` (400): `slideIndex` is < 0 or >= `slideCount`.

**Semantics:**
- Sets `slideIndex` to the specified index (0-based).
- Validates that the index is within [0, slideCount - 1].
- **Index convention:** Request body `slideIndex` is **0-based** (e.g., `slideIndex: 0` = first slide, `slideIndex: 9` = 10th slide). The Companion module uses **1-based** slide numbers for human-friendly display (e.g., `slide_number: 1` = first slide) and the module adapter subtracts 1 before calling this endpoint. See `07-companion-module.md` for details.

---

#### `POST /api/slides/reload`
Reload the current deck in one or both instances.

**Request:**
```json
{
  "instance": "A" | "B"  // Optional; if omitted, reloads the active instance
}
```

**Response (200 OK):**
```json
{
  "slides": {
    "isLoading": true
  }
}
```

**Error Codes:**
- `NO_ACTIVE_DECK` (400): No deck is currently loaded.

**Semantics:**
- Reloads the deck in the specified instance (or active instance if not specified).
- Sets `isLoading: true`; once reload completes, sets `isLoading: false`.
- Does not change `slideIndex`; the same slide is displayed after reload.

---

### 2.5 Lower Thirds Mode

#### `POST /api/l3/take`
Trigger a lower third cue to the Program output.

**Request:**
```json
{
  "cueId": "cue-001",     // Optional; either cueId or name must be provided
  "name": "John Doe",      // Optional; human-readable name
  "title": "CEO",          // Optional; title text
  "theme": "default",      // Optional; template theme name
}
```

**Response (200 OK):**
```json
{
  "currentMode": "l3",
  "l3": {
    "activeCueId": "cue-001",
    "activeCueName": "John Doe",
    "isStacking": false
  }
}
```

**Error Codes:**
- `INVALID_MODE` (400): Required fields (`cueId` or `name`) are missing.
- `CUE_NOT_FOUND` (404): The specified `cueId` does not exist.

**Semantics:**
- If `cueId` is provided, load the pre-defined cue with that ID.
- If `cueId` is not provided but `name`, `title`, and optional `theme` are provided, create an inline cue (not saved).
- Sets `currentMode` to `"l3"`.
- If `isStacking: false`, removes the previous lower third before displaying the new one.
- If `isStacking: true`, stacks the new lower third above the previous one.

---

#### `POST /api/l3/clear`
Remove all active lower thirds from the Program output.

**Request:** No body.

**Response (200 OK):**
```json
{
  "l3": {
    "activeCueId": null,
    "activeCueName": null
  }
}
```

**Error Codes:** None expected.

**Semantics:**
- Sets `activeCueId` and `activeCueName` to `null`.
- Does not change `currentMode` or `isStacking`.
- All lower thirds are removed from the Program output.

---

#### `POST /api/l3/stacking`
Toggle stacking mode for lower thirds.

**Request:**
```json
{
  "enabled": true
}
```

**Response (200 OK):**
```json
{
  "l3": {
    "isStacking": true
  }
}
```

**Error Codes:** None expected.

**Semantics:**
- Sets `isStacking` to the specified value.
- Does not affect the currently displayed lower third(s).
- Affects subsequent `take` actions.

---

### 2.6 Background and Keying

#### `POST /api/background`
Set the luma key or background color.

**Request:**
```json
{
  "presetId": "bg-preset-1",  // Optional; if provided, load preset
  "type": "luma" | "solid",   // Optional; if omitted, defaults to "luma"
  "value": "#00FF00"          // Optional; hex color; if omitted with presetId, uses preset's value
}
```

**Response (200 OK):**
```json
{
  "background": {
    "presetId": "bg-preset-1",
    "presetName": "Green Key",
    "type": "luma",
    "value": "#00FF00"
  }
}
```

**Error Codes:**
- `INVALID_URL` (400): `value` is not a valid hex color.
- `PRESET_NOT_FOUND` (404): Specified `presetId` does not exist.

**Semantics:**
- If `presetId` is provided, load the preset and override `type` and `value` from the preset.
- If only `type` and/or `value` are provided (no `presetId`), set them directly; `presetId` and `presetName` become `null`.
- **Validation**: `value` must be in format `#RRGGBB` with hexadecimal characters.

---

### 2.7 Display Management

#### `GET /api/displays`
Returns the list of connected displays.

**Request:** No body.

**Response (200 OK):**
```json
{
  "displays": [
    {
      "id": "HDMI-1",
      "name": "HDMI-1",
      "isPrimary": true
    },
    {
      "id": "DP-1",
      "name": "DisplayPort-1",
      "isPrimary": false
    }
  ]
}
```

**Error Codes:** None expected.

**Semantics:**
- Returns a snapshot of the current display list.
- Exactly one display has `isPrimary: true`.
- If no displays are connected, returns an empty array.

---

### 2.8 Presets (URL and Slides)

> **Note:** These are the canonical URL preset endpoint paths. Spec 06 (`06-url-mode-multi-display.md`) provides additional URL mode context and documentation, but the path definitions here are authoritative. `POST /api/presets` and `DELETE /api/presets/:id` are **admin-only** (creation and deletion require admin authentication); `GET /api/presets` requires operator or admin authentication.

The canonical `UrlPreset` shape (used in all endpoints and export bundles):

```typescript
interface UrlPreset {
  id: string;                           // UUID
  name: string;                         // Human-readable label (≤ 100 chars)
  url: string;                          // Valid http/https URL
  displayTarget?: string | null;        // Display ID or "primary" (null = use default)
  sessionMode: "persistent" | "ephemeral"; // Session mode for this preset
  description?: string;                 // Optional description (≤ 500 chars)
  createdAt: string;                    // ISO 8601
  updatedAt: string;                    // ISO 8601
}
```

#### `GET /api/presets`
Returns the list of saved URL presets.

**Authentication:** Operator or admin.

**Request:** No body.

**Response (200 OK):**
```json
{
  "presets": [
    {
      "id": "preset-1",
      "name": "Slido Q&A",
      "url": "https://slido.com/event/abc",
      "displayTarget": "HDMI-1",
      "sessionMode": "persistent",
      "description": "Main stage Q&A",
      "createdAt": "2026-05-01T10:00:00Z",
      "updatedAt": "2026-05-01T10:00:00Z"
    },
    {
      "id": "preset-2",
      "name": "Dashboard",
      "url": "https://dashboard.example.com",
      "displayTarget": null,
      "sessionMode": "ephemeral",
      "createdAt": "2026-05-01T11:00:00Z",
      "updatedAt": "2026-05-01T11:00:00Z"
    }
  ]
}
```

**Error Codes:** None expected.

**Semantics:**
- Presets are user-defined; they are created and deleted via `POST /api/presets` and `DELETE /api/presets/:id`.

---

#### `POST /api/presets`
Create or update a URL preset.

**Authentication:** Admin only.

**Request:**
```json
{
  "id": "preset-3",             // Optional; if omitted, a new ID is generated
  "name": "Slido Q&A",
  "url": "https://slido.com/event/abc",
  "displayTarget": "HDMI-1",   // Optional
  "sessionMode": "persistent",  // Required
  "description": "Main stage"   // Optional
}
```

**Response (201 Created or 200 OK):**
```json
{
  "id": "preset-3",
  "name": "Slido Q&A",
  "url": "https://slido.com/event/abc",
  "displayTarget": "HDMI-1",
  "sessionMode": "persistent",
  "description": "Main stage",
  "createdAt": "2026-05-01T10:00:00Z",
  "updatedAt": "2026-05-01T10:00:00Z"
}
```

**Error Codes:**
- `INVALID_URL` (400): `url` is malformed.

**Semantics:**
- If `id` is provided and already exists, the preset is updated (200 OK).
- If `id` is omitted or does not exist, a new preset is created with a generated ID (201 Created).

---

#### `DELETE /api/presets/:id`
Delete a URL preset.

**Authentication:** Admin only.

**Request:** No body.

**Response (204 No Content):**

**Error Codes:**
- `PRESET_NOT_FOUND` (404): Specified `id` does not exist.

**Semantics:**
- Removes the preset from the library.
- If the deleted preset is the current `currentPreset`, set `currentPreset` to `null`.

---

### 2.9 L3 Playlist Management

Playlists are ordered lists of L3 cues that can be configured in Admin and recalled by name from Operator view. Playlists are v1 scope (see `01-source-of-truth.md`, Section 5.3).

**Authentication:** `GET /api/l3/playlists` and `GET /api/l3/playlists/:id` require operator or admin. All write endpoints (`POST`, `PUT`, `DELETE`, `POST .../activate`) require admin.

#### `GET /api/l3/playlists`
List all playlists.

**Response (200 OK):**
```json
{
  "playlists": [
    {
      "id": "playlist-001",
      "name": "Opening Sequence",
      "cueIds": ["cue-001", "cue-002", "cue-003"],
      "createdAt": "2026-05-01T10:00:00Z",
      "updatedAt": "2026-05-01T10:00:00Z"
    }
  ]
}
```

---

#### `POST /api/l3/playlists`
Create a new playlist.

**Request:**
```json
{
  "name": "Opening Sequence",
  "cueIds": ["cue-001", "cue-002", "cue-003"]
}
```

**Response (201 Created):**
```json
{
  "id": "playlist-001",
  "name": "Opening Sequence",
  "cueIds": ["cue-001", "cue-002", "cue-003"],
  "createdAt": "2026-05-01T10:00:00Z",
  "updatedAt": "2026-05-01T10:00:00Z"
}
```

**Error Codes:**
- `CUE_NOT_FOUND` (404): One or more `cueIds` do not exist.

---

#### `GET /api/l3/playlists/:id`
Get a playlist with its full cue list.

**Response (200 OK):**
```json
{
  "id": "playlist-001",
  "name": "Opening Sequence",
  "cueIds": ["cue-001", "cue-002", "cue-003"],
  "createdAt": "2026-05-01T10:00:00Z",
  "updatedAt": "2026-05-01T10:00:00Z"
}
```

**Error Codes:**
- `PRESET_NOT_FOUND` (404): Specified playlist `id` does not exist.

---

#### `PUT /api/l3/playlists/:id`
Update a playlist (name and/or cue order).

**Request:**
```json
{
  "name": "Opening Sequence v2",
  "cueIds": ["cue-002", "cue-001", "cue-003"]
}
```

**Response (200 OK):**
```json
{
  "id": "playlist-001",
  "name": "Opening Sequence v2",
  "cueIds": ["cue-002", "cue-001", "cue-003"],
  "createdAt": "2026-05-01T10:00:00Z",
  "updatedAt": "2026-05-11T12:00:00Z"
}
```

**Error Codes:**
- `PRESET_NOT_FOUND` (404): Specified playlist `id` does not exist.
- `CUE_NOT_FOUND` (404): One or more `cueIds` do not exist.

---

#### `DELETE /api/l3/playlists/:id`
Delete a playlist.

**Response (204 No Content):**

**Error Codes:**
- `PRESET_NOT_FOUND` (404): Specified `id` does not exist.

**Semantics:**
- Removes the playlist. If this playlist is currently loaded (`l3.currentPlaylistId`), sets `currentPlaylistId` to `null`.

---

#### `POST /api/l3/playlists/:id/activate`
Load a playlist into the operator queue (sets it as the current L3 playlist).

**Request:** No body.

**Response (200 OK):**
```json
{
  "l3": {
    "currentPlaylistId": "playlist-001"
  }
}
```

**Error Codes:**
- `PRESET_NOT_FOUND` (404): Specified playlist `id` does not exist.

**Semantics:**
- Sets `l3.currentPlaylistId` to the specified playlist ID.
- Does not automatically trigger any cues; operator manually takes each cue from the loaded playlist.

---

## 3. WebSocket Protocol

### 3.1 Connection and State Push

The application exposes a WebSocket endpoint at `ws://[host]:[port]/ws`.

**Client Connection:**
1. Client initiates WebSocket connection to `ws://[host]:[port]/ws`.
2. Server accepts connection.
3. Server immediately sends a full `state` event with the complete `AppState`.

**Initial State Event (Server → Client):**
```json
{
  "type": "state",
  "payload": {
    "currentMode": "idle",
    "currentPreset": null,
    "currentUrl": null,
    "slides": null,
    "l3": null,
    "background": { "presetId": null, "presetName": null, "type": "luma", "value": "#00FF00" },
    "displays": [...],
    "abState": {...},
    "connectionStatus": { "webSocketClients": 1, "companionConnected": false }
  }
}
```

### 3.2 State Updates

Whenever application state changes, the server broadcasts updates to all connected clients.

**Full State Push (Server → Client):**
Sent when a significant state change occurs (e.g., mode change, new deck load):
```json
{
  "type": "state",
  "payload": { "currentMode": "slides", ... }
}
```

**Partial State Push (Server → Client):**
Sent when a small, isolated change occurs (e.g., slide navigation):
```json
{
  "type": "state_patch",
  "payload": {
    "slides": {
      "slideIndex": 3
    }
  }
}
```

**Merge Semantics:**
- Client receives a `state_patch` and merges it into its local state using shallow merge.
- E.g., if `payload: { slides: { slideIndex: 3 } }`, the client updates `state.slides.slideIndex` but preserves all other fields in `state.slides`.

### 3.3 Error Events

**Error Notification (Server → Client):**
```json
{
  "type": "error",
  "payload": {
    "code": "INVALID_URL",
    "message": "The provided URL is unreachable or malformed."
  }
}
```

**Error Codes:**
Same as HTTP error codes (see **Error Responses** section).

### 3.4 Client Actions

Clients can send actions over WebSocket instead of HTTP. All HTTP API actions can be invoked via WebSocket.

**Client → Server Action:**
```json
{
  "type": "action",
  "action": "slides/next",
  "payload": {}
}
```

**Action Names:**
- Action names correspond to HTTP endpoint paths with `/api/` stripped.
- Examples:
  - `POST /api/slides/next` → action: `"slides/next"`
  - `POST /api/url` → action: `"url"`
  - `POST /api/l3/take` → action: `"l3/take"`

**Server Response:**
```json
{
  "type": "action_result",
  "action": "slides/next",
  "success": true,
  "result": {
    "slides": {
      "slideIndex": 3
    }
  }
}
```

**On Error:**
```json
{
  "type": "action_result",
  "action": "slides/next",
  "success": false,
  "error": "SLIDE_OUT_OF_RANGE"
}
```

### 3.5 Reconnection and Recovery

**Client Reconnection:**
- If the WebSocket connection drops, the client should reconnect using exponential backoff.
- Recommended backoff: start at 1 second, double on each retry, cap at 30 seconds.
- E.g.: 1s, 2s, 4s, 8s, 16s, 30s, 30s, ...

**Server State Retention:**
- The server retains the last known full state in memory.
- Upon reconnection, a new client immediately receives the full `state` event with the latest state.
- No "missed events" are replayed; the client receives the current snapshot.

**Stateless Design:**
- The client maintains its own local state and merges patches as they arrive.
- The client does not rely on server-side session state beyond the snapshot.

---

## 4. Error Responses

All error responses follow a standard format:

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable error message",
    "details": { /* optional */ }
  }
}
```

### 4.1 HTTP Error Response Example

**400 Bad Request:**
```json
{
  "error": {
    "code": "INVALID_URL",
    "message": "The provided URL is malformed or unreachable.",
    "details": {
      "url": "https://invalid...",
      "reason": "DNS resolution failed"
    }
  }
}
```

### 4.2 Canonical Error Codes

| Code | HTTP Status | Meaning |
|------|-------------|---------|
| `INVALID_MODE` | 400 | The specified mode is not one of: `"slides"`, `"url"`, `"l3"`, `"media-library"`, `"idle"`. |
| `NO_ACTIVE_DECK` | 400 | No Slides deck is currently loaded or in scope. |
| `SLIDE_OUT_OF_RANGE` | 400 | The requested slide index is outside the valid range [0, slideCount-1]. |
| `INVALID_URL` | 400 | The provided URL is malformed, unreachable, or the color value is not a valid hex color. |
| `DISPLAY_NOT_FOUND` | 404 | The specified display ID does not exist in the connected displays list. |
| `CUE_NOT_FOUND` | 404 | The specified lower third cue ID does not exist. |
| `PRESET_NOT_FOUND` | 404 | The specified preset (URL or background) ID does not exist. |
| `AUTH_REQUIRED` | 401 | The request requires authentication (valid session cookie); none was provided. |
| `RATE_LIMITED` | 429 | Too many requests in a short time. The client should back off. |

### 4.3 HTTP Status Codes

| Status | Usage |
|--------|-------|
| `200 OK` | Successful request with response body. |
| `201 Created` | Successful creation (e.g., new preset). |
| `204 No Content` | Successful request with no response body (e.g., delete). |
| `400 Bad Request` | Invalid input or semantic error (e.g., slide out of range). |
| `401 Unauthorized` | Missing or invalid authentication. |
| `404 Not Found` | Resource not found (e.g., preset, display, cue). |
| `429 Too Many Requests` | Rate limit exceeded. |
| `500 Internal Server Error` | Unexpected server error. |

---

## 5. Authentication

All endpoints (HTTP and WebSocket) respect authentication. Unauthenticated requests to protected endpoints return `401 AUTH_REQUIRED`.

### 5.1 Session Cookies

Authentication uses session cookies set via `POST /auth/operator` and `POST /auth/admin`.

#### `POST /auth/operator`
Authenticate as operator.

**Request:**
```json
{
  "pin": "1234"
}
```

**Response (200 OK):**
```json
{
  "role": "operator"
}
```

**Set-Cookie Header:**
```
Set-Cookie: pc-on-air-session=<token>; Path=/; HttpOnly; SameSite=Strict
```

**Error Codes:**
- `AUTH_REQUIRED` (401): PIN is incorrect.
- `RATE_LIMITED` (429): Too many failed attempts (e.g., 5 failures in 5 minutes → lockout for 5 minutes).

**Semantics:**
- Validates the provided PIN against the configured operator PIN.
- On success, sets a session cookie with an opaque session token.
- The session token is valid for all `/api/*` endpoints and the `/operator` route.

---

#### `POST /auth/admin`
Authenticate as admin.

**Request:**
```json
{
  "pin": "5678"
}
```

**Response (200 OK):**
```json
{
  "role": "admin"
}
```

**Set-Cookie Header:**
```
Set-Cookie: pc-on-air-session=<token>; Path=/; HttpOnly; SameSite=Strict
```

**Error Codes:**
- `AUTH_REQUIRED` (401): PIN is incorrect.
- `RATE_LIMITED` (429): Too many failed attempts.

**Semantics:**
- Validates the provided PIN against the configured admin PIN.
- Admin PIN is separate from operator PIN.
- Admin session grants access to both `/admin` and `/operator` routes (and all `/api/*` endpoints).

---

### 5.2 Protected Routes and Endpoints

| Route/Endpoint | Required Role | Notes |
|---|---|---|
| `/operator` | operator or admin | Web UI for show-time controls. |
| `/admin` | admin | Web UI for configuration (can be locked via admin settings). |
| `/api/mode` | operator | Mode switching. |
| `/api/url` | operator | Load URL. |
| `/api/slides/*` | operator | Slide navigation, deck load. |
| `/api/l3/*` | operator | Lower thirds triggering. |
| `/api/background` | admin | Key color configuration. |
| `/api/status` | operator | Read-only status (operator and above can read). |
| `/api/displays` | operator | Read-only displays list. |
| `GET /api/presets` | operator | Read preset list. |
| `POST /api/presets` | admin | Create or update preset. |
| `DELETE /api/presets/:id` | admin | Delete preset. |

**Default:** Operator-level endpoints are accessible to both operator and admin sessions.

---

### 5.3 Cookie Handling

- Session cookies are sent with all subsequent HTTP requests (via `Cookie` header).
- WebSocket connections send cookies as HTTP headers during the WebSocket handshake (standard WebSocket protocol).
- Cookies are `HttpOnly` to prevent XSS-based theft.
- Cookies are `SameSite=Strict` to prevent CSRF.

---

## 6. Rate Limiting

Rate limiting is applied to `/auth/operator` and `/auth/admin` endpoints to prevent brute-force PIN guessing.

**Policy:**
- **Limit:** 5 failed attempts per IP per 5 minutes.
- **Lockout:** After 5 failures, the IP is locked out for 5 minutes.
- **Response:** Locked-out requests return `429 Too Many Requests` with error code `RATE_LIMITED`.

**Example:**
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

---

## 7. Request/Response Content Types

All requests and responses use `Content-Type: application/json`. The server should return this header on all responses; clients should send this header on requests with a body.

---

## 8. Implementation Notes

### 8.1 State Mutation Rules

- **No partial state updates from clients**: Clients cannot send a partial state to "patch" the server. All updates must go through well-defined endpoints (HTTP or WebSocket actions).
- **Idempotency**: Repeated identical requests should produce the same result. E.g., calling `POST /api/slides/next` twice moves forward two slides; calling `POST /api/mode` with the same mode twice is a no-op.
- **Transactional semantics**: Actions like "load deck" are atomic; the state is consistent after each action completes.

### 8.2 Timing and Latency

- **HTTP**: Response should arrive within 100ms under normal conditions; longer if I/O (loading URLs, fetching deck metadata) is required.
- **WebSocket**: Patches and state updates should arrive within 50ms of state change.
- **Action results**: WebSocket action results should arrive within 100ms.

### 8.3 Reliability and Message Ordering

- **HTTP**: RESTful; follows HTTP semantics.
- **WebSocket**: Messages are ordered (FIFO); a client receives updates in the order they were sent.
- **No message loss**: WebSocket frames are reliable (TCP); no application-level retransmission is needed.

### 8.4 Backward Compatibility

- **Version**: This is API v1. Future versions will be `/api/v2/*` with a new WebSocket endpoint `/v2/ws`.
- **Required fields**: The state model defines required fields; clients should not rely on optional fields being present.
- **Unknown fields**: Clients should ignore unknown fields in state payloads (for forward compatibility).

---

## 9. Example Workflows

### 9.1 Operator Loads Slides and Navigates

1. **Operator connects** to `ws://localhost:8080/ws` (via browser Web UI).
   - Server sends full `state` with `currentMode: "idle"`.

2. **Operator loads a deck** via `POST /api/slides/load`.
   - Request: `{ "deckUrl": "https://docs.google.com/presentation/d/..." }`
   - Server responds with updated state: `currentMode: "slides"`, `slides: { ... isLoading: true }`.
   - Server broadcasts `state_patch` to all WebSocket clients.

3. **Deck finishes loading**.
   - Server sets `slides.isLoading: false`.
   - Server broadcasts `state_patch: { "slides": { "isLoading": false } }`.

4. **Operator navigates to next slide** via `POST /api/slides/next`.
   - Server increments `slides.slideIndex` to 1.
   - Server responds and broadcasts `state_patch: { "slides": { "slideIndex": 1 } }`.

5. **Operator refreshes the peer instance** via `POST /api/slides/reload?instance=B`.
   - Server reloads instance B (not currently on-air).
   - Instance A continues displaying slide 1.
   - Once reload completes, instance B is ready as a backup.

6. **Operator switches to instance B** via `POST /api/ab/switch`.
   - Request: `{ "instance": "B" }`
   - Server sets `abState.activeInstance: "B"`.
   - Instance B now displays on Program output.

---

### 9.2 Companion Loads URL Preset

1. **Companion connects** to `ws://localhost:8080/ws`.
   - Server sends full state.

2. **Companion sends action** to load a preset:
   - Message: `{ "type": "action", "action": "url", "payload": { "url": "https://slido.com/event/123", "display": "HDMI-1" } }`

3. **Server processes action**.
   - Sets `currentMode: "url"`.
   - Loads URL into active instance.
   - Responds: `{ "type": "action_result", "action": "url", "success": true, ... }`

4. **Server broadcasts state update** to all clients (including the Companion and any Web UI browser).

---

### 9.3 Multi-Client State Consistency

1. **Web UI Client A** and **Web UI Client B** are both connected.
2. **Client A** sends `POST /api/slides/next`.
3. **Server** processes action, updates state, responds to Client A.
4. **Server** broadcasts `state_patch` to all clients, including Client B.
5. Both clients now have consistent state.

---

## 10. Validation and Constraints

### 10.1 URL Validation

- **Format**: Must be a valid absolute URL (starts with `http://` or `https://`).
- **Reachability**: URL must be reachable (DNS resolves, server responds within 10 seconds).
- **HTTPS preferred**: HTTP is allowed for local/development use; HTTPS is recommended for production.

### 10.2 Hex Color Validation

- **Format**: `#RRGGBB` where `RR`, `GG`, `BB` are hexadecimal (00–FF).
- **Case-insensitive**: `#00FF00` and `#00ff00` are equivalent.
- **No alpha**: RGBA notation (e.g., `#00FF00FF`) is not supported in v1.

### 10.3 Preset and Cue ID Validation

- **Format**: Alphanumeric, hyphens, underscores. Regex: `^[a-zA-Z0-9_-]+$`
- **Uniqueness**: IDs must be unique within their category (presets, cues).
- **Length**: IDs should not exceed 255 characters (recommended: < 64).

---

## Document Metadata

- **Spec Version:** 1.0
- **Date:** 2026-05-11
- **Status:** ACTIVE (v1 MVP)
- **Related Specs:** `01-source-of-truth.md`

