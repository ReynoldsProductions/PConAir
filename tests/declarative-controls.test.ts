// Spec 18 — declarative controls, server half: manifest validation, the
// controls route, serving precedence and colour validation on POST /state.
//
// The client half (the generated panel) lives in
// tests/declarative-controls-render.test.ts, which needs the jsdom
// environment; vitest picks one environment per file.
import { describe, it, expect } from 'vitest';
import { validateManifest } from '../src/main/packages/loader';

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

  it('a manifest with no controls key still validates (additive)', () => {
    const res = validateManifest({
      id: 'plain',
      name: 'Plain',
      version: '1.0.0',
      renders: [{ id: 'main', label: 'Main', file: 'render.html' }],
    });
    expect(res.ok).toBe(true);
  });
});
