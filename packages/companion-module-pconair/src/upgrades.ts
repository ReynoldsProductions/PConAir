import type { CompanionStaticUpgradeScript } from '@companion-module/base'
import type { Config } from './index.js'

/** v0.3.0: numeric options became textinput-with-variables — stringify saved values. */
const ACTION_NUMBER_OPTIONS: Record<string, string[]> = {
  go_to_slide: ['slide'],
  show_share_qr: ['durationSec'],
  stagetimer_overlay_settings: ['size'],
  perfectcue_set_port_enabled: ['port'],
  slides_goto: ['slide_number'],
  stills_slideshow_play: ['interval_sec'],
}

const FEEDBACK_NUMBER_OPTIONS: Record<string, string[]> = {
  slide_at: ['slide_number'],
  on_slide: ['slide'],
}

const upgradeScripts: CompanionStaticUpgradeScript<Config>[] = [
  function upgradeNumberOptionsToText(_context, props) {
    const result = {
      updatedConfig: null,
      updatedActions: [] as typeof props.actions,
      updatedFeedbacks: [] as typeof props.feedbacks,
    }

    for (const action of props.actions) {
      const optionIds = ACTION_NUMBER_OPTIONS[action.actionId]
      if (!optionIds) continue
      let changed = false
      for (const id of optionIds) {
        if (typeof action.options[id] === 'number') {
          action.options[id] = String(action.options[id])
          changed = true
        }
      }
      if (changed) result.updatedActions.push(action)
    }

    for (const feedback of props.feedbacks) {
      const optionIds = FEEDBACK_NUMBER_OPTIONS[feedback.feedbackId]
      if (!optionIds) continue
      let changed = false
      for (const id of optionIds) {
        if (typeof feedback.options[id] === 'number') {
          feedback.options[id] = String(feedback.options[id])
          changed = true
        }
      }
      if (changed) result.updatedFeedbacks.push(feedback)
    }

    return result
  },
]

export default upgradeScripts
