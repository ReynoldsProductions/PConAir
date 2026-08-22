import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createStateStore, type StateStore } from '../src/main/state';
import { createFullServer } from './_test-server';
import { PcoClient, type PcoState, type Transport } from '../packages/companion-module-pconair/src/client';
import { stateToVariables, VARIABLE_DEFINITIONS } from '../packages/companion-module-pconair/src/variables';
import { makeSlidesState } from '../src/shared/types';

const PINS = { operatorPin: '1234', adminPin: 'supersecret' };

function waitFor(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = (): void => {
      if (predicate()) return resolve();
      if (Date.now() - started > timeoutMs) return reject(new Error('timeout waiting for condition'));
      setTimeout(tick, 25);
    };
    tick();
  });
}

describe('PcoClient against a live PConAir server', () => {
  let store: StateStore;
  let srv: ReturnType<typeof createFullServer>;
  let port: number;
  let client: PcoClient | null = null;
  let state: Partial<PcoState>;
  let transport: Transport;
  const transitions: Transport[] = [];

  beforeEach(async () => {
    store = createStateStore();
    srv = createFullServer({ store, ...PINS, port: 0 });
    await srv.listen();
    port = (srv.httpServer.address() as { port: number }).port;
    state = {};
    transport = null;
    transitions.length = 0;
  });

  afterEach(async () => {
    client?.destroy();
    client = null;
    await srv.close();
  });

  function connect(overrides: Partial<{ port: number; pollingIntervalMs: number }> = {}): PcoClient {
    const c = new PcoClient({
      host: '127.0.0.1',
      port: overrides.port ?? port,
      operatorPin: PINS.operatorPin,
      pollingIntervalMs: overrides.pollingIntervalMs ?? 250,
      onAppState: (patch, replace) => {
        state = replace ? patch : { ...state, ...patch };
      },
      onPackageState: () => {},
      onTransportChange: (t) => {
        transport = t;
        transitions.push(t);
      },
      log: () => {},
    });
    c.start();
    return c;
  }

  it('reports the ws transport once the socket is up and pushes a full snapshot', async () => {
    client = connect();
    await waitFor(() => transport === 'ws');
    expect(client.connected).toBe(true);
    expect(state.currentMode).toBe('idle');
    expect(state.abState?.activeInstance).toBe('A');
  });

  it('reports no transport when the host is unreachable', async () => {
    // Port 1 is reserved and never listening — the ws fails, then the poll does.
    client = connect({ port: 1, pollingIntervalMs: 100 });
    await waitFor(() => transitions.length > 0 || transport === null, 3000);
    expect(transport).toBeNull();
    expect(client.connected).toBe(false);
  });

  it('fires onTransportChange only on an actual change', async () => {
    client = connect();
    await waitFor(() => transport === 'ws');
    const seen = transitions.length;
    // Several state pushes must not re-announce the transport.
    store.setState({ currentMode: 'url' });
    store.setState({ currentMode: 'idle' });
    await new Promise((r) => setTimeout(r, 300));
    expect(transitions.length).toBe(seen);
  });

  it('applies state patches over the socket and maps them to variables', async () => {
    client = connect();
    await waitFor(() => transport === 'ws');
    store.setState({
      currentMode: 'slides',
      slides: makeSlidesState({
        deckId: 'd1',
        deckTitle: 'Keynote',
        slideIndex: 2,
        slideCount: 10,
        isLoading: false,
      }),
    });
    await waitFor(() => state.slides?.deckTitle === 'Keynote');
    const v = stateToVariables(state, true, transport);
    expect(v.slide_info).toBe('3 / 10');
    expect(v.is_last_slide).toBe('No');
    expect(v.connection_status).toBe('connected');
    expect(v.transport).toBe('ws');
  });

  it('dispatches an action over the socket', async () => {
    client = connect();
    await waitFor(() => transport === 'ws');
    store.setState({
      currentMode: 'slides',
      slides: makeSlidesState({ deckId: 'd1', deckTitle: 'D', slideIndex: 0, slideCount: 5, isLoading: false }),
    });
    await waitFor(() => state.slides !== null);
    await client.sendAction('slides_next', {});
    await waitFor(() => store.getState().slides?.slideIndex === 1);
    expect(store.getState().slides?.slideIndex).toBe(1);
  });

  it('GET /api/status carries every field the variable mapper reads', async () => {
    client = connect();
    await waitFor(() => transport === 'ws');
    store.setState({
      currentMode: 'slides',
      slides: makeSlidesState({ deckId: 'd1', deckTitle: 'Polled', slideIndex: 1, slideCount: 4, isLoading: false }),
    });
    const body = (await client.httpGet('/api/status')) as Partial<PcoState>;
    const v = stateToVariables(body, true, 'http');
    expect(v.deck_title).toBe('Polled');
    expect(v.slide_info).toBe('2 / 4');
    expect(v.connection_status).toBe('http_fallback');
    expect(v.transport).toBe('http');
    // Nothing the mapper declares may come back undefined from a real payload.
    const undef = Object.entries(v).filter(([, value]) => value === undefined).map(([k]) => k);
    expect(undef).toEqual([]);
  });

  it('declared variables and produced values stay in lockstep on live state', async () => {
    client = connect();
    await waitFor(() => transport === 'ws');
    const values = stateToVariables(state, true, transport);
    const declared = VARIABLE_DEFINITIONS.map((d) => d.variableId).sort();
    const produced = Object.keys(values).sort();
    expect(produced).toEqual(declared);
  });
});
