import { describe, it, expect } from 'vitest';
import { makePrompterState } from '../src/shared/types';
import {
  positionAt,
  start,
  stop,
  toggle,
  setSpeed,
  nudgeSpeed,
  setFontSize,
  nudgeFontSize,
  setLineHeight,
  setScript,
  seek,
  nudgePosition,
  setMirror,
  setMaxWidth,
  setMarkerPosition,
  nudgeMarkerPosition,
  setMarkerVisible,
  toggleMarker,
  MAX_WIDTH_MIN,
  MAX_WIDTH_MAX,
  MARKER_POSITION_MIN,
  MARKER_POSITION_MAX,
  MARKER_POSITION_STEP,
} from '../src/main/prompter/transport';

const T0 = 1_700_000_000_000;

describe('prompter transport ops', () => {
  it('defaults to a parked, non-scrolling prompter', () => {
    const s = makePrompterState();
    expect(s.scrolling).toBe(false);
    expect(s.startedAt).toBeNull();
    expect(s.offset).toBe(0);
    expect(positionAt(s, T0)).toBe(0);
  });

  it('never mutates the state it is given', () => {
    const s = makePrompterState();
    const frozen = Object.freeze({ ...s });
    const next = start(frozen, T0);
    expect(next).not.toBe(frozen);
    expect(frozen.scrolling).toBe(false);
    expect(next.scrolling).toBe(true);
  });

  it('advances the position at the configured speed while scrolling', () => {
    const s = start({ ...makePrompterState(), speed: 40 }, T0);
    expect(positionAt(s, T0)).toBe(0);
    expect(positionAt(s, T0 + 1000)).toBe(40);
    expect(positionAt(s, T0 + 2500)).toBe(100);
  });

  it('freezes the position where it was when stopped', () => {
    const running = start({ ...makePrompterState(), speed: 40 }, T0);
    const stopped = stop(running, T0 + 3000);
    expect(stopped.scrolling).toBe(false);
    expect(stopped.startedAt).toBeNull();
    expect(stopped.offset).toBe(120);
    expect(positionAt(stopped, T0 + 60_000)).toBe(120);
  });

  it('resumes from where it stopped', () => {
    const stopped = stop(start({ ...makePrompterState(), speed: 40 }, T0), T0 + 3000);
    const resumed = start(stopped, T0 + 10_000);
    expect(positionAt(resumed, T0 + 11_000)).toBe(160);
  });

  it('toggles between running and stopped', () => {
    const s = makePrompterState();
    const running = toggle(s, T0);
    expect(running.scrolling).toBe(true);
    expect(toggle(running, T0 + 1000).scrolling).toBe(false);
  });

  it('re-anchors the position when the speed changes mid-run', () => {
    const running = start({ ...makePrompterState(), speed: 40 }, T0);
    const faster = setSpeed(running, 100, T0 + 2000);
    expect(faster.offset).toBe(80);
    expect(faster.startedAt).toBe(T0 + 2000);
    expect(positionAt(faster, T0 + 3000)).toBe(180);
  });

  it('clamps speed to 0-200 and font size to 24-200', () => {
    const s = makePrompterState();
    expect(setSpeed(s, 500, T0).speed).toBe(200);
    expect(setSpeed(s, -20, T0).speed).toBe(0);
    expect(setSpeed(s, 41.6, T0).speed).toBe(42);
    expect(setFontSize(s, 10).fontSize).toBe(24);
    expect(setFontSize(s, 900).fontSize).toBe(200);
    expect(nudgeSpeed({ ...s, speed: 195 }, 10, T0).speed).toBe(200);
    expect(nudgeFontSize({ ...s, fontSize: 26 }, -4).fontSize).toBe(24);
  });

  it('clamps line height to 1-3', () => {
    const s = makePrompterState();
    expect(setLineHeight(s, 0.2).lineHeight).toBe(1);
    expect(setLineHeight(s, 9).lineHeight).toBe(3);
    expect(setLineHeight(s, 1.75).lineHeight).toBe(1.75);
  });

  it('rewinds to the top when a new script is loaded, and stops scrolling', () => {
    const running = start({ ...makePrompterState(), speed: 40 }, T0);
    const loaded = setScript(running, 'Good evening.', T0 + 5000);
    expect(loaded.script).toBe('Good evening.');
    expect(loaded.scrolling).toBe(false);
    expect(loaded.offset).toBe(0);
    expect(positionAt(loaded, T0 + 20_000)).toBe(0);
  });

  it('seeks to an absolute position without disturbing the run state', () => {
    const running = start({ ...makePrompterState(), speed: 40 }, T0);
    const sought = seek(running, 500, T0 + 1000);
    expect(sought.scrolling).toBe(true);
    expect(positionAt(sought, T0 + 1000)).toBe(500);
    expect(positionAt(sought, T0 + 2000)).toBe(540);
    expect(seek(running, -50, T0 + 1000).offset).toBe(0);
  });

  it('nudges the position relative to where the script currently sits', () => {
    const running = start({ ...makePrompterState(), speed: 40 }, T0);
    const back = nudgePosition(running, -100, T0 + 5000);
    expect(positionAt(back, T0 + 5000)).toBe(100);
    const floored = nudgePosition(running, -10_000, T0 + 1000);
    expect(positionAt(floored, T0 + 1000)).toBe(0);
  });

  it('flips the mirror axes independently', () => {
    const s = makePrompterState();
    expect(setMirror(s, { x: true }).mirrorX).toBe(true);
    expect(setMirror(s, { x: true }).mirrorY).toBe(false);
    expect(setMirror({ ...s, mirrorX: true }, { y: true })).toMatchObject({ mirrorX: true, mirrorY: true });
  });

  it('starts with an uncapped line width and a visible marker at 38%', () => {
    const s = makePrompterState();
    expect(s.maxWidth).toBe(0);
    expect(s.markerPosition).toBe(38);
    expect(s.markerVisible).toBe(true);
  });

  it('clamps the max line width, keeping 0 as "uncapped"', () => {
    const s = makePrompterState();
    expect(setMaxWidth(s, 0).maxWidth).toBe(0);
    expect(setMaxWidth(s, 1200).maxWidth).toBe(1200);
    expect(setMaxWidth(s, 10).maxWidth).toBe(MAX_WIDTH_MIN);
    expect(setMaxWidth(s, 99_999).maxWidth).toBe(MAX_WIDTH_MAX);
  });

  it('clamps the marker position to the screen', () => {
    const s = makePrompterState();
    expect(setMarkerPosition(s, 10).markerPosition).toBe(10);
    expect(setMarkerPosition(s, -20).markerPosition).toBe(MARKER_POSITION_MIN);
    expect(setMarkerPosition(s, 140).markerPosition).toBe(MARKER_POSITION_MAX);
  });

  it('nudges the marker up and down by a delta', () => {
    const s = makePrompterState();
    expect(nudgeMarkerPosition(s, MARKER_POSITION_STEP).markerPosition).toBe(38 + MARKER_POSITION_STEP);
    expect(nudgeMarkerPosition(s, -MARKER_POSITION_STEP).markerPosition).toBe(38 - MARKER_POSITION_STEP);
    expect(nudgeMarkerPosition({ ...s, markerPosition: 1 }, -10).markerPosition).toBe(MARKER_POSITION_MIN);
  });

  it('hides and shows the marker without moving the reading position', () => {
    const s = { ...makePrompterState(), markerPosition: 45 };
    const hidden = setMarkerVisible(s, false);
    expect(hidden.markerVisible).toBe(false);
    expect(hidden.markerPosition).toBe(45);
    expect(setMarkerVisible(hidden, true).markerVisible).toBe(true);
  });

  it('toggles marker visibility', () => {
    const s = makePrompterState();
    expect(toggleMarker(s).markerVisible).toBe(false);
    expect(toggleMarker(toggleMarker(s)).markerVisible).toBe(true);
  });
});
