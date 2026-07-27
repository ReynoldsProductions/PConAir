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

    // ════ Teleprompter ════
    teleprompter_start: simpleDispatch(deps, 'Teleprompter: Start Scrolling', 'teleprompter_start'),
    teleprompter_stop: simpleDispatch(deps, 'Teleprompter: Stop Scrolling', 'teleprompter_stop'),
    teleprompter_toggle: simpleDispatch(deps, 'Teleprompter: Toggle Scrolling', 'teleprompter_toggle'),
    teleprompter_scroll_faster: simpleDispatch(deps, 'Teleprompter: Scroll Faster', 'teleprompter_scroll_faster'),
    teleprompter_scroll_slower: simpleDispatch(deps, 'Teleprompter: Scroll Slower', 'teleprompter_scroll_slower'),
    teleprompter_font_size_in: simpleDispatch(deps, 'Teleprompter: Font Size +', 'teleprompter_font_size_in'),
    teleprompter_font_size_out: simpleDispatch(deps, 'Teleprompter: Font Size −', 'teleprompter_font_size_out'),
    teleprompter_set_speed: {
      name: 'Teleprompter: Set Scroll Speed',
      options: [
        { type: 'textinput', id: 'speed', label: 'Speed (0-200)', default: '40', required: true, useVariables: true },
      ],
      callback: async (event, context) =>
        dispatch('teleprompter_set_speed', { speed: await parsedNum(context, event, 'speed', 40) }),
    },
    teleprompter_set_font_size: {
      name: 'Teleprompter: Set Font Size',
      options: [
        { type: 'textinput', id: 'font_size', label: 'Font Size (24-200)', default: '72', required: true, useVariables: true },
      ],
      callback: async (event, context) =>
        dispatch('teleprompter_set_font_size', { font_size: await parsedNum(context, event, 'font_size', 72) }),
    },
    teleprompter_load_script: {
      name: 'Teleprompter: Load Script',
      options: [
        { type: 'textinput', id: 'text', label: 'Script Text', default: '', required: true, useVariables: true },
      ],
      callback: async (event, context) =>
        dispatch('teleprompter_load_script', { text: await parsed(context, event, 'text') }),
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
