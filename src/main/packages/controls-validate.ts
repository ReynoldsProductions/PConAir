/**
 * Validation for a package manifest's declarative `controls` block — spec 18
 * §3.7. Split out of loader.ts purely to keep that file readable; the types
 * themselves live in loader.ts alongside the rest of the manifest surface.
 *
 * The contract every message keeps: name the group and the field, so a
 * mis-typed state path is caught when the package loads rather than by an
 * operator wondering why a control does nothing.
 */
import type {
  ControlField,
  ControlGroup,
  ControlSpan,
  PackageControls,
  PackageDataSource,
  PackageRenderDecl,
  PackageSchema,
  PackageSchemaLeaf,
} from './loader';

const GROUP_ID_PATTERN = /^[a-z0-9][a-z0-9-_]*$/;

const FIELD_TYPES = new Set([
  'text',
  'number',
  'toggle',
  'select',
  'color',
  'slider',
  'asset',
  'transport',
  'data',
  'action',
  'static',
]);

const SPANS = new Set<ControlSpan>(['full', 'half', 'third']);

const ASSET_ACCEPTS = new Set(['image', 'video', 'any']);

const ACTION_VARIANTS = new Set(['default', 'danger']);

/** Field types that carry a value and therefore require `field`. */
const VALUE_BEARING = new Set(['text', 'number', 'toggle', 'select', 'color', 'slider', 'asset']);

/** Field types for which `field` must be absent (spec's `field?: never`). */
const FIELDLESS = new Set(['transport', 'data', 'static']);

