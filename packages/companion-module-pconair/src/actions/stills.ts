import type { CompanionActionDefinition } from '@companion-module/base'
import { type ActionDeps, parsed, parsedNum, parsedChoice, simpleDispatch } from './helpers.js'

export function buildStillsActions(deps: ActionDeps): Record<string, CompanionActionDefinition> {
  const { dispatch } = deps

  return {
    stills_take: {
      name: 'Take Still',
      options: [
        { type: 'textinput', id: 'item', label: 'Image ID or Name', default: '', useVariables: true, required: true },
      ],
      callback: async (event, context) => dispatch('stills_take', { item: await parsed(context, event, 'item') }),
    },
    stills_clear: simpleDispatch(deps, 'Clear Still Output', 'stills_clear'),
    stills_slideshow_play: {
      name: 'Slideshow Play / Resume',
      description: 'Blank item list resumes a paused show, restarts the loaded list, or plays the whole library',
      options: [
        { type: 'textinput', id: 'item_ids', label: 'Image IDs (comma-separated, optional)', default: '', useVariables: true },
        { type: 'textinput', id: 'interval_sec', label: 'Interval (seconds)', default: '5', useVariables: true },
        {
          type: 'dropdown',
          id: 'transition',
          label: 'Transition',
          default: 'cut',
          allowCustom: true,
          choices: [
            { id: 'cut', label: 'Hard Cut' },
            { id: 'fade', label: 'Fade' },
          ],
        },
      ],
      callback: async (event, context) => {
        const raw = await parsed(context, event, 'item_ids')
        const itemIds = raw
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s.length > 0)
        await dispatch('stills_slideshow_play', {
          item_ids: itemIds,
          interval_sec: await parsedNum(context, event, 'interval_sec', 5),
          transition: await parsedChoice(context, event, 'transition', ['cut', 'fade'], 'cut'),
        })
      },
    },
    stills_slideshow_pause: simpleDispatch(deps, 'Slideshow Pause', 'stills_slideshow_pause'),
    stills_slideshow_resume: simpleDispatch(deps, 'Slideshow Resume', 'stills_slideshow_resume'),
    stills_slideshow_stop: simpleDispatch(deps, 'Slideshow Stop', 'stills_slideshow_stop'),
    stills_slideshow_next: simpleDispatch(deps, 'Slideshow Next Image', 'stills_slideshow_next'),
    stills_slideshow_prev: simpleDispatch(deps, 'Slideshow Previous Image', 'stills_slideshow_prev'),
  }
}
