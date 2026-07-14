import { describe, it, expect, vi } from 'vitest';
import { createOfficeManager } from '../src/main/director/office-manager';
import type { OfficeClient, OfficeClientEvents, OfficeConnectionStatus } from '../src/main/director/office-client';
import type { DirectorOffice } from '../src/main/app-settings';
import type { AppState } from '../src/shared/types';

function makeOffice(overrides: Partial<DirectorOffice> = {}): DirectorOffice {
  return { id: 'o1', name: 'Nashville', baseUrl: 'http://127.0.0.1:9000', operatorPin: '1234', ...overrides };
}

interface FakeClientHandle {
  client: OfficeClient;
  events: OfficeClientEvents;
  started: boolean;
  stopped: boolean;
  fireAction: ReturnType<typeof vi.fn>;
}

function makeFakeFactory() {
  const created: FakeClientHandle[] = [];
  const factory = (office: DirectorOffice, events: OfficeClientEvents): OfficeClient => {
    const handle: FakeClientHandle = {
      events,
      started: false,
      stopped: false,
      fireAction: vi.fn().mockResolvedValue({ ok: true, body: { office: office.id } }),
      client: null as unknown as OfficeClient,
    };
    handle.client = {
      start: () => { handle.started = true; },
      stop: () => { handle.stopped = true; },
      getStatus: (): OfficeConnectionStatus => 'offline',
      fireAction: handle.fireAction,
    };
    created.push(handle);
    return handle.client;
  };
  return { factory, created };
}

describe('createOfficeManager', () => {
  it('creates and starts a client for each configured office', () => {
    const { factory, created } = makeFakeFactory();
    const manager = createOfficeManager({}, factory);

    manager.sync([makeOffice({ id: 'a' }), makeOffice({ id: 'b' })]);

    expect(created).toHaveLength(2);
    expect(created.every((h) => h.started)).toBe(true);
  });

  it('stops and removes clients for offices no longer present', () => {
    const { factory, created } = makeFakeFactory();
    const manager = createOfficeManager({}, factory);

    manager.sync([makeOffice({ id: 'a' }), makeOffice({ id: 'b' })]);
    manager.sync([makeOffice({ id: 'a' })]);

    expect(created[1].stopped).toBe(true);
    expect(manager.getSnapshot('b')).toBeNull();
    expect(manager.getSnapshot('a')).not.toBeNull();
  });

  it('reconnects (stop + new client) when an office is edited', () => {
    const { factory, created } = makeFakeFactory();
    const manager = createOfficeManager({}, factory);

    manager.sync([makeOffice({ id: 'a', baseUrl: 'http://127.0.0.1:9000' })]);
    expect(created).toHaveLength(1);

    manager.sync([makeOffice({ id: 'a', baseUrl: 'http://127.0.0.1:9999' })]);
    expect(created).toHaveLength(2);
    expect(created[0].stopped).toBe(true);
    expect(created[1].started).toBe(true);
  });

  it('does not recreate a client when the office is unchanged', () => {
    const { factory, created } = makeFakeFactory();
    const manager = createOfficeManager({}, factory);

    manager.sync([makeOffice({ id: 'a' })]);
    manager.sync([makeOffice({ id: 'a' })]);

    expect(created).toHaveLength(1);
    expect(created[0].stopped).toBe(false);
  });

  it('propagates status and state events with the office id', () => {
    const { factory, created } = makeFakeFactory();
    const statusEvents: Array<[string, OfficeConnectionStatus]> = [];
    const stateEvents: Array<[string, AppState]> = [];
    const manager = createOfficeManager(
      {
        onStatus: (id, status) => statusEvents.push([id, status]),
        onState: (id, state) => stateEvents.push([id, state]),
      },
      factory
    );

    manager.sync([makeOffice({ id: 'a' })]);
    const handle = created[0];

    handle.events.onStatus?.('online');
    expect(statusEvents).toEqual([['a', 'online']]);
    expect(manager.getSnapshot('a')?.status).toBe('online');

    const state = { currentMode: 'l3' } as AppState;
    handle.events.onState?.(state);
    expect(stateEvents).toEqual([['a', state]]);
    expect(manager.getSnapshot('a')?.state).toBe(state);
  });

  it('merges state_patch events onto the last known full state', () => {
    const { factory, created } = makeFakeFactory();
    const manager = createOfficeManager({}, factory);
    manager.sync([makeOffice({ id: 'a' })]);
    const handle = created[0];

    // No full state yet — a patch alone is ignored (nothing to merge onto).
    handle.events.onStatePatch?.({ currentMode: 'idle' });
    expect(manager.getSnapshot('a')?.state).toBeNull();

    const state = { currentMode: 'l3', currentUrl: null } as AppState;
    handle.events.onState?.(state);
    handle.events.onStatePatch?.({ currentMode: 'idle' });

    expect(manager.getSnapshot('a')?.state).toEqual({ currentMode: 'idle', currentUrl: null });
  });

  it('fireAction delegates to the matching client', async () => {
    const { factory, created } = makeFakeFactory();
    const manager = createOfficeManager({}, factory);
    manager.sync([makeOffice({ id: 'a' })]);

    const result = await manager.fireAction('a', 'lower_third_hide', {});
    expect(created[0].fireAction).toHaveBeenCalledWith('lower_third_hide', {});
    expect(result).toEqual({ ok: true, body: { office: 'a' } });
  });

  it('fireAction returns ITEM_NOT_FOUND for an unknown office', async () => {
    const { factory } = makeFakeFactory();
    const manager = createOfficeManager({}, factory);
    manager.sync([makeOffice({ id: 'a' })]);

    const result = await manager.fireAction('unknown', 'lower_third_hide');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('ITEM_NOT_FOUND');
  });

  it('stopAll stops every client and clears snapshots', () => {
    const { factory, created } = makeFakeFactory();
    const manager = createOfficeManager({}, factory);
    manager.sync([makeOffice({ id: 'a' }), makeOffice({ id: 'b' })]);

    manager.stopAll();

    expect(created.every((h) => h.stopped)).toBe(true);
    expect(manager.listSnapshots()).toEqual([]);
  });
});
