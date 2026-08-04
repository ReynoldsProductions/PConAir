import type { CompanionActionDefinition, CompanionActionContext, CompanionActionEvent } from '@companion-module/base'
import type { PcoState } from '../client.js'

export type SendAction = (actionId: string, params: Record<string, unknown>) => Promise<void>
export type GscPost = (path: string, body: Record<string, unknown>) => Promise<Record<string, unknown>>
export type Log = (level: 'debug' | 'info' | 'warn' | 'error', msg: string) => void

export interface ActionDeps {
  /** Native PConAir action dispatch (WebSocket / /api/action). */
  dispatch: SendAction
  /** Cookie-less POST to the GSC-compat HTTP surface. */
  gscPost: GscPost
  getApp: () => Partial<PcoState>
  log: Log
}

/** Parse a text option through Companion's variable expansion. */
export async function parsed(
  context: CompanionActionContext,
  event: CompanionActionEvent,
  optionId: string
): Promise<string> {
  return context.parseVariablesInString(String(event.options[optionId] ?? ''))
}

/** Parse a text option to a number; blank/invalid falls back. */
export async function parsedNum(
  context: CompanionActionContext,
  event: CompanionActionEvent,
  optionId: string,
  fallback: number
): Promise<number> {
  const s = (await parsed(context, event, optionId)).trim()
  const n = Number(s)
  return s !== '' && Number.isFinite(n) ? n : fallback
}

/** Parse a text option; '' → undefined (omit from params). */
export async function parsedOpt(
  context: CompanionActionContext,
  event: CompanionActionEvent,
  optionId: string
): Promise<string | undefined> {
  const s = await parsed(context, event, optionId)
  return s === '' ? undefined : s
}

/**
 * Parse an allowCustom dropdown value (may contain variables when typed as
 * custom text) and validate it against the known choice ids.
 */
export async function parsedChoice(
  context: CompanionActionContext,
  event: CompanionActionEvent,
  optionId: string,
  allowed: readonly string[],
  fallback: string
): Promise<string> {
  const v = (await parsed(context, event, optionId)).trim()
  return (allowed as readonly string[]).includes(v) ? v : fallback
}

export function makeGscAction(deps: Pick<ActionDeps, 'gscPost' | 'log'>) {
  /** GSC-style action: POST a compat endpoint, log result, never throw. */
  return function gscAction(
    name: string,
    path: string,
    options: CompanionActionDefinition['options'] = [],
    buildBody?: (event: CompanionActionEvent, context: CompanionActionContext) => Promise<Record<string, unknown>>,
    description?: string
  ): CompanionActionDefinition {
    return {
      name,
      description,
      options,
      callback: async (event, context) => {
        try {
          const body = buildBody ? await buildBody(event, context) : {}
          await deps.gscPost(path, body)
          deps.log('debug', `${name}: ok`)
        } catch (err) {
          deps.log('error', `${name} failed: ${(err as Error).message}`)
        }
      },
    }
  }
}

/** Zero-option action that fires a native dispatch id. */
export function simpleDispatch(deps: Pick<ActionDeps, 'dispatch'>, name: string, actionId: string): CompanionActionDefinition {
  return { name, options: [], callback: async () => deps.dispatch(actionId, {}) }
}
