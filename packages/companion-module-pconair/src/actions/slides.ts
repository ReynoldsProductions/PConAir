import type { CompanionActionDefinition } from '@companion-module/base'
import { type ActionDeps, parsed, parsedNum, parsedOpt, parsedChoice, simpleDispatch } from './helpers.js'

const INSTANCE_CHOICES = [
  { id: 'active', label: 'Active' },
  { id: 'A', label: 'Instance A' },
  { id: 'B', label: 'Instance B' },
]

export function buildSlidesActions(deps: ActionDeps): Record<string, CompanionActionDefinition> {
  const { dispatch } = deps

  return {
    slides_next: simpleDispatch(deps, 'Next Slide (native)', 'slides_next'),
    slides_prev: simpleDispatch(deps, 'Previous Slide (native)', 'slides_prev'),
    prev_slide: { name: 'Previous Slide (alias)', options: [], callback: async () => dispatch('slides_prev', {}) },
    slides_goto: {
      name: 'Go to Slide (native)',
      options: [
        { type: 'textinput', id: 'slide_number', label: 'Slide Number (1-based)', default: '1', required: true, useVariables: true },
      ],
      callback: async (event, context) =>
        dispatch('slides_goto', { slide_number: await parsedNum(context, event, 'slide_number', 1) }),
    },
    go_to_first: simpleDispatch(deps, 'Go to First Slide', 'slides_goto_first'),
    go_to_last: simpleDispatch(deps, 'Go to Last Slide', 'slides_goto_last'),
    slides_load: {
      name: 'Load Slides Deck',
      options: [
        { type: 'textinput', id: 'deck_url', label: 'Deck URL', default: '', useVariables: true, required: true },
        { type: 'textinput', id: 'backup_url', label: 'Backup Deck URL (optional)', default: '', useVariables: true },
        {
          type: 'dropdown',
          id: 'instance',
          label: 'Instance',
          default: 'active',
          allowCustom: true,
          choices: INSTANCE_CHOICES,
        },
      ],
      callback: async (event, context) => {
        const params: Record<string, unknown> = {
          deck_url: await parsed(context, event, 'deck_url'),
          instance: await parsedChoice(context, event, 'instance', ['active', 'A', 'B'], 'active'),
        }
        const backup = await parsedOpt(context, event, 'backup_url')
        if (backup) params['backup_url'] = backup
        await dispatch('slides_load', params)
      },
    },
    load_deck: {
      name: 'Load Deck (Primary + Backup)',
      options: [
        { type: 'textinput', id: 'url', label: 'Primary Deck URL', default: '', useVariables: true, required: true },
        { type: 'textinput', id: 'backup_url', label: 'Backup Deck URL (optional)', default: '', useVariables: true },
      ],
      callback: async (event, context) => {
        const params: Record<string, unknown> = { deck_url: await parsed(context, event, 'url') }
        const backup = await parsedOpt(context, event, 'backup_url')
        if (backup) params['backup_url'] = backup
        await dispatch('slides_load', params)
      },
    },
    slides_reload: {
      name: 'Reload Slides (Keep Position)',
      options: [
        {
          type: 'dropdown',
          id: 'instance',
          label: 'Instance',
          default: 'active',
          allowCustom: true,
          choices: INSTANCE_CHOICES,
        },
      ],
      callback: async (event, context) =>
        dispatch('slides_reload', { instance: await parsedChoice(context, event, 'instance', ['active', 'A', 'B'], 'active') }),
    },
    reload_deck: { name: 'Reload Deck (alias)', options: [], callback: async () => dispatch('slides_reload', {}) },
    slides_switch_ab: simpleDispatch(deps, 'Switch Slides Instance (A ↔ B)', 'slides_switch_ab'),
    toggle_offline_mode: {
      name: 'Toggle Offline Mode',
      options: [],
      callback: async () => dispatch('slides_offline_mode', {}),
    },
    set_offline_mode: {
      name: 'Set Offline Mode',
      options: [
        {
          type: 'dropdown',
          id: 'enabled',
          label: 'Offline Mode',
          default: 'true',
          allowCustom: true,
          choices: [
            { id: 'true', label: 'Enable' },
            { id: 'false', label: 'Disable' },
          ],
        },
      ],
      callback: async (event, context) =>
        dispatch('slides_offline_mode', {
          enabled: (await parsedChoice(context, event, 'enabled', ['true', 'false'], 'true')) === 'true',
        }),
    },
    slides_notes_scroll_up: simpleDispatch(deps, 'Speaker Notes: Scroll Up (native)', 'slides_notes_scroll_up'),
    slides_notes_scroll_down: simpleDispatch(deps, 'Speaker Notes: Scroll Down (native)', 'slides_notes_scroll_down'),
    slides_notes_zoom_in: simpleDispatch(deps, 'Speaker Notes: Zoom In (native)', 'slides_notes_zoom_in'),
    slides_notes_zoom_out: simpleDispatch(deps, 'Speaker Notes: Zoom Out (native)', 'slides_notes_zoom_out'),
  }
}
