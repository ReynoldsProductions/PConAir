import { describe, it, expect } from 'vitest';
import { createWarningsStore } from '../src/main/packages/warnings';

describe('WarningsStore (spec 22 T8)', () => {
  it('set then get returns the stored warnings for that render', () => {
    const store = createWarningsStore();
    store.set('news', 'l3', [{ field: 'name', text: 'X', naturalWidth: 900, maxWidth: 620 }]);
    expect(store.get('news')).toEqual({
      l3: [{ field: 'name', text: 'X', naturalWidth: 900, maxWidth: 620 }],
    });
  });

  it('overwrites by (packageId, renderId), leaving other renders untouched', () => {
    const store = createWarningsStore();
    store.set('news', 'l3', [{ field: 'name', text: 'A', naturalWidth: 900, maxWidth: 620 }]);
    store.set('news', 'ticker', [{ field: 'headline', text: 'B', naturalWidth: 1000, maxWidth: 800 }]);
    store.set('news', 'l3', [{ field: 'name', text: 'A2', naturalWidth: 950, maxWidth: 620 }]);
    expect(store.get('news')).toEqual({
      l3: [{ field: 'name', text: 'A2', naturalWidth: 950, maxWidth: 620 }],
      ticker: [{ field: 'headline', text: 'B', naturalWidth: 1000, maxWidth: 800 }],
    });
  });

  it('an empty warnings array clears that render entirely from the map', () => {
    const store = createWarningsStore();
    store.set('news', 'l3', [{ field: 'name', text: 'A', naturalWidth: 900, maxWidth: 620 }]);
    store.set('news', 'l3', []);
    expect(store.get('news')).toEqual({});
  });

  it('clear removes one render even if it was never explicitly emptied', () => {
    const store = createWarningsStore();
    store.set('news', 'l3', [{ field: 'name', text: 'A', naturalWidth: 900, maxWidth: 620 }]);
    store.clear('news', 'l3');
    expect(store.get('news')).toEqual({});
  });

  it('clear on an unknown package/render is a harmless no-op', () => {
    const store = createWarningsStore();
    expect(() => store.clear('nope', 'nope')).not.toThrow();
  });

  it('get for an unknown package returns an empty map, not undefined', () => {
    const store = createWarningsStore();
    expect(store.get('nope')).toEqual({});
  });

  it('warnings for different packages never leak into each other', () => {
    const store = createWarningsStore();
    store.set('news', 'l3', [{ field: 'name', text: 'A', naturalWidth: 900, maxWidth: 620 }]);
    store.set('hoops', 'scorebug', [{ field: 'clock', text: '99:99', naturalWidth: 500, maxWidth: 300 }]);
    expect(store.get('news')).toEqual({ l3: [{ field: 'name', text: 'A', naturalWidth: 900, maxWidth: 620 }] });
    expect(store.get('hoops')).toEqual({ scorebug: [{ field: 'clock', text: '99:99', naturalWidth: 500, maxWidth: 300 }] });
  });
});
