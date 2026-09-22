# Prompter scripts from Google Docs — design

> **For agentic workers:** This is a design spec, not a task list. Generate an
> implementation plan from it (superpowers:writing-plans) before writing code.
> TDD applies. The three renderer surfaces have no unit coverage by nature, so
> the work finishes with live verification against a running server and a real
> Google Doc — not just a green suite.

**Goal:** Let producers keep editing a show script in a Google Doc while it is
in use, and give the operator a deliberate, one-button way to put the newer
version on the glass between takes.

**Spec refs:** `docs/prompter.md`, `docs/plans/2026-09-18-prompter-control-page.md`
(approved, not yet implemented — this spec subsumes its first phase)

---

## Context

The prompter script is loaded by pasting text into a box in the Admin SPA and
pressing Load (`POST /api/prompter/script`). That is limiting in three ways:
a producer cannot revise copy without someone re-pasting the whole script,
two people cannot work on it at once, and the script does not survive an app
restart.

### What the "existing Google Drive connection" actually is

There is **no Drive API integration in PConAir**, and none in its predecessor,
Google Slides Controller. Slides mode loads
`docs.google.com/presentation/d/<id>/present` into an Electron
`BrowserWindow` on a persistent session partition
(`persist:google-slides`), with a "Sign in to Google" window and a cookie
sniff for `SID`/`SAPISID` (`src/main/slides/window-manager.ts:324`). No OAuth,
no tokens, no `googleapis` dependency, no scopes.

GSC was checked directly for prior art (all 7 branches, `main.js` at 13k
lines): every `docs.google.com` reference there is `/presentation/`. There is
no Docs text fetching to port. What GSC does have, and what this design
reuses, is the session plumbing — `session.fromPartition` (main.js:1395), the
cookie sign-in check (main.js:3452), and a `webRequest.onHeadersReceived` hook
over `docs.google.com/*` that force-appends `charset=utf-8` to text responses
(main.js:1402).

That last one is load-bearing: it is the root cause behind the U+FFFD
corruption that `normalizeSpeakerNotes` exists to clean up
(`src/main/slides/window-manager.ts:15`). Google's responses can arrive
without a declared charset. **This design must decode bytes as UTF-8
explicitly and must never trust `res.text()`.**

So: same connection, new endpoint —
`https://docs.google.com/document/d/<id>/export?format=txt`, which returns the
document body as plain text and, critically, **excludes comments**. Producers
can argue in the margins without any of it reaching the talent.

## Decisions taken

These were settled during design. Do not relitigate them while implementing;
raise a flag if implementation disproves one.

| # | Decision | Rationale |
|---|---|---|
| 1 | **Session-first fetch, anonymous fallback** | Works on private/org docs via the existing sign-in, still works on link-shared docs with no session. The anonymous path is what makes the fetcher testable without Electron. |
| 2 | **Saved library *and* an ad-hoc URL field** | A Companion button with a URL baked in is unreadable on a stream deck; a named dropdown is one click. The ad-hoc field stays for one-offs. |
| 3 | **Refresh always arms; operator always takes** | No text reaches the glass without a deliberate action, ever. |
| 4 | **Poll every 60s and pre-stage** | The producer edits, the desk goes amber, nobody coordinates over comms. |
| 5 | **Shared renderer module first, Admin migrated onto it** | Otherwise the new Drive UI gets built twice and drifts by the second change. |
| 6 | **Initial load applies immediately; only refresh stages** | Arm/take protects text already on the glass. On first load there is nothing to protect and the prompter is parked by definition; a two-step Load would be today's paste box with an extra click. |
| 7 | **`format=txt`, not `format=html`** | The prompter renders plain text with blank-line paragraphs and literal `[...]`/`(...)` stage directions. Bold and headings have nowhere to go, and txt drops comments for free rather than us filtering them. |
| 8 | **Never preserve scroll position across a refresh** | Paragraph reflow means the same px offset lands on different words. "Keep the reader where they were" would silently lie. Park at top, every time. |

## Model assignments

