import type { CompanionActionDefinition } from '@companion-module/base'
import { type ActionDeps, parsed, parsedNum, parsedOpt, parsedChoice } from './helpers.js'

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
    // ════ Graphics lower-third overlay (render/graphics path) — left/right independent ════
    lower_third_apply: {
      name: 'Graphics: Apply Lower Third',
      description: 'Shows the graphics lower-third overlay on the given side (cue prefill or inline text)',
      options: [
        {
          type: 'dropdown',
          id: 'side',
          label: 'Side',
          default: 'left',
          choices: [
            { id: 'left', label: 'Left' },
            { id: 'right', label: 'Right' },
          ],
        },
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
        {
          type: 'dropdown',
          id: 'logo_mode',
          label: 'Logo',
          default: 'keep',
          choices: [
            { id: 'keep', label: 'Keep Current' },
            { id: 'show', label: 'Show (uses Logo Asset ID)' },
            { id: 'hide', label: 'Hide' },
          ],
        },
        { type: 'textinput', id: 'logo_asset_id', label: 'Logo Asset ID (when Show)', default: '', useVariables: true },
      ],
      callback: async (event, context) => {
        const params: Record<string, unknown> = {}
        params['side'] = event.options['side'] === 'right' ? 'right' : 'left'
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

        const logoMode = String(event.options['logo_mode'] ?? 'keep')
        if (logoMode === 'show') {
          params['logoEnabled'] = true
          params['logoAssetId'] = await parsed(context, event, 'logo_asset_id')
        } else if (logoMode === 'hide') {
          params['logoEnabled'] = false
        }
        // 'keep': omit both — the dispatcher falls back to whatever is currently applied

        await dispatch('lower_third_apply', params)
      },
    },
    lower_third_hide: {
      name: 'Graphics: Hide Lower Third',
      options: [
        {
          type: 'dropdown',
          id: 'side',
          label: 'Side',
          default: 'left',
          choices: [
            { id: 'left', label: 'Left' },
            { id: 'right', label: 'Right' },
          ],
        },
      ],
      callback: async (event) => dispatch('lower_third_hide', { side: event.options['side'] === 'right' ? 'right' : 'left' }),
    },
  }
}
