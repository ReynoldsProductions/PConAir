import type { CompanionActionDefinition, CompanionActionContext, CompanionActionEvent } from '@companion-module/base'
import { type ActionDeps, parsed, parsedNum, parsedChoice } from './helpers.js'

const KEEP_ON_OFF = [
  { id: 'keep', label: 'Keep Current' },
  { id: 'true', label: 'Running' },
  { id: 'false', label: 'Stopped' },
]

export function buildGraphicsActions(deps: ActionDeps): Record<string, CompanionActionDefinition> {
  const { dispatch } = deps

  /** Blank text option = leave that scoreboard field unchanged. */
  async function optionalStr(c: CompanionActionContext, e: CompanionActionEvent, id: string, params: Record<string, unknown>, key: string) {
    const v = (await parsed(c, e, id)).trim()
    if (v !== '') params[key] = v
  }
  async function optionalNum(c: CompanionActionContext, e: CompanionActionEvent, id: string, params: Record<string, unknown>, key: string) {
    const v = (await parsed(c, e, id)).trim()
    if (v === '') return
    const n = Number(v)
    if (Number.isFinite(n)) params[key] = n
  }

  return {
    graphics_scoreboard_set: {
      name: 'Scoreboard: Set Fields',
      description: 'Blank fields are left unchanged',
      options: [
        { type: 'textinput', id: 'teamA', label: 'Team A Name', default: '', useVariables: true },
        { type: 'textinput', id: 'teamB', label: 'Team B Name', default: '', useVariables: true },
        { type: 'textinput', id: 'scoreA', label: 'Score A', default: '', useVariables: true },
        { type: 'textinput', id: 'scoreB', label: 'Score B', default: '', useVariables: true },
        { type: 'textinput', id: 'quarter', label: 'Quarter/Period', default: '', useVariables: true },
        { type: 'textinput', id: 'gameClock', label: 'Game Clock (e.g. 12:00)', default: '', useVariables: true },
        { type: 'dropdown', id: 'gameClockRunning', label: 'Game Clock', default: 'keep', choices: KEEP_ON_OFF },
        { type: 'textinput', id: 'shotClock', label: 'Shot Clock', default: '', useVariables: true },
        { type: 'dropdown', id: 'shotClockRunning', label: 'Shot Clock', default: 'keep', choices: KEEP_ON_OFF },
        {
          type: 'dropdown',
          id: 'possession',
          label: 'Possession',
          default: 'keep',
          choices: [
            { id: 'keep', label: 'Keep Current' },
            { id: 'a', label: 'Team A' },
            { id: 'b', label: 'Team B' },
            { id: 'none', label: 'None' },
          ],
        },
        { type: 'textinput', id: 'foulsA', label: 'Fouls A', default: '', useVariables: true },
        { type: 'textinput', id: 'foulsB', label: 'Fouls B', default: '', useVariables: true },
        { type: 'textinput', id: 'timeoutsA', label: 'Timeouts A', default: '', useVariables: true },
        { type: 'textinput', id: 'timeoutsB', label: 'Timeouts B', default: '', useVariables: true },
      ],
      callback: async (event, context) => {
        const params: Record<string, unknown> = {}
        await optionalStr(context, event, 'teamA', params, 'teamA')
        await optionalStr(context, event, 'teamB', params, 'teamB')
        await optionalNum(context, event, 'scoreA', params, 'scoreA')
        await optionalNum(context, event, 'scoreB', params, 'scoreB')
        await optionalStr(context, event, 'quarter', params, 'quarter')
        await optionalStr(context, event, 'gameClock', params, 'gameClock')
        await optionalNum(context, event, 'shotClock', params, 'shotClock')
        await optionalNum(context, event, 'foulsA', params, 'foulsA')
        await optionalNum(context, event, 'foulsB', params, 'foulsB')
        await optionalNum(context, event, 'timeoutsA', params, 'timeoutsA')
        await optionalNum(context, event, 'timeoutsB', params, 'timeoutsB')

        const gcr = String(event.options['gameClockRunning'] ?? 'keep')
        if (gcr === 'true' || gcr === 'false') params['gameClockRunning'] = gcr === 'true'
        const scr = String(event.options['shotClockRunning'] ?? 'keep')
        if (scr === 'true' || scr === 'false') params['shotClockRunning'] = scr === 'true'

        const poss = String(event.options['possession'] ?? 'keep')
        if (poss === 'a' || poss === 'b') params['possession'] = poss
        else if (poss === 'none') params['possession'] = null

        await dispatch('graphics_scoreboard_set', params)
      },
    },
    graphics_score_bump: {
      name: 'Scoreboard: Bump Score',
      options: [
        {
          type: 'dropdown',
          id: 'team',
          label: 'Team',
          default: 'a',
          allowCustom: true,
          choices: [
            { id: 'a', label: 'Team A' },
            { id: 'b', label: 'Team B' },
          ],
        },
        { type: 'textinput', id: 'delta', label: 'Delta (e.g. 1, 3, -1)', default: '1', useVariables: true },
      ],
      callback: async (event, context) =>
        dispatch('graphics_score_bump', {
          team: await parsedChoice(context, event, 'team', ['a', 'b'], 'a'),
          delta: Math.round(await parsedNum(context, event, 'delta', 1)),
        }),
    },
    graphics_clock_start: {
      name: 'Scoreboard: Start Game Clock',
      options: [],
      callback: async () => dispatch('graphics_scoreboard_set', { gameClockRunning: true }),
    },
    graphics_clock_stop: {
      name: 'Scoreboard: Stop Game Clock',
      options: [],
      callback: async () => dispatch('graphics_scoreboard_set', { gameClockRunning: false }),
    },
    graphics_shot_clock_start: {
      name: 'Scoreboard: Start Shot Clock',
      options: [],
      callback: async () => dispatch('graphics_scoreboard_set', { shotClockRunning: true }),
    },
    graphics_shot_clock_stop: {
      name: 'Scoreboard: Stop Shot Clock',
      options: [],
      callback: async () => dispatch('graphics_scoreboard_set', { shotClockRunning: false }),
    },
    graphics_possession_set: {
      name: 'Scoreboard: Set Possession',
      options: [
        {
          type: 'dropdown',
          id: 'possession',
          label: 'Possession',
          default: 'a',
          choices: [
            { id: 'a', label: 'Team A' },
            { id: 'b', label: 'Team B' },
            { id: 'none', label: 'None' },
          ],
        },
      ],
      callback: async ({ options }) => {
        const v = String(options['possession'] ?? 'a')
        await dispatch('graphics_scoreboard_set', { possession: v === 'none' ? null : v })
      },
    },
  }
}
