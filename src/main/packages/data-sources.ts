import dns from 'dns';
import { Address4, Address6 } from 'ip-address';
import type { PackageHub } from './state-hub';
import type { LoadedPackage, PackageDataSource, DataSourceKind, DataTransform } from './loader';
import type { DataOverrides, DataSourceOverride } from './data-overrides';

/**
 * Normalized data sources (spec 20). One polled, normalized, transformable
 * data layer that packages declare (manifest `dataSources`) and operators
 * configure (URL/poll/enabled overrides — see data-overrides.ts). Results
 * land under the reserved `_data` key in package state (state-hub.ts keeps
 * it out of persistence).
 *
 * This is the largest new outbound attack surface in the plan, so the SSRF
 * guard, poll floor, response cap and "failure keeps last good rows" rules
 * below are safety-critical — see plan_approved.md's Global Constraints and
 * spec 20 §3.4 before touching them.
 */

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

/**
 * What's actually stored under `_data.<sourceId>` in package state. Adds
 * `enabled` to the wire-level DataSourceResult so a render page can tell "the
 * operator turned this off" apart from "this hasn't fetched yet" without a
 * second round trip to GET /api/packages/:id/data — needed for §3.7's fallback
 * rule ("absent, disabled, or has never fetched" all fall back to the
 * manually-typed items). This is additive to DataSourceResult, not a
 * different shape.
 */
export type StoredDataSourceResult = DataSourceResult & { enabled: boolean };

/** Keyed by source id. */
export type PackageDataState = Record<string, StoredDataSourceResult>;

/** View returned by GET /api/packages/:id/data — declaration + effective values + last result. */
export interface PackageDataSourceView extends PackageDataSource {
  effectiveUrl: string;
  effectivePollSeconds: number;
  enabled: boolean;
  result: DataSourceResult | null;
}

export const POLL_FLOOR_SECONDS = 60;
export const DEFAULT_POLL_SECONDS = 300;
export const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
export const FETCH_TIMEOUT_MS = 10_000;
export const MAX_REDIRECTS = 3;

/** Seconds the manifest/override asked for, clamped to the floor. */
export function clampPollSeconds(requested: number | undefined): number {
  const base = typeof requested === 'number' && requested > 0 ? requested : DEFAULT_POLL_SECONDS;
  return Math.max(POLL_FLOOR_SECONDS, Math.floor(base));
}

function emptyResult(): DataSourceResult {
  return { rows: [], columns: [], fetchedAt: 0, error: null, rawCount: 0 };
}

// ── Parsers — pure, no I/O ──────────────────────────────────────────────

export type ParseResult = { ok: true; rows: DataRow[]; columns: string[] } | { ok: false; error: string };

function stringifyLeaf(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'boolean' || typeof v === 'number') return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

/** Walk a dotted path, require an array of objects, stringify leaf values. */
export function parseJson(text: string, path?: string): ParseResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (err) {
    return { ok: false, error: `invalid JSON: ${(err as Error).message}` };
  }
  let cursor: unknown = data;
  if (path) {
    for (const part of path.split('.')) {
      if (typeof cursor !== 'object' || cursor === null || Array.isArray(cursor) || !(part in (cursor as Record<string, unknown>))) {
        return { ok: false, error: `path '${path}' not found in response` };
      }
      cursor = (cursor as Record<string, unknown>)[part];
    }
  }
  if (!Array.isArray(cursor)) {
    return { ok: false, error: path ? `path '${path}' is not an array` : 'response is not an array' };
  }
  const columns: string[] = [];
  const seen = new Set<string>();
  const rows: DataRow[] = cursor.map((item) => {
    const row: DataRow = {};
    if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
      for (const [k, v] of Object.entries(item as Record<string, unknown>)) {
        if (!seen.has(k)) {
          seen.add(k);
          columns.push(k);
        }
        row[k] = stringifyLeaf(v);
      }
    }
    return row;
  });
  return { ok: true, rows, columns };
}

/** RFC 4180: quoted fields, embedded commas/newlines, doubled quotes. First row is the header. */
function parseCsvRecords(text: string): string[][] {
  const records: string[][] = [];
  let field = '';
  let record: string[] = [];
  let inQuotes = false;
  let i = 0;
  const n = text.length;
  while (i < n) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ',') {
      record.push(field);
      field = '';
      i++;
      continue;
    }
    if (ch === '\r') {
      i++;
      continue;
    }
    if (ch === '\n') {
      record.push(field);
      field = '';
      records.push(record);
      record = [];
      i++;
      continue;
    }
    field += ch;
    i++;
  }
  if (field.length > 0 || record.length > 0) {
    record.push(field);
    records.push(record);
  }
  // Drop a lone trailing blank line (extra final newline), not a real row.
  return records.filter((r) => !(r.length === 1 && r[0] === ''));
}

