import type { CompanionActionDefinition } from '@companion-module/base'

export type SendAction = (actionId: string, params: Record<string, unknown>) => Promise<void>

export function buildActions(sendAction: SendAction): Record<string, CompanionActionDefinition> {
  return {
    load_url: {
      name: 'Load URL',
      options: [
        {
          type: 'textinput',
          id: 'url',
          label: 'URL',
          default: '',
          useVariables: true,
          required: true,
        },
        {
          type: 'textinput',
          id: 'display',
          label: 'Display ID (optional)',
          default: '',
          useVariables: true,
        },
        {
          type: 'dropdown',
          id: 'session_mode',
          label: 'Session Mode',
          default: 'persistent',
          choices: [
            { id: 'persistent', label: 'Persistent' },
            { id: 'ephemeral', label: 'Ephemeral' },
          ],
        },
      ],
      callback: async ({ options }) => {
        const params: Record<string, unknown> = {
          url: options['url'],
          session_mode: options['session_mode'],
        }
        if (options['display']) params['display'] = options['display']
        await sendAction('load_url', params)
      },
    },

    load_url_preset: {
      name: 'Load URL Preset',
      options: [
        {
          type: 'textinput',
          id: 'preset',
          label: 'Preset ID or Name',
          default: '',
          useVariables: true,
          required: true,
        },
        {
          type: 'textinput',
          id: 'display',
          label: 'Display ID (optional)',
          default: '',
          useVariables: true,
        },
      ],
      callback: async ({ options }) => {
        const params: Record<string, unknown> = { preset: options['preset'] }
        if (options['display']) params['display'] = options['display']
        await sendAction('load_url_preset', params)
      },
    },

    reload_url: {
      name: 'Reload Current URL (On-Air)',
      options: [],
      callback: async () => sendAction('reload_url', {}),
    },

    reload_url_offair: {
      name: 'Reload Current URL (Off-Air)',
      options: [],
      callback: async () => sendAction('reload_url_offair', {}),
    },

    url_switch_ab: {
      name: 'Switch URL Instance (A ↔ B)',
      options: [],
      callback: async () => sendAction('url_switch_ab', {}),
    },

    url_switch_to: {
      name: 'Switch URL Instance To…',
      options: [
        {
          type: 'dropdown',
          id: 'instance',
          label: 'Instance',
          default: 'A',
          choices: [
            { id: 'A', label: 'Instance A' },
            { id: 'B', label: 'Instance B' },
          ],
        },
      ],
      callback: async ({ options }) => sendAction('url_switch_to', { instance: options['instance'] }),
    },

    slides_next: {
      name: 'Next Slide',
      options: [],
      callback: async () => sendAction('slides_next', {}),
    },

    slides_prev: {
      name: 'Previous Slide',
      options: [],
      callback: async () => sendAction('slides_prev', {}),
    },

    slides_goto: {
      name: 'Go to Slide…',
      options: [
        {
          type: 'number',
          id: 'slide_number',
          label: 'Slide Number (1-based)',
          default: 1,
          min: 1,
          max: 9999,
          required: true,
        },
      ],
      callback: async ({ options }) =>
        sendAction('slides_goto', { slide_number: Number(options['slide_number']) }),
    },

    slides_load: {
      name: 'Load Slides Deck',
      options: [
        {
          type: 'textinput',
          id: 'deck_url',
          label: 'Deck URL',
          default: '',
          useVariables: true,
          required: true,
        },
        {
          type: 'dropdown',
          id: 'instance',
          label: 'Instance',
          default: 'active',
          choices: [
            { id: 'active', label: 'Active' },
            { id: 'A', label: 'Instance A' },
            { id: 'B', label: 'Instance B' },
          ],
        },
      ],
      callback: async ({ options }) =>
        sendAction('slides_load', { deck_url: options['deck_url'], instance: options['instance'] }),
    },

    slides_reload: {
      name: 'Reload Slides (Keep Position)',
      options: [
        {
          type: 'dropdown',
          id: 'instance',
          label: 'Instance',
          default: 'active',
          choices: [
            { id: 'active', label: 'Active' },
            { id: 'A', label: 'Instance A' },
            { id: 'B', label: 'Instance B' },
          ],
        },
      ],
      callback: async ({ options }) =>
        sendAction('slides_reload', { instance: options['instance'] }),
    },

    slides_switch_ab: {
      name: 'Switch Slides Instance (A ↔ B)',
      options: [],
      callback: async () => sendAction('slides_switch_ab', {}),
    },

    l3_take: {
      name: 'Take Lower Third Cue',
      options: [
        {
          type: 'textinput',
          id: 'cue_id',
          label: 'Cue ID or Name',
          default: '',
          useVariables: true,
          required: true,
        },
        {
          type: 'textinput',
          id: 'name',
          label: 'Override Name (optional)',
          default: '',
          useVariables: true,
        },
        {
          type: 'textinput',
          id: 'title',
          label: 'Override Title (optional)',
          default: '',
          useVariables: true,
        },
        {
          type: 'textinput',
          id: 'theme',
          label: 'Override Theme (optional)',
          default: '',
          useVariables: true,
        },
      ],
      callback: async ({ options }) => {
        const params: Record<string, unknown> = { cue_id: options['cue_id'] }
        if (options['name']) params['name'] = options['name']
        if (options['title']) params['title'] = options['title']
        if (options['theme']) params['theme'] = options['theme']
        await sendAction('l3_take', params)
      },
    },

    l3_clear: {
      name: 'Clear Lower Third',
      options: [],
      callback: async () => sendAction('l3_clear', {}),
    },

    l3_stacking_on: {
      name: 'Enable Lower Third Stacking',
      options: [],
      callback: async () => sendAction('l3_stacking_on', {}),
    },

    l3_stacking_off: {
      name: 'Disable Lower Third Stacking',
      options: [],
      callback: async () => sendAction('l3_stacking_off', {}),
    },

    ab_switch: {
      name: 'Switch Active A/B Instance (Current Mode)',
      options: [],
      callback: async () => sendAction('ab_switch', {}),
    },

    set_display: {
      name: 'Set Target Display',
      options: [
        {
          type: 'textinput',
          id: 'display',
          label: 'Display Name or ID',
          default: '',
          useVariables: true,
          required: true,
        },
      ],
      callback: async ({ options }) =>
        sendAction('set_display', { display: options['display'] }),
    },

    set_mode: {
      name: 'Switch Mode',
      options: [
        {
          type: 'dropdown',
          id: 'mode',
          label: 'Mode',
          default: 'slides',
          choices: [
            { id: 'slides', label: 'Slides' },
            { id: 'url', label: 'URL' },
            { id: 'l3', label: 'Lower Thirds' },
            { id: 'idle', label: 'Idle' },
          ],
        },
      ],
      callback: async ({ options }) => sendAction('set_mode', { mode: options['mode'] }),
    },
  }
}
