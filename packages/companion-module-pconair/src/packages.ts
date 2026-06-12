import {
  combineRgb,
  type CompanionActionDefinition,
  type CompanionFeedbackDefinition,
  type CompanionVariableDefinition,
  type CompanionVariableValues,
  type SomeCompanionActionInputField,
  type SomeCompanionFeedbackInputField,
} from '@companion-module/base'
import {
  applyOps,
  computeDerived,
  evalFeedback,
  hasActiveCountdown,
  variableValue,
  type OptionValues,
  type PkgActionDef,
  type PkgDerivedDef,
  type PkgFeedbackDef,
  type PkgOption,
  type PkgState,
  type PkgVariableDef,
} from './pkg-engine.js'

/** One package as served by GET /api/packages. */
export interface PackageInfo {
  id: string
  name: string
  companionActions: PkgActionDef[]
  companionFeedbacks: PkgFeedbackDef[]
  companionVariables: PkgVariableDef[]
  companionDerived: PkgDerivedDef[]
}

export interface PackageDeps {
  getPkgState: (pkgId: string) => PkgState
  patchPkg: (pkgId: string, patch: PkgState) => Promise<void>
  log: (level: 'debug' | 'info' | 'warn' | 'error', msg: string) => void
}

/** Parse the GET /api/packages response defensively. */
export function parsePackageList(body: Record<string, unknown>): PackageInfo[] {
  const raw = Array.isArray(body.packages) ? (body.packages as Array<Record<string, unknown>>) : []
  return raw
    .filter((p) => typeof p.id === 'string')
    .map((p) => ({
      id: String(p.id),
      name: typeof p.name === 'string' ? p.name : String(p.id),
      companionActions: Array.isArray(p.companionActions) ? (p.companionActions as PkgActionDef[]) : [],
      companionFeedbacks: Array.isArray(p.companionFeedbacks) ? (p.companionFeedbacks as PkgFeedbackDef[]) : [],
      companionVariables: Array.isArray(p.companionVariables) ? (p.companionVariables as PkgVariableDef[]) : [],
      companionDerived: Array.isArray(p.companionDerived) ? (p.companionDerived as PkgDerivedDef[]) : [],
    }))
}

function toActionInput(opt: PkgOption): SomeCompanionActionInputField {
  switch (opt.type) {
    case 'number':
      return {
        type: 'number',
        id: opt.id,
        label: opt.label,
        default: typeof opt.default === 'number' ? opt.default : 0,
        min: opt.min ?? -999999,
        max: opt.max ?? 999999,
      }
    case 'dropdown': {
      const fallback = opt.choices?.[0]?.id ?? ''
      return {
        type: 'dropdown',
        id: opt.id,
        label: opt.label,
        default: typeof opt.default === 'boolean' ? fallback : opt.default ?? fallback,
        choices: (opt.choices ?? []).map((c) => ({ id: c.id, label: c.label })),
      }
    }
    case 'checkbox':
      return { type: 'checkbox', id: opt.id, label: opt.label, default: opt.default === true }
    case 'textinput':
    default:
      return {
        type: 'textinput',
        id: opt.id,
        label: opt.label,
        default: typeof opt.default === 'string' ? opt.default : '',
        useVariables: true,
      }
  }
}

async function collectOptionValues(
  opts: PkgOption[] | undefined,
  eventOptions: Record<string, unknown>,
  parseVariables?: (text: string) => Promise<string>
): Promise<OptionValues> {
  const out: OptionValues = {}
  for (const opt of opts ?? []) {
    let v = eventOptions[opt.id]
    if (opt.type === 'textinput' && typeof v === 'string' && parseVariables) {
      v = await parseVariables(v)
    }
    if (opt.type === 'number') v = Number(v)
    out[opt.id] = v
  }
  return out
}

/**
 * Build Companion definitions for all loaded packages from their declarative
 * manifests. IDs are namespaced: actions `pkg_<id>_<action>`, feedbacks
 * `pkg_<id>_<feedback>`, variables `<id>_<variable>`.
 */
export function buildPackageDefinitions(packages: PackageInfo[], deps: PackageDeps) {
  const actions: Record<string, CompanionActionDefinition> = {}
  const feedbacks: Record<string, CompanionFeedbackDefinition> = {}
  const variableDefs: CompanionVariableDefinition[] = []

  for (const pkg of packages) {
    for (const def of pkg.companionActions) {
      if (!def || typeof def.id !== 'string' || !Array.isArray(def.ops)) continue
      actions[`pkg_${pkg.id}_${def.id}`] = {
        name: `${pkg.name}: ${def.label ?? def.id}`,
        description: def.description,
        options: (def.options ?? []).map(toActionInput),
        callback: async (event, context) => {
          try {
            const options = await collectOptionValues(def.options, event.options, (t) =>
              context.parseVariablesInString(t)
            )
            const state = deps.getPkgState(pkg.id)
            const patch = applyOps(def.ops, options, state)
            if (Object.keys(patch).length > 0) {
              await deps.patchPkg(pkg.id, patch)
            }
          } catch (err) {
            deps.log('error', `${pkg.id}/${def.id} failed: ${(err as Error).message}`)
          }
        },
      }
    }

    for (const def of pkg.companionFeedbacks) {
      if (!def || typeof def.id !== 'string' || typeof def.field !== 'string') continue
      const style = def.defaultStyle
      feedbacks[`pkg_${pkg.id}_${def.id}`] = {
        type: 'boolean',
        name: `${pkg.name}: ${def.label ?? def.id}`,
        defaultStyle: {
          bgcolor: style?.bgcolor ? combineRgb(...style.bgcolor) : combineRgb(0, 200, 0),
          color: style?.color ? combineRgb(...style.color) : combineRgb(255, 255, 255),
        },
        options: (def.options ?? []).map(toActionInput) as SomeCompanionFeedbackInputField[],
        callback: (feedback) => {
          const options: OptionValues = {}
          for (const opt of def.options ?? []) {
            let v = feedback.options[opt.id]
            if (opt.type === 'number') v = Number(v)
            options[opt.id] = v
          }
          const state = computeDerived(pkg.companionDerived, deps.getPkgState(pkg.id))
          return evalFeedback(def, options, state)
        },
        showInvert: true,
      }
    }

    for (const def of pkg.companionVariables) {
      if (!def || typeof def.id !== 'string') continue
      variableDefs.push({ variableId: `${pkg.id}_${def.id}`, name: `${pkg.name}: ${def.label ?? def.id}` })
    }
  }

  /** Current values for every package variable (countdowns computed live). */
  function computeVariableValues(now: number = Date.now()): CompanionVariableValues {
    const values: CompanionVariableValues = {}
    for (const pkg of packages) {
      const state = computeDerived(pkg.companionDerived, deps.getPkgState(pkg.id))
      for (const def of pkg.companionVariables) {
        if (!def || typeof def.id !== 'string') continue
        values[`${pkg.id}_${def.id}`] = variableValue(def, state, now)
      }
    }
    return values
  }

  /** True when any package has a running countdown (needs a 1 s display tick). */
  function needsTick(): boolean {
    return packages.some((pkg) => hasActiveCountdown(pkg.companionVariables, deps.getPkgState(pkg.id)))
  }

  return { actions, feedbacks, variableDefs, computeVariableValues, needsTick }
}