export function parseCsv(text: string): ParseResult {
  const records = parseCsvRecords(text);
  if (records.length === 0) return { ok: true, rows: [], columns: [] };
  const header = records[0];
  const rows: DataRow[] = records.slice(1).map((rec) => {
    const row: DataRow = {};
    header.forEach((col, i) => {
      row[col] = rec[i] ?? '';
    });
    return row;
  });
  return { ok: true, rows, columns: header.slice() };
}

const XML_NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeXmlEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, ent: string) => {
    if (ent[0] === '#') {
      const isHex = ent[1] === 'x' || ent[1] === 'X';
      const code = parseInt(ent.slice(isHex ? 2 : 1), isHex ? 16 : 10);
      if (Number.isNaN(code)) return whole;
      try {
        return String.fromCodePoint(code);
      } catch {
        return whole;
      }
    }
    return XML_NAMED_ENTITIES[ent] ?? whole;
  });
}

function unwrapCdata(s: string): string {
  const m = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/.exec(s);
  return m ? m[1] : s;
}

function extractBlocks(text: string, tag: string): string[] {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'gi');
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.push(m[1]);
  return out;
}

function extractTag(block: string, tag: string): string {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i');
  const m = re.exec(block);
  if (!m) return '';
  return decodeXmlEntities(unwrapCdata(m[1]).trim());
}

function extractLink(block: string): string {
  // RSS: <link>https://...</link>. Atom: <link href="..."/>.
  const rssMatch = /<link(?:\s[^>]*)?>([\s\S]*?)<\/link>/i.exec(block);
  if (rssMatch && rssMatch[1].trim()) return decodeXmlEntities(unwrapCdata(rssMatch[1]).trim());
  const atomMatch = /<link\b[^>]*\bhref=["']([^"']*)["'][^>]*\/?>/i.exec(block);
  if (atomMatch) return decodeXmlEntities(atomMatch[1]);
  return '';
}

/** RSS 2.0 `<item>` and Atom `<entry>`. Not a DOM parser — small regex/state extraction. */
export function parseRss(text: string): ParseResult {
  const blocks = [...extractBlocks(text, 'item'), ...extractBlocks(text, 'entry')];
  if (blocks.length === 0) return { ok: true, rows: [], columns: [] };
  const columns = ['title', 'link', 'date', 'description', 'author', 'category', 'guid'];
  const rows: DataRow[] = blocks.map((block) => ({
    title: extractTag(block, 'title'),
    link: extractLink(block),
    date: extractTag(block, 'pubDate') || extractTag(block, 'published') || extractTag(block, 'updated'),
    description: extractTag(block, 'description') || extractTag(block, 'summary') || extractTag(block, 'content'),
    author: extractTag(block, 'author') || extractTag(block, 'dc:creator'),
    category: extractTag(block, 'category'),
    guid: extractTag(block, 'guid') || extractTag(block, 'id'),
  }));
  return { ok: true, rows, columns };
}

export function parseByKind(kind: DataSourceKind, text: string, path?: string): ParseResult {
  if (kind === 'http-json') return parseJson(text, path);
  if (kind === 'http-csv') return parseCsv(text);
  return parseRss(text);
}

// ── Transforms — pure ────────────────────────────────────────────────────

