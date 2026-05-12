import { describe, it, expect } from 'vitest';
import { buildL3ProgramMarkup } from '../src/main/l3/window-manager';

describe('buildL3ProgramMarkup', () => {
  it('includes base layout without theme', () => {
    const html = buildL3ProgramMarkup([{ name: 'A', title: 'B' }], null);
    expect(html).toContain('#wrap');
    expect(html).toContain('A');
    expect(html).toContain('B');
    expect(html).not.toContain('data:text/css');
  });

  it('embeds theme CSS as a base64 data URL after base styles', () => {
    const css = '.name { color: rgb(255, 0, 0); }';
    const html = buildL3ProgramMarkup([{ name: 'N', title: 'T' }], css);
    expect(html).toContain('data:text/css;charset=utf-8;base64,');
    const iStyle = html.indexOf('</style>');
    const iData = html.indexOf('data:text/css');
    expect(iStyle).toBeGreaterThan(-1);
    expect(iData).toBeGreaterThan(iStyle);
  });
});
