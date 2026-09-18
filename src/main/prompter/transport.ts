import type { PrompterState } from '../../shared/types';

/** Scroll rate bounds in px/sec. */
export const SPEED_MIN = 0;
export const SPEED_MAX = 200;
/** Script size bounds in px. */
export const FONT_SIZE_MIN = 24;
export const FONT_SIZE_MAX = 200;
/** Line height bounds, as a multiple of the font size. */
export const LINE_HEIGHT_MIN = 1;
export const LINE_HEIGHT_MAX = 3;
/** Side padding bounds, as a percent of viewport width (vw). */
export const SIDE_PADDING_MIN = 0;
export const SIDE_PADDING_MAX = 30;
/** Reading marker bounds, as a percent of screen height. */
export const MARKER_POSITION_MIN = 0;
export const MARKER_POSITION_MAX = 100;

/** Step used by the "faster/slower" and "A+/A−" transport buttons. */
export const SPEED_STEP = 10;
export const FONT_SIZE_STEP = 4;
/** Step used by the marker up/down buttons, in percent of screen height. */
export const MARKER_POSITION_STEP = 2;
/** Step used by the margin +/− buttons, in vw. */
export const SIDE_PADDING_STEP = 1;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function clampSpeed(speed: number): number {
  return clamp(Math.round(speed), SPEED_MIN, SPEED_MAX);
}

function clampFontSize(fontSize: number): number {
  return clamp(Math.round(fontSize), FONT_SIZE_MIN, FONT_SIZE_MAX);
}

/**
 * Where the script sits right now, in px scrolled from the top. Derived from
 * the anchor so that a viewer joining mid-run lands in the same place as one
 * that has been watching since the start.
 */
export function positionAt(state: PrompterState, now: number): number {
  if (state.startedAt === null) return Math.max(0, state.offset);
  const elapsedSec = (now - state.startedAt) / 1000;
  return Math.max(0, state.offset + elapsedSec * state.speed);
}

/** Re-anchor on the current position, keeping the run state as it is. */
function reanchor(state: PrompterState, now: number, patch: Partial<PrompterState>): PrompterState {
  return {
    ...state,
    ...patch,
    offset: positionAt(state, now),
    startedAt: state.startedAt === null ? null : now,
  };
}

export function start(state: PrompterState, now: number): PrompterState {
  if (state.scrolling && state.startedAt !== null) return state;
  return { ...state, scrolling: true, offset: positionAt(state, now), startedAt: now };
}

export function stop(state: PrompterState, now: number): PrompterState {
  return { ...state, scrolling: false, offset: positionAt(state, now), startedAt: null };
}

export function toggle(state: PrompterState, now: number): PrompterState {
  return state.scrolling ? stop(state, now) : start(state, now);
}

export function setSpeed(state: PrompterState, speed: number, now: number): PrompterState {
  return reanchor(state, now, { speed: clampSpeed(speed) });
}

export function nudgeSpeed(state: PrompterState, delta: number, now: number): PrompterState {
  return setSpeed(state, state.speed + delta, now);
}

export function setFontSize(state: PrompterState, fontSize: number): PrompterState {
  return { ...state, fontSize: clampFontSize(fontSize) };
}

export function nudgeFontSize(state: PrompterState, delta: number): PrompterState {
  return setFontSize(state, state.fontSize + delta);
}

export function setLineHeight(state: PrompterState, lineHeight: number): PrompterState {
  return { ...state, lineHeight: clamp(lineHeight, LINE_HEIGHT_MIN, LINE_HEIGHT_MAX) };
}

/**
 * Load a script. Always parks at the top: leaving a half-scrolled position
 * against fresh copy would drop the talent into the middle of a new script.
 */
export function setScript(state: PrompterState, script: string, _now: number): PrompterState {
  return { ...state, script, scrolling: false, offset: 0, startedAt: null };
}

/** Jump to an absolute px position; keeps running if it was already running. */
export function seek(state: PrompterState, position: number, now: number): PrompterState {
  return {
    ...state,
    offset: Math.max(0, position),
    startedAt: state.startedAt === null ? null : now,
  };
}

/** Jump forwards (+) or backwards (−) relative to the live position. */
export function nudgePosition(state: PrompterState, deltaPx: number, now: number): PrompterState {
  return seek(state, positionAt(state, now) + deltaPx, now);
}

/** Park the script back at the top without changing the run state. */
export function rewind(state: PrompterState, now: number): PrompterState {
  return seek(state, 0, now);
}

export function setMirror(state: PrompterState, axes: { x?: boolean; y?: boolean }): PrompterState {
  return {
    ...state,
    mirrorX: axes.x ?? state.mirrorX,
    mirrorY: axes.y ?? state.mirrorY,
  };
}

export function setSidePadding(state: PrompterState, sidePadding: number): PrompterState {
  return { ...state, sidePadding: clamp(sidePadding, SIDE_PADDING_MIN, SIDE_PADDING_MAX) };
}

/** Widen (+) or narrow (−) the gap at each side of the script. */
export function nudgeSidePadding(state: PrompterState, delta: number): PrompterState {
  return setSidePadding(state, state.sidePadding + delta);
}

export function setMarkerPosition(state: PrompterState, markerPosition: number): PrompterState {
  return {
    ...state,
    markerPosition: clamp(markerPosition, MARKER_POSITION_MIN, MARKER_POSITION_MAX),
  };
}

/** Move the marker down (+) or up (−) the screen. */
export function nudgeMarkerPosition(state: PrompterState, delta: number): PrompterState {
  return setMarkerPosition(state, state.markerPosition + delta);
}

export function setMarkerVisible(state: PrompterState, markerVisible: boolean): PrompterState {
  return { ...state, markerVisible };
}

export function toggleMarker(state: PrompterState): PrompterState {
  return setMarkerVisible(state, !state.markerVisible);
}
