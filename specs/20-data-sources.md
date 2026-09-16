# Spec 20 — Normalized Data Sources

**Status:** Done · **Date:** 2026-09-09 · **Wave:** 1 (concurrent with 15, 16, 21)
**Model:** `claude-sonnet-5` · **Depends on:** spec 14 · **Branch:** `feat/graphics-20-data-sources`
**Umbrella:** [`../plan_approved.md`](../plan_approved.md)

---

## 1. Why

Ticker headlines live in `graphics/news/ticker.json`. In a packaged build that file is inside `PConAir.app/Contents/Resources/`, and the README already concedes defeat: *"which is awkward to edit — use the `?ticker=` param."* So the shipped answer to "change the headlines" is "retype them into a URL".

Anything a graphic should pull from elsewhere — a results CSV, a headline feed, a roster sheet — has the same problem. Every package that wants live data invents its own fetch, its own poll timer, its own failure handling, and its own idea of what to do when the feed returns garbage mid-show.

This spec adds one polled, normalized, transformable data layer that packages declare and operators configure.

## 2. What already exists — do not rebuild

- **Spec 14's runtime** — `client.state` / `client.on()`. Data lands in package state; render pages read it the way they read everything else. No new client transport.
- **`src/main/packages/state-hub.ts`** — the poller writes into the namespace through the hub, so existing pub/sub, persistence and merge semantics apply unchanged.
- **`src/main/packages/loader.ts`** — `validateManifest`. Data sources are declared and validated here.
- **`src/main/security/`** and `isClientIpAllowlisted` in `server.ts` — read these before writing the SSRF guard; reuse the existing address helpers rather than writing new CIDR parsing. `ip-address` is already a dependency.
- **`graphics/news/ticker.json`** and `bundled-packages/news/package.json` — the migration target. Read both before designing the row shape.

## 3. Design

### 3.1 The normalized shape

Every source, whatever its origin, produces the same thing:

```ts
/** One row. Values are always strings — formatting is the graphic's job. */
export type DataRow = Record<string, string>;

export interface DataSourceResult {
  rows: DataRow[];
  /** Column names in first-seen order. */
  columns: string[];
  fetchedAt: number;
  /** null when the last fetch succeeded. */
  error: string | null;
  /** Rows before transforms — shown in the control page so an operator can
      see "the feed has 40 items, your limit is 5". */
  rawCount: number;
}
```

### 3.2 Manifest declaration

```ts
export type DataSourceKind = 'http-json' | 'http-csv' | 'rss';

export interface PackageDataSource {
  /** Key under `_data` in package state. Lowercase, no leading underscore. */
  id: string;
  label: string;
  kind: DataSourceKind;
  /** Default URL. Operator-overridable; see §3.5. */
  url?: string;
  /** http-json only: dotted path to the array, e.g. "data.standings". */
  path?: string;
  /** Seconds. Clamped to the floor in §3.4. Default 300. */
  pollSeconds?: number;
  /** Applied in array order. */
  transforms?: DataTransform[];
}

export type DataTransform =
  | { op: 'sort'; column: string; direction?: 'asc' | 'desc'; numeric?: boolean }
  | { op: 'filter'; column: string; test: 'eq' | 'neq' | 'contains' | 'gt' | 'lt'; value: string }
  | { op: 'limit'; count: number }
  | { op: 'offset'; count: number }
  | { op: 'rank'; column: string };
```

`rank` inserts a 1-based position into the named column **after** the preceding transforms, so "sort then rank then limit" gives the intended top-5 with ranks 1–5.

`PackageManifest` gains `dataSources?: PackageDataSource[]`.

Validation: `id` matches `/^[a-z0-9][a-z0-9-_]*$/`; ids unique within a package; `kind` is one of the three; `path` only on `http-json`; `pollSeconds` a positive integer; every transform's `op` known and its fields present and correctly typed. Reject with a message naming the offending source id.

### 3.3 State placement

Results land under the reserved `_data` key:

```ts
/** Keyed by source id. */
export type PackageDataState = Record<string, DataSourceResult>;
```

`_data` is **not** persisted — a stale feed restored from disk at show start is worse than an empty one. Add it to the always-transient set alongside spec 15's `_transport`. (Both specs touch that line in `state-hub.ts`; whichever merges second rebases.)

Spec 15 adds rejection of `_`-prefixed keys in `stateSchema`. If spec 15 has not merged, add that rejection here — the two implementations are identical and the merge conflict is trivial.

