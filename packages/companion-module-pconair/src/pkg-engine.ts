/**
 * Declarative engine for package-defined Companion interfaces.
 *
 * Packages declare actions/feedbacks/variables in their package.json (see
 * PConAir src/main/packages/loader.ts for the schema). This module resolves
 * those declarations against the package's live state:
 *  - field paths: dot-separated, numeric segments index arrays, and
 *    "{optionId}" placeholders are substituted from action options
 *  - values: literals, { option } (with optional orState fallback and split
 *    delimiter), { state } refs, arrays/objects resolved element-wise
 *  - countdown ops implement the deadline-epoch-ms pattern the bundled
 *    packages use for game clocks and ship-by timers
 *
 * Pure functions only — no Companion or network imports (unit-testable).
 */

export type PkgState = Record<string, unknown>

export type OptionValues = Record<string, unknown>

export interface PkgOption {
  id: string
  label: string
  type: 'number' | 'textinput' | 'dropdown' | 'checkbox'
  default?: string | number | boolean
  min?: number
  max?: number
  choices?: Array<{ id: string | number; label: string }>
}

export type PkgOp =
  | { op: 'set'; field: string; value: unknown }
  | { op: 'add'; field: string; value: unknown; min?: number; max?: number }
  | { op: 'toggle'; field: string }
  | {
      op: 'countdown_start' | 'countdown_stop' | 'countdown_reset'
      deadlineField: string
      valueField: string
      format: 'mm:ss' | 'seconds'
      runningField?: string
      value?: unknown
      defaultValue?: number
    }

export interface PkgActionDef {
  id: string
  label: string
  description?: string
  options?: PkgOption[]
  ops: PkgOp[]
}

export interface PkgFeedbackDef {
  id: string
  label: string
  field: string
  equals?: unknown
  notEquals?: unknown
  options?: PkgOption[]
  defaultStyle?: { bgcolor?: [number, number, number]; color?: [number, number, number] }
}

export interface PkgVariableDef {
  id: string
  label: string
  field?: string
  countdown?: { deadlineField: string; valueField: string; runningField?: string; format: 'mm:ss' | 'seconds' }
}

export type PkgDerivedDef =
  | { field: string; fn: 'argmax'; source: string }
  | { field: string; fn: 'lookup'; source: string; index: string; path: string }

// ── path helpers ─────────────────────────────────────────────────────────────

/** Substitute "{optionId}" placeholders in a field path. */
export function resolveFieldPath(field: string, options: OptionValues): string {
  return field.replace(/\{([a-zA-Z0-9_]+)\}/g, (_m, id: string) => String(options[id] ?? ''))
}

export function getPath(state: unknown, path: string): unknown {
  let cur: unknown = state
  for (const seg of path.split('.')) {
    if (cur === null || cur === undefined) return undefined
    if (Array.isArray(cur)) {
      cur = cur[Number(seg)]
    } else if (typeof cur === 'object') {
      cur = (cur as Record<string, unknown>)[seg]
    } else {
      return undefined
    }
  }
  return cur
}

function setPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const segs = path.split('.')
  let cur: unknown = target
  for (let i = 0; i < segs.length - 1; i++) {
    const seg = segs[i]
    const container = cur as Record<string, unknown>
    let next: unknown = Array.isArray(container) ? (container as unknown[])[Number(seg)] : container[seg]
    if (next === null || next === undefined || typeof next !== 'object') {
      next = /^\d+$/.test(segs[i + 1]) ? [] : {}
      if (Array.isArray(container)) (container as unknown[])[Number(seg)] = next
      else container[seg] = next
    }
    cur = next
  }
  const last = segs[segs.length - 1]
  if (Array.isArray(cur)) (cur as unknown[])[Number(last)] = value
  else (cur as Record<string, unknown>)[last] = value
}

function deepClone<T>(v: T): T {
  return v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T)
}

// ── value resolution ─────────────────────────────────────────────────────────

function isOptionRef(v: unknown): v is { option: string; orState?: string; split?: string } {
  return typeof v === 'object' && v !== null && typeof (v as Record<string, unknown>).option === 'string'
}

