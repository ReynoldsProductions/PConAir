import type { DirectorOffice } from '../app-settings';
import type { AppState } from '../../shared/types';
import { createOfficeClient, type OfficeClient, type OfficeClientEvents, type OfficeConnectionStatus, type OfficeActionResult } from './office-client';

/**
 * Holds one office-client per configured Director office, keyed by office
 * id. Re-syncs (connects new offices, disconnects removed ones, reconnects
 * on edit) whenever settings change.
 */

export interface OfficeSnapshot {
  officeId: string;
  status: OfficeConnectionStatus;
  state: AppState | null;
}

export interface OfficeManagerEvents {
  onStatus?: (officeId: string, status: OfficeConnectionStatus) => void;
  onState?: (officeId: string, state: AppState) => void;
}

export interface OfficeManager {
  sync(offices: DirectorOffice[]): void;
  fireAction(officeId: string, actionId: string, params?: Record<string, unknown>): Promise<OfficeActionResult>;
  getSnapshot(officeId: string): OfficeSnapshot | null;
  listSnapshots(): OfficeSnapshot[];
  stopAll(): void;
}

type ClientFactory = (office: DirectorOffice, events: OfficeClientEvents) => OfficeClient;

function officeChanged(a: DirectorOffice, b: DirectorOffice): boolean {
  return a.baseUrl !== b.baseUrl || a.operatorPin !== b.operatorPin || a.name !== b.name;
}

export function createOfficeManager(
  events: OfficeManagerEvents = {},
  clientFactory: ClientFactory = createOfficeClient
): OfficeManager {
  const clients = new Map<string, OfficeClient>();
  const offices = new Map<string, DirectorOffice>();
  const statuses = new Map<string, OfficeConnectionStatus>();
  const states = new Map<string, AppState | null>();

  function removeOffice(id: string): void {
    clients.get(id)?.stop();
    clients.delete(id);
    offices.delete(id);
    statuses.delete(id);
    states.delete(id);
  }

  function addOffice(office: DirectorOffice): void {
    const client = clientFactory(office, {
      onStatus: (status) => {
        statuses.set(office.id, status);
        events.onStatus?.(office.id, status);
      },
      onState: (state) => {
        states.set(office.id, state);
        events.onState?.(office.id, state);
      },
      onStatePatch: (patch) => {
        const prev = states.get(office.id) ?? null;
        if (!prev) return;
        const next: AppState = { ...prev, ...patch };
        states.set(office.id, next);
        events.onState?.(office.id, next);
      },
    });
    clients.set(office.id, client);
    offices.set(office.id, office);
    statuses.set(office.id, 'offline');
    states.set(office.id, null);
    client.start();
  }

  function sync(nextOffices: DirectorOffice[]): void {
    const nextIds = new Set(nextOffices.map((o) => o.id));
    for (const id of Array.from(offices.keys())) {
      if (!nextIds.has(id)) removeOffice(id);
    }
    for (const office of nextOffices) {
      const existing = offices.get(office.id);
      if (!existing) {
        addOffice(office);
        continue;
      }
      if (officeChanged(existing, office)) {
        removeOffice(office.id);
        addOffice(office);
      }
    }
  }

  return {
    sync,
    async fireAction(officeId, actionId, params = {}) {
      const client = clients.get(officeId);
      if (!client) {
        return { ok: false, status: 404, error: { code: 'ITEM_NOT_FOUND', message: `Unknown office '${officeId}'` } };
      }
      return client.fireAction(actionId, params);
    },
    getSnapshot(officeId) {
      if (!offices.has(officeId)) return null;
      return { officeId, status: statuses.get(officeId) ?? 'offline', state: states.get(officeId) ?? null };
    },
    listSnapshots() {
      return Array.from(offices.keys()).map((id) => ({
        officeId: id,
        status: statuses.get(id) ?? 'offline',
        state: states.get(id) ?? null,
      }));
    },
    stopAll() {
      for (const id of Array.from(offices.keys())) removeOffice(id);
    },
  };
}
