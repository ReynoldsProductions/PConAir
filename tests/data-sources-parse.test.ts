import { describe, it, expect } from 'vitest';
import { parseCsv, parseJson, parseRss, applyTransforms } from '../src/main/packages/data-sources';

describe('parseCsv (T2)', () => {
  it('parses plain rows', () => {
    const res = parseCsv('name,city\nAlice,Boston\nBob,Chicago');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.columns).toEqual(['name', 'city']);
    expect(res.rows).toEqual([
      { name: 'Alice', city: 'Boston' },
      { name: 'Bob', city: 'Chicago' },
    ]);
  });

  it('handles a quoted field containing a comma', () => {
    const res = parseCsv('name,note\nAlice,"hello, world"');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.rows).toEqual([{ name: 'Alice', note: 'hello, world' }]);
  });

  it('handles a quoted field containing a newline', () => {
    const res = parseCsv('name,note\nAlice,"line one\nline two"\nBob,plain');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.rows).toEqual([
      { name: 'Alice', note: 'line one\nline two' },
      { name: 'Bob', note: 'plain' },
    ]);
  });

  it('treats a doubled quote as a literal quote', () => {
    const res = parseCsv('name,quote\nAlice,"she said ""hi"""');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.rows).toEqual([{ name: 'Alice', quote: 'she said "hi"' }]);
  });

  it('handles CRLF line endings', () => {
    const res = parseCsv('name,city\r\nAlice,Boston\r\nBob,Chicago\r\n');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.rows).toEqual([
      { name: 'Alice', city: 'Boston' },
      { name: 'Bob', city: 'Chicago' },
    ]);
  });

  it('fills missing columns with empty string on a ragged row', () => {
    const res = parseCsv('name,city,zip\nAlice,Boston');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.rows).toEqual([{ name: 'Alice', city: 'Boston', zip: '' }]);
  });
});

describe('parseJson (T3)', () => {
  it('parses a top-level array', () => {
    const res = parseJson(JSON.stringify([{ a: 1, b: 'x' }, { a: 2, b: 'y' }]));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.rows).toEqual([
      { a: '1', b: 'x' },
      { a: '2', b: 'y' },
    ]);
    expect(res.columns).toEqual(['a', 'b']);
  });

  it('walks a dotted path to find the array', () => {
    const res = parseJson(JSON.stringify({ data: { items: [{ x: 1 }] } }), 'data.items');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.rows).toEqual([{ x: '1' }]);
  });

  it('returns an error result (not a throw) when the path misses', () => {
    expect(() => parseJson(JSON.stringify({ data: {} }), 'data.items')).not.toThrow();
    const res = parseJson(JSON.stringify({ data: {} }), 'data.items');
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toMatch(/data\.items/);
  });

  it('stringifies non-string leaves', () => {
    const res = parseJson(JSON.stringify([{ n: 42, b: true, nil: null }]));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.rows).toEqual([{ n: '42', b: 'true', nil: '' }]);
  });

  it('unions columns across rows in first-seen order', () => {
    const res = parseJson(JSON.stringify([{ a: 1 }, { b: 2 }, { a: 3, c: 4 }]));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.columns).toEqual(['a', 'b', 'c']);
  });

  it('invalid JSON is an error result, not a throw', () => {
    expect(() => parseJson('{ not json')).not.toThrow();
    expect(parseJson('{ not json').ok).toBe(false);
  });
});

describe('parseRss (T4)', () => {
  it('parses an RSS 2.0 fixture', () => {
    const xml = `<?xml version="1.0"?>
      <rss><channel>
        <item>
          <title>Hello &amp; welcome</title>
          <link>https://example.test/a</link>
          <pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate>
          <description><![CDATA[Some <b>html</b> body]]></description>
        </item>
      </channel></rss>`;
    const res = parseRss(xml);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].title).toBe('Hello & welcome');
    expect(res.rows[0].link).toBe('https://example.test/a');
    expect(res.rows[0].date).toBe('Mon, 01 Jan 2024 00:00:00 GMT');
    expect(res.rows[0].description).toBe('Some <b>html</b> body');
  });

  it('parses an Atom fixture', () => {
    const xml = `<?xml version="1.0"?>
      <feed xmlns="http://www.w3.org/2005/Atom">
        <entry>
          <title>It&#39;s Atom</title>
          <link href="https://example.test/b" />
          <updated>2024-01-02T00:00:00Z</updated>
          <summary>Atom summary</summary>
        </entry>
      </feed>`;
    const res = parseRss(xml);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].title).toBe("It's Atom");
    expect(res.rows[0].link).toBe('https://example.test/b');
    expect(res.rows[0].date).toBe('2024-01-02T00:00:00Z');
    expect(res.rows[0].description).toBe('Atom summary');
  });

  it('yields no rows (not an error) for a feed with no items', () => {
    const res = parseRss('<rss><channel></channel></rss>');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.rows).toEqual([]);
  });
});

describe('applyTransforms (T5)', () => {
  const rows = [{ n: 'C', v: '3' }, { n: 'A', v: '1' }, { n: 'B', v: '2' }];

  it('sort', () => {
    const { rows: out } = applyTransforms(rows, ['n', 'v'], [{ op: 'sort', column: 'n' }]);
    expect(out.map((r) => r.n)).toEqual(['A', 'B', 'C']);
  });

  it('filter', () => {
    const { rows: out } = applyTransforms(rows, ['n', 'v'], [{ op: 'filter', column: 'n', test: 'eq', value: 'A' }]);
    expect(out).toEqual([{ n: 'A', v: '1' }]);
  });

  it('limit', () => {
    const { rows: out } = applyTransforms(rows, ['n', 'v'], [{ op: 'limit', count: 2 }]);
    expect(out).toHaveLength(2);
  });

  it('offset', () => {
    const { rows: out } = applyTransforms(rows, ['n', 'v'], [{ op: 'offset', count: 2 }]);
    expect(out).toHaveLength(1);
    expect(out[0].n).toBe('B');
  });

  it('rank assigns 1-based position', () => {
    const { rows: out, columns } = applyTransforms(rows, ['n', 'v'], [{ op: 'rank', column: 'pos' }]);
    expect(out.map((r) => r.pos)).toEqual(['1', '2', '3']);
    expect(columns).toContain('pos');
  });

  it('composed pipeline: sort desc -> rank -> limit 5 gives ranks 1-5 reflecting post-sort order', () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ n: String(i), score: String(i) }));
    const { rows: out } = applyTransforms(
      many,
      ['n', 'score'],
      [
        { op: 'sort', column: 'score', direction: 'desc', numeric: true },
        { op: 'rank', column: 'rank' },
        { op: 'limit', count: 5 },
      ]
    );
    expect(out).toHaveLength(5);
    expect(out.map((r) => r.rank)).toEqual(['1', '2', '3', '4', '5']);
    // post-sort order: highest score first
    expect(out.map((r) => r.score)).toEqual(['9', '8', '7', '6', '5']);
  });

  it('numeric sort puts 2 before 10; default lexical sort does not', () => {
    const data = [{ v: '10' }, { v: '2' }];
    const numeric = applyTransforms(data, ['v'], [{ op: 'sort', column: 'v', numeric: true }]);
    expect(numeric.rows.map((r) => r.v)).toEqual(['2', '10']);
    const lexical = applyTransforms(data, ['v'], [{ op: 'sort', column: 'v' }]);
    expect(lexical.rows.map((r) => r.v)).toEqual(['10', '2']);
  });
});
