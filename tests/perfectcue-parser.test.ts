import { describe, it, expect } from 'vitest';
import {
  lookupPerfectCueByte,
  createPerfectCueParser,
  PERFECTCUE_DEBOUNCE_MS,
} from '../src/main/services/perfectcue-parser';

describe('lookupPerfectCueByte — DSAN', () => {
  it('0x0F → next', () => expect(lookupPerfectCueByte(0x0f)).toBe('next'));
  it('0x1F → prev', () => expect(lookupPerfectCueByte(0x1f)).toBe('prev'));
  it('0xFF → keepalive', () => expect(lookupPerfectCueByte(0xff)).toBe('keepalive'));
  it('unknown DSAN byte → null', () => expect(lookupPerfectCueByte(0x00)).toBeNull());
});

describe('lookupPerfectCueByte — WaveShare', () => {
  it('0x0c → next', () => expect(lookupPerfectCueByte(0x0c)).toBe('next'));
  it('0x08 → prev', () => expect(lookupPerfectCueByte(0x08)).toBe('prev'));
  it('mis-framed 0x06 → next', () => expect(lookupPerfectCueByte(0x06)).toBe('next'));

  it('masks RS485 noise in the two high bits (bits 7+6)', () => {
    // 0xCc = 0b1100_1100; & 0x3f = 0x0c → next
    expect(lookupPerfectCueByte(0xcc)).toBe('next');
    // 0xC8 = 0b1100_1000; & 0x3f = 0x08 → prev
    expect(lookupPerfectCueByte(0xc8)).toBe('prev');
    // 0x46 = 0b0100_0110; & 0x3f = 0x06 → next (mis-frame)
    expect(lookupPerfectCueByte(0x46)).toBe('next');
  });

  it('unknown masked byte → null', () => {
    // 0x04 (blackout in GSC) is not a slide command here → null
    expect(lookupPerfectCueByte(0x04)).toBeNull();
    expect(lookupPerfectCueByte(0x01)).toBeNull();
  });
});

describe('createPerfectCueParser — debounce', () => {
  it('passes the first next/prev through', () => {
    const p = createPerfectCueParser();
    expect(p.parseByte(0x0c, 1000)).toBe('next');
  });

  it('suppresses a second identical command within the debounce window', () => {
    const p = createPerfectCueParser();
    expect(p.parseByte(0x0c, 1000)).toBe('next');
    expect(p.parseByte(0x0c, 1000 + PERFECTCUE_DEBOUNCE_MS - 1)).toBeNull();
  });

  it('suppresses a different command within the window too (shared debounce)', () => {
    const p = createPerfectCueParser();
    expect(p.parseByte(0x0c, 1000)).toBe('next');
    expect(p.parseByte(0x08, 1100)).toBeNull();
  });

  it('passes a command through once the window has elapsed', () => {
    const p = createPerfectCueParser();
    expect(p.parseByte(0x0c, 1000)).toBe('next');
    expect(p.parseByte(0x0c, 1000 + PERFECTCUE_DEBOUNCE_MS)).toBe('next');
  });

  it('never debounces keepalive and leaves the window untouched', () => {
    const p = createPerfectCueParser();
    expect(p.parseByte(0x0c, 1000)).toBe('next');
    // keepalive in the middle of the window passes and does not reset timing
    expect(p.parseByte(0xff, 1050)).toBe('keepalive');
    expect(p.parseByte(0x0c, 1050)).toBeNull(); // still within original window
    expect(p.parseByte(0x0c, 1000 + PERFECTCUE_DEBOUNCE_MS)).toBe('next');
  });

  it('ignores unknown bytes without affecting the debounce window', () => {
    const p = createPerfectCueParser();
    expect(p.parseByte(0x00, 1000)).toBeNull();
    expect(p.parseByte(0x0c, 1001)).toBe('next');
  });

  it('debounces per parser instance, not globally', () => {
    const a = createPerfectCueParser();
    const b = createPerfectCueParser();
    expect(a.parseByte(0x0c, 1000)).toBe('next');
    // b is a separate port — its first command is not suppressed by a's timing
    expect(b.parseByte(0x0c, 1000)).toBe('next');
  });
});