export interface ControlsValidationContext {
  stateSchema: PackageSchema | undefined;
  renders: PackageRenderDecl[];
  dataSources: PackageDataSource[] | undefined;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** "controls group 'look' field 'Accent': <detail>" */
function where(groupId: string, field?: { label?: unknown; index: number }): string {
  if (!field) return `controls group '${groupId}'`;
  const label = typeof field.label === 'string' && field.label.length > 0 ? `'${field.label}'` : `[${field.index}]`;
  return `controls group '${groupId}' field ${label}`;
}

export function validateControls(raw: unknown, ctx: ControlsValidationContext): string | null {
  if (!isPlainObject(raw)) return 'controls must be an object with a groups array';
  if (!Array.isArray(raw.groups)) return 'controls.groups must be an array';

  const seenGroupIds = new Set<string>();
  for (let g = 0; g < raw.groups.length; g++) {
    const err = validateGroup(raw.groups[g], g, seenGroupIds, ctx);
    if (err) return err;
  }
  return null;
}

function validateGroup(
  raw: unknown,
  index: number,
  seenGroupIds: Set<string>,
  ctx: ControlsValidationContext
): string | null {
  if (!isPlainObject(raw)) return `controls.groups[${index}] must be an object`;
  const id = raw.id;
  if (typeof id !== 'string' || !GROUP_ID_PATTERN.test(id)) {
    return `controls.groups[${index}]: id must be lowercase alphanumeric (with - or _)`;
  }
  if (seenGroupIds.has(id)) return `${where(id)}: duplicate group id`;
  seenGroupIds.add(id);

  if (typeof raw.label !== 'string' || raw.label.length === 0) return `${where(id)}: label is required`;
  if (raw.collapsed !== undefined && typeof raw.collapsed !== 'boolean') {
    return `${where(id)}: collapsed must be a boolean`;
  }
  if (raw.renderId !== undefined) {
    if (typeof raw.renderId !== 'string') return `${where(id)}: renderId must be a string`;
    if (!ctx.renders.some((r) => r.id === raw.renderId)) {
      return `${where(id)}: renderId '${raw.renderId}' names no declared render`;
    }
  }
  if (!Array.isArray(raw.fields) || raw.fields.length === 0) {
    return `${where(id)}: fields must be a non-empty array`;
  }
  for (let f = 0; f < raw.fields.length; f++) {
    const err = validateField(raw.fields[f], f, id, ctx);
    if (err) return err;
  }
  return null;
}

function validateField(raw: unknown, index: number, groupId: string, ctx: ControlsValidationContext): string | null {
  if (!isPlainObject(raw)) return `${where(groupId, { index })}: must be an object`;
  const at = where(groupId, { label: raw.label, index });

  if (typeof raw.type !== 'string' || !FIELD_TYPES.has(raw.type)) {
    return `${at}: unknown field type '${String(raw.type)}'`;
  }
  if (typeof raw.label !== 'string' || raw.label.length === 0) {
    return `${where(groupId, { index })}: label is required`;
  }
  if (raw.help !== undefined && typeof raw.help !== 'string') return `${at}: help must be a string`;
  if (raw.span !== undefined && !SPANS.has(raw.span as ControlSpan)) {
    return `${at}: span must be one of full, half, third`;
  }
  if (FIELDLESS.has(raw.type) && raw.field !== undefined) {
    return `${at}: a ${raw.type} field must not declare 'field'`;
  }
  if (VALUE_BEARING.has(raw.type) && (typeof raw.field !== 'string' || raw.field.length === 0)) {
    return `${at}: a ${raw.type} field requires a dotted state path in 'field'`;
  }

  const perType = validateFieldShape(raw, at, ctx);
  if (perType) return perType;

  // A typo'd path is caught here, at load, rather than by an operator
  // wondering why a control does nothing (spec 18 §3.7).
  if (typeof raw.field === 'string') {
    const resolved = resolveSchemaPath(ctx.stateSchema, raw.field);
    if (!resolved.ok) return `${at}: path '${raw.field}' ${resolved.reason}`;
  }

  return null;
}

/** Per-type required/optional members. Path resolution is layered on in T2-T4. */
function validateFieldShape(
  raw: Record<string, unknown>,
  at: string,
  ctx: ControlsValidationContext
): string | null {
  switch (raw.type) {
    case 'text':
      if (raw.multiline !== undefined && typeof raw.multiline !== 'boolean') {
        return `${at}: multiline must be a boolean`;
      }
      if (raw.list !== undefined && typeof raw.list !== 'boolean') return `${at}: list must be a boolean`;
      if (raw.maxLength !== undefined && (typeof raw.maxLength !== 'number' || raw.maxLength <= 0)) {
        return `${at}: maxLength must be a positive number`;
      }
      if (raw.placeholder !== undefined && typeof raw.placeholder !== 'string') {
        return `${at}: placeholder must be a string`;
      }
      return null;
    case 'number':
      for (const key of ['min', 'max', 'step'] as const) {
        if (raw[key] !== undefined && typeof raw[key] !== 'number') return `${at}: ${key} must be a number`;
      }
      if (typeof raw.min === 'number' && typeof raw.max === 'number' && raw.min > raw.max) {
        return `${at}: min must not exceed max`;
      }
      if (raw.bump !== undefined) {
        if (!Array.isArray(raw.bump) || raw.bump.length === 0 || raw.bump.some((b) => typeof b !== 'number' || b === 0)) {
          return `${at}: bump must be a non-empty array of non-zero numbers`;
        }
      }
      return null;
    case 'toggle':
      return null;
    case 'select': {
      if (!Array.isArray(raw.choices) || raw.choices.length === 0) {
        return `${at}: select requires at least one choice`;
      }
      for (const c of raw.choices) {
        if (!isPlainObject(c) || (typeof c.id !== 'string' && typeof c.id !== 'number')) {
          return `${at}: each choice needs an id (string or number)`;
        }
        if (typeof c.label !== 'string' || c.label.length === 0) {
          return `${at}: choice '${String(c.id)}' needs a label`;
        }
      }
      return null;
    }
    case 'color': {
      if (raw.swatches !== undefined) {
        if (!Array.isArray(raw.swatches)) return `${at}: swatches must be an array`;
        for (const s of raw.swatches) {
          if (!isValidColorValue(s)) return `${at}: swatch '${String(s)}' is not a valid colour value`;
        }
      }
      return null;
    }
    case 'slider': {
      if (typeof raw.min !== 'number' || typeof raw.max !== 'number') {
        return `${at}: slider requires numeric min and max`;
      }
      if (!(raw.min < raw.max)) return `${at}: slider min must be less than max`;
      if (raw.step !== undefined && (typeof raw.step !== 'number' || raw.step <= 0)) {
        return `${at}: step must be a positive number`;
      }
      if (raw.unit !== undefined && typeof raw.unit !== 'string') return `${at}: unit must be a string`;
      return null;
    }
    case 'asset':
      if (raw.accept !== undefined && !ASSET_ACCEPTS.has(raw.accept as string)) {
        return `${at}: accept must be one of image, video, any`;
      }
      return null;
    case 'transport':
      if (typeof raw.renderId !== 'string' || raw.renderId.length === 0) {
        return `${at}: transport requires a renderId`;
      }
      return null;
    case 'data':
      if (typeof raw.sourceId !== 'string' || raw.sourceId.length === 0) {
        return `${at}: data requires a sourceId`;
      }
      return null;
    case 'action': {
      if (!isPlainObject(raw.patch) || Object.keys(raw.patch).length === 0) {
        return `${at}: action requires a non-empty 'patch' object`;
      }
      if (raw.confirm !== undefined && (typeof raw.confirm !== 'string' || raw.confirm.length === 0)) {
        return `${at}: confirm must be a non-empty string`;
      }
      if (raw.variant !== undefined && !ACTION_VARIANTS.has(raw.variant as string)) {
        return `${at}: variant must be 'default' or 'danger'`;
      }
      return null;
    }
    case 'static':
      if (typeof raw.text !== 'string' || raw.text.length === 0) {
        return `${at}: static field requires a non-empty 'text'`;
      }
      return null;
    default:
      // Unreachable: FIELD_TYPES is checked by the caller.
      return `${at}: unknown field type '${String(raw.type)}'`;
  }
}

// ── Colour safety (spec 18 §3.3) ──────────────────────────────────────────
//
// A `color` field's value ends up in a CSS custom property on a live render's
// <html style="..."> via client.applyStyle(). An unvalidated value is a CSS
// injection into every connected output, so it is checked here (server-side,
// before it enters state) AND again by applyStyle client-side.

/**
 * Named colours accepted in addition to hex. Deliberately a short fixed list
 * rather than the full CSS keyword set: the point is to be exhaustively
 * enumerable, so nothing that is not on it can reach a style attribute.
 */
export const NAMED_COLORS: ReadonlySet<string> = new Set([
  'transparent',
  'currentcolor',
  'black',
  'white',
  'red',
  'green',
  'blue',
  'yellow',
  'orange',
  'purple',
  'pink',
  'brown',
  'gray',
  'grey',
  'cyan',
  'magenta',
  'silver',
  'gold',
  'navy',
  'teal',
  'olive',
  'maroon',
  'lime',
  'aqua',
  'fuchsia',
]);

/** Substrings that let a value escape a single CSS declaration. */
export const UNSAFE_STYLE_FRAGMENTS: readonly string[] = [';', '}', '{', '/*', '*/', 'url(', '\\'];

const HEX_COLOR = /^#[0-9a-fA-F]{3,8}$/;

/** True when `v` may safely be written into a CSS custom property. */
export function isSafeStyleValue(v: unknown): boolean {
  if (typeof v === 'number') return Number.isFinite(v);
  if (typeof v === 'boolean') return true;
  if (typeof v !== 'string') return false;
  const lower = v.toLowerCase();
  for (const bad of UNSAFE_STYLE_FRAGMENTS) {
    if (lower.indexOf(bad) !== -1) return false;
  }
  // `expression(...)` and friends: anything with a function call is refused
  // outright. Nothing a declarative control produces needs one.
  if (lower.indexOf('(') !== -1 || lower.indexOf(')') !== -1) return false;
  return true;
}

/** Strict check for a `color`-typed field's value. */
export function isValidColorValue(v: unknown): boolean {
  if (typeof v !== 'string' || v.length === 0) return false;
  if (!isSafeStyleValue(v)) return false;
  if (HEX_COLOR.test(v)) return true;
  return NAMED_COLORS.has(v.toLowerCase());
}

// ── Schema path resolution ───────────────────────────────────────────────
// Layered in by T2-T4.

/** What a dotted path resolves to. 'unknown' = under an array leaf. */
export type ResolvedLeaf = PackageSchemaLeaf | 'unknown';

export type PathResolution = { ok: true; leaf: ResolvedLeaf } | { ok: false; reason: string };

/**
 * Resolve a dotted state path against a stateSchema. Array leaves swallow the
 * rest of the path and resolve to 'unknown', because a manifest's `[]` says
 * nothing about element types — `scores.0` is valid, and untyped.
 */
export function resolveSchemaPath(schema: PackageSchema | undefined, dotted: string): PathResolution {
  if (!schema) return { ok: false, reason: 'the manifest declares no stateSchema' };
  const parts = dotted.split('.');
  if (parts.some((p) => p.length === 0)) return { ok: false, reason: 'malformed path' };
  let cur: unknown = schema;
  for (let i = 0; i < parts.length; i++) {
    if (Array.isArray(cur)) return { ok: true, leaf: 'unknown' };
    if (typeof cur === 'string') {
      return { ok: false, reason: `'${parts.slice(0, i).join('.')}' is a ${cur}, not an object` };
    }
    if (!isPlainObject(cur)) return { ok: false, reason: 'no such path in stateSchema' };
    if (!Object.prototype.hasOwnProperty.call(cur, parts[i])) {
      return { ok: false, reason: 'no such path in stateSchema' };
    }
    cur = (cur as Record<string, unknown>)[parts[i]];
  }
  if (Array.isArray(cur)) return { ok: true, leaf: 'unknown' };
  if (cur === 'string' || cur === 'number' || cur === 'boolean') return { ok: true, leaf: cur };
  return { ok: false, reason: 'resolves to an object, not a value' };
}

/** Every `color`-typed field's dotted path, for POST /state validation. */
export function colorFieldPaths(controls: PackageControls | undefined): string[] {
  const out: string[] = [];
  if (!controls) return out;
  for (const group of controls.groups ?? []) {
    for (const field of group.fields ?? []) {
      if (field.type === 'color' && typeof field.field === 'string') out.push(field.field);
    }
  }
  return out;
}

/** Read a dotted path out of a plain object. Returns undefined when absent. */
function readPath(obj: unknown, dotted: string): { present: boolean; value: unknown } {
  const parts = dotted.split('.');
  let cur: unknown = obj;
  for (const part of parts) {
    if (Array.isArray(cur)) {
      const idx = Number(part);
      if (!Number.isInteger(idx) || idx < 0 || idx >= cur.length) return { present: false, value: undefined };
      cur = cur[idx];
      continue;
    }
    if (!isPlainObject(cur) || !Object.prototype.hasOwnProperty.call(cur, part)) {
      return { present: false, value: undefined };
    }
    cur = cur[part];
  }
  return { present: true, value: cur };
}

/**
 * Reject a state patch that sets a `color`-typed field to something that is
 * not a colour. Returns a message for a 400, or null when the patch is clean.
 */
export function validateColorPatch(
  controls: PackageControls | undefined,
  patch: Record<string, unknown>
): string | null {
  for (const dotted of colorFieldPaths(controls)) {
    const { present, value } = readPath(patch, dotted);
    if (!present || value === undefined || value === null) continue;
    if (!isValidColorValue(value)) {
      return `'${dotted}' must be a hex colour (#rgb…#rrggbbaa) or a named colour; got ${JSON.stringify(value)}`;
    }
  }
  return null;
}

/** Re-exported for tests and callers that only need the union guard. */
export function isControlField(v: unknown): v is ControlField {
  return isPlainObject(v) && typeof v.type === 'string' && FIELD_TYPES.has(v.type);
}

export type { ControlGroup, PackageControls };
