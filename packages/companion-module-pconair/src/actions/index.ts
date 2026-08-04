import type { CompanionActionDefinition } from '@companion-module/base'
import type { ActionDeps } from './helpers.js'
import { buildGscActions } from './gsc.js'
import { buildSlidesActions } from './slides.js'
import { buildUrlActions } from './url.js'
import { buildL3Actions } from './l3.js'
import { buildStillsActions } from './stills.js'
import { buildGraphicsActions } from './graphics.js'
import { buildSystemActions } from './system.js'

export type { ActionDeps, SendAction, GscPost, Log } from './helpers.js'

/**
 * Action set = original PConAir IDs + the full GSC module ID list (preserved
 * exactly) + v2 actions for slides extras, L3 playlists, still store,
 * graphics/scoreboard, teleprompter and reliability. Package actions are
 * registered separately (see packages.ts).
 */
export function buildActions(deps: ActionDeps): Record<string, CompanionActionDefinition> {
  return {
    ...buildGscActions(deps),
    ...buildSlidesActions(deps),
    ...buildUrlActions(deps),
    ...buildL3Actions(deps),
    ...buildStillsActions(deps),
    ...buildGraphicsActions(deps),
    ...buildSystemActions(deps),
  }
}