Execution is split into phases below; each is run by a separate agent. Two
phases carry real invariant/architecture risk (session-cookie reuse, explicit
UTF-8 decoding, the staged-vs-taken safety property, and untangling a
2,456-line inline-script file) and are assigned to Opus. The rest is
pattern-matching against existing code (`presets.ts`, `prompter.ts`,
Companion action conventions) and is assigned to Sonnet.

| Phase | Scope | Model | Why |
|---|---|---|---|
| 1 — Foundation | Phase 0 spike write-up, `PrompterState.doc` shape, `doc-source.ts` | **Opus** | Gets the fetch/decode/safety contract right once; everything else builds on it |
| 2a — Library | `script-docs.ts`, profile persistence | Sonnet | Mirrors `presets.ts` directly |
| 2b — Watcher | `doc-watcher.ts` | Sonnet | Well-specified poll/backoff/diff logic |
| 3 — Routes | `prompter.ts` doc endpoints | Sonnet | Integration of 1/2a/2b behind an established route pattern |
| 4a — Companion | actions/variables/feedbacks | Sonnet | Mirrors existing `prompter_*` actions |
| 4b — Renderer | shared module + `/remote/` + `/prompter-control/` mounts | Sonnet | New surfaces, no legacy coupling |
| 5 — Admin migration | move inline `<script>` prompter section onto the shared module | **Opus** | Surgery on a 2,456-line file with invisible inline-script coupling; own commit, independently revertible |

## Phase 0 — spike before implementation

Hit a real Google Doc and confirm three things. Each changes a line of the
parser, and the second is a genuine safety question.

1. **Does txt export prepend the document title?** If so, strip it — a title
   line at the top of the glass is wrong.
2. **Do suggested edits export as accepted text?** A producer working in
   *Suggesting* mode could otherwise leak unapproved copy to the talent. If
   suggestions are included, the UI needs an explicit warning and the docs
   need a "review in Editing mode" note.
3. **What does a multi-tab doc export?** (Google Docs tabs, 2024+.) If all
   tabs concatenate, say so in the docs; multi-tab selection is out of scope.

Record the answers in the implementation plan before writing the parser.

## Phase 0 — spike findings (deferred to live verification)

**Status: NOT ANSWERED. All three questions remain open and must be verified
manually against a real Google Doc before this feature ships.**

The spike could not be run during Phase 1. Answering any of these requires a
live, signed-in Electron session pointed at a real Google Doc — there is no
browser, no Google session, and no network path to a user's document from the
build environment, and reaching an arbitrary doc is not something to attempt
blind. Phase 1 therefore coded each question **defensively**, choosing the
assumption that fails safe, and left a `// TODO(live-verify):` marker in
`src/main/prompter/doc-source.ts` at the exact point each answer would change.

| # | Question | Assumption coded against | Where it lives | If the live check disagrees |
|---|---|---|---|---|
| 1 | Does `format=txt` prepend the document title? | **No** — the export is understood to return the body only. Nothing strips a title line. | `normalizeScriptText`, `doc-source.ts` | Add a title-strip pass at the marked point, before the CRLF pass: drop a leading line equal to the doc title plus its following blank line. Contained to that one function; nothing downstream changes. |
| 2 | Do suggested edits export as accepted text? | **No** — the export is understood to reflect the accepted/base text, with pending suggestions excluded. No filtering, no UI warning. | `fetchDocText`, `doc-source.ts` | **Ship blocker.** This is "Known risks" #3: a producer in *Suggesting* mode would push unapproved copy to the talent. Requires, at minimum, a prominent "review in Editing mode" warning on every doc-source surface and in `docs/prompter.md`. |
| 3 | What does a multi-tab doc export? | **All tabs concatenated, no separator** — the operator silently gets every tab. No tab handling of any kind. | `normalizeScriptText`, `doc-source.ts` | If confirmed: a documentation callout in `docs/prompter.md` (multi-tab selection stays out of scope). If instead a separator or tab heading appears in the text, strip it at the marked point. |

**How to verify (≈10 minutes, once the app runs signed in):**

1. *Title* — load a doc whose first body line is known and distinct from its
   title; check whether the title appears on the glass.
2. *Suggestions* — in the same doc, switch to *Suggesting* mode, make an
   obvious insertion, leave it pending, and refresh. If the insertion reaches
   the staged text, question 2 is answered "yes" and the ship blocker applies.
