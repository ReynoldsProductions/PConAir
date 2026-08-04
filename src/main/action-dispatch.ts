import type { StateStore } from './state';
import type { AuthManager } from './auth';
import type { PresetsStore } from './presets';
import type { L3CueStore } from './l3/cue-store';
import type { L3PlaylistStore } from './l3/playlist-store';
import type { MediaLibraryStore } from './media-library/item-store';
import type { SlideshowEngine } from './media-library/slideshow';
import type { SlidesWindowManager } from './slides/window-manager';
import type { Mode, SlideshowTransition, ScoreboardState, LowerThirdState, LowerThirdTheme, LowerThirdAnimationStyle } from '../shared/types';
import { slideNextOp, slidePrevOp, slideGotoOp, slideReloadOp, slideLoadOp, slideOfflineModeOp } from './services/slide-ops';
import { urlLoadOp, urlReloadOp, setDisplayTargetOp } from './services/url-ops';
import { fanOutSlideCommand } from './services/backup-fanout';
import type { AppSettings } from './app-settings';
import { l3ClearOp, l3StackingOp, l3TakeOp } from './l3/take-ops';
import { playlistActivateOp, playlistStepOp } from './l3/playlist-ops';
import { stillsTakeOp, stillsClearOp } from './media-library/stills-ops';

const LOWER_THIRD_THEMES: LowerThirdTheme[] = [
  'default', 'dark', 'dark_alt',
  'bright', 'bright_insider', 'bright_warm', 'bright_info',
  'palette_olive', 'palette_teal', 'palette_terracotta',
  'palette_plum', 'palette_copper', 'palette_sage',
];

const DEFAULT_SCOREBOARD: ScoreboardState = {
  teamA: 'HME',
  teamB: 'AWY',
  scoreA: 0,
  scoreB: 0,
  quarter: 'Q1',
  gameClock: '12:00',
  gameClockRunning: false,
  shotClock: 24,
  shotClockRunning: false,
  possession: null,
  foulsA: 0,
  foulsB: 0,
  timeoutsA: 7,
  timeoutsB: 7,
};

