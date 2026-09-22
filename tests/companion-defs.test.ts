import { describe, it, expect, beforeEach } from 'vitest';
import { buildActions, type ActionDeps } from '../packages/companion-module-pconair/src/actions';
import { buildFeedbacks } from '../packages/companion-module-pconair/src/feedbacks';
import { buildPresets } from '../packages/companion-module-pconair/src/presets';
import { VARIABLE_DEFINITIONS, stateToVariables } from '../packages/companion-module-pconair/src/variables';
import type { PcoState, ScriptDocInfo } from '../packages/companion-module-pconair/src/client';

/** Fake Companion context: expands $(test:n) → 7 and $(test:name) → Alice. */
const fakeContext = {
  parseVariablesInString: async (s: string) =>
    s.replaceAll('$(test:n)', '7').replaceAll('$(test:name)', 'Alice'),
} as never;

const SAMPLE_SCRIPT_DOCS: ScriptDocInfo[] = [
  { id: 'doc-1', name: 'Cold Open', docUrl: 'https://docs.google.com/document/d/AAA/edit', description: '' },
  { id: 'doc-2', name: 'Closing Remarks', docUrl: 'https://docs.google.com/document/d/BBB/edit', description: '' },
];

function makeDeps() {
  const dispatched: Array<{ actionId: string; params: Record<string, unknown> }> = [];
  const posted: Array<{ path: string; body: Record<string, unknown> }> = [];
  let app: Partial<PcoState> = {};
  let scriptDocs: ScriptDocInfo[] = [];
  const deps: ActionDeps = {
    dispatch: async (actionId, params) => {
      dispatched.push({ actionId, params });
    },
    gscPost: async (path, body) => {
      posted.push({ path, body });
      return {};
    },
    getApp: () => app,
    log: () => {},
    getScriptDocs: () => scriptDocs,
  };
  return {
    deps,
    dispatched,
    posted,
    setApp: (a: Partial<PcoState>) => (app = a),
    setScriptDocs: (docs: ScriptDocInfo[]) => (scriptDocs = docs),
  };
}

async function run(defs: ReturnType<typeof buildActions>, actionId: string, options: Record<string, unknown>) {
  const def = defs[actionId];
  expect(def, `action ${actionId} exists`).toBeTruthy();
  await def.callback({ options } as never, fakeContext);
}

