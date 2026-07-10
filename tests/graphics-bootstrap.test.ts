import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';
import { bootstrapGraphicsPresets } from '../src/main/graphics/bootstrap-presets';
import { createPresetsStore } from '../src/main/presets';

const REAL_GRAPHICS_ROOT = path.join(process.cwd(), 'graphics');

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `bootstrap-test-${randomUUID()}-`));
}

function writeManifest(dir: string, templates: object[]): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ version: 1, templates }), 'utf8');
}

describe('bootstrapGraphicsPresets', () => {
  let presets: ReturnType<typeof createPresetsStore>;

  beforeEach(() => {
    presets = createPresetsStore();
  });

  it('seeds one URL preset per url-mode template when presets are empty', () => {
    const dir = makeTmpDir();
    writeManifest(dir, [
      { id: 'scoreboard-basketball', title: 'COURTVISION — Basketball Scorebug', description: 'NBA-style scorebug', mode: 'url', path: 'scoreboard-basketball/index.html', params: { a: 'BOS', b: 'LAL', sa: '88', sb: '84' } },
      { id: 'news', title: 'Faire Nightly News', description: 'Lower-third + clock', mode: 'url', path: 'news/index.html', params: { name: 'Jane Smith' } },
    ]);
    bootstrapGraphicsPresets(8080, dir, presets);
    const list = presets.list();
    expect(list).toHaveLength(2);
    expect(list[0].name).toBe('COURTVISION — Basketball Scorebug');
    expect(list[0].url).toBe('http://localhost:8080/graphics/scoreboard-basketball/index.html?a=BOS&b=LAL&sa=88&sb=84');
    expect(list[0].description).toBe('NBA-style scorebug');
    expect(list[0].sessionMode).toBe('persistent');
    expect(list[0].displayTarget).toBeNull();
    expect(list[1].name).toBe('Faire Nightly News');
    expect(list[1].url).toBe('http://localhost:8080/graphics/news/index.html?name=Jane+Smith');
  });

  it('is a no-op when presets already exist', () => {
    const dir = makeTmpDir();
    writeManifest(dir, [
      { id: 'news', title: 'Faire Nightly News', description: 'Clock + ticker', mode: 'url', path: 'news/index.html', params: {} },
    ]);
    presets.create({ name: 'Existing', url: 'http://localhost:8080/something', sessionMode: 'persistent', displayTarget: null, description: null });
    bootstrapGraphicsPresets(8080, dir, presets);
    // should not add the template preset
    expect(presets.list()).toHaveLength(1);
    expect(presets.list()[0].name).toBe('Existing');
  });

  it('is a no-op when manifest file is missing', () => {
    bootstrapGraphicsPresets(8080, '/nonexistent-path', presets);
    expect(presets.list()).toHaveLength(0);
  });

  it('skips templates with mode !== "url"', () => {
    const dir = makeTmpDir();
    writeManifest(dir, [
      { id: 'slides', title: 'Some Slides Template', description: '', mode: 'slides', path: 'slides/index.html', params: {} },
      { id: 'news', title: 'Faire Nightly News', description: 'Clock', mode: 'url', path: 'news/index.html', params: {} },
    ]);
    bootstrapGraphicsPresets(8080, dir, presets);
    expect(presets.list()).toHaveLength(1);
    expect(presets.list()[0].name).toBe('Faire Nightly News');
  });

  it('uses the real graphics manifest without error', () => {
    bootstrapGraphicsPresets(8080, REAL_GRAPHICS_ROOT, presets);
    expect(presets.list().length).toBeGreaterThanOrEqual(5);
    const names = presets.list().map((p) => p.name);
    expect(names).toContain('COURTVISION — Basketball Scorebug');
    expect(names).toContain('Faire Nightly News');
    expect(names).toContain('Lower Third — Live');
  });

  it('builds URLs with correct port', () => {
    const dir = makeTmpDir();
    writeManifest(dir, [
      { id: 'news', title: 'News', description: '', mode: 'url', path: 'news/index.html', params: {} },
    ]);
    bootstrapGraphicsPresets(9999, dir, presets);
    expect(presets.list()[0].url).toContain('localhost:9999');
  });
});