export function applyTransforms(rows: DataRow[], columns: string[], transforms: DataTransform[]): { rows: DataRow[]; columns: string[] } {
  let curRows = rows.slice();
  let curColumns = columns.slice();
  for (const t of transforms) {
    switch (t.op) {
      case 'sort': {
        const dir = t.direction === 'desc' ? -1 : 1;
        const column = t.column;
        const numeric = t.numeric === true;
        curRows = curRows.slice().sort((a, b) => {
          const av = a[column] ?? '';
          const bv = b[column] ?? '';
          if (numeric) {
            const an = parseFloat(av);
            const bn = parseFloat(bv);
            const aNum = Number.isNaN(an) ? -Infinity : an;
            const bNum = Number.isNaN(bn) ? -Infinity : bn;
            return (aNum - bNum) * dir;
          }
          if (av < bv) return -dir;
          if (av > bv) return dir;
          return 0;
        });
        break;
      }
      case 'filter': {
        const column = t.column;
        const value = t.value;
        curRows = curRows.filter((row) => {
          const v = row[column] ?? '';
          switch (t.test) {
            case 'eq':
              return v === value;
            case 'neq':
              return v !== value;
            case 'contains':
              return v.includes(value);
            case 'gt':
              return parseFloat(v) > parseFloat(value);
            case 'lt':
              return parseFloat(v) < parseFloat(value);
            default:
              return true;
          }
        });
        break;
      }
      case 'limit':
        curRows = curRows.slice(0, Math.max(0, t.count));
        break;
      case 'offset':
        curRows = curRows.slice(Math.max(0, t.count));
        break;
      case 'rank': {
        const column = t.column;
        curRows = curRows.map((row, i) => ({ ...row, [column]: String(i + 1) }));
        if (!curColumns.includes(column)) curColumns = curColumns.concat([column]);
        break;
      }
    }
  }
  return { rows: curRows, columns: curColumns };
}

// ── SSRF guard ───────────────────────────────────────────────────────────

const V4_RESERVED_BLOCKS: string[] = [
  '127.0.0.0/8', // loopback
  '169.254.0.0/16', // link-local (also covers the cloud metadata address)
  '10.0.0.0/8', // RFC1918
  '172.16.0.0/12', // RFC1918
  '192.168.0.0/16', // RFC1918
  '0.0.0.0/8', // "this network"
];

const V6_RESERVED_BLOCKS: string[] = [
  '::1/128', // loopback
  'fe80::/10', // link-local
  'fc00::/7', // unique local (RFC1918 equivalent)
];

function isInV4Block(ip: string, block: string): boolean {
  try {
    return new Address4(ip).isInSubnet(new Address4(block));
  } catch {
    return false;
  }
}

function isInV6Block(ip: string, block: string): boolean {
  try {
    return new Address6(ip).isInSubnet(new Address6(block));
  } catch {
    return false;
  }
}

/** Loopback, link-local, or RFC1918 (v4) / unique-local (v6). */
export function isReservedAddress(ip: string): boolean {
  if (Address4.isValid(ip)) {
    return V4_RESERVED_BLOCKS.some((b) => isInV4Block(ip, b));
  }
  if (Address6.isValid(ip)) {
    return V6_RESERVED_BLOCKS.some((b) => isInV6Block(ip, b));
  }
  return false;
}

export type SafetyCheck = { ok: true } | { ok: false; error: string };

/**
 * Refuse a URL whose scheme isn't http/https, or whose host — literal IP or
 * DNS-resolved — is loopback/link-local/RFC1918, unless the host is on the
 * operator-managed allowlist (exact hostname match, checked before any DNS
 * lookup so an allowlisted name never triggers real resolution in a test).
 */
export async function checkUrlSafety(urlObj: URL, allowedHosts: ReadonlySet<string>): Promise<SafetyCheck> {
  if (urlObj.protocol !== 'http:' && urlObj.protocol !== 'https:') {
    return { ok: false, error: `scheme '${urlObj.protocol}' is not allowed (only http/https)` };
  }
  const hostname = urlObj.hostname;
  if (allowedHosts.has(hostname.toLowerCase())) {
    return { ok: true };
  }
  if (Address4.isValid(hostname) || Address6.isValid(hostname)) {
    if (isReservedAddress(hostname)) {
      return { ok: false, error: `refused: '${hostname}' is a loopback/link-local/private address` };
    }
    return { ok: true };
  }
  let addresses: Array<{ address: string }>;
  try {
    addresses = await dns.promises.lookup(hostname, { all: true });
  } catch (err) {
    return { ok: false, error: `DNS lookup failed for '${hostname}': ${(err as Error).message}` };
  }
  for (const a of addresses) {
    if (isReservedAddress(a.address)) {
      return { ok: false, error: `refused: '${hostname}' resolves to a loopback/link-local/private address (${a.address})` };
    }
  }
  return { ok: true };
}

// ── Fetch with timeout, response cap, and same-host-only redirects ───────

type MinimalResponse = {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  body?: unknown;
  text(): Promise<string>;
};

