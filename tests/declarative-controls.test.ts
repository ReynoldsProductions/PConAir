// Spec 18 — declarative controls, server half: manifest validation, the
// controls route, serving precedence and colour validation on POST /state.
//
// The client half (the generated panel) lives in
// tests/declarative-controls-render.test.ts, which needs the jsdom
// environment; vitest picks one environment per file.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';
import type { Express } from 'express';
import { validateManifest } from '../src/main/packages/loader';
import { resolveSchemaPath } from '../src/main/packages/controls-validate';
import { createStateStore } from '../src/main/state';
import { createFullServer } from './_test-server';

const BASE_SCHEMA = {
  home: { score: 'number', name: 'string', bonus: 'boolean' },
  live: 'boolean',
  style: { accent: 'string', panelOpacity: 'number', corner: 'number', font: 'string' },
  scores: [],
  logo: 'string',
};

function manifest(controls: unknown, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'widget',
    name: 'Widget',
    version: '1.0.0',
    renders: [{ id: 'main', label: 'Main', file: 'render.html' }],
    stateSchema: BASE_SCHEMA,
    controls,
    ...extra,
  };
}

/** validateManifest's failure message, or '' when it passed. */
function err(controls: unknown, extra: Record<string, unknown> = {}): string {
  const res = validateManifest(manifest(controls, extra));
  return res.ok ? '' : res.error;
}

describe('T1 — controls schema + basic validation', () => {
  it('accepts a valid two-group manifest', () => {
    const res = validateManifest(
      manifest({
        groups: [
          {
            id: 'scores',
            label: 'Scores',
            fields: [
              { type: 'number', field: 'home.score', label: 'Home score', bump: [1, 10] },
              { type: 'text', field: 'home.name', label: 'Home name', placeholder: 'Home' },
              { type: 'toggle', field: 'live', label: 'On air' },
            ],
          },
          {
            id: 'look',
            label: 'Look',
            collapsed: true,
            fields: [
              { type: 'color', field: 'style.accent', label: 'Accent', swatches: ['#c8a24a', '#fff'] },
              { type: 'slider', field: 'style.panelOpacity', label: 'Panel opacity', min: 0, max: 1, step: 0.05 },
              { type: 'static', label: 'Note', text: 'Restyles live.' },
            ],
          },
        ],
      })
    );
    expect(res.ok).toBe(true);
  });

  it('rejects controls that is not an object with a groups array', () => {
    expect(err([])).toMatch(/controls must be an object/);
    expect(err({})).toMatch(/controls\.groups must be an array/);
  });

  it('rejects duplicate group ids, naming the group', () => {
    const message = err({
      groups: [
        { id: 'look', label: 'Look', fields: [{ type: 'static', label: 'a', text: 'a' }] },
        { id: 'look', label: 'Look again', fields: [{ type: 'static', label: 'b', text: 'b' }] },
      ],
    });
    expect(message).toMatch(/group 'look'/);
    expect(message).toMatch(/duplicate/i);
  });

  it('rejects an empty field label, naming the group and the field position', () => {
    const message = err({
      groups: [
        {
          id: 'scores',
          label: 'Scores',
          fields: [
            { type: 'toggle', field: 'live', label: 'On air' },
            { type: 'text', field: 'home.name', label: '' },
          ],
        },
      ],
    });
    expect(message).toMatch(/group 'scores'/);
    expect(message).toMatch(/field \[1\]/);
    expect(message).toMatch(/label is required/);
  });

  it('rejects an empty group label and a non-array fields list', () => {
    expect(
      err({ groups: [{ id: 'g', label: '', fields: [{ type: 'static', label: 'a', text: 'a' }] }] })
    ).toMatch(/group 'g'.*label is required/);
    expect(err({ groups: [{ id: 'g', label: 'G', fields: {} }] })).toMatch(
      /group 'g'.*fields must be a non-empty array/
    );
  });

  it('rejects a select with no choices, naming the group and field', () => {
    const message = err({
      groups: [
        { id: 'look', label: 'Look', fields: [{ type: 'select', field: 'style.font', label: 'Font', choices: [] }] },
      ],
    });
    expect(message).toMatch(/group 'look'/);
    expect(message).toMatch(/field 'Font'/);
    expect(message).toMatch(/at least one choice/);
  });

  it('rejects a slider whose min is not below its max', () => {
    const message = err({
      groups: [
        {
          id: 'look',
          label: 'Look',
          fields: [{ type: 'slider', field: 'style.panelOpacity', label: 'Opacity', min: 1, max: 1 }],
        },
      ],
    });
    expect(message).toMatch(/group 'look'/);
    expect(message).toMatch(/field 'Opacity'/);
    expect(message).toMatch(/min must be less than max/);
  });

  it('rejects an unknown field type and a bad group id', () => {
    expect(
      err({ groups: [{ id: 'g', label: 'G', fields: [{ type: 'rotary', field: 'live', label: 'X' }] }] })
    ).toMatch(/unknown field type 'rotary'/);
    expect(
      err({ groups: [{ id: 'Bad Id', label: 'G', fields: [{ type: 'static', label: 'a', text: 'a' }] }] })
    ).toMatch(/id must be lowercase/);
  });

  it('rejects a bad span, a non-string help and a static with no text', () => {
    expect(
      err({
        groups: [{ id: 'g', label: 'G', fields: [{ type: 'toggle', field: 'live', label: 'X', span: 'quarter' }] }],
      })
    ).toMatch(/span must be one of/);
    expect(
      err({ groups: [{ id: 'g', label: 'G', fields: [{ type: 'toggle', field: 'live', label: 'X', help: 7 }] }] })
    ).toMatch(/help must be a string/);
    expect(err({ groups: [{ id: 'g', label: 'G', fields: [{ type: 'static', label: 'X' }] }] })).toMatch(
      /static field requires a non-empty 'text'/
    );
  });

});

