import { describe, it, expect } from 'vitest';
import { createPresenceRegistry } from '../src/main/packages/presence';

describe('createPresenceRegistry (T1 — registry unit)', () => {
  it('tracks renders, byRender and controls per package; unknown packages are fully zeroed', () => {
    const registry = createPresenceRegistry();
    const renderA1 = Symbol('renderA1');
    const renderA2 = Symbol('renderA2');
    const controlA = Symbol('controlA');
    const renderB1 = Symbol('renderB1');

    registry.add(renderA1, {
      role: 'render',
      packageId: 'pkgA',
      renderId: 'main',
      ip: '127.0.0.1',
      connectedAt: 1,
    });
    registry.add(renderA2, {
      role: 'render',
      packageId: 'pkgA',
      renderId: null,
      ip: '127.0.0.1',
      connectedAt: 2,
    });
    registry.add(controlA, {
      role: 'control',
      packageId: 'pkgA',
      renderId: null,
      ip: '127.0.0.1',
      connectedAt: 3,
    });
    registry.add(renderB1, {
      role: 'render',
      packageId: 'pkgB',
      renderId: 'main',
      ip: '127.0.0.1',
      connectedAt: 4,
    });

    expect(registry.forPackage('pkgA')).toEqual({
      renders: 2,
      byRender: { main: 1 },
      controls: 1,
    });
    expect(registry.forPackage('pkgB')).toEqual({
      renders: 1,
      byRender: { main: 1 },
      controls: 0,
    });
    expect(registry.forPackage('nope')).toEqual({
      renders: 0,
      byRender: {},
      controls: 0,
    });
  });

  it('remove decrements counts', () => {
    const registry = createPresenceRegistry();
    const id = Symbol('r');
    registry.add(id, { role: 'render', packageId: 'pkgA', renderId: 'main', ip: '127.0.0.1', connectedAt: 1 });
    expect(registry.forPackage('pkgA').renders).toBe(1);
    registry.remove(id);
    expect(registry.forPackage('pkgA').renders).toBe(0);
  });

  it('onChange fires once per mutation (add or remove)', () => {
    const registry = createPresenceRegistry();
    let fired = 0;
    const off = registry.onChange(() => { fired += 1; });

    const id = Symbol('r');
    registry.add(id, { role: 'render', packageId: 'pkgA', renderId: 'main', ip: '127.0.0.1', connectedAt: 1 });
    expect(fired).toBe(1);

    registry.remove(id);
    expect(fired).toBe(2);

    // removing an already-removed id (or unknown) is a no-op, not a mutation
    registry.remove(id);
    expect(fired).toBe(2);

    off();
    registry.add(Symbol('r2'), { role: 'render', packageId: 'pkgA', renderId: 'main', ip: '127.0.0.1', connectedAt: 2 });
    expect(fired).toBe(2);
  });

  it('all() returns every entry sorted by connectedAt ascending', () => {
    const registry = createPresenceRegistry();
    registry.add(Symbol('c'), { role: 'render', packageId: 'pkgA', renderId: 'main', ip: '1.1.1.1', connectedAt: 30 });
    registry.add(Symbol('a'), { role: 'control', packageId: 'pkgA', renderId: null, ip: '2.2.2.2', connectedAt: 10 });
    registry.add(Symbol('b'), { role: 'render', packageId: 'pkgB', renderId: null, ip: '3.3.3.3', connectedAt: 20 });

    const all = registry.all();
    expect(all.map((e) => e.connectedAt)).toEqual([10, 20, 30]);
  });
});