function fetchWithTimeout(fetchImpl: typeof fetch, url: string, timeoutMs: number): Promise<MinimalResponse> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`timed out after ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs);
    Promise.resolve(fetchImpl(url, { redirect: 'manual' } as RequestInit))
      .then((res) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(res as unknown as MinimalResponse);
      })
      .catch((err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err);
      });
  });
}

async function readCapped(res: MinimalResponse): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const body = res.body as { getReader?: () => ReadableStreamDefaultReader<Uint8Array> } | undefined;
  if (body && typeof body.getReader === 'function') {
    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > MAX_RESPONSE_BYTES) {
          try {
            await reader.cancel();
          } catch {
            /* best effort */
          }
          return { ok: false, error: `response exceeded ${MAX_RESPONSE_BYTES} byte cap` };
        }
        chunks.push(value);
      }
    }
    const buf = Buffer.concat(chunks.map((c) => Buffer.from(c)));
    return { ok: true, text: buf.toString('utf8') };
  }
  // Fallback for Response-like stubs without a streaming body (unit tests).
  const text = await res.text();
  if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) {
    return { ok: false, error: `response exceeded ${MAX_RESPONSE_BYTES} byte cap` };
  }
  return { ok: true, text };
}

interface FetchDeps {
  fetchImpl: typeof fetch;
  getAllowedHosts: () => string[];
}

async function fetchSafely(urlStr: string, deps: FetchDeps): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  let current: URL;
  try {
    current = new URL(urlStr);
  } catch {
    return { ok: false, error: `invalid URL: '${urlStr}'` };
  }
  const originalHost = current.host;
  const allowedHosts = new Set(deps.getAllowedHosts().map((h) => h.toLowerCase()));

  for (let redirectCount = 0; ; redirectCount++) {
    const safety = await checkUrlSafety(current, allowedHosts);
    if (!safety.ok) return { ok: false, error: safety.error };

    let res: MinimalResponse;
    try {
      res = await fetchWithTimeout(deps.fetchImpl, current.toString(), FETCH_TIMEOUT_MS);
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) return { ok: false, error: `redirect (${res.status}) with no Location header` };
      let next: URL;
      try {
        next = new URL(loc, current);
      } catch {
        return { ok: false, error: `redirect (${res.status}) with an invalid Location header` };
      }
      if (next.host !== originalHost) {
        return { ok: false, error: `cross-host redirect to '${next.host}' refused` };
      }
      if (redirectCount >= MAX_REDIRECTS) {
        return { ok: false, error: 'too many redirects' };
      }
      current = next;
      continue;
    }

    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}` };
    }
    return readCapped(res);
  }
}

// ── One fetch-parse-transform cycle for a single source ─────────────────

export interface EffectiveSourceSpec {
  kind: DataSourceKind;
  url: string;
  path?: string;
  transforms?: DataTransform[];
}

export async function runFetch(spec: EffectiveSourceSpec, deps: FetchDeps): Promise<DataSourceResult> {
  const fetched = await fetchSafely(spec.url, deps);
  if (!fetched.ok) {
    return { rows: [], columns: [], fetchedAt: Date.now(), error: fetched.error, rawCount: 0 };
  }
  const parsed = parseByKind(spec.kind, fetched.text, spec.path);
  if (!parsed.ok) {
    return { rows: [], columns: [], fetchedAt: Date.now(), error: parsed.error, rawCount: 0 };
  }
  const rawCount = parsed.rows.length;
  const { rows, columns } = applyTransforms(parsed.rows, parsed.columns, spec.transforms ?? []);
  return { rows, columns, fetchedAt: Date.now(), error: null, rawCount };
}

// ── The poller ─────────────────────────────────────────────────────────

export interface DataSourcePoller {
  /** (Re)build timers from the loaded packages and stored overrides. */
  reload(): void;
  /** Fetch one source now, out of band. */
  refresh(packageId: string, sourceId: string): Promise<DataSourceResult>;
  /** Build the operator-facing view for one package's sources. */
  buildViews(packageId: string): PackageDataSourceView[];
  dispose(): void;
}

export interface DataSourcePollerDeps {
  hub: PackageHub;
  getPackages: () => LoadedPackage[];
  getOverrides: () => DataOverrides;
  getAllowedHosts: () => string[];
  fetchImpl?: typeof fetch;
}

function effectiveFor(source: PackageDataSource, override: DataSourceOverride | undefined) {
  const effectiveUrl = override?.url ?? source.url ?? '';
  const effectivePollSeconds = clampPollSeconds(override?.pollSeconds ?? source.pollSeconds);
  const enabled = override?.enabled !== false;
  return { effectiveUrl, effectivePollSeconds, enabled };
}

