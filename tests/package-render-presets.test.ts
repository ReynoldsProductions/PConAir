import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';
import { createPresetsStore } from '../src/main/presets';
import { createPackageHub } from '../src/main/packages/state-hub';
import { ensurePackageRenderPresets } from '../src/main/packages/render-presets';

const BUNDLED_ROOT = path.join(process.cwd(), 'bundled-packages');

function writePackage(root: string, renders: object[]): string {
  const dir = path.join(root, 'demo');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ id: 'demo', name: 'Demo Pack', version: '1.0.0', renders })
  );
  for (const r of renders as Array<{ file: string }>) {
    fs.writeFileSync(path.join(dir, r.file), '<!DOCTYPE html><html><body></body></html>');
  }
  return root;
}

describe('ensurePackageRenderPresets', () => {
  let presets: ReturnType<typeof createPresetsStore>;
  let root: string;

  beforeEach(() => {
    presets = createPresetsStore();
    root = fs.mkdtempSync(path.join(os.tmpdir(), `render-presets-${randomUUID()}-`));
  });

  it('seeds only the renders that declare a preset', () => {
    writePackage(root, [
      { id: 'layer', label: 'Layer', file: 'layer.html' },
      { id: 'all', label: 'Everything', file: 'all.html', preset: {} },
    ]);
    ensurePackageRenderPresets({ hub: createPackageHub(root), presets, port: 8080 });

    expect(presets.list()).toHaveLength(1);
    expect(presets.list()[0]).toMatchObject({
      name: 'Demo Pack — Everything',
      url: 'http://localhost:8080/packages/demo/render/all',
      sessionMode: 'persistent',
      displayTarget: null,
      description: null,
    });
  });

  it('takes the name and description the manifest gives it', () => {
    writePackage(root, [
      { id: 'all', label: 'Everything', file: 'all.html', preset: { name: 'Demo scene', description: 'Both layers' } },
    ]);
    ensurePackageRenderPresets({ hub: createPackageHub(root), presets, port: 8080 });

    expect(presets.list()[0]).toMatchObject({ name: 'Demo scene', description: 'Both layers' });
  });

  it('is idempotent across restarts and leaves an edited preset alone', () => {
    writePackage(root, [{ id: 'all', label: 'Everything', file: 'all.html', preset: {} }]);
    const hub = createPackageHub(root);

    ensurePackageRenderPresets({ hub, presets, port: 8080 });
    const seeded = presets.list()[0];
    presets.update(seeded.id, { name: 'My scene', displayTarget: 'display-2' });

    ensurePackageRenderPresets({ hub, presets, port: 8080 });

    expect(presets.list()).toHaveLength(1);
    expect(presets.list()[0]).toMatchObject({ id: seeded.id, name: 'My scene', displayTarget: 'display-2' });
  });

  it('repoints an existing preset when the server port moves', () => {
    writePackage(root, [{ id: 'all', label: 'Everything', file: 'all.html', preset: {} }]);
    const hub = createPackageHub(root);

    ensurePackageRenderPresets({ hub, presets, port: 8080 });
    presets.update(presets.list()[0].id, { name: 'My scene' });
    ensurePackageRenderPresets({ hub, presets, port: 9099 });

    expect(presets.list()).toHaveLength(1);
    expect(presets.list()[0]).toMatchObject({
      name: 'My scene',
      url: 'http://localhost:9099/packages/demo/render/all',
    });
  });

  it('gives the bundled Faire Wire all-in-one a preset, and no other render one', () => {
    ensurePackageRenderPresets({ hub: createPackageHub(BUNDLED_ROOT), presets, port: 8080 });

    expect(presets.list().map((p) => p.url)).toEqual(['http://localhost:8080/packages/news/render/all']);
    expect(presets.list()[0].name).toBe('Faire Wire — Ticker + lower thirds');
  });
});