### 3.4 Safety

This subsystem makes outbound network calls on behalf of manifest files, so it is the largest new attack surface in the plan.

- **Scheme allowlist.** `https:` and `http:` only. Reject `file:`, `ftp:`, `data:`, everything else.
- **Private-address block by default.** Resolve the host and refuse loopback, link-local, and RFC1918 targets unless the host appears in an operator-managed allowlist. Persist the allowlist next to the existing security preferences; expose it in Admin as a textarea, one host per line. Default empty.
- **Poll floor.** 60 seconds minimum, whatever the manifest asks for. Clamp silently and record the effective value in the result.
- **Response cap.** 2 MB. Abort and record an error beyond it — do not buffer a runaway feed into memory during a show.
- **Timeout.** 10 seconds per fetch.
- **No redirects across hosts.** Follow same-host redirects up to 3; a cross-host redirect is an error.
- **Failure keeps the last good rows.** On error, set `error` and leave `rows` as they were. A feed that 500s must never blank a ticker that is on air.

### 3.5 Operator overrides

The manifest supplies defaults; the operator owns the live value. Overrides persist per package.

| Route | Auth | Body | Notes |
|---|---|---|---|
| `GET /api/packages/:id/data` | operator | — | `{ sources: PackageDataSourceView[] }` — declaration merged with override and last result |
| `PUT /api/packages/:id/data/:sourceId` | **admin** | `{ url?, pollSeconds?, enabled? }` | Admin, because it sets an outbound fetch target |
| `POST /api/packages/:id/data/:sourceId/refresh` | operator | — | Fetch now; returns the new `DataSourceResult` |

`PackageDataSourceView` = the declaration, plus `effectiveUrl`, `effectivePollSeconds`, `enabled`, and the latest `DataSourceResult`.

A disabled source keeps its last rows and stops polling.

### 3.6 The poller

New file `src/main/packages/data-sources.ts`:

```ts
export interface DataSourcePoller {
  /** (Re)build timers from the loaded packages and stored overrides. */
  reload(): void;
  /** Fetch one source now, out of band. */
  refresh(packageId: string, sourceId: string): Promise<DataSourceResult>;
  dispose(): void;
}

export function createDataSourcePoller(deps: {
  hub: PackageHub;
  getPackages: () => LoadedPackage[];
  getOverrides: () => DataOverrides;
  getAllowedHosts: () => string[];
  fetchImpl?: typeof fetch;   // injected in tests
}): DataSourcePoller;
```

`fetchImpl` is injectable so **no test makes a real network call**. Node 20's global `fetch` is the default.

Parsers, each a pure exported function so they unit-test without I/O:

- `parseJson(text, path)` — walk the dotted path, require an array of objects, stringify leaf values, union the keys for `columns`.
- `parseCsv(text)` — RFC 4180: quoted fields, embedded commas and newlines, doubled quotes. First row is the header. Do not add a CSV dependency; this is ~60 lines.
- `parseRss(text)` — `<item>` (RSS) and `<entry>` (Atom). Columns `title`, `link`, `date`, `description`, `author`, `category`, `guid`. Use a small regex/state extraction, not a DOM parser; decode the five XML entities plus numeric ones.

### 3.7 Migrating `news`

Prove the subsystem on the real wart:

- `bundled-packages/news/package.json` declares a `headlines` source, `kind: 'rss'`, no default URL, `pollSeconds: 300`, transforms `[{op:'sort',column:'date',direction:'desc'},{op:'limit',count:8}]`.
- `render-ticker.html` reads `state._data.headlines.rows` when present and falls back to the existing manually-typed items when the source is absent, disabled, or has never fetched. **The fallback is required** — a package must not go dark because a feed is unconfigured.
- Leave `graphics/news/ticker.json` in place. It belongs to the legacy `graphics/` tree, which this plan does not touch.

New items must join the crawl **at the loop seam**, never by mutating text mid-scroll. The ticker keeps rendering the batch it started with until the current pass completes, then swaps.

### 3.8 Files

**Create**
- `src/main/packages/data-sources.ts`
- `src/main/packages/data-overrides.ts` — load/save the per-package override file under `userData`, mirroring `state-hub.ts`'s persistence.
- `tests/data-sources.test.ts`
- `tests/data-sources-parse.test.ts`