function isStateRef(v: unknown): v is { state: string } {
  return typeof v === 'object' && v !== null && typeof (v as Record<string, unknown>).state === 'string'
}

export function resolveValue(v: unknown, options: OptionValues, state: PkgState): unknown {
  if (isOptionRef(v)) {
    let val = options[v.option]
    const empty = val === undefined || val === null || val === ''
    if (empty && v.orState) {
      return getPath(state, resolveFieldPath(v.orState, options))
    }
    if (v.split !== undefined && typeof val === 'string') {
      return val
        .split(v.split)
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
    }
    return empty ? '' : val
  }
  if (isStateRef(v)) {
    return getPath(state, resolveFieldPath(v.state, options))
  }
  if (Array.isArray(v)) {
    return v.map((x) => resolveValue(x, options, state))
  }
  if (typeof v === 'object' && v !== null) {
    const out: Record<string, unknown> = {}
    for (const [k, val] of Object.entries(v)) out[k] = resolveValue(val, options, state)
    return out
  }
  return v
}

// ── countdown helpers ────────────────────────────────────────────────────────

export function parseClockMmSs(str: string): number {
  const m = /^(\d+):(\d{1,2})$/.exec(str.trim())
  if (!m) return 0
  return Number(m[1]) * 60 + Number(m[2])
}

export function formatClockMmSs(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds))
  const mm = String(Math.floor(s / 60)).padStart(2, '0')
  const ss = String(s % 60).padStart(2, '0')
  return `${mm}:${ss}`
}

/** Remaining seconds from a static display value ('mm:ss' string or seconds number). */
function staticRemainingSeconds(value: unknown, format: 'mm:ss' | 'seconds'): number | null {
  if (value === null || value === undefined || value === '') return null
  if (format === 'mm:ss') return typeof value === 'string' ? parseClockMmSs(value) : Number(value) || 0
  return Number(value) || 0
}

function formatStatic(seconds: number, format: 'mm:ss' | 'seconds'): string | number {
  return format === 'mm:ss' ? formatClockMmSs(seconds) : Math.max(0, Math.round(seconds * 10) / 10)
}

// ── ops ──────────────────────────────────────────────────────────────────────

/**
 * Apply an action's ops to the package state and return the top-level patch
 * to POST. Later ops see the effect of earlier ones.
 */
export function applyOps(ops: PkgOp[], options: OptionValues, state: PkgState, now: number = Date.now()): PkgState {
  const work = deepClone(state)
  const touched = new Set<string>()

  function set(fieldTemplate: string, value: unknown): void {
    const path = resolveFieldPath(fieldTemplate, options)
    setPath(work, path, value)
    touched.add(path.split('.')[0])
  }

  for (const op of ops) {
    switch (op.op) {
      case 'set': {
        set(op.field, resolveValue(op.value, options, work))
        break
      }
      case 'add': {
        const path = resolveFieldPath(op.field, options)
        const cur = Number(getPath(work, path)) || 0
        const delta = Number(resolveValue(op.value, options, work)) || 0
        let next = cur + delta
        if (op.min !== undefined) next = Math.max(op.min, next)
        if (op.max !== undefined) next = Math.min(op.max, next)
        set(op.field, next)
        break
      }
      case 'toggle': {
        const path = resolveFieldPath(op.field, options)
        set(op.field, !getPath(work, path))
        break
      }
      case 'countdown_start': {
        const deadline = Number(getPath(work, resolveFieldPath(op.deadlineField, options))) || 0
        let remaining: number | null
        if (deadline > now) {
          remaining = (deadline - now) / 1000 // already running — restart from live remaining
        } else {
          remaining = staticRemainingSeconds(getPath(work, resolveFieldPath(op.valueField, options)), op.format)
        }
        if (remaining === null || remaining <= 0) remaining = op.defaultValue ?? 0
        set(op.deadlineField, now + remaining * 1000)
        if (op.runningField) set(op.runningField, true)
        break
      }
      case 'countdown_stop': {
        const deadline = Number(getPath(work, resolveFieldPath(op.deadlineField, options))) || 0
        const remaining =
          deadline > 0
            ? Math.max(0, (deadline - now) / 1000)
            : staticRemainingSeconds(getPath(work, resolveFieldPath(op.valueField, options)), op.format) ?? 0
        set(op.valueField, formatStatic(remaining, op.format))
        set(op.deadlineField, 0)
        if (op.runningField) set(op.runningField, false)
        break
      }
      case 'countdown_reset': {
        const deadline = Number(getPath(work, resolveFieldPath(op.deadlineField, options))) || 0
        const running =
          deadline > now ||
          (op.runningField ? Boolean(getPath(work, resolveFieldPath(op.runningField, options))) : false)
        const target = staticRemainingSeconds(resolveValue(op.value, options, work), op.format) ?? op.defaultValue ?? 0
        set(op.valueField, formatStatic(target, op.format))
        if (running) {
          set(op.deadlineField, now + target * 1000)
          if (op.runningField) set(op.runningField, true)
        } else {
          set(op.deadlineField, 0)
        }
        break
      }
    }
  }

  const patch: PkgState = {}
  for (const key of touched) patch[key] = work[key]
  return patch
}