3. *Tabs* — add a second tab with distinct content and refresh; note whether
   both tabs appear and whether anything separates them.

Question 2 is the one that matters. Questions 1 and 3 are cosmetic or
documentation-level; 2 is a safety property, and its assumption must be
confirmed rather than inherited.

## Architecture

```
Google Doc ──export?format=txt──> doc-source.ts ──> staged buffer ──Take──> PrompterState.script ──> /prompter glass
                                       ^                  ^
                                  doc-watcher (60s)   operator / Companion
```

The talent display is unchanged. `PrompterState.script` remains the single
authoritative "text on the glass", so `page.ts`, `transport.ts` and the
hydration path need no modification.

### 1. Fetch layer — `src/main/prompter/doc-source.ts` (new)

Pure and injectable; no Electron import, so it unit-tests without a harness.

```ts
export function extractDocId(url: string): string | null
export function normalizeScriptText(raw: string): string
export function fetchDocText(docId: string, transport: DocTransport): Promise<DocFetchResult>

export type DocFetchResult =
  | { ok: true; text: string; hash: string; words: number }
  | { ok: false; code: DocErrorCode; message: string }

export type DocErrorCode =
  | 'INVALID_DOC_URL' | 'DOC_UNREACHABLE' | 'DOC_NOT_READABLE' | 'DOC_EMPTY' | 'DOC_TOO_LARGE'
```

- `extractDocId` mirrors `extractDeckId` (`src/main/services/slide-ops.ts:10`)
  and accepts `/document/d/<id>/…` and `/document/u/<n>/d/<id>/…`. Because
  only `docs.google.com` document URLs parse, **arbitrary-URL fetch can never
  reach the main process** — the allowlist is a side effect of the parser.
- `transport` is injected. Main supplies an adapter that tries
  `net.fetch(url, { session: session.fromPartition('persist:google-slides'), useSessionCookies: true })`
  and falls back to bare `fetch` on failure or when no session cookie exists.
- **Decode explicitly:** `arrayBuffer()` → `new TextDecoder('utf-8')`. Never
  `res.text()`. See the charset note in Context.