describe('T2 — field path resolution against stateSchema', () => {
  function oneField(field: Record<string, unknown>, schema?: unknown): string {
    const m = manifest({ groups: [{ id: 'g', label: 'G', fields: [field] }] });
    if (schema !== undefined) m.stateSchema = schema;
    const res = validateManifest(m);
    return res.ok ? '' : res.error;
  }

  it('resolves a nested path', () => {
    expect(oneField({ type: 'number', field: 'home.score', label: 'Score' }, { home: { score: 'number' } })).toBe('');
  });

  it('fails a typo\'d path naming the group, the field and the path', () => {
    const message = oneField({ type: 'number', field: 'home.scor', label: 'Score' }, { home: { score: 'number' } });
    expect(message).toMatch(/group 'g'/);
    expect(message).toMatch(/field 'Score'/);
    expect(message).toMatch(/'home\.scor'/);
    expect(message).toMatch(/no such path in stateSchema/);
  });

  it('resolves an index under an array leaf', () => {
    expect(oneField({ type: 'text', field: 'scores.0', label: 'First' }, { scores: [] })).toBe('');
    // …and an untyped array element is exempt from the leaf-type check, so a
    // number field on the same path is fine too.
    expect(oneField({ type: 'number', field: 'scores.0', label: 'First' }, { scores: [] })).toBe('');
  });

  it('fails a path that runs past a scalar leaf', () => {
    const message = oneField({ type: 'text', field: 'live.deeper', label: 'Deep' }, { live: 'boolean' });
    expect(message).toMatch(/'live\.deeper'/);
    expect(message).toMatch(/not an object/);
  });

  it('fails a path that resolves to an object rather than a value', () => {
    expect(oneField({ type: 'text', field: 'home', label: 'Home' }, { home: { score: 'number' } })).toMatch(
      /resolves to an object, not a value/
    );
  });

  it('fails when the manifest declares no stateSchema at all', () => {
    const res = validateManifest({
      id: 'noschema',
      name: 'No schema',
      version: '1.0.0',
      renders: [{ id: 'main', label: 'Main', file: 'render.html' }],
      controls: { groups: [{ id: 'g', label: 'G', fields: [{ type: 'text', field: 'a', label: 'A' }] }] },
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/declares no stateSchema/);
  });

  it('rejects a malformed dotted path', () => {
    expect(oneField({ type: 'text', field: 'home..name', label: 'N' }, { home: { name: 'string' } })).toMatch(
      /malformed path/
    );
  });
});

describe('T3 — leaf type agreement', () => {
  const SCHEMA = { num: 'number', str: 'string', bool: 'boolean', arr: [] };

  function check(field: Record<string, unknown>): string {
    const m = manifest({ groups: [{ id: 'g', label: 'G', fields: [field] }] });
    m.stateSchema = SCHEMA;
    const res = validateManifest(m);
    return res.ok ? '' : res.error;
  }

  it('each of the seven value-bearing types validates against its correct leaf type', () => {
    expect(check({ type: 'text', field: 'str', label: 'T' })).toBe('');
    expect(check({ type: 'number', field: 'num', label: 'N' })).toBe('');
    expect(check({ type: 'slider', field: 'num', label: 'S', min: 0, max: 1 })).toBe('');
    expect(check({ type: 'toggle', field: 'bool', label: 'B' })).toBe('');
    expect(check({ type: 'color', field: 'str', label: 'C' })).toBe('');
    expect(check({ type: 'select', field: 'str', label: 'Sel', choices: [{ id: 'a', label: 'A' }] })).toBe('');
    expect(check({ type: 'asset', field: 'str', label: 'A' })).toBe('');
  });

  it("rejects type: 'text' on a number leaf, naming the group, field, path and both types", () => {
    const message = check({ type: 'text', field: 'num', label: 'Headline' });
    expect(message).toMatch(/group 'g'/);
    expect(message).toMatch(/field 'Headline'/);
    expect(message).toMatch(/'num'/);
    expect(message).toMatch(/text.*string/);
    expect(message).toMatch(/number/);
  });

  it('rejects every other mismatched pairing', () => {
    expect(check({ type: 'number', field: 'str', label: 'N' })).toMatch(/expects a number leaf/);
    expect(check({ type: 'slider', field: 'bool', label: 'S', min: 0, max: 1 })).toMatch(/expects a number leaf/);
    expect(check({ type: 'toggle', field: 'str', label: 'B' })).toMatch(/expects a boolean leaf/);
    expect(check({ type: 'color', field: 'num', label: 'C' })).toMatch(/expects a string leaf/);
    expect(check({ type: 'asset', field: 'bool', label: 'A' })).toMatch(/expects a string leaf/);
    expect(check({ type: 'select', field: 'bool', label: 'Sel', choices: [{ id: 'a', label: 'A' }] })).toMatch(
      /expects a string leaf/
    );
  });

  it('an untyped array element is exempt from the leaf-type check', () => {
    expect(check({ type: 'text', field: 'arr.0', label: 'T' })).toBe('');
    expect(check({ type: 'toggle', field: 'arr.2', label: 'B' })).toBe('');
  });

  it("a `list` text field requires an array leaf, and a plain text field forbids one", () => {
    expect(check({ type: 'text', field: 'arr', label: 'Lines', list: true })).toBe('');
    expect(check({ type: 'text', field: 'str', label: 'Lines', list: true })).toMatch(
      /list requires an array leaf/
    );
    expect(check({ type: 'text', field: 'arr', label: 'Lines' })).toMatch(/expects a string leaf/);
  });

  it('a select on a number leaf is allowed when every choice id is a number', () => {
    // PkgCompanionOption's `dropdown` already allows numeric ids, so the panel
    // follows suit rather than making an author learn a second rule.
    expect(check({ type: 'select', field: 'num', label: 'Sel', choices: [{ id: 1, label: 'One' }] })).toBe('');
    expect(check({ type: 'select', field: 'num', label: 'Sel', choices: [{ id: 'a', label: 'A' }] })).toMatch(
      /every choice id must be a number/
    );
  });
});

describe('T4 — cross-references', () => {
  // Specs 15 (render `transport`) and 20 (`dataSources`) are both merged into
  // this branch's base, so both checks run unguarded. Spec 18 §3.7 says to
  // skip a check only if its spec had not landed.
  const RENDERS = [
    { id: 'plain', label: 'Plain', file: 'a.html' },
    { id: 'card', label: 'Card', file: 'b.html', transport: { stops: 2 } },
  ];
  const SOURCES = [{ id: 'feed', label: 'Feed', kind: 'rss', url: 'https://example.com/f.xml' }];

  function check(field: Record<string, unknown>): string {
    const res = validateManifest({
      id: 'widget',
      name: 'Widget',
      version: '1.0.0',
      renders: RENDERS,
      dataSources: SOURCES,
      stateSchema: BASE_SCHEMA,
      controls: { groups: [{ id: 'g', label: 'G', fields: [field] }] },
    });
    return res.ok ? '' : res.error;
  }

  it('accepts a transport field naming a transport-managed render', () => {
    expect(check({ type: 'transport', label: 'Card', renderId: 'card' })).toBe('');
  });

  it('rejects a transport field naming a render that declares no transport', () => {
    const message = check({ type: 'transport', label: 'Card', renderId: 'plain' });
    expect(message).toMatch(/group 'g'/);
    expect(message).toMatch(/field 'Card'/);
    expect(message).toMatch(/'plain'/);
    expect(message).toMatch(/not transport-managed/);
  });

  it('rejects a transport field naming a render that does not exist', () => {
    expect(check({ type: 'transport', label: 'Card', renderId: 'nope' })).toMatch(/names no declared render/);
  });

  it('accepts a data field naming a declared source and rejects an undeclared one', () => {
    expect(check({ type: 'data', label: 'Feed', sourceId: 'feed' })).toBe('');
    const message = check({ type: 'data', label: 'Feed', sourceId: 'ghost' });
    expect(message).toMatch(/field 'Feed'/);
    expect(message).toMatch(/'ghost'/);
    expect(message).toMatch(/names no declared data source/);
  });

  it('rejects a data field when the manifest declares no data sources at all', () => {
    const res = validateManifest({
      id: 'widget',
      name: 'Widget',
      version: '1.0.0',
      renders: RENDERS,
      stateSchema: BASE_SCHEMA,
      controls: { groups: [{ id: 'g', label: 'G', fields: [{ type: 'data', label: 'F', sourceId: 'feed' }] }] },
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/names no declared data source/);
  });

  it('resolves showIf.field, rejecting a typo', () => {
    expect(check({ type: 'text', field: 'home.name', label: 'N', showIf: { field: 'live', equals: true } })).toBe('');
    const message = check({
      type: 'text',
      field: 'home.name',
      label: 'N',
      showIf: { field: 'liv', equals: true },
    });
    expect(message).toMatch(/showIf/);
    expect(message).toMatch(/'liv'/);
    expect(message).toMatch(/no such path in stateSchema/);
  });

  it('rejects a malformed showIf', () => {
    expect(check({ type: 'text', field: 'home.name', label: 'N', showIf: { field: 'live' } })).toMatch(
      /showIf requires 'field' and 'equals'/
    );
    expect(
      check({ type: 'text', field: 'home.name', label: 'N', showIf: { field: 'live', equals: { a: 1 } } })
    ).toMatch(/showIf\.equals must be a string, number or boolean/);
  });

  it('resolves every dotted path inside an action patch', () => {
    expect(check({ type: 'action', label: 'Take', patch: { live: true, home: { score: 0 } } })).toBe('');
    const message = check({ type: 'action', label: 'Take', patch: { home: { scor: 0 } } });
    expect(message).toMatch(/field 'Take'/);
    expect(message).toMatch(/patch path 'home\.scor'/);
    expect(message).toMatch(/no such path in stateSchema/);
  });

  it('accepts an array value at an array leaf inside an action patch', () => {
    expect(check({ type: 'action', label: 'Reset', patch: { scores: [] } })).toBe('');
  });

  it('rejects an action patch that writes an engine-reserved key', () => {
    expect(check({ type: 'action', label: 'Bad', patch: { _transport: {} } })).toMatch(/reserved/);
  });
});

describe('T2 — resolveSchemaPath directly', () => {
  it('reports the resolved leaf type', () => {
    expect(resolveSchemaPath({ home: { score: 'number' } }, 'home.score')).toEqual({ ok: true, leaf: 'number' });
    expect(resolveSchemaPath({ name: 'string' }, 'name')).toEqual({ ok: true, leaf: 'string' });
    // Inside an array: element type is unknowable from `[]`.
    expect(resolveSchemaPath({ rows: [] }, 'rows.3.value')).toEqual({ ok: true, leaf: 'unknown' });
    // The array itself.
    expect(resolveSchemaPath({ rows: [] }, 'rows')).toEqual({ ok: true, leaf: 'array' });
  });

  it('reports a reason on failure', () => {
    const res = resolveSchemaPath({ home: { score: 'number' } }, 'away.score');
    expect(res.ok).toBe(false);
  });
});


// ── Route-level tests (T5, T6, T13) ──────────────────────────────────────

const PINS = { operatorPin: '12341234', adminPin: 'adminpass9' };

/** The controls block both route fixtures share. */
const FIXTURE_CONTROLS = {
  groups: [
    {
      id: 'scores',
      label: 'Scores',
      fields: [
        { type: 'number', field: 'home.score', label: 'Home score', bump: [1] },
        { type: 'text', field: 'home.name', label: 'Home name' },
        { type: 'toggle', field: 'live', label: 'On air' },
      ],
    },
    {
      id: 'look',
      label: 'Look',
      fields: [
        { type: 'color', field: 'style.accent', label: 'Accent', swatches: ['#c8a24a'] },
        { type: 'slider', field: 'style.panelOpacity', label: 'Panel opacity', min: 0, max: 1, step: 0.05 },
      ],
    },
  ],
};

interface FixtureOpts {
  /** Package directory name and manifest id. */
  id: string;
  controls?: unknown;
  controlHtml?: string;
}

function writeFixture(root: string, opts: FixtureOpts): void {
  const dir = path.join(root, opts.id);
  fs.mkdirSync(dir, { recursive: true });
  const manifestBody: Record<string, unknown> = {
    id: opts.id,
    name: `Fixture ${opts.id}`,
    version: '1.0.0',
    renders: [{ id: 'main', label: 'Main', file: 'render.html' }],
    stateSchema: BASE_SCHEMA,
  };
  if (opts.controls !== undefined) manifestBody.controls = opts.controls;
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(manifestBody));
  fs.writeFileSync(path.join(dir, 'render.html'), '<!DOCTYPE html><html><body>R</body></html>');
  if (opts.controlHtml !== undefined) fs.writeFileSync(path.join(dir, 'control.html'), opts.controlHtml);
}

describe('T5/T6 — controls route and serving precedence', () => {
  let root: string;
  let server: ReturnType<typeof createFullServer>;
  let app: Express;
  let operatorCookie: string;

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'pconair-ctrl-'));
    // declared: controls only          → generated shell
    // handwritten: control.html only   → served verbatim
    // both: control.html + controls    → control.html wins
    // bare: neither                    → 404
    writeFixture(root, { id: 'declared', controls: FIXTURE_CONTROLS });
    writeFixture(root, { id: 'handwritten', controlHtml: '<!DOCTYPE html><html><body>HAND</body></html>' });
    writeFixture(root, {
      id: 'both',
      controls: FIXTURE_CONTROLS,
      controlHtml: '<!DOCTYPE html><html><body>HAND-AND-DECLARED</body></html>',
    });
    writeFixture(root, { id: 'bare' });

    server = createFullServer({ store: createStateStore(), ...PINS, port: 0, packagesRoot: root });
    await server.listen();
    app = server.app;
    const op = await request(app).post('/auth/operator').send({ pin: PINS.operatorPin });
    operatorCookie = (op.headers['set-cookie'] as unknown as string[])[0];
  });

  afterEach(async () => {
    await server.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('every fixture loaded without a manifest error', () => {
    expect(server.packageHub?.errors() ?? []).toEqual([]);
  });

  // ── T5 ──
  it('GET /api/packages/:id/controls returns the validated structure for an operator', async () => {
    const res = await request(app).get('/api/packages/declared/controls').set('Cookie', operatorCookie);
    expect(res.status).toBe(200);
    expect(res.body.controls.groups).toHaveLength(2);
    expect(res.body.controls.groups[0]).toMatchObject({ id: 'scores', label: 'Scores' });
    expect(res.body.controls.groups[0].fields[0]).toMatchObject({
      type: 'number',
      field: 'home.score',
      label: 'Home score',
    });
    // The panel needs the package's identity and render list for its header
    // and preview selector without a second round trip.
    expect(res.body).toMatchObject({ id: 'declared', name: 'Fixture declared' });
    expect(res.body.renders).toEqual([{ id: 'main', label: 'Main', transport: null }]);
  });

  it('GET /api/packages/:id/controls is 401 unauthenticated', async () => {
    const res = await request(app).get('/api/packages/declared/controls');
    expect(res.status).toBe(401);
  });

  it('GET /api/packages/:id/controls is 404 for a package with no controls', async () => {
    const res = await request(app).get('/api/packages/handwritten/controls').set('Cookie', operatorCookie);
    expect(res.status).toBe(404);
  });

  it('GET /api/packages/:id/controls is 404 for an unknown package', async () => {
    const res = await request(app).get('/api/packages/ghost/controls').set('Cookie', operatorCookie);
    expect(res.status).toBe(404);
  });

  // ── T6 ──
  it('a package with control.html serves it unchanged', async () => {
    const res = await request(app).get('/packages/handwritten/control');
    expect(res.status).toBe(200);
    expect(res.text).toContain('HAND');
    expect(res.text).not.toContain('controlPanel');
  });

  it('control.html still wins when the manifest also declares controls', async () => {
    const res = await request(app).get('/packages/both/control');
    expect(res.status).toBe(200);
    expect(res.text).toContain('HAND-AND-DECLARED');
  });

  it('a package with only controls serves the generated shell', async () => {
    const res = await request(app).get('/packages/declared/control');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toContain('/packages/_runtime/pconair.js');
    expect(res.text).toContain('/packages/_runtime/pconair-controls.js');
    expect(res.text).toContain('/packages/_runtime/pconair.css');
    expect(res.text).toContain('controlPanel');
    expect(res.text).toContain('"declared"');
  });

  it('a package with neither still 404s', async () => {
    const res = await request(app).get('/packages/bare/control');
    expect(res.status).toBe(404);
  });

  it('the generated shell is still frame-denied (it is an operator surface, not a render)', async () => {
    const res = await request(app).get('/packages/declared/control');
    expect(res.headers['x-frame-options']).toBe('DENY');
  });
});