export type ActionResult =
  | { ok: true; body: unknown }
  | { ok: false; status: number; error: { code: string; message: string } };

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function bool(v: unknown): boolean | undefined {
  return typeof v === 'boolean' ? v : undefined;
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

const LOWER_THIRD_ANIMATION_STYLES: LowerThirdAnimationStyle[] = [
  'fade', 'wipe', 'grow', 'slide-up', 'slide-down', 'zoom', 'flip',
];
const LOWER_THIRD_FADE_MS_MIN = 0;
// The operator UI's slider tops out at 5000ms, but the paired number input
// allows typing a larger custom value — this is the server-side ceiling for
// that, not the slider's suggested range.
const LOWER_THIRD_FADE_MS_MAX = 60000;
const LOWER_THIRD_DEFAULT_FADE_MS = 550;

export function createActionDispatcher(deps: {
  store: StateStore;
  auth: AuthManager;
  presets: PresetsStore;
  cues: L3CueStore;
  /** L3 playlist store — enables l3_next / l3_prev / l3_activate_playlist. */
  playlists?: L3PlaylistStore;
  /** Media library — enables stills_take / stills_clear / slideshow actions. */
  media?: MediaLibraryStore;
  /** Slideshow engine — must be the same instance the media-library router uses. */
  slideshow?: SlideshowEngine;
  /** Slides window manager — enables notes scroll/zoom actions. */
  windowManager?: SlidesWindowManager;
  /** Returns the active teleprompter base URL (empty string when not configured). */
  getTeleprompterHost?: () => string;
  /** Returns whether teleprompter proxy is enabled. */
  isTeleprompterEnabled?: () => boolean;
  /** Returns the current backup fan-out settings (primary mode only). */
  getBackupSettings?: () => { operationMode: AppSettings['operationMode']; backupIps: string[]; port: number };
}) {
  const { store, presets, cues, playlists, media, slideshow, windowManager, getTeleprompterHost, isTeleprompterEnabled, getBackupSettings } = deps;

  const reloadTimers = new Map<'A' | 'B', ReturnType<typeof setTimeout>>();

  /** POST a state patch to the teleprompter host and mirror it into the store. */
  async function teleprompterPatch(patch: Record<string, unknown>): Promise<ActionResult> {
    const host = getTeleprompterHost?.() ?? '';
    if (!isTeleprompterEnabled?.() || !host) return { ok: true, body: { skipped: true } };
    const tp = store.getState().teleprompter;
    try {
      await fetch(`${host}/api/state`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
        signal: AbortSignal.timeout(3000),
      });
      const stateUpdate: Record<string, unknown> = {};
      if ('scrolling' in patch) stateUpdate['scrolling'] = patch['scrolling'];
      if ('speed' in patch) stateUpdate['speed'] = patch['speed'];
      if ('font_size' in patch) stateUpdate['fontSize'] = patch['font_size'];
      store.setState({ teleprompter: { ...tp, ...stateUpdate } });
    } catch { /* fire-and-forget from Companion; log nothing */ }
    return { ok: true, body: {} };
  }

  function fanOut(endpoint: string, body: Record<string, unknown>): void {
    if (!getBackupSettings) return;
    const { operationMode, backupIps, port } = getBackupSettings();
    if (operationMode !== 'primary' || backupIps.length === 0) return;
    void fanOutSlideCommand(backupIps, port, endpoint, body, (msg) => console.warn(msg));
  }

  function unavailable(what: string): ActionResult {
    return { ok: false, status: 501, error: { code: 'INVALID_MODE', message: `${what} is not available on this server` } };
  }

  return async function executeAction(actionId: string, params: Record<string, unknown>): Promise<ActionResult> {
    const p = params ?? {};

    switch (actionId) {
      case 'slides_next': {
        const r = slideNextOp(store);
        if (r.ok) fanOut('/api/next-slide', {});
        return r.ok ? { ok: true, body: r.body } : { ok: false, status: r.status, error: r.error };
      }
      case 'slides_prev': {
        const r = slidePrevOp(store);
        if (r.ok) fanOut('/api/previous-slide', {});
        return r.ok ? { ok: true, body: r.body } : { ok: false, status: r.status, error: r.error };
      }
      case 'slides_goto': {
        const n = p.slide_number;
        if (typeof n !== 'number' || !Number.isInteger(n) || n < 1) {
          return { ok: false, status: 400, error: { code: 'INVALID_MODE', message: 'slide_number must be a positive integer' } };
        }
        const r = slideGotoOp(store, n - 1);
        if (r.ok) fanOut('/api/go-to-slide', { slide: n });
        return r.ok ? { ok: true, body: r.body } : { ok: false, status: r.status, error: r.error };
      }
      case 'slides_reload': {
        const r = slideReloadOp(store);
        if (r.ok) fanOut('/api/reload-presentation', {});
        return r.ok ? { ok: true, body: r.body } : { ok: false, status: r.status, error: r.error };
      }
      case 'slides_load': {
        const deckUrl = str(p.deck_url);
        if (!deckUrl) {
          return { ok: false, status: 400, error: { code: 'INVALID_MODE', message: 'deck_url is required' } };
        }
        const inst = str(p.instance);
        const r = slideLoadOp(store, deckUrl, inst === 'A' || inst === 'B' ? inst : undefined, str(p.backup_url));
        if (r.ok) fanOut('/api/open-presentation', { url: deckUrl });
        return r.ok ? { ok: true, body: r.body } : { ok: false, status: r.status, error: r.error };
      }
      case 'slides_goto_first': {
        const r = slideGotoOp(store, 0);
        return r.ok ? { ok: true, body: r.body } : { ok: false, status: r.status, error: r.error };
      }
      case 'slides_goto_last': {
        const slides = store.getState().slides;
        if (!slides || slides.slideCount < 1) {
          return { ok: false, status: 409, error: { code: 'NO_ACTIVE_DECK', message: 'No deck is loaded' } };
        }
        const r = slideGotoOp(store, slides.slideCount - 1);
        return r.ok ? { ok: true, body: r.body } : { ok: false, status: r.status, error: r.error };
      }
      case 'slides_offline_mode': {
        // enabled omitted = toggle (Companion "toggle offline mode" button).
        const enabled = typeof p.enabled === 'boolean' ? p.enabled : !(store.getState().slides?.offlineMode ?? false);
        const r = slideOfflineModeOp(store, enabled);
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
        const inst = str(p.instance);
        const target = inst === 'A' || inst === 'B' ? inst : undefined;
        const r = setDisplayTargetOp(store, display, target);
        return r.ok ? { ok: true, body: r.body } : { ok: false, status: r.status, error: r.error };
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
      case 'l3_toggle_stacking': {
        const r = l3StackingOp(store, !(store.getState().l3?.isStacking ?? false));
        return r.ok ? { ok: true, body: r.body } : { ok: false, status: r.status, error: r.error };
      }
      case 'l3_next':
      case 'l3_prev': {
        if (!playlists) return unavailable('Playlist stepping');
        const r = playlistStepOp(store, playlists, cues, actionId === 'l3_next' ? 1 : -1);
        return r.ok ? { ok: true, body: r.body } : { ok: false, status: r.status, error: r.error };
      }
      case 'l3_activate_playlist': {
        if (!playlists) return unavailable('Playlist activation');
        const idOrName = str(p.playlist) ?? str(p.playlist_id);
        if (!idOrName) {
          return { ok: false, status: 400, error: { code: 'INVALID_MODE', message: 'playlist (id or name) is required' } };
        }
        const r = playlistActivateOp(store, playlists, idOrName);
        return r.ok ? { ok: true, body: r.body } : { ok: false, status: r.status, error: r.error };
      }
      case 'stills_take': {
        if (!media) return unavailable('Still store');
        const idOrName = str(p.item) ?? str(p.item_id);
        if (!idOrName) {
          return { ok: false, status: 400, error: { code: 'INVALID_MODE', message: 'item (id or name) is required' } };
        }
        const r = stillsTakeOp(store, media, idOrName);
        return r.ok ? { ok: true, body: r.body } : { ok: false, status: r.status, error: r.error };
      }
      case 'stills_clear': {
        return { ok: true, body: stillsClearOp(store).body };
      }
      case 'stills_slideshow_play': {
        if (!slideshow || !media) return unavailable('Slideshow');
        const show = store.getState().mediaLibrary?.slideshow ?? null;
        const requestedIds = Array.isArray(p.item_ids)
          ? (p.item_ids as unknown[]).filter((x): x is string => typeof x === 'string')
          : [];
        // No items given: resume a paused show, else restart the loaded list,
        // else play the whole library in upload order.
        if (requestedIds.length === 0 && show?.running && show.paused) {
          slideshow.resume();
          return { ok: true, body: { mediaLibrary: store.getState().mediaLibrary } };
        }
        const itemIds =
          requestedIds.length > 0
            ? requestedIds
            : show?.itemIds.length
              ? show.itemIds
              : media
                  .list() // newest-first; re-sort ascending for upload order
                  .slice()
                  .sort((x, y) => x.uploadedAt - y.uploadedAt)
                  .map((it) => it.id);
        const intervalSec =
          typeof p.interval_sec === 'number' && p.interval_sec >= 1 ? p.interval_sec : show?.intervalSec ?? 5;
        const transition: SlideshowTransition = p.transition === 'fade' ? 'fade' : p.transition === 'cut' ? 'cut' : show?.transition ?? 'cut';
        const r = slideshow.play({ itemIds, intervalSec, transition });
        if (!r.ok) {
          return { ok: false, status: 400, error: { code: 'ITEM_NOT_FOUND', message: r.error } };
        }
        return { ok: true, body: { mediaLibrary: store.getState().mediaLibrary } };
      }
      case 'stills_slideshow_pause': {
        if (!slideshow) return unavailable('Slideshow');
        if (!slideshow.pause()) {
          return { ok: false, status: 400, error: { code: 'INVALID_MODE', message: 'No slideshow running' } };
        }
        return { ok: true, body: { mediaLibrary: store.getState().mediaLibrary } };
      }
      case 'stills_slideshow_resume': {
        if (!slideshow) return unavailable('Slideshow');
        if (!slideshow.resume()) {
          return { ok: false, status: 400, error: { code: 'INVALID_MODE', message: 'No slideshow running' } };
        }
        return { ok: true, body: { mediaLibrary: store.getState().mediaLibrary } };
      }
      case 'stills_slideshow_stop': {
        if (!slideshow) return unavailable('Slideshow');
        slideshow.stop();
        return { ok: true, body: { mediaLibrary: store.getState().mediaLibrary } };
      }
      case 'stills_slideshow_next':
      case 'stills_slideshow_prev': {
        if (!slideshow) return unavailable('Slideshow');
        const moved = actionId === 'stills_slideshow_next' ? slideshow.next() : slideshow.prev();
        if (!moved) {
          return { ok: false, status: 400, error: { code: 'INVALID_MODE', message: 'No slideshow loaded' } };
        }
        return { ok: true, body: { mediaLibrary: store.getState().mediaLibrary } };
      }
      case 'slides_notes_scroll_up': {
        windowManager?.scrollNotesUp();
        return { ok: true, body: {} };
      }
      case 'slides_notes_scroll_down': {
        windowManager?.scrollNotesDown();
        return { ok: true, body: {} };
      }
      case 'slides_notes_zoom_in': {
        windowManager?.zoomInNotes();
        return { ok: true, body: {} };
      }
      case 'slides_notes_zoom_out': {
        windowManager?.zoomOutNotes();
        return { ok: true, body: {} };
      }
      case 'teleprompter_start':
      case 'teleprompter_stop':
      case 'teleprompter_scroll_faster':
      case 'teleprompter_scroll_slower':
      case 'teleprompter_font_size_in':
      case 'teleprompter_font_size_out': {
        const tp = store.getState().teleprompter;
        let patch: Record<string, unknown> = {};
        if (actionId === 'teleprompter_start') patch = { scrolling: true };
        else if (actionId === 'teleprompter_stop') patch = { scrolling: false };
        else if (actionId === 'teleprompter_scroll_faster') patch = { speed: Math.min(200, tp.speed + 10) };
        else if (actionId === 'teleprompter_scroll_slower') patch = { speed: Math.max(0, tp.speed - 10) };
        else if (actionId === 'teleprompter_font_size_in') patch = { font_size: Math.min(200, tp.fontSize + 4) };
        else patch = { font_size: Math.max(24, tp.fontSize - 4) };
        return teleprompterPatch(patch);
      }
      case 'teleprompter_set_speed': {
        const speed = num(p.speed);
        if (speed === undefined) {
          return { ok: false, status: 400, error: { code: 'INVALID_MODE', message: 'speed must be a number' } };
        }
        return teleprompterPatch({ speed: Math.min(200, Math.max(0, Math.round(speed))) });
      }
      case 'teleprompter_set_font_size': {
        const fontSize = num(p.font_size) ?? num(p.fontSize);
        if (fontSize === undefined) {
          return { ok: false, status: 400, error: { code: 'INVALID_MODE', message: 'font_size must be a number' } };
        }
        return teleprompterPatch({ font_size: Math.min(200, Math.max(24, Math.round(fontSize))) });
      }
      case 'teleprompter_load_script': {
        const text = str(p.text) ?? str(p.script);
        if (text === undefined) {
          return { ok: false, status: 400, error: { code: 'INVALID_MODE', message: 'text is required' } };
        }
        return teleprompterPatch({ script: text });
      }
      case 'teleprompter_toggle': {
        return teleprompterPatch({ scrolling: !store.getState().teleprompter.scrolling });
      }
      case 'panic': {
        const action = str(p.action) ?? 'toggle';
        if (action !== 'toggle' && action !== 'on' && action !== 'off') {
          return { ok: false, status: 400, error: { code: 'INVALID_MODE', message: 'action must be "toggle", "on", or "off"' } };
        }
        const rel = store.getState().reliability;
        const next = action === 'toggle' ? !rel.panicActive : action === 'on';
        store.setState({ reliability: { panicActive: next, panicSlate: rel.panicSlate } });
        return {
          ok: true,
          body: {
            panicActive: next,
            message: next ? 'Panic activated — output hidden' : 'Panic cleared — output restored',
          },
        };
      }
      case 'reload_instance': {
        const instance = str(p.instance);
        if (instance !== 'A' && instance !== 'B') {
          return { ok: false, status: 400, error: { code: 'INVALID_MODE', message: 'instance must be "A" or "B"' } };
        }
        const state = store.getState();
        if (instance === state.abState.activeInstance) {
          return {
            ok: false,
            status: 400,
            error: { code: 'INVALID_INSTANCE', message: 'Cannot reload on-air instance; use off-air instance for safe reload.' },
          };
        }
        const key = instance === 'A' ? 'instanceA' : 'instanceB';
        const prevT = reloadTimers.get(instance);
        if (prevT) clearTimeout(prevT);
        store.setState({
          abState: { ...state.abState, [key]: { ...state.abState[key], isLoading: true, isReady: false } },
        });
        /** Simulated async completion, matching POST /api/reload-instance. */
        const delayMs = 50;
        const t = setTimeout(() => {
          const s = store.getState();
          store.setState({
            abState: { ...s.abState, [key]: { ...s.abState[key], isLoading: false, isReady: true } },
          });
          reloadTimers.delete(instance);
        }, delayMs);
        reloadTimers.set(instance, t);
        return { ok: true, body: { status: 'reloading', instance } };
      }
      case 'graphics_scoreboard_set': {
        const existing = store.getState().graphics?.scoreboard ?? { ...DEFAULT_SCOREBOARD };
        const patch: Partial<ScoreboardState> = {};
        if (typeof p.teamA === 'string') patch.teamA = p.teamA;
        if (typeof p.teamB === 'string') patch.teamB = p.teamB;
        if (typeof p.scoreA === 'number') patch.scoreA = p.scoreA;
        if (typeof p.scoreB === 'number') patch.scoreB = p.scoreB;
        if (typeof p.quarter === 'string') patch.quarter = p.quarter;
        if (typeof p.gameClock === 'string') patch.gameClock = p.gameClock;
        if (typeof p.gameClockRunning === 'boolean') patch.gameClockRunning = p.gameClockRunning;
        if (typeof p.shotClock === 'number') patch.shotClock = p.shotClock;
        if (typeof p.shotClockRunning === 'boolean') patch.shotClockRunning = p.shotClockRunning;
        if (p.possession === 'a' || p.possession === 'b' || p.possession === null) patch.possession = p.possession;
        if (typeof p.foulsA === 'number') patch.foulsA = p.foulsA;
        if (typeof p.foulsB === 'number') patch.foulsB = p.foulsB;
        if (typeof p.timeoutsA === 'number') patch.timeoutsA = p.timeoutsA;
        if (typeof p.timeoutsB === 'number') patch.timeoutsB = p.timeoutsB;
        const scoreboard: ScoreboardState = { ...existing, ...patch };
        store.setState({ graphics: { ...store.getState().graphics, scoreboard } });
        return { ok: true, body: { graphics: { scoreboard } } };
      }
      case 'graphics_score_bump': {
        const team = p.team;
        const delta = p.delta;
        if (team !== 'a' && team !== 'b') {
          return { ok: false, status: 400, error: { code: 'INVALID_MODE', message: 'team must be "a" or "b"' } };
        }
        if (typeof delta !== 'number' || !Number.isInteger(delta)) {
          return { ok: false, status: 400, error: { code: 'INVALID_MODE', message: 'delta must be an integer' } };
        }
        const existing = store.getState().graphics?.scoreboard ?? { ...DEFAULT_SCOREBOARD };
        const scoreboard: ScoreboardState = { ...existing };
        if (team === 'a') {
          scoreboard.scoreA = Math.max(0, existing.scoreA + delta);
        } else {
          scoreboard.scoreB = Math.max(0, existing.scoreB + delta);
        }
        store.setState({ graphics: { ...store.getState().graphics, scoreboard } });
        return { ok: true, body: { graphics: { scoreboard } } };
      }
      case 'lower_third_apply': {
        const existing = store.getState().graphics?.lowerThird ?? null;
        const cueId = str(p.cue_id) ?? str(p.cueId);
        let name = str(p.name);
        let title = str(p.title);
        let subtitle = str(p.subtitle);

        if (cueId) {
          const cue = cues.findById(cueId); // read-only — never writes back to the cue store, state.l3, or currentMode
          if (!cue) {
            return { ok: false, status: 404, error: { code: 'CUE_NOT_FOUND', message: `Cue '${cueId}' not found` } };
          }
          name = name ?? cue.name;
          title = title ?? cue.title;
          // Only prefill from the cue when the caller omitted subtitle entirely
          // (e.g. a bare {cueId} call) — an explicit '' means "no subtitle" and
          // must not be overridden, otherwise it can never be cleared.
          if (subtitle === undefined) subtitle = cue.subtitle ?? undefined;
        }

        if (!name || !name.trim()) {
          return { ok: false, status: 400, error: { code: 'INVALID_MODE', message: 'name is required' } };
        }

        const themeRaw = str(p.theme);
        const theme: LowerThirdTheme = (themeRaw && (LOWER_THIRD_THEMES as string[]).includes(themeRaw))
          ? (themeRaw as LowerThirdTheme)
          : (existing?.theme ?? 'default');

        const animationStyleRaw = str(p.animationStyle) ?? str(p.animation_style);
        const animationStyle: LowerThirdAnimationStyle =
          (animationStyleRaw && (LOWER_THIRD_ANIMATION_STYLES as string[]).includes(animationStyleRaw))
            ? (animationStyleRaw as LowerThirdAnimationStyle)
            : (existing?.animationStyle ?? 'fade');

        const fadeEnabled = bool(p.fadeEnabled) ?? bool(p.fade_enabled) ?? existing?.fadeEnabled ?? true;

        const fadeMsRaw = num(p.fadeMs) ?? num(p.fade_ms);
        const fadeMs = fadeMsRaw !== undefined
          ? Math.min(LOWER_THIRD_FADE_MS_MAX, Math.max(LOWER_THIRD_FADE_MS_MIN, Math.round(fadeMsRaw)))
          : (existing?.fadeMs ?? LOWER_THIRD_DEFAULT_FADE_MS);

        const lowerThird: LowerThirdState = {
          visible: true,
          name: name.trim(),
          title: (title ?? existing?.title ?? '').trim(),
          // subtitle !== undefined means the caller explicitly specified it (even
          // as '' to clear it) — that's authoritative. Only truly omitting the
          // field falls back to whatever was already applied.
          subtitle: subtitle !== undefined ? (subtitle.trim() || null) : (existing?.subtitle ?? null),
          theme,
          sourceCueId: cueId ?? null,
          fadeEnabled,
          fadeMs,
          animationStyle,
        };
        store.setState({ graphics: { ...store.getState().graphics, lowerThird } });
        return { ok: true, body: { graphics: { lowerThird } } };
      }
      case 'lower_third_hide': {
        const existing = store.getState().graphics?.lowerThird ?? null;
        if (!existing) {
          return { ok: true, body: { graphics: { lowerThird: null } } };
        }
        const lowerThird: LowerThirdState = { ...existing, visible: false };
        store.setState({ graphics: { ...store.getState().graphics, lowerThird } });
        return { ok: true, body: { graphics: { lowerThird } } };
      }
      default:
        return {
          ok: false,
          status: 400,
          error: { code: 'UNKNOWN_ACTION', message: `Unknown action_id: ${actionId}` },
        };
    }
  };
}

export type ActionDispatcher = ReturnType<typeof createActionDispatcher>;
