import type { CompanionActionDefinition } from '@companion-module/base'
import { type ActionDeps, parsed, parsedOpt, parsedChoice, simpleDispatch } from './helpers.js'

export function buildUrlActions(deps: ActionDeps): Record<string, CompanionActionDefinition> {
  const { dispatch } = deps

  return {
    load_url: {
      name: 'Load URL',
      options: [
        { type: 'textinput', id: 'url', label: 'URL', default: '', useVariables: true, required: true },
        { type: 'textinput', id: 'display', label: 'Display ID (optional)', default: '', useVariables: true },
        {
          type: 'dropdown',
          id: 'session_mode',
          label: 'Session Mode',
          default: 'persistent',
          allowCustom: true,
          choices: [
            { id: 'persistent', label: 'Persistent' },
            { id: 'ephemeral', label: 'Ephemeral' },
          ],
        },
      ],
      callback: async (event, context) => {
        const params: Record<string, unknown> = {
          url: await parsed(context, event, 'url'),
          session_mode: await parsedChoice(context, event, 'session_mode', ['persistent', 'ephemeral'], 'persistent'),
        }
        const display = await parsedOpt(context, event, 'display')
        if (display) params['display'] = display
        await dispatch('load_url', params)
      },
    },
    load_url_preset: {
      name: 'Load URL Preset',
      options: [
        { type: 'textinput', id: 'preset', label: 'Preset ID or Name', default: '', useVariables: true, required: true },
        { type: 'textinput', id: 'display', label: 'Display ID (optional)', default: '', useVariables: true },
      ],
      callback: async (event, context) => {
        const params: Record<string, unknown> = { preset: await parsed(context, event, 'preset') }
        const display = await parsedOpt(context, event, 'display')
        if (display) params['display'] = display
        await dispatch('load_url_preset', params)
      },
    },
    reload_url: simpleDispatch(deps, 'Reload Current URL (On-Air)', 'reload_url'),
    reload_url_offair: simpleDispatch(deps, 'Reload Current URL (Off-Air)', 'reload_url_offair'),
    url_switch_ab: simpleDispatch(deps, 'Switch URL Instance (A ↔ B)', 'url_switch_ab'),
    url_switch_to: {
      name: 'Switch URL Instance To…',
      options: [
        {
          type: 'dropdown',
          id: 'instance',
          label: 'Instance',
          default: 'A',
          allowCustom: true,
          choices: [
            { id: 'A', label: 'Instance A' },
            { id: 'B', label: 'Instance B' },
          ],
        },
      ],
      callback: async (event, context) =>
        dispatch('url_switch_to', { instance: await parsedChoice(context, event, 'instance', ['A', 'B'], 'A') }),
    },
  }
}
