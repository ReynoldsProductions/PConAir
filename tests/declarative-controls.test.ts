// Spec 18 — declarative controls, server half: manifest validation, the
// controls route, serving precedence and colour validation on POST /state.
//
// The client half (the generated panel) lives in
// tests/declarative-controls-render.test.ts, which needs the jsdom
// environment; vitest picks one environment per file.
import { describe, it, expect } from 'vitest';
import { validateManifest } from '../src/main/packages/loader';
import { resolveSchemaPath } from '../src/main/packages/controls-validate';

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

