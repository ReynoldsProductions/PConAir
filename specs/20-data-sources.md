# Spec 20 — Normalized Data Sources

**Status:** Planned · **Date:** 2026-09-09 · **Wave:** 1 (concurrent with 15, 16, 21)
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

- [ ] **T1 — Manifest schema.** Test: a valid `dataSources` array passes; duplicate ids, an unknown `kind`, `path` on `http-csv`, `pollSeconds: 0`, and an unknown transform `op` each fail with a message naming the source id. Commit.
- [ ] **T2 — CSV parser.** Test in `tests/data-sources-parse.test.ts`: plain rows; quoted field containing a comma; quoted field containing a newline; doubled quote as a literal quote; CRLF line endings; a ragged row shorter than the header (missing columns become `''`). Commit.
- [ ] **T3 — JSON parser.** Test: top-level array; dotted path `data.items`; a path that misses returns an error result, not a throw; non-string leaves are stringified; `columns` is the union across rows in first-seen order. Commit.
- [ ] **T4 — RSS/Atom parser.** Test: an RSS 2.0 fixture and an Atom fixture both yield `title`/`link`/`date`; `&amp;` and `&#39;` are decoded; CDATA is unwrapped. Commit.
- [ ] **T5 — Transforms.** Test each op alone and the composed pipeline `sort desc → rank → limit 5`, asserting ranks are 1–5 and reflect post-sort order. Test `numeric: true` sorts 2 before 10 and the default lexical sort does not. Commit.
- [ ] **T6 — Poll floor and clamping.** Test: `pollSeconds: 5` polls at 60s; the result reports the effective value. Fake timers. Commit.
- [ ] **T7 — SSRF guard.** Test with an injected `fetchImpl` that must never be called: `file:///etc/passwd`, `http://127.0.0.1:8080/`, `http://169.254.169.254/`, and `http://10.0.0.5/` are all refused with an error result. Then add `10.0.0.5` to the allowlist and assert the fetch proceeds. Commit.
- [ ] **T8 — Response cap and timeout.** Test: a stub returning 3 MB records an error and does not store rows; a stub that never resolves records a timeout error after the fake clock advances 10s. Commit.
- [ ] **T9 — Failure keeps last good rows.** Test: succeed with 3 rows, then fail; assert `rows.length === 3` and `error` is set. Commit.
- [ ] **T10 — Not persisted.** Test: populate `_data`, rebuild the hub from disk, assert `_data` is empty. Commit.
- [ ] **T11 — Routes.** supertest: `GET …/data` shape; `PUT …/data/:sourceId` requires **admin** and rejects operator with 403; `POST …/refresh` returns the new result. Commit.
- [ ] **T12 — Admin allowlist UI.** Test the persistence round-trip through the admin route. Commit.
- [ ] **T13 — Migrate `news`.** Declare the source, wire the ticker with its fallback, implement loop-seam swapping. Test: with no source configured the ticker still renders its manual items. Commit.
- [ ] **T14 — Docs.** Document declaration, transforms, the safety rules and the fallback requirement in `docs/designing-packages.md`. Commit.

## 5. Acceptance

- [ ] A package declares an RSS source; an operator points it at a URL in the UI; headlines appear in the ticker within one poll and update on later polls without touching a file or a URL param.
- [ ] Unconfiguring or breaking the source leaves the last headlines on air and surfaces an error — it never blanks the ticker.
- [ ] No test performs real network I/O.
- [ ] A manifest cannot reach loopback, link-local or RFC1918 addresses unless an admin has allowlisted the host.
- [ ] Poll intervals below 60s are clamped.
- [ ] `hoops` and `ffg`, which declare no data sources, are unaffected.
- [ ] `npm run typecheck && npm test` green.

## 6. Out of scope

**Weather providers** — the manifest `kind` union is the extension point, and adding `'weather'` later is a contained change, but corporate work rarely calls for it and every provider carries an on-screen attribution obligation. Not built here. Also out: Google Sheets private API, XML with arbitrary repeating tags, FTP/SFTP drops, table layers with re-sort animation, and any control-panel UI for editing rows by hand (spec 18 renders the operator-facing side).