describe('T13 — colour validation on POST /state', () => {
  let root: string;
  let server: ReturnType<typeof createFullServer>;
  let app: Express;

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'pconair-color-'));
    writeFixture(root, { id: 'declared', controls: FIXTURE_CONTROLS });
    server = createFullServer({ store: createStateStore(), ...PINS, port: 0, packagesRoot: root });
    await server.listen();
    app = server.app;
  });

  afterEach(async () => {
    await server.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  function setAccent(value: unknown) {
    return request(app)
      .post('/api/packages/declared/state')
      .send({ style: { accent: value, panelOpacity: 0.9 } });
  }

  // ── Rejection first: an unvalidated value here is a CSS injection into
  //    every connected output, so this is the test that matters. ──

  it('rejects a value that escapes the declaration', async () => {
    const res = await setAccent('red; background: url(x)');
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/style\.accent/);
  });

  it('rejects a value containing a function call', async () => {
    expect((await setAccent('expression(1)')).status).toBe(400);
    expect((await setAccent('url(//evil/x.png)')).status).toBe(400);
  });

  it('rejects a value containing a brace or a comment opener', async () => {
    expect((await setAccent('}')).status).toBe(400);
    expect((await setAccent('#fff}')).status).toBe(400);
    expect((await setAccent('#fff/*')).status).toBe(400);
    expect((await setAccent('#fff;')).status).toBe(400);
  });

  it('rejects a non-string and a non-colour word', async () => {
    expect((await setAccent(7)).status).toBe(400);
    expect((await setAccent(true)).status).toBe(400);
    expect((await setAccent('chartreusey')).status).toBe(400);
    expect((await setAccent('')).status).toBe(400);
  });

  it('a rejected patch leaves state untouched — nothing partially applied', async () => {
    const before = await request(app).get('/api/packages/declared/state');
    await setAccent('red; background: url(x)');
    const after = await request(app).get('/api/packages/declared/state');
    expect(after.body.state).toEqual(before.body.state);
  });

  // ── Then acceptance. ──

  it('accepts hex in 3, 6 and 8 digits and a named colour', async () => {
    for (const ok of ['#c8a24a', '#fff', '#c8a24aff', 'transparent', 'white']) {
      const res = await setAccent(ok);
      expect(res.status).toBe(200);
      expect((res.body.state.style as Record<string, unknown>).accent).toBe(ok);
    }
  });

  it('leaves a patch that does not touch the colour field alone', async () => {
    const res = await request(app).post('/api/packages/declared/state').send({ live: true });
    expect(res.status).toBe(200);
    expect(res.body.state.live).toBe(true);
  });

  it('a package with no controls is unaffected — no colour paths to check', async () => {
    writeFixture(root, { id: 'plain', controlHtml: '<html></html>' });
    await request(app).post('/api/packages/rescan');
    const res = await request(app).post('/api/packages/plain/state').send({ logo: 'red; url(x)' });
    expect(res.status).toBe(200);
  });
});
