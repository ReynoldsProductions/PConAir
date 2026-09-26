import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '..');

/** Every renderer HTML entrypoint the webpack plugin builds, read from forge.config.ts. */
function forgeHtmlEntrypoints(): string[] {
  const config = fs.readFileSync(path.join(ROOT, 'forge.config.ts'), 'utf-8');
  return [...config.matchAll(/html:\s*'([^']+)'/g)].map((m) => m[1]);
}

describe('renderer HTML entrypoints', () => {
  it('finds the entrypoints in forge.config.ts', () => {
    expect(forgeHtmlEntrypoints()).toContain('./src/renderer/remote/index.html');
  });

  // The webpack plugin injects each entry's bundle into its HTML. A hand-written
  // <script src="index.js"> resolves to the same bundle, so the page runs twice
  // and every click handler fires twice (e.g. Next slide advances two slides).
  it.each(forgeHtmlEntrypoints())('%s does not load its own bundle by hand', (htmlPath) => {
    const html = fs.readFileSync(path.join(ROOT, htmlPath), 'utf-8');
    expect(html).not.toMatch(/<script[^>]*\ssrc=["'](\.\/)?index\.js["']/);
  });
});