**Modify**
- `src/main/packages/loader.ts` — `PackageDataSource`, `DataTransform`, validation.
- `src/main/packages/state-hub.ts` — `_data` always-transient.
- `src/main/routes/packages.ts` — the three routes.
- `src/main/index.ts` / `src/main/server.ts` — construct the poller, `dispose()` on close, `reload()` after `POST /api/packages/rescan`.
- `src/renderer/admin/index.html` — allowed-hosts textarea in the security section.
- `bundled-packages/news/package.json`, `bundled-packages/news/render-ticker.html`
- `docs/designing-packages.md`

## 4. Tasks

- [x] **T1 — Manifest schema.** Test: a valid `dataSources` array passes; duplicate ids, an unknown `kind`, `path` on `http-csv`, `pollSeconds: 0`, and an unknown transform `op` each fail with a message naming the source id. Commit.
- [x] **T2 — CSV parser.** Test in `tests/data-sources-parse.test.ts`: plain rows; quoted field containing a comma; quoted field containing a newline; doubled quote as a literal quote; CRLF line endings; a ragged row shorter than the header (missing columns become `''`). Commit.
- [x] **T3 — JSON parser.** Test: top-level array; dotted path `data.items`; a path that misses returns an error result, not a throw; non-string leaves are stringified; `columns` is the union across rows in first-seen order. Commit.
- [x] **T4 — RSS/Atom parser.** Test: an RSS 2.0 fixture and an Atom fixture both yield `title`/`link`/`date`; `&amp;` and `&#39;` are decoded; CDATA is unwrapped. Commit.
- [x] **T5 — Transforms.** Test each op alone and the composed pipeline `sort desc → rank → limit 5`, asserting ranks are 1–5 and reflect post-sort order. Test `numeric: true` sorts 2 before 10 and the default lexical sort does not. Commit.
- [x] **T6 — Poll floor and clamping.** Test: `pollSeconds: 5` polls at 60s; the result reports the effective value. Fake timers. Commit.
- [x] **T7 — SSRF guard.** Test with an injected `fetchImpl` that must never be called: `file:///etc/passwd`, `http://127.0.0.1:8080/`, `http://169.254.169.254/`, and `http://10.0.0.5/` are all refused with an error result. Then add `10.0.0.5` to the allowlist and assert the fetch proceeds. Commit.
- [x] **T8 — Response cap and timeout.** Test: a stub returning 3 MB records an error and does not store rows; a stub that never resolves records a timeout error after the fake clock advances 10s. Commit.
- [x] **T9 — Failure keeps last good rows.** Test: succeed with 3 rows, then fail; assert `rows.length === 3` and `error` is set. Commit.
- [x] **T10 — Not persisted.** Test: populate `_data`, rebuild the hub from disk, assert `_data` is empty. Commit.
- [x] **T11 — Routes.** supertest: `GET …/data` shape; `PUT …/data/:sourceId` requires **admin** and rejects operator with 403; `POST …/refresh` returns the new result. Commit.
- [x] **T12 — Admin allowlist UI.** Test the persistence round-trip through the admin route. Commit.
- [x] **T13 — Migrate `news`.** Declare the source, wire the ticker with its fallback, implement loop-seam swapping. Test: with no source configured the ticker still renders its manual items. Commit.
- [x] **T14 — Docs.** Document declaration, transforms, the safety rules and the fallback requirement in `docs/designing-packages.md`. Commit.

## 5. Acceptance

- [x] A package declares an RSS source; an operator points it at a URL in the UI; headlines appear in the ticker within one poll and update on later polls without touching a file or a URL param.
- [x] Unconfiguring or breaking the source leaves the last headlines on air and surfaces an error — it never blanks the ticker.
- [x] No test performs real network I/O.
- [x] A manifest cannot reach loopback, link-local or RFC1918 addresses unless an admin has allowlisted the host.
- [x] Poll intervals below 60s are clamped.
- [x] `hoops` and `ffg`, which declare no data sources, are unaffected.
- [x] `npm run typecheck && npm test` green.

## 6. Out of scope

**Weather providers** — the manifest `kind` union is the extension point, and adding `'weather'` later is a contained change, but corporate work rarely calls for it and every provider carries an on-screen attribution obligation. Not built here. Also out: Google Sheets private API, XML with arbitrary repeating tags, FTP/SFTP drops, table layers with re-sort animation, and any control-panel UI for editing rows by hand (spec 18 renders the operator-facing side).

## 7. Implementation notes (departures from the spec as written)