// ── derived fields ───────────────────────────────────────────────────────────

/** Compute derived fields (argmax/lookup) into a copy of the state. */
export function computeDerived(deriveds: PkgDerivedDef[] | undefined, state: PkgState): PkgState {
  if (!deriveds || deriveds.length === 0) return state
  const out: PkgState = { ...state }
  for (const d of deriveds) {
    if (d.fn === 'argmax') {
      const arr = getPath(out, d.source)
      if (Array.isArray(arr) && arr.length > 0) {
        let best = -1
        let bestVal = -Infinity
        let tie = false
        arr.forEach((v, i) => {
          const n = Number(v) || 0
          if (n > bestVal) {
            bestVal = n
            best = i
            tie = false
          } else if (n === bestVal) {
            tie = true
          }
        })
        out[d.field] = tie ? -1 : best
      } else {
        out[d.field] = -1
      }
    } else if (d.fn === 'lookup') {
      const arr = getPath(out, d.source)
      const idx = Number(getPath(out, d.index))
      if (Array.isArray(arr) && Number.isInteger(idx) && idx >= 0 && idx < arr.length) {
        out[d.field] = getPath(arr[idx], d.path) ?? ''
      } else {
        out[d.field] = ''
      }
    }
  }
  return out
}

// ── feedback / variable evaluation ──────────────────────────────────────────

function looseEq(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === null || a === undefined || b === null || b === undefined) return false
  return String(a) === String(b)
}

/** Evaluate a feedback against derived state. */
export function evalFeedback(def: PkgFeedbackDef, options: OptionValues, state: PkgState): boolean {
  const value = getPath(state, resolveFieldPath(def.field, options))
  if (def.equals !== undefined) {
    return looseEq(value, resolveValue(def.equals, options, state))
  }
  if (def.notEquals !== undefined) {
    return !looseEq(value, resolveValue(def.notEquals, options, state))
  }
  return Boolean(value)
}

/** Current display string for a variable (countdowns computed live). */
export function variableValue(def: PkgVariableDef, state: PkgState, now: number = Date.now()): string {
  if (def.countdown) {
    const cd = def.countdown
    const deadline = Number(getPath(state, cd.deadlineField)) || 0
    let seconds: number | null
    if (deadline > 0) {
      seconds = Math.max(0, (deadline - now) / 1000)
    } else {
      seconds = staticRemainingSeconds(getPath(state, cd.valueField), cd.format)
    }
    if (seconds === null) return cd.format === 'mm:ss' ? '--:--' : ''
    return cd.format === 'mm:ss' ? formatClockMmSs(seconds) : String(Math.ceil(seconds))
  }
  const v = def.field !== undefined ? getPath(state, def.field) : undefined
  if (v === null || v === undefined) return ''
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

/** True when any variable of this set needs a periodic tick (running countdown). */
export function hasActiveCountdown(defs: PkgVariableDef[], state: PkgState): boolean {
  return defs.some((d) => {
    if (!d.countdown) return false
    return (Number(getPath(state, d.countdown.deadlineField)) || 0) > 0
  })
}