- **Sniff for HTML.** An unauthorized export does not return 403 — it returns
  200 with a sign-in page. A body that looks like HTML is `DOC_NOT_READABLE`
  with an actionable message ("sign in to Google, or set the doc to
  link-viewable"), never a script.
- **Cap the body** (suggest 2 MB) → `DOC_TOO_LARGE`.
- 10s timeout via `AbortSignal.timeout`, matching `forward.ts`.
- `normalizeScriptText`: CRLF/CR → LF, strip BOM, strip U+FFFD and U+0000,
  normalise U+2028/U+2029, collapse 3+ blank lines to 2, trim trailing
  whitespace per line. Follow `normalizeSpeakerNotes` rather than inventing a
  second dialect.
- `hash` is a content hash of the normalised text (sha256, hex, via `crypto`).
  Change detection compares hashes, never raw strings.

### 2. State — additive to `PrompterState` (`src/shared/types.ts`)

```ts
doc: {
  url: string;                 // '' when no doc source
  docId: string;
  name: string | null;         // set when loaded from the library
  loadedAt: number | null;
  loadedHash: string;          // hash of the text currently on the glass
  staged: { text: string; hash: string; words: number; fetchedAt: number } | null;
  status: 'idle' | 'fetching' | 'ready' | 'error';
  error: { code: DocErrorCode; message: string } | null;
  lastCheckedAt: number | null;
}
```

Add the defaults to `makePrompterState()` (`src/shared/types.ts:269`).

**Staged text must not appear in `viewState()`** (`src/main/routes/prompter.ts:49`).
That omission is the safety property of this whole design: it is structurally
impossible for un-taken copy to reach the talent display.

### 3. Library — `src/main/prompter/script-docs.ts` (new)

Copy the `src/main/presets.ts` shape exactly: a `Map`, `list/findById/create/
update/remove/replaceAll`, `randomUUID`, an `onChange` callback.

```ts
interface ScriptDoc { id, name, docUrl, description, createdAt, updatedAt }
```

**Persistence follows URL presets, which do *not* live in `runtime-state.json`**
— v2 of that file persists only L3 cues. Presets persist into the **active
show profile** via `syncActiveProfileUrlPresets` wired as the store's
`onChange` (`src/main/index.ts:117`), and load at boot from
`boot.profile.urlPresets` (`src/main/index.ts:121`). Mirror that:

- `scriptDocs: ScriptDoc[]` on the profile type (`src/main/profiles/types.ts:53`)
- `syncActiveProfileScriptDocs` alongside its sibling (`bootstrap.ts:429`)
- seed from `boot.profile.scriptDocs` at startup

**Migration hazard:** profile validation requires known array fields
(`bootstrap.ts:102`). An existing profile has no `scriptDocs` key, so absence
must default to `[]` rather than failing validation and rejecting the profile.
Cover this with a test that loads a pre-existing profile fixture.

Script libraries then export and import with show profiles for free.

### 4. Watcher — `src/main/prompter/doc-watcher.ts` (new)

```ts
createDocWatcher({ store, fetchDoc, now, setIntervalFn, clearIntervalFn })
```

Clock and timers injected so tests run on fake timers with no real waiting.

- Idle whenever `doc.docId` is empty.
- Every 60s: fetch, hash, compare against `loadedHash`. Different, and
  different from any already-staged hash → fill `staged`, set status `ready`.
- Identical → update `lastCheckedAt` only. No state churn, no WS noise.
- On failure: set status `error`, back off 60s → 2m → 4m, cap 10m, reset on
  success. A dead network must not hammer Google for a whole show.
- Tear down cleanly on app shutdown.

### 5. Routes — `src/main/routes/prompter.ts` (modified)

All operator-gated (`opGuard`), consistent with every other prompter endpoint.

| Endpoint | Body | Behaviour |
|---|---|---|
| `POST /api/prompter/doc/load` | `{ url }` or `{ presetId }` | Fetch, then **apply immediately** via `setScript` (decision 6). Sets `loadedHash`, clears `staged`. |
| `POST /api/prompter/doc/refresh` | — | Fetch → `staged` only. Never touches the glass. |
| `POST /api/prompter/doc/take` | — | Apply `staged` via the existing `setScript` (parks at top, stops scroll), clear `staged`, update `loadedHash`. 409 when nothing is staged. |
| `POST /api/prompter/doc/clear` | — | Detach the source. Leaves the current script on the glass. |
| `GET/POST/PATCH/DELETE /api/prompter/docs` | library CRUD | Mirror the presets routes (`src/main/routes/presets.ts`). |

Extend `GET /api/prompter/status` with the `doc` block. Fetch errors return
the typed code and a human message; a failed fetch never mutates `script`.

The fetcher is injected into the router as a dependency (following the
`prompterWindow` optional-dep pattern, `prompter.ts:41`) so route tests run
with a fake and never touch the network.

### 6. Companion — `packages/companion-module-pconair/`

- **Actions** (`src/actions/system.ts`, beside the existing `prompter_*`):
  `prompter_load_doc` (URL text field, variable-capable),
  `prompter_load_doc_preset` (**dropdown of the saved library**),
  `prompter_refresh_doc`, `prompter_take_doc`, `prompter_clear_doc`
- **Variables:** `prompter_doc_name`, `prompter_doc_status`,
  `prompter_doc_words`, `prompter_doc_loaded_at`, `prompter_doc_staged`
- **Feedbacks:** `prompter_doc_update_ready` (amber — the core UX of this
  feature), `prompter_doc_error` (red)
- **Presets:** a Script page — named load buttons, Refresh, and a Take button
  carrying the amber feedback
- No `upgrades.ts` entries: these are new ids, not renames.
- The preset dropdown needs the library pushed over the existing state feed.
  Check `pkg-engine.ts`'s dynamic-list handling for the established pattern
  before inventing one.
- Update the action/variable/feedback counts in the root `README.md`.

### 7. Renderer — shared module first (decision 5)

Build `src/renderer/shared/prompter-controls.ts` to the contract in the
approved prompter-control plan:

```ts
export function renderPrompterControls(state: PrompterState): string
export function wirePrompterControls(root, { post, onState }): void
```

Then add a **Script Source** block to it: library `<select>`, ad-hoc URL
field, Load / Refresh / Take buttons, a status line ("loaded 14:32 · 1,240
words"), and an amber "update ready" pill bound to `doc.status === 'ready'`.

Mounted three times:

1. `/prompter-control/` — new standalone operator-PIN page, per the approved
   plan (`prompter-control.ts` mirroring `remote.ts`, asar-safe
   `fs.readFileSync`, `renderLoginPage` with `next`, new webpack entry in
   `forge.config.ts`)
2. `/remote/` — new Prompter section in the existing web remote
3. **Admin** — the prompter section moves out of inline `<script>` in
   `src/renderer/admin/index.html:1927` into the `admin/index.ts` bundle,
   consuming the shared module

**The Admin migration is the risk item in this work.** It is ~250 lines of
`getElementById` + `post` wiring that maps cleanly onto the module's injected
`post`, but it is surgery on a 2,456-line file, and inline script and bundle
are separate scopes. Do it as its own commit, verify it independently, and
note that verification needs a full app restart **and** a hard reload or the
change will look like it never landed.

Out of scope for all three surfaces, per the approved plan: the output window
/ display picker, and the third-party prompter service config.

## Error handling

| Situation | Behaviour |
|---|---|
| Bad or non-Docs URL | `INVALID_DOC_URL`, rejected before any network call |
| Network down / timeout | `DOC_UNREACHABLE`, status `error`, watcher backs off, glass untouched |
| Not signed in and not link-shared | `DOC_NOT_READABLE` with both remedies named |
| Doc emptied by a producer mid-show | `DOC_EMPTY` — refuse to stage. Blanking the talent's screen because someone selected-all is the worst failure available here. |
| Doc over the size cap | `DOC_TOO_LARGE` |
| Take with nothing staged | 409, no state change |

In every failure the script on the glass is untouched. That is the invariant.

## Testing

**Unit** — `extractDocId` (all URL shapes, rejections); `normalizeScriptText`
(CRLF, U+FFFD, BOM, blank-line collapse); `fetchDocText` against stubbed
transports (HTML sign-in interstitial → `DOC_NOT_READABLE`, 404, charset-less
UTF-8 bytes, empty body, oversize); stage/take reducers; watcher change
detection and backoff on fake timers; library CRUD; profile round-trip
including the missing-`scriptDocs` fixture.

**Routes** — supertest with an injected fake fetcher, following
`tests/prompter-routes.test.ts`. Assert the invariant directly: a failed
fetch and a staged-but-untaken refresh both leave `GET /api/prompter/view`
byte-identical.

**Live verification** (required — the renderer surfaces have no unit
coverage): a real private doc with the app signed in; a link-shared doc with
the session signed out; edit the doc mid-run and confirm the amber indicator
appears within ~60s, that the glass does not change until Take, and that a
comment added to the doc never appears in the script.

## Out of scope

Drive picker UI; Drive API or OAuth; revision history; importing comments;
rich formatting (bold, headings, tables); preserving scroll position across a
refresh; auto-take; multi-tab selection; non-Docs sources (.docx, Word,
Dropbox).

## Known risks

1. **The export endpoint is unofficial.** Long-standing and widely used, but
   not a contract. If Google changes or throttles it, Drive loading breaks —
   which is exactly why the paste box stays, and why polling is one request
   per minute with backoff rather than anything that could look like abuse.
2. **Sign-in is shared with Slides mode.** Signing out of Google for slides
   also breaks private-doc fetching. The `DOC_NOT_READABLE` message must name
   this so the failure is self-diagnosing.
3. **Suggesting mode** may leak unapproved copy to the glass — resolved by the
   Phase 0 spike, and a warning in the UI if confirmed.
4. **Admin migration** may surface inline-script coupling not visible from the
   outside. Keep it a separate commit so it can be reverted independently.

## Documentation

Update `docs/prompter.md`: the new endpoints, the Companion actions, the
load/refresh/take model, the sharing requirements for both auth paths, the
comments-excluded behaviour, and the removal of the "script does not survive a
restart" limitation for library-loaded docs.