Spec 15 (transport) had not merged into this branch (confirmed: no `_transport` or underscore-prefix handling existed in `loader.ts`/`state-hub.ts` at the base commit), so per §3.3's instruction this implementation added the underscore-prefix rejection itself, in `validateManifest` (`loader.ts`). It rejects any **top-level** `stateSchema` key starting with `_`, not a recursive check on nested objects — the reserved namespaces (`_data`, spec 15's `_transport`, spec 19's `_meta`) only ever live at the top level of a package's state object (`state-hub.ts`'s `patchState`/`setState` only ever shallow-merge at that level), so a nested field named `_foo` inside a schema sub-object can't collide with them. When spec 15 merges, its identical top-level check should be a no-op merge conflict as the spec predicted.

**`_data`'s exact persistence mechanism.** §3.3 says `_data` must not be persisted. Given `validateManifest` now rejects a `_`-prefixed `stateSchema` key, `_data` was never going to appear in the manifest-derived `base` state that `mergeSaved` restores against — so in principle it could never survive a restart even without further changes. This implementation also strips every top-level `_`-prefixed key from the *serialized* save file itself (`state-hub.ts`'s `writeNow`/`stripReservedNamespaces`), for two reasons beyond the letter of the spec: (1) defense in depth, in case a future change to `mergeSaved` ever widens what it restores, and (2) practically, `_data` can hold up to the full 2MB response cap per source — leaving it in the debounced-flush save file would balloon `package-state.json` on every poll for no benefit, since it's discarded on load anyway.

**`StoredDataSourceResult` adds `enabled` on top of the spec's `DataSourceResult`.** §3.7 requires the render page to fall back to manually-typed items when the source is "absent, disabled, or has never fetched" — but §3.1's `DataSourceResult` (what's specified to live under `_data`) has no `enabled` field, and §3.5's `enabled` lives only in the `PackageDataSourceView` returned by `GET /api/packages/:id/data`, which a render page (subscribed only to package state, not that route) never sees. Rather than have the render page silently misinterpret "disabled but still has last-good rows" (required by §3.4/§3.5) as "configured and live," this implementation stores `DataSourceResult & { enabled: boolean }` under `_data.<sourceId>` — additive to the spec's shape, not a different one. `render-ticker.html`'s `resolveItems()` checks `enabled !== false` before trusting `rows`.

**Where the allowed-hosts list and its persistence live.** §3.4 says "persist the allowlist next to the existing security preferences." The nearest existing "security preferences" in this codebase is `appPreferences.ipAllowlist`/`ipAllowlistEnabled` on the per-show `ShowProfile` (`profiles/types.ts`), read/written today via the generic `PATCH /api/profiles/:id` route and rendered in Admin → System next to the IP Allowlist card. This implementation added `appPreferences.dataSourceAllowedHosts: string[]` there (default `[]`) rather than introducing a dedicated route or a new file store — it reuses the exact persistence/validation/API surface the IP allowlist already has, needs no new route, and is exactly "next to" that preference in both the data model and the Admin UI. Unlike the IP allowlist (which needs an app restart), a change here takes effect on the poller's next tick, since `getAllowedHosts()` reads the active profile live at fetch time.

**Fetch injection for tests.** The spec's `createDataSourcePoller({ fetchImpl? })` is exactly as specified, but wiring it through `createServer`/`createFullServer` needed a new `dataSourceFetchImpl` field on `ServerDeps` and `FullServerTestOpts` — not called out explicitly in §3.8's file list, but necessary for any supertest-based route test (T11, T12, and the acceptance-flow test) to avoid the poller's default of Node's real global `fetch`. `tests/_test-server.ts` defaults this to a stub that throws if actually invoked, so a test that forgets to stub it fails loudly instead of silently making a real network call.

**Extra test file.** Tests landed in `tests/data-sources.test.ts` and `tests/data-sources-parse.test.ts` as specified. T13's ticker-specific behavior (data-source fallback precedence, loop-seam swap) needed a `// @vitest-environment jsdom` file to load and execute `render-ticker.html`'s inline script directly (the same technique `tests/package-runtime-client.test.ts` uses for the shared runtime) — that lives in the new `tests/news-ticker-datasource.test.ts` rather than being force-fit into the two node-environment files vitest would otherwise run `data-sources.test.ts` under.

**T8 in a single file vs. the spec's split description.** The spec's task list writes the cap and the timeout as one task (T8) with two behaviors; the test file mirrors that as two `it()` blocks rather than combining them into one, since combining them would obscure which assertion failed.