export function createDataSourcePoller(deps: DataSourcePollerDeps): DataSourcePoller {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const timers = new Map<string, NodeJS.Timeout>();

  function key(packageId: string, sourceId: string): string {
    return `${packageId}:${sourceId}`;
  }

  function overrideFor(packageId: string, sourceId: string): DataSourceOverride | undefined {
    return deps.getOverrides()[packageId]?.[sourceId];
  }

  function currentStored(packageId: string, sourceId: string): StoredDataSourceResult | undefined {
    const state = deps.hub.getState(packageId);
    const data = state?.['_data'] as PackageDataState | undefined;
    return data?.[sourceId];
  }

  function writeResult(packageId: string, sourceId: string, result: StoredDataSourceResult): void {
    const state = deps.hub.getState(packageId);
    if (!state) return;
    const data: PackageDataState = { ...((state['_data'] as PackageDataState | undefined) ?? {}) };
    data[sourceId] = result;
    deps.hub.patchState(packageId, { _data: data });
  }

  async function fetchAndStore(packageId: string, source: PackageDataSource): Promise<DataSourceResult> {
    const override = overrideFor(packageId, source.id);
    const eff = effectiveFor(source, override);
    const prev = currentStored(packageId, source.id);

    if (!eff.enabled || !eff.effectiveUrl) {
      // Disabled or unconfigured: never fetch. Keep whatever rows are already
      // there (§3.5 "a disabled source keeps its last rows and stops
      // polling"); the `enabled` flag is what lets a render page fall back to
      // its manual copy instead of showing stale automated rows while off.
      const kept: StoredDataSourceResult = { ...(prev ?? emptyResult()), enabled: eff.enabled };
      writeResult(packageId, source.id, kept);
      return kept;
    }

    const fresh = await runFetch(
      { kind: source.kind, url: eff.effectiveUrl, path: source.path, transforms: source.transforms },
      { fetchImpl, getAllowedHosts: deps.getAllowedHosts }
    );
    // Failure keeps the last good rows — a feed that 500s must never blank a
    // ticker that is on air.
    const merged: StoredDataSourceResult =
      fresh.error !== null && prev
        ? { ...fresh, rows: prev.rows, columns: prev.columns, rawCount: prev.rawCount, enabled: true }
        : { ...fresh, enabled: true };
    writeResult(packageId, source.id, merged);
    return merged;
  }

  function clearAll(): void {
    for (const t of timers.values()) clearInterval(t);
    timers.clear();
  }

  function reload(): void {
    clearAll();
    for (const pkg of deps.getPackages()) {
      for (const source of pkg.manifest.dataSources ?? []) {
        const override = overrideFor(pkg.manifest.id, source.id);
        const eff = effectiveFor(source, override);
        void fetchAndStore(pkg.manifest.id, source);
        const timer = setInterval(() => {
          void fetchAndStore(pkg.manifest.id, source);
        }, eff.effectivePollSeconds * 1000);
        timers.set(key(pkg.manifest.id, source.id), timer);
      }
    }
  }

  async function refresh(packageId: string, sourceId: string): Promise<DataSourceResult> {
    const pkg = deps.getPackages().find((p) => p.manifest.id === packageId);
    const source = pkg?.manifest.dataSources?.find((s) => s.id === sourceId);
    if (!pkg || !source) {
      throw new Error(`data source '${sourceId}' not found on package '${packageId}'`);
    }
    return fetchAndStore(packageId, source);
  }

  function buildViews(packageId: string): PackageDataSourceView[] {
    const pkg = deps.getPackages().find((p) => p.manifest.id === packageId);
    if (!pkg) return [];
    return (pkg.manifest.dataSources ?? []).map((source) => {
      const override = overrideFor(packageId, source.id);
      const eff = effectiveFor(source, override);
      const stored = currentStored(packageId, source.id);
      const result: DataSourceResult | null = stored
        ? { rows: stored.rows, columns: stored.columns, fetchedAt: stored.fetchedAt, error: stored.error, rawCount: stored.rawCount }
        : null;
      return { ...source, effectiveUrl: eff.effectiveUrl, effectivePollSeconds: eff.effectivePollSeconds, enabled: eff.enabled, result };
    });
  }

  function dispose(): void {
    clearAll();
  }

  return { reload, refresh, buildViews, dispose };
}
