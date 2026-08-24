import type { CompanionActionDefinition } from '@companion-module/base'
import { type ActionDeps, makeGscAction, parsed, parsedNum, parsedChoice, simpleDispatch } from './helpers.js'

const MODES = ['slides', 'url', 'l3', 'media-library', 'idle'] as const
const RENDER_CONTENT = ['slides', 'l3', 'stills', 'url'] as const
const RENDER_BG = ['transparent', 'black', 'white', 'chroma', 'opaque'] as const
const STAGETIMER_POSITIONS = ['bottom-left', 'bottom-right', 'top-left', 'top-right'] as const

export function buildSystemActions(deps: ActionDeps): Record<string, CompanionActionDefinition> {
  const { dispatch, gscPost, getApp, log } = deps
  const gscAction = makeGscAction(deps)

  return {
    // ════ Mode / display / A-B ════
    ab_switch: simpleDispatch(deps, 'Switch Active A/B Instance (Current Mode)', 'ab_switch'),
    set_display: {
      name: 'Set Target Display',
      options: [
        { type: 'textinput', id: 'display', label: 'Display Name or ID', default: '', useVariables: true, required: true },
      ],
      callback: async (event, context) => dispatch('set_display', { display: await parsed(context, event, 'display') }),
    },
    set_mode: {
      name: 'Switch Mode',
      options: [
        {
          type: 'dropdown',
          id: 'mode',
          label: 'Mode',
          default: 'slides',
          allowCustom: true,
          choices: [
            { id: 'slides', label: 'Slides' },
            { id: 'url', label: 'URL' },
            { id: 'l3', label: 'Lower Thirds' },
            { id: 'media-library', label: 'Still Store' },
            { id: 'idle', label: 'Idle' },
          ],
        },
      ],
      callback: async (event, context) =>
        dispatch('set_mode', { mode: await parsedChoice(context, event, 'mode', MODES, 'slides') }),
    },

    // ════ Render outputs (software path) ════
    set_render_bg: {
      name: 'Set Render Background Mode',
      description: 'Switches a /render page background without a reload (OBS key modes)',
      options: [
        {
          type: 'dropdown',
          id: 'content',
          label: 'Content Type',
          default: 'l3',
          allowCustom: true,
          choices: [
            { id: 'slides', label: 'Slides' },
            { id: 'l3', label: 'Lower Thirds' },
            { id: 'stills', label: 'Still Store' },
            { id: 'url', label: 'URL' },
          ],
        },
        {
          type: 'dropdown',
          id: 'bg',
          label: 'Background',
          default: 'transparent',
          allowCustom: true,
          choices: [
            { id: 'transparent', label: 'Transparent' },
            { id: 'black', label: 'Black (luma key)' },
            { id: 'white', label: 'White (luma key)' },
            { id: 'chroma', label: 'Chroma' },
            { id: 'opaque', label: 'Opaque' },
          ],
        },
        { type: 'textinput', id: 'chroma_color', label: 'Chroma color (hex, chroma mode only)', default: '#00b140', useVariables: true },
      ],
      callback: async (event, context) => {
        const content = await parsedChoice(context, event, 'content', RENDER_CONTENT, 'l3')
        const bg = await parsedChoice(context, event, 'bg', RENDER_BG, 'transparent')
        const body: Record<string, unknown> = { bg }
        if (bg === 'chroma') body['chromaColor'] = await parsed(context, event, 'chroma_color')
        try {
          await gscPost(`/api/render/${content}/background`, body)
        } catch (err) {
          log('error', `Set render background failed: ${(err as Error).message}`)
        }
      },
    },

    // ════ Stagetimer overlay ════
    stagetimer_overlay_show: gscAction('Show Stagetimer Overlay', '/api/show-stage-timer-overlay'),
    stagetimer_overlay_hide: gscAction('Hide Stagetimer Overlay', '/api/hide-stage-timer-overlay'),
    stagetimer_overlay_toggle: {
      name: 'Toggle Stagetimer Overlay',
      options: [],
      callback: async () => {
        try {
          const showing = Boolean(getApp().stageTimer?.overlayEnabled)
          await gscPost(showing ? '/api/hide-stage-timer-overlay' : '/api/show-stage-timer-overlay', {})
        } catch (err) {
          log('error', `Toggle Stagetimer Overlay failed: ${(err as Error).message}`)
        }
      },
    },
    stagetimer_overlay_settings: gscAction(
      'Set Stagetimer Overlay Position/Size',
      '/api/update-stage-timer-overlay-settings',
      [
        {
          id: 'position',
          type: 'dropdown',
          label: 'Position',
          default: 'bottom-left',
          allowCustom: true,
          choices: [
            { id: 'bottom-left', label: 'Bottom Left' },
            { id: 'bottom-right', label: 'Bottom Right' },
            { id: 'top-left', label: 'Top Left' },
            { id: 'top-right', label: 'Top Right' },
          ],
        },
        { id: 'size', type: 'textinput', label: 'Size (% of display)', default: '10', required: true, useVariables: true },
      ],
      async (e, c) => ({
        position: await parsedChoice(c, e, 'position', STAGETIMER_POSITIONS, 'bottom-left'),
        size: await parsedNum(c, e, 'size', 10),
      })
    ),

    // ════ Prompter ════
    prompter_start: simpleDispatch(deps, 'Prompter: Start Scrolling', 'prompter_start'),
    prompter_stop: simpleDispatch(deps, 'Prompter: Stop Scrolling', 'prompter_stop'),
    prompter_toggle: simpleDispatch(deps, 'Prompter: Toggle Scrolling', 'prompter_toggle'),
    prompter_scroll_faster: simpleDispatch(deps, 'Prompter: Scroll Faster', 'prompter_scroll_faster'),
    prompter_scroll_slower: simpleDispatch(deps, 'Prompter: Scroll Slower', 'prompter_scroll_slower'),
    prompter_font_size_in: simpleDispatch(deps, 'Prompter: Font Size +', 'prompter_font_size_in'),
    prompter_font_size_out: simpleDispatch(deps, 'Prompter: Font Size −', 'prompter_font_size_out'),
    prompter_set_speed: {
      name: 'Prompter: Set Scroll Speed',
      options: [
        { type: 'textinput', id: 'speed', label: 'Speed (0-200)', default: '40', required: true, useVariables: true },
      ],
      callback: async (event, context) =>
        dispatch('prompter_set_speed', { speed: await parsedNum(context, event, 'speed', 40) }),
    },
    prompter_set_font_size: {
      name: 'Prompter: Set Font Size',
      options: [
        { type: 'textinput', id: 'font_size', label: 'Font Size (24-200)', default: '72', required: true, useVariables: true },
      ],
      callback: async (event, context) =>
        dispatch('prompter_set_font_size', { font_size: await parsedNum(context, event, 'font_size', 72) }),
    },
    prompter_rewind: simpleDispatch(deps, 'Prompter: Rewind to Top', 'prompter_rewind'),
    prompter_jump: {
      name: 'Prompter: Jump By Pixels',
      options: [
        { type: 'textinput', id: 'delta', label: 'Pixels (negative scrolls back)', default: '-200', required: true, useVariables: true },
      ],
      callback: async (event, context) =>
        dispatch('prompter_jump', { delta: await parsedNum(context, event, 'delta', -200) }),
    },
    prompter_mirror: {
      name: 'Prompter: Mirror Display',
      options: [
        {
          type: 'dropdown',
          id: 'axis',
          label: 'Axis',
          default: 'x',
          choices: [
            { id: 'x', label: 'Horizontal (beam-splitter glass)' },
            { id: 'y', label: 'Vertical (ceiling mount)' },
          ],
        },
        {
          type: 'dropdown',
          id: 'mode',
          label: 'Mode',
          default: 'toggle',
          choices: [
            { id: 'toggle', label: 'Toggle' },
            { id: 'on', label: 'On' },
            { id: 'off', label: 'Off' },
          ],
        },
      ],
      callback: async (event) =>
        dispatch('prompter_mirror', { axis: event.options.axis, mode: event.options.mode }),
    },
    prompter_load_script: {
      name: 'Prompter: Load Script',
      options: [
        { type: 'textinput', id: 'text', label: 'Script Text', default: '', required: true, useVariables: true },
      ],
      callback: async (event, context) =>
        dispatch('prompter_load_script', { text: await parsed(context, event, 'text') }),
    },

    // ════ Reliability ════
    panic_toggle: { name: 'Panic: Toggle Output Slate', options: [], callback: async () => dispatch('panic', { action: 'toggle' }) },
    panic_on: { name: 'Panic: Slate On (Hide Output)', options: [], callback: async () => dispatch('panic', { action: 'on' }) },
    panic_off: { name: 'Panic: Slate Off (Restore Output)', options: [], callback: async () => dispatch('panic', { action: 'off' }) },
    reload_instance: {
      name: 'Reload Off-Air Instance',
      description: 'Safe reload — the server rejects reloading the on-air instance',
      options: [
        {
          type: 'dropdown',
          id: 'instance',
          label: 'Instance',
          default: 'B',
          allowCustom: true,
          choices: [
            { id: 'A', label: 'Instance A' },
            { id: 'B', label: 'Instance B' },
          ],
        },
      ],
      callback: async (event, context) =>
        dispatch('reload_instance', { instance: await parsedChoice(context, event, 'instance', ['A', 'B'], 'B') }),
    },

    // Kept for transcript/debug convenience: show current app mode in logs.
    log_status: {
      name: 'Log Current Status (debug)',
      options: [],
      callback: async () => {
        const app = getApp()
        log(
          'info',
          `mode=${app.currentMode ?? 'idle'} slide=${app.slides ? app.slides.slideIndex + 1 : '-'} l3=${app.l3?.activeCueName ?? '-'} still=${app.mediaLibrary?.activeItemName ?? '-'}`
        )
      },
    },
  }
}
