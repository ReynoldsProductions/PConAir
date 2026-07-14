import type { CompanionActionDefinition } from '@companion-module/base'
import { type ActionDeps, parsed, parsedNum, parsedOpt, parsedChoice, simpleDispatch } from './helpers.js'

/** Must match LowerThirdTheme in src/shared/types.ts. */
const LOWER_THIRD_THEMES = [
  'default', 'dark', 'dark_alt',
  'bright', 'bright_insider', 'bright_warm', 'bright_info',
  'palette_olive', 'palette_teal', 'palette_terracotta',
  'palette_plum', 'palette_copper', 'palette_sage',
] as const

/** Must match LowerThirdAnimationStyle in src/shared/types.ts. */
const LOWER_THIRD_ANIMATIONS = ['fade', 'wipe', 'grow', 'slide-up', 'slide-down', 'zoom', 'flip'] as const

export function buildL3Actions(deps: ActionDeps): Record<string, CompanionActionDefinition> {
  const { dispatch } = deps

  return {
    l3_take: {
      name: 'Take Lower Third Cue',
      options: [
        { type: 'textinput', id: 'cue_id', label: 'Cue ID (blank = inline name/title)', default: '', useVariables: true },
        { type: 'textinput', id: 'name', label: 'Name (inline take)', default: '', useVariables: true },
        { type: 'textinput', id: 'title', label: 'Title (inline take)', default: '', useVariables: true },
        { type: 'textinput', id: 'theme', label: 'Theme (optional)', default: '', useVariables: true },
      ],
      callback: async (event, context) => {
        const params: Record<string, unknown> = {}
        const cueId = await parsedOpt(context, event, 'cue_id')
        const name = await parsedOpt(context, event, 'name')
        const title = await parsedOpt(context, event, 'title')
        const theme = await parsedOpt(context, event, 'theme')
        if (cueId) params['cue_id'] = cueId
        if (name) params['name'] = name
        if (title) params['title'] = title
        if (theme) params['theme'] = theme
        await dispatch('l3_take', params)
      },
    },
    l3_clear: simpleDispatch(deps, 'Clear Lower Third', 'l3_clear'),
    l3_next: simpleDispatch(deps, 'L3 Playlist Next', 'l3_next'),
    l3_prev: simpleDispatch(deps, 'L3 Playlist Previous', 'l3_prev'),
    l3_activate_playlist: {
      name: 'Activate L3 Playlist',
      options: [
        { type: 'textinput', id: 'playlist', label: 'Playlist ID or Name', default: '', useVariables: true, required: true },
      ],
      callback: async (event, context) =>
        dispatch('l3_activate_playlist', { playlist: await parsed(context, event, 'playlist') }),
    },
    l3_stacking_on: simpleDispatch(deps, 'Enable Lower Third Stacking', 'l3_stacking_on'),
    l3_stacking_off: simpleDispatch(deps, 'Disable Lower Third Stacking', 'l3_stacking_off'),
    l3_toggle_stacking: simpleDispatch(deps, 'Toggle Lower Third Stacking', 'l3_toggle_stacking'),

    // ════ Graphics lower-third overlay (render/graphics path) ════
    lower_third_apply: {
      name: 'Graphics: Apply Lower Third',
      description: 'Shows the graphics lower-third overlay (cue prefill or inline text)',
      options: [
        { type: 'textinput', id: 'cue_id', label: 'Cue ID (optional prefill)', default: '', useVariables: true },
        { type: 'textinput', id: 'name', label: 'Name Line', default: '', useVariables: true },
        { type: 'textinput', id: 'title', label: 'Title Line', default: '', useVariables: true },
        {
          type: 'dropdown',
          id: 'subtitle_mode',
          label: 'Subtitle',
          default: 'keep',
          choices: [
            { id: 'keep', label: 'Keep Current' },
            { id: 'set', label: 'Set Text' },
            { id: 'clear', label: 'Clear' },
          ],
        },
        { type: 'textinput', id: 'subtitle', label: 'Subtitle Text (when Set)', default: '', useVariables: true },
        {
          type: 'dropdown',
          id: 'theme',
          label: 'Theme',
          default: 'keep',
          allowCustom: true,
          choices: [
            { id: 'keep', label: 'Keep Current' },
            ...LOWER_THIRD_THEMES.map((t) => ({ id: t, label: t })),
          ],
        },
        {
          type: 'dropdown',
          id: 'animation',
          label: 'Animation Style',
          default: 'keep',
          allowCustom: true,
          choices: [
            { id: 'keep', label: 'Keep Current' },
            ...LOWER_THIRD_ANIMATIONS.map((a) => ({ id: a, label: a })),
          ],
        },
        {
          type: 'dropdown',
          id: 'fade_enabled',
          label: 'Transition',
          default: 'keep',
          choices: [
            { id: 'keep', label: 'Keep Current' },
            { id: 'true', label: 'Animated' },
            { id: 'false', label: 'Hard Cut' },
          ],
        },
        { type: 'textinput', id: 'fade_ms', label: 'Transition Duration ms (blank = keep)', default: '', useVariables: true },
      ],
      callback: async (event, context) => {
        const params: Record<string, unknown> = {}
        const cueId = await parsedOpt(context, event, 'cue_id')
        const name = await parsedOpt(context, event, 'name')
        const title = await parsedOpt(context, event, 'title')
        if (cueId) params['cue_id'] = cueId
        if (name) params['name'] = name
        if (title) params['title'] = title

        const subtitleMode = String(event.options['subtitle_mode'] ?? 'keep')
        if (subtitleMode === 'set') params['subtitle'] = await parsed(context, event, 'subtitle')
        else if (subtitleMode === 'clear') params['subtitle'] = ''
        // 'keep': omit — the dispatcher falls back to the currently applied subtitle

        const theme = await parsedChoice(context, event, 'theme', LOWER_THIRD_THEMES, 'keep')
        if (theme !== 'keep') params['theme'] = theme
        const animation = await parsedChoice(context, event, 'animation', LOWER_THIRD_ANIMATIONS, 'keep')
        if (animation !== 'keep') params['animationStyle'] = animation

        const fadeEnabled = String(event.options['fade_enabled'] ?? 'keep')
        if (fadeEnabled === 'true' || fadeEnabled === 'false') params['fadeEnabled'] = fadeEnabled === 'true'

        const fadeMsRaw = (await parsed(context, event, 'fade_ms')).trim()
        if (fadeMsRaw !== '') params['fadeMs'] = await parsedNum(context, event, 'fade_ms', 550)

        await dispatch('lower_third_apply', params)
      },
    },
    lower_third_hide: simpleDispatch(deps, 'Graphics: Hide Lower Third', 'lower_third_hide'),
  }
}
