import type { StateStore } from './state';
import type { AuthManager } from './auth';
import type { PresetsStore } from './presets';
import type { L3CueStore } from './l3/cue-store';
import type { Mode } from '../shared/types';
import { slideNextOp, slidePrevOp, slideGotoOp, slideReloadOp, slideLoadOp } from './services/slide-ops';
import { urlLoadOp, urlReloadOp } from './services/url-ops';
import { l3ClearOp, l3StackingOp, l3TakeOp } from './l3/take-ops';

export type ActionResult =
  | { ok: true; body: unknown }
  | { ok: false; status: number; error: { code: string; message: string } };

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

export function createActionDispatcher(deps: {
  store: StateStore;
  auth: AuthManager;
  presets: PresetsStore;
  cues: L3CueStore;
}) {
  const { store, presets, cues } = deps;

  return async function executeAction(actionId: string, params: Record<string, unknown>): Promise<ActionResult> {
    const p = params ?? {};

    switch (actionId) {
      case 'slides_next': {
        const r = slideNextOp(store);
        return r.ok ? { ok: true, body: r.body } : { ok: false, status: r.status, error: r.error };
      }
      case 'slides_prev': {
        const r = slidePrevOp(store);
        return r.ok ? { ok: true, body: r.body } : { ok: false, status: r.status, error: r.error };
      }
      case 'slides_goto': {
        const n = p.slide_number;
        if (typeof n !== 'number' || !Number.isInteger(n) || n < 1) {
          return { ok: false, status: 400, error: { code: 'INVALID_MODE', message: 'slide_number must be a positive integer' } };
        }
        const r = slideGotoOp(store, n - 1);
        return r.ok ? { ok: true, body: r.body } : { ok: false, status: r.status, error: r.error };
      }
      case 'slides_reload': {
        const r = slideReloadOp(store);
        return r.ok ? { ok: true, body: r.body } : { ok: false, status: r.status, error: r.error };
      }
      case 'slides_load': {
        const deckUrl = str(p.deck_url);
        if (!deckUrl) {
          return { ok: false, status: 400, error: { code: 'INVALID_MODE', message: 'deck_url is required' } };
        }
        const r = slideLoadOp(store, deckUrl);
        return r.ok ? { ok: true, body: r.body } : { ok: false, status: r.status, error: r.error };
      }
      case 'url_switch_ab':
      case 'slides_switch_ab':
      case 'ab_switch': {
        const state = store.getState();
        const next = state.abState.activeInstance === 'A' ? 'B' : 'A';
        store.setState({ abState: { ...state.abState, activeInstance: next } });
        return { ok: true, body: { abState: { activeInstance: next } } };
      }
      case 'load_url': {
        const url = str(p.url);
        if (!url) {
          return { ok: false, status: 400, error: { code: 'INVALID_MODE', message: 'url is required' } };
        }
        const display = str(p.display);
        const r = urlLoadOp(store, url, display);
        return r.ok ? { ok: true, body: r.body } : { ok: false, status: r.status, error: r.error };
      }
      case 'load_url_preset': {
        const name = str(p.preset);
        if (!name) {
          return { ok: false, status: 400, error: { code: 'INVALID_MODE', message: 'preset is required' } };
        }
        const list = presets.list();
        const found = list.find((x) => x.name === name) ?? list.find((x) => x.id === name);
        if (!found) {
          return { ok: false, status: 404, error: { code: 'PRESET_NOT_FOUND', message: `Preset '${name}' not found` } };
        }
        const display = str(p.display) ?? found.displayTarget ?? undefined;
        const r = urlLoadOp(store, found.url, display ?? undefined);
        if (!r.ok) return { ok: false, status: r.status, error: r.error };
        store.setState({ currentPreset: { id: found.id, name: found.name } });
        const s = store.getState();
        return {
          ok: true,
          body: {
            currentMode: s.currentMode,
            currentUrl: s.currentUrl,
            currentPreset: s.currentPreset,
            abState: s.abState,
          },
        };
      }
      case 'reload_url': {
        const r = urlReloadOp(store);
        return r.ok ? { ok: true, body: r.body } : { ok: false, status: r.status, error: r.error };
      }
      case 'reload_url_offair': {
        const inst = str(p.instance);
        const r = urlReloadOp(store, inst === 'A' || inst === 'B' ? inst : undefined);
        return r.ok ? { ok: true, body: r.body } : { ok: false, status: r.status, error: r.error };
      }
      case 'url_switch_to': {
        const instance = str(p.instance);
        if (instance !== 'A' && instance !== 'B') {
          return { ok: false, status: 400, error: { code: 'INVALID_MODE', message: 'instance must be A or B' } };
        }
        const state = store.getState();
        store.setState({ abState: { ...state.abState, activeInstance: instance } });
        return { ok: true, body: { abState: { activeInstance: instance } } };
      }
      case 'set_mode': {
        const mode = str(p.mode) as Mode | undefined;
        const allowed: Mode[] = ['slides', 'url', 'l3', 'media-library', 'idle'];
        if (!mode || !allowed.includes(mode)) {
          return { ok: false, status: 400, error: { code: 'INVALID_MODE', message: `mode must be one of: ${allowed.join(', ')}` } };
        }
        store.setState({ currentMode: mode });
        return { ok: true, body: { currentMode: mode } };
      }
      case 'set_display': {
        const display = str(p.display);
        const instance = str(p.instance);
        if (!display) {
          return { ok: false, status: 400, error: { code: 'MISSING_PARAM', message: 'display is required' } };
        }
        if (instance !== 'A' && instance !== 'B') {
          return { ok: false, status: 400, error: { code: 'INVALID_INSTANCE', message: 'instance must be "A" or "B"' } };
        }
        const knownDisplays = store.getState().displays;
        if (!knownDisplays.find((d) => d.id === display)) {
          return { ok: false, status: 404, error: { code: 'DISPLAY_NOT_FOUND', message: `Display "${display}" not found` } };
        }
        const instKey = instance === 'A' ? 'instanceA' : 'instanceB';
        const current = store.getState().abState;
        store.setState({
          abState: {
            ...current,
            [instKey]: { ...current[instKey], displayTarget: display },
          },
        });
        return { ok: true, body: { displayTarget: display, instance } };
      }
      case 'l3_take': {
        const cueId = str(p.cue_id) ?? str(p.cueId);
        const name = str(p.name);
        const title = str(p.title);
        const theme = str(p.theme);
        const r = l3TakeOp(store, cues, { cueId, name, title, theme });
        return r.ok ? { ok: true, body: r.body } : { ok: false, status: r.status, error: r.error };
      }
      case 'l3_clear': {
        const r = l3ClearOp(store);
        return { ok: true, body: r.body };
      }
      case 'l3_stacking_on': {
        const r = l3StackingOp(store, true);
        return r.ok ? { ok: true, body: r.body } : { ok: false, status: r.status, error: r.error };
      }
      case 'l3_stacking_off': {
        const r = l3StackingOp(store, false);
        return r.ok ? { ok: true, body: r.body } : { ok: false, status: r.status, error: r.error };
      }
      default:
        return {
          ok: false,
          status: 400,
          error: { code: 'INVALID_MODE', message: `Unknown action_id: ${actionId}` },
        };
    }
  };
}

export type ActionDispatcher = ReturnType<typeof createActionDispatcher>;
