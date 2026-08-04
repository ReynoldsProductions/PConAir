import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * The lower-third name clips its own glyphs if the line box is shorter than the
 * ink it has to hold. `.l3 .name` needs `overflow:hidden` for text-overflow
 * ellipsis, and overflow clips at the PADDING box — so a tight line-height with
 * no vertical padding cuts descenders ("y", "g", "p") and accented capitals.
 *
 * The Inter metrics below were measured in Blink against the shipped font file
 * (graphics/_fonts/inter-latin-600.woff2) at 52px, normalised to em:
 *
 *   hhea ascent   50/52 = 0.96154em   hhea descent  13/52 = 0.25em
 *   "y" tail   10.82/52 = 0.20808em   "ÉÅ" ink   51.72/52 = 0.99462em
 *
 * Because the name auto-shrinks toward 34px, the padding must be in em so the
 * headroom scales with the font size.
 */
const INTER = {
  ascent: 50 / 52,
  descent: 13 / 52,
  inkBelowBaseline: 10.82 / 52,
  inkAboveBaseline: 51.72 / 52,
};

const NAME_FONT_PX = 52;
const html = fs.readFileSync(
  path.join(__dirname, '..', 'bundled-packages', 'news', 'render-l3.html'),
  'utf8',
);

/** Pull one CSS declaration block out of the render page. */
function rule(selector: string): string {
  const m = html.match(
    new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`),
  );
  if (!m) throw new Error(`no CSS rule for ${selector}`);
  return m[1];
}

/** A length from that block, in em relative to the name's font-size. */
function em(block: string, prop: string, fallback = 0): number {
  const m = block.match(new RegExp(`(?:^|;|\\s)${prop}\\s*:\\s*(-?[\\d.]+)(em|px)?`));
  if (!m) return fallback;
  const n = parseFloat(m[1]);
  return m[2] === 'px' ? n / NAME_FONT_PX : n;
}

/** Shorthand `padding:a 0 b` / `margin:a 0 b` → top & bottom, in em. */
function shorthandBlock(block: string, prop: 'padding' | 'margin'): { top: number; bottom: number } {
  const m = block.match(new RegExp(`(?:^|;|\\s)${prop}\\s*:\\s*([^;}]+)`));
  if (!m) {
    return { top: em(block, `${prop}-top`), bottom: em(block, `${prop}-bottom`) };
  }
  const parts = m[1].trim().split(/\s+/).map((p) => {
    const v = parseFloat(p);
    return /px$/.test(p) ? v / NAME_FONT_PX : v;
  });
  const top = parts[0];
  const bottom = parts.length >= 3 ? parts[2] : parts[0];
  return { top, bottom };
}

describe('Faire Wire lower third — name glyphs are not clipped', () => {
  const name = rule('.l3 .name');
  const lineHeight = em(name, 'line-height', 1);
  const pad = shorthandBlock(name, 'padding');
  // half-leading is negative whenever line-height < the font's content area
  const baseline = (lineHeight - (INTER.ascent + INTER.descent)) / 2 + INTER.ascent;

  it('clips text horizontally (the ellipsis this padding has to survive)', () => {
    expect(name).toMatch(/overflow\s*:\s*hidden/);
    expect(name).toMatch(/text-overflow\s*:\s*ellipsis/);
    expect(name).toMatch(/font-size\s*:\s*52px/);
  });

  it('leaves room below the baseline for descenders', () => {
    const roomBelow = lineHeight - baseline + pad.bottom;
    expect(roomBelow).toBeGreaterThanOrEqual(INTER.inkBelowBaseline);
  });

  it('leaves room above the baseline for accented capitals', () => {
    const roomAbove = baseline + pad.top;
    expect(roomAbove).toBeGreaterThanOrEqual(INTER.inkAboveBaseline);
  });

  it('cancels the padding with negative margins so panel geometry is unchanged', () => {
    // the FaireL3s spec pins the panel at 169px tall with name 52 / title 32;
    // padding may grow the paint box but must not grow the layout box
    const margin = shorthandBlock(name, 'margin');
    expect(margin.top).toBeCloseTo(-pad.top, 5);
    expect(margin.bottom).toBeCloseTo(-pad.bottom, 5);
  });

  it('scales its headroom with the auto-shrunk font size', () => {
    if (pad.top === 0 && pad.bottom === 0) return; // covered by the assertions above
    expect(name).toMatch(/padding\s*:[^;}]*em/);
  });
});
