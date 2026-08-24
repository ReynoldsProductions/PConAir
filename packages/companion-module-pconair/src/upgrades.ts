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

/**
 * v0.3.1: the prompter feature dropped its former name (a registered trademark).
 * Rewrite saved buttons onto the new ids so existing pages keep working.
 */
const RENAMED_ACTION_IDS: Record<string, string> = {
  teleprompter_start: 'prompter_start',
  teleprompter_stop: 'prompter_stop',
  teleprompter_toggle: 'prompter_toggle',
  teleprompter_scroll_faster: 'prompter_scroll_faster',
  teleprompter_scroll_slower: 'prompter_scroll_slower',
  teleprompter_font_size_in: 'prompter_font_size_in',
  teleprompter_font_size_out: 'prompter_font_size_out',
  teleprompter_set_speed: 'prompter_set_speed',
  teleprompter_set_font_size: 'prompter_set_font_size',
  teleprompter_load_script: 'prompter_load_script',
}

const RENAMED_FEEDBACK_IDS: Record<string, string> = {
  teleprompter_enabled: 'prompter_enabled',
  teleprompter_scrolling: 'prompter_scrolling',
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
  function upgradePrompterIds(_context, props) {
    const result = {
      updatedConfig: null,
      updatedActions: [] as typeof props.actions,
      updatedFeedbacks: [] as typeof props.feedbacks,
    }

    for (const action of props.actions) {
      const renamed = RENAMED_ACTION_IDS[action.actionId]
      if (!renamed) continue
      action.actionId = renamed
      result.updatedActions.push(action)
    }

    for (const feedback of props.feedbacks) {
      const renamed = RENAMED_FEEDBACK_IDS[feedback.feedbackId]
      if (!renamed) continue
      feedback.feedbackId = renamed
      result.updatedFeedbacks.push(feedback)
    }

    return result
  },
]

export default upgradeScripts