describe('companion module definitions', () => {
  let h: ReturnType<typeof makeDeps>;
  let actions: ReturnType<typeof buildActions>;

  beforeEach(() => {
    h = makeDeps();
    actions = buildActions(h.deps);
  });

  describe('variables-in-every-input contract', () => {
    it('no action option is type number, and every textinput has useVariables', () => {
      for (const [actionId, def] of Object.entries(actions)) {
        for (const opt of def.options ?? []) {
          expect(opt.type, `${actionId}.${opt.id} must not be a number input`).not.toBe('number');
          if (opt.type === 'textinput') {
            expect(opt.useVariables, `${actionId}.${opt.id} needs useVariables`).toBe(true);
          }
        }
      }
    });

    it('no feedback option is type number, and every textinput has useVariables', () => {
      const feedbacks = buildFeedbacks(() => ({}), () => true);
      for (const [feedbackId, def] of Object.entries(feedbacks)) {
        for (const opt of def.options ?? []) {
          expect(opt.type, `${feedbackId}.${opt.id} must not be a number input`).not.toBe('number');
          if (opt.type === 'textinput') {
            expect(opt.useVariables, `${feedbackId}.${opt.id} needs useVariables`).toBe(true);
          }
        }
      }
    });
  });

  describe('actions parse variables in inputs', () => {
    it('slides_goto parses a variable into a number', async () => {
      await run(actions, 'slides_goto', { slide_number: '$(test:n)' });
      expect(h.dispatched).toEqual([{ actionId: 'slides_goto', params: { slide_number: 7 } }]);
    });

    it('go_to_slide (GSC) parses a variable into a number', async () => {
      await run(actions, 'go_to_slide', { slide: '$(test:n)' });
      expect(h.posted).toEqual([{ path: '/api/go-to-slide', body: { slide: 7 } }]);
    });

    it('slides_goto falls back to 1 on a non-numeric value', async () => {
      await run(actions, 'slides_goto', { slide_number: 'garbage' });
      expect(h.dispatched[0].params).toEqual({ slide_number: 1 });
    });

    it('stills_slideshow_play parses interval and validates transition', async () => {
      await run(actions, 'stills_slideshow_play', { item_ids: '', interval_sec: '$(test:n)', transition: 'bogus' });
      expect(h.dispatched[0].params).toEqual({ item_ids: [], interval_sec: 7, transition: 'cut' });
    });

    it('allowCustom dropdown values are validated with fallback (set_mode)', async () => {
      await run(actions, 'set_mode', { mode: 'nonsense' });
      expect(h.dispatched[0].params).toEqual({ mode: 'slides' });
      await run(actions, 'set_mode', { mode: 'url' });
      expect(h.dispatched[1].params).toEqual({ mode: 'url' });
    });
  });

  describe('graphics actions', () => {
    it('graphics_scoreboard_set sends only non-blank fields, numbers parsed', async () => {
      await run(actions, 'graphics_scoreboard_set', {
        teamA: 'HOME', teamB: '', scoreA: '$(test:n)', scoreB: '',
        quarter: '', gameClock: '', gameClockRunning: 'true', shotClock: '',
        shotClockRunning: 'keep', possession: 'none',
        foulsA: '', foulsB: '', timeoutsA: '', timeoutsB: '',
      });
      expect(h.dispatched[0]).toEqual({
        actionId: 'graphics_scoreboard_set',
        params: { teamA: 'HOME', scoreA: 7, gameClockRunning: true, possession: null },
      });
    });

    it('graphics_score_bump parses delta and validates team', async () => {
      await run(actions, 'graphics_score_bump', { team: 'b', delta: '$(test:n)' });
      expect(h.dispatched[0].params).toEqual({ team: 'b', delta: 7 });
      await run(actions, 'graphics_score_bump', { team: 'x', delta: 'junk' });
      expect(h.dispatched[1].params).toEqual({ team: 'a', delta: 1 });
    });

    it('clock convenience wrappers set the right scoreboard flags', async () => {
      await run(actions, 'graphics_clock_start', {});
      await run(actions, 'graphics_shot_clock_stop', {});
      expect(h.dispatched[0].params).toEqual({ gameClockRunning: true });
      expect(h.dispatched[1].params).toEqual({ shotClockRunning: false });
    });

    it('lower_third_apply maps subtitle keep/set/clear correctly', async () => {
      const base = {
        cue_id: '', name: 'Tom', title: '',
        subtitle: 'CEO', theme: 'keep', animation: 'keep', fade_enabled: 'keep', fade_ms: '',
      };
      await run(actions, 'lower_third_apply', { ...base, subtitle_mode: 'keep' });
      expect(h.dispatched[0].params).toEqual({ side: 'left', name: 'Tom' });

      await run(actions, 'lower_third_apply', { ...base, subtitle_mode: 'set' });
      expect(h.dispatched[1].params).toEqual({ side: 'left', name: 'Tom', subtitle: 'CEO' });

      await run(actions, 'lower_third_apply', { ...base, subtitle_mode: 'clear' });
      expect(h.dispatched[2].params).toEqual({ side: 'left', name: 'Tom', subtitle: '' });
    });

    it('lower_third_apply passes theme/animation/fade when not keep', async () => {
      await run(actions, 'lower_third_apply', {
        side: 'right', cue_id: '', name: 'Tom', title: '', subtitle_mode: 'keep', subtitle: '',
        theme: 'dark', animation: 'wipe', fade_enabled: 'false', fade_ms: '250',
      });
      expect(h.dispatched[0].params).toEqual({
        side: 'right', name: 'Tom', theme: 'dark', animationStyle: 'wipe', fadeEnabled: false, fadeMs: 250,
      });
    });
  });

  describe('system actions', () => {
    it('panic wrappers dispatch the panic action', async () => {
      await run(actions, 'panic_toggle', {});
      await run(actions, 'panic_on', {});
      await run(actions, 'panic_off', {});
      expect(h.dispatched.map((d) => d.params['action'])).toEqual(['toggle', 'on', 'off']);
      expect(h.dispatched.every((d) => d.actionId === 'panic')).toBe(true);
    });

    it('reload_instance validates the instance with B fallback', async () => {
      await run(actions, 'reload_instance', { instance: 'A' });
      await run(actions, 'reload_instance', { instance: 'garbage' });
      expect(h.dispatched[0].params).toEqual({ instance: 'A' });
      expect(h.dispatched[1].params).toEqual({ instance: 'B' });
    });

    it('prompter set-speed/font/script parse variables', async () => {
      await run(actions, 'prompter_set_speed', { speed: '$(test:n)' });
      await run(actions, 'prompter_set_font_size', { font_size: '96' });
      await run(actions, 'prompter_load_script', { text: 'Hello $(test:name)' });
      expect(h.dispatched).toEqual([
        { actionId: 'prompter_set_speed', params: { speed: 7 } },
        { actionId: 'prompter_set_font_size', params: { font_size: 96 } },
        { actionId: 'prompter_load_script', params: { text: 'Hello Alice' } },
      ]);
    });

    it('prompter line jog actions dispatch with no options, for a rotary', async () => {
      await run(actions, 'prompter_line_forward', {});
      await run(actions, 'prompter_line_back', {});
      expect(h.dispatched).toEqual([
        { actionId: 'prompter_line_forward', params: {} },
        { actionId: 'prompter_line_back', params: {} },
      ]);
    });

    it('GSC notes scroll/zoom actions are rewired to native dispatch', async () => {
      await run(actions, 'scroll_notes_down', {});
      await run(actions, 'zoom_in_notes', {});
      expect(h.dispatched.map((d) => d.actionId)).toEqual(['slides_notes_scroll_down', 'slides_notes_zoom_in']);
      expect(h.posted).toEqual([]);
    });

    it('set_render_bg parses the chroma color variable', async () => {
      await run(actions, 'set_render_bg', { content: 'l3', bg: 'chroma', chroma_color: '#$(test:n)$(test:n)' });
      expect(h.posted[0]).toEqual({ path: '/api/render/l3/background', body: { bg: 'chroma', chromaColor: '#77' } });
    });
  });

  // Design doc 2026-09-21-prompter-drive-scripts-design.md, section 6.
  describe('prompter Google Doc actions', () => {
    it('prompter_load_doc parses the URL variable and dispatches prompter_load_doc', async () => {
      await run(actions, 'prompter_load_doc', { url: 'https://docs.google.com/document/d/$(test:n)$(test:n)/edit' });
      expect(h.dispatched).toEqual([
        { actionId: 'prompter_load_doc', params: { url: 'https://docs.google.com/document/d/77/edit' } },
      ]);
    });

    it('prompter_load_doc_preset dispatches prompter_load_doc with a presetId', async () => {
      await run(actions, 'prompter_load_doc_preset', { presetId: 'doc-1' });
      expect(h.dispatched).toEqual([{ actionId: 'prompter_load_doc', params: { presetId: 'doc-1' } }]);
    });

    it('prompter_load_doc_preset dropdown lists the saved library at build time', () => {
      h.setScriptDocs(SAMPLE_SCRIPT_DOCS);
      const withLibrary = buildActions(h.deps);
      const opt = withLibrary['prompter_load_doc_preset'].options?.[0] as { choices: Array<{ id: string; label: string }> };
      expect(opt.choices).toEqual([
        { id: 'doc-1', label: 'Cold Open' },
        { id: 'doc-2', label: 'Closing Remarks' },
      ]);
    });

    it('prompter_refresh_doc, prompter_take_doc, and prompter_clear_doc dispatch with no options', async () => {
      await run(actions, 'prompter_refresh_doc', {});
      await run(actions, 'prompter_take_doc', {});
      await run(actions, 'prompter_clear_doc', {});
      expect(h.dispatched).toEqual([
        { actionId: 'prompter_refresh_doc', params: {} },
        { actionId: 'prompter_take_doc', params: {} },
        { actionId: 'prompter_clear_doc', params: {} },
      ]);
    });
  });

  describe('feedbacks', () => {
    it('slide_at parses variables and matches the 1-based slide', async () => {
      const feedbacks = buildFeedbacks(
        () => ({ slides: { slideIndex: 6, slideCount: 10, isLoading: false } as never }),
        () => true
      );
      const cb = feedbacks['slide_at'].callback as (f: never, c: never) => Promise<boolean>;
      expect(await cb({ options: { slide_number: '$(test:n)' } } as never, fakeContext)).toBe(true);
      expect(await cb({ options: { slide_number: '3' } } as never, fakeContext)).toBe(false);
    });

    it('score_leader_is picks the leading team or tied', () => {
      const feedbacks = buildFeedbacks(
        () => ({ graphics: { scoreboard: { scoreA: 10, scoreB: 8 } as never, lowerThirds: { left: null, right: null } } }),
        () => true
      );
      const cb = feedbacks['score_leader_is'].callback as (f: never) => boolean;
      expect(cb({ options: { team: 'a' } } as never)).toBe(true);
      expect(cb({ options: { team: 'tied' } } as never)).toBe(false);
    });

    it('new boolean feedbacks read their state fields', () => {
      const feedbacks = buildFeedbacks(
        () => ({
          prompter: { enabled: true, scrolling: true, speed: 40, fontSize: 72 },
          watchdog: { programUnresponsive: true, programUnresponsiveSecs: 5, memoryPressure: false, memoryPressurePct: 40 },
          graphics: { scoreboard: null, lowerThirds: { left: { visible: true } as never, right: null } },
          tunnel: { enabled: true, status: 'active', url: null, pinRequired: true, lastError: null },
        }),
        () => true
      );
      const check = (id: string) => (feedbacks[id].callback as (f: never) => boolean)({ options: {} } as never);
      expect(check('prompter_scrolling')).toBe(true);
      expect(check('watchdog_unresponsive')).toBe(true);
      expect(check('memory_pressure')).toBe(false);
      expect(check('gfx_lower_third_visible')).toBe(true);
      expect(check('tunnel_enabled')).toBe(true);
      expect(check('tunnel_pin_required')).toBe(true);
    });

    describe('prompter_doc_update_ready — the core UX of the feature', () => {
      const cb = (id: string, doc: unknown) =>
        (buildFeedbacks(() => ({ prompter: { doc } as never }), () => true)[id].callback as (f: never) => boolean)(
          { options: {} } as never
        );

      it('is true only when ready AND something is staged', () => {
        expect(cb('prompter_doc_update_ready', { status: 'ready', staged: { words: 12 } })).toBe(true);
      });

      it('is false when ready but nothing is staged (fresh load, or already taken)', () => {
        expect(cb('prompter_doc_update_ready', { status: 'ready', staged: null })).toBe(false);
      });

      it('is false while fetching, even if something was staged before', () => {
        expect(cb('prompter_doc_update_ready', { status: 'fetching', staged: { words: 12 } })).toBe(false);
      });

      it('is false on error', () => {
        expect(cb('prompter_doc_update_ready', { status: 'error', staged: null })).toBe(false);
      });

      it('is false with no doc at all', () => {
        expect(
          (buildFeedbacks(() => ({}), () => true)['prompter_doc_update_ready'].callback as (f: never) => boolean)({
            options: {},
          } as never)
        ).toBe(false);
      });
    });

    it('prompter_doc_error is true only when status is error', () => {
      const feedbacks = buildFeedbacks(() => ({ prompter: { doc: { status: 'error', staged: null } } as never }), () => true);
      const cb = feedbacks['prompter_doc_error'].callback as (f: never) => boolean;
      expect(cb({ options: {} } as never)).toBe(true);

      const okFeedbacks = buildFeedbacks(() => ({ prompter: { doc: { status: 'ready', staged: null } } as never }), () => true);
      const okCb = okFeedbacks['prompter_doc_error'].callback as (f: never) => boolean;
      expect(okCb({ options: {} } as never)).toBe(false);
    });
  });

  describe('variables', () => {
    it('stateToVariables covers every defined variable', () => {
      const values = stateToVariables({}, false);
      for (const def of VARIABLE_DEFINITIONS) {
        expect(def.variableId in values, `variable ${def.variableId} has a value`).toBe(true);
      }
    });

    it('is null-safe on an empty state', () => {
      const values = stateToVariables({}, false);
      expect(values['score_a']).toBe('');
      expect(values['prompter_scrolling']).toBe('No');
      expect(values['display_count']).toBe('');
    });

    it('surfaces new state fields', () => {
      const values = stateToVariables(
        {
          prompter: { enabled: true, scrolling: true, speed: 55, fontSize: 90 },
          graphics: {
            scoreboard: {
              teamA: 'HME', teamB: 'AWY', scoreA: 3, scoreB: 1, quarter: 'Q2',
              gameClock: '05:00', gameClockRunning: true, shotClock: 24, shotClockRunning: false,
              possession: 'a', foulsA: 2, foulsB: 4, timeoutsA: 5, timeoutsB: 6,
            },
            lowerThirds: {
              left: { visible: true, name: 'Tom', title: 'CEO', subtitle: null, theme: 'dark', animationStyle: 'fade', logoEnabled: false, logoAssetId: null },
              right: null,
            },
          },
          watchdog: { programUnresponsive: false, programUnresponsiveSecs: 0, memoryPressure: true, memoryPressurePct: 91 },
          displays: [
            { id: 'd1', name: 'Main', isPrimary: true },
            { id: 'd2', name: 'Aux', isPrimary: false },
          ],
          abState: {
            activeInstance: 'A',
            instanceA: { url: 'https://a.example', isLoading: false, isReady: true },
            instanceB: { url: null, isLoading: false, isReady: false },
          },
        },
        true
      );
      expect(values['prompter_speed']).toBe('55');
      expect(values['score_a']).toBe('3');
      expect(values['possession']).toBe('a');
      expect(values['gfx_l3_left_name']).toBe('Tom');
      expect(values['memory_pct']).toBe('91');
      expect(values['display_count']).toBe('2');
      expect(values['display_primary_name']).toBe('Main');
      expect(values['display_names']).toBe('Main, Aux');
      expect(values['instance_a_url']).toBe('https://a.example');
      expect(values['instance_a_ready']).toBe('Yes');
    });

    it('prompter_doc_* variables reflect the doc state and the on-glass word count', () => {
      const values = stateToVariables(
        {
          prompter: {
            enabled: false,
            scrolling: false,
            speed: 40,
            fontSize: 72,
            script: 'Good evening, and welcome to the show.',
            doc: {
              name: 'Cold Open',
              status: 'ready',
              staged: { words: 12 },
              loadedAt: Date.UTC(2026, 0, 1, 12, 0, 0),
              error: null,
            },
          },
        },
        true
      );
      expect(values['prompter_doc_name']).toBe('Cold Open');
      expect(values['prompter_doc_status']).toBe('ready');
      expect(values['prompter_doc_words']).toBe('7');
      expect(values['prompter_doc_staged']).toBe('Yes');
      expect(typeof values['prompter_doc_loaded_at']).toBe('string');
      expect(values['prompter_doc_loaded_at']).not.toBe('');
    });

    it('prompter_doc_* variables are blank/No with no doc attached', () => {
      const values = stateToVariables({ prompter: { enabled: false, scrolling: false, speed: 40, fontSize: 72 } }, true);
      expect(values['prompter_doc_name']).toBe('');
      expect(values['prompter_doc_status']).toBe('');
      expect(values['prompter_doc_words']).toBe('');
      expect(values['prompter_doc_loaded_at']).toBe('');
      expect(values['prompter_doc_staged']).toBe('No');
    });
  });

  describe('presets', () => {
    it('every preset references existing action and feedback ids', () => {
      const feedbacks = buildFeedbacks(() => ({}), () => true);
      const presets = buildPresets(SAMPLE_SCRIPT_DOCS);
      for (const [presetId, preset] of Object.entries(presets)) {
        for (const step of preset.steps) {
          for (const a of [...step.down, ...step.up]) {
            expect(actions[a.actionId], `preset ${presetId} action ${a.actionId} exists`).toBeTruthy();
          }
        }
        for (const f of preset.feedbacks) {
          expect(feedbacks[f.feedbackId], `preset ${presetId} feedback ${f.feedbackId} exists`).toBeTruthy();
        }
      }
    });

    it('has a Script page: Refresh, Take (carrying prompter_doc_update_ready), and Clear', () => {
      const presets = buildPresets();
      expect(presets['script_refresh'].category).toBe('Script');
      expect(presets['script_refresh'].steps[0].down[0].actionId).toBe('prompter_refresh_doc');

      expect(presets['script_take'].category).toBe('Script');
      expect(presets['script_take'].steps[0].down[0].actionId).toBe('prompter_take_doc');
      expect(presets['script_take'].feedbacks.map((f) => f.feedbackId)).toContain('prompter_doc_update_ready');

      expect(presets['script_clear'].category).toBe('Script');
      expect(presets['script_clear'].steps[0].down[0].actionId).toBe('prompter_clear_doc');
    });

    it('generates one named Load preset per saved script, and none with an empty library', () => {
      expect(Object.keys(buildPresets()).some((id) => id.startsWith('script_load_'))).toBe(false);

      const withLibrary = buildPresets(SAMPLE_SCRIPT_DOCS);
      const loadPresets = Object.entries(withLibrary).filter(([id]) => id.startsWith('script_load_'));
      expect(loadPresets).toHaveLength(2);
      for (const [, preset] of loadPresets) {
        expect(preset.category).toBe('Script');
        expect(preset.steps[0].down[0].actionId).toBe('prompter_load_doc_preset');
      }
    });
  });
});
