import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  applyOps,
  computeDerived,
  evalFeedback,
  getPath,
  parseClockMmSs,
  formatClockMmSs,
  resolveFieldPath,
  variableValue,
  type PkgActionDef,
  type PkgDerivedDef,
  type PkgFeedbackDef,
  type PkgState,
  type PkgVariableDef,
} from '../packages/companion-module-pconair/src/pkg-engine';

const BUNDLED = path.join(__dirname, '..', 'bundled-packages');

function loadManifest(id: string): {
  companionActions: PkgActionDef[];
  companionFeedbacks: PkgFeedbackDef[];
  companionVariables: PkgVariableDef[];
  companionDerived?: PkgDerivedDef[];
  initialState: PkgState;
} {
  return JSON.parse(fs.readFileSync(path.join(BUNDLED, id, 'package.json'), 'utf-8'));
}

function action(m: { companionActions: PkgActionDef[] }, id: string): PkgActionDef {
  const a = m.companionActions.find((x) => x.id === id);
  if (!a) throw new Error(`action ${id} missing`);
  return a;
}

describe('pkg-engine primitives', () => {
  it('getPath walks objects and arrays', () => {
    const s = { a: { b: [10, { c: 'x' }] } };
    expect(getPath(s, 'a.b.0')).toBe(10);
    expect(getPath(s, 'a.b.1.c')).toBe('x');
    expect(getPath(s, 'a.missing.deep')).toBeUndefined();
  });

  it('resolveFieldPath substitutes option placeholders', () => {
    expect(resolveFieldPath('scores.{team}', { team: 2 })).toBe('scores.2');
    expect(resolveFieldPath('h2h.slot{slot}', { slot: 'A' })).toBe('h2h.slotA');
  });

  it('clock parsing and formatting round-trip', () => {
    expect(parseClockMmSs('07:42')).toBe(462);
    expect(formatClockMmSs(462)).toBe('07:42');
    expect(formatClockMmSs(0)).toBe('00:00');
  });

  it('applyOps returns only touched top-level keys and preserves siblings of nested sets', () => {
    const state: PkgState = { playerCard: { visible: false, name: 'J. TATUM', pts: 31 }, other: 1 };
    const patch = applyOps([{ op: 'set', field: 'playerCard.visible', value: true }], {}, state);
    expect(Object.keys(patch)).toEqual(['playerCard']);
    expect(patch.playerCard).toEqual({ visible: true, name: 'J. TATUM', pts: 31 });
  });
});

describe('hoops manifest', () => {
  const m = loadManifest('hoops');
  const state = m.initialState;

  it('bump_score_home increments scoreA with a floor of 0', () => {
    const patch = applyOps(action(m, 'bump_score_home').ops, { delta: 2 }, state);
    expect(patch).toEqual({ scoreA: 90 });
    const down = applyOps(action(m, 'bump_score_home').ops, { delta: -3 }, { ...state, scoreA: 1 });
    expect(down).toEqual({ scoreA: 0 });
  });

  it('start_clock converts the static MM:SS into a deadline; stop_clock freezes it back', () => {
    const now = 1_000_000;
    const started = applyOps(action(m, 'start_clock').ops, {}, state, now);
    expect(started.clockEndsAt).toBe(now + 462_000); // 07:42
    const running = { ...state, ...started };
    const stopped = applyOps(action(m, 'stop_clock').ops, {}, running, now + 12_000);
    expect(stopped.clockEndsAt).toBe(0);
    expect(stopped.clock).toBe('07:30');
  });

  it('reset_shot_clock keeps the clock running when it was running', () => {
    const now = 5_000_000;
    const running = { ...state, shotEndsAt: now + 5_000 };
    const patch = applyOps(action(m, 'reset_shot_clock').ops, { seconds: 24 }, running, now);
    expect(patch.shotClock).toBe(24);
    expect(patch.shotEndsAt).toBe(now + 24_000);
    const stoppedPatch = applyOps(action(m, 'reset_shot_clock').ops, { seconds: 14 }, state, now);
    expect(stoppedPatch.shotEndsAt).toBe(0);
    expect(stoppedPatch.shotClock).toBe(14);
  });

  it('set_player_card falls back to current state for blank text fields', () => {
    const patch = applyOps(
      action(m, 'set_player_card').ops,
      { name: '', number: '7', info: '', pts: 12, reb: 3, ast: 4, fg: '' },
      state
    );
    const card = patch.playerCard as Record<string, unknown>;
    expect(card.name).toBe('J. TATUM'); // kept
    expect(card.number).toBe('7'); // overridden
    expect(card.pts).toBe(12);
    expect(card.fg).toBe('11-19'); // kept
  });

  it('clock variable shows live countdown while running and the static value when stopped', () => {
    const clockVar = m.companionVariables.find((v) => v.id === 'clock')!;
    expect(variableValue(clockVar, state, 0)).toBe('07:42');
    const now = 2_000_000;
    expect(variableValue(clockVar, { ...state, clockEndsAt: now + 61_000 }, now)).toBe('01:01');
  });

  it('possession feedback compares against the selected option', () => {
    const fb = m.companionFeedbacks.find((f) => f.id === 'possession')!;
    expect(evalFeedback(fb, { side: 'a' }, state)).toBe(true);
    expect(evalFeedback(fb, { side: 'b' }, state)).toBe(false);
  });
});

describe('news manifest', () => {
  const m = loadManifest('news');

  it('news_l3_take keeps existing name/title when options are blank', () => {
    const patch = applyOps(action(m, 'news_l3_take').ops, { name: '', title: 'CTO' }, m.initialState);
    const l3 = patch.l3 as Record<string, unknown>;
    expect(l3.visible).toBe(true);
    expect(l3.name).toBe('Jane Smith');
    expect(l3.title).toBe('CTO');
  });

  it('news_set_ticker splits items on |', () => {
    const patch = applyOps(
      action(m, 'news_set_ticker').ops,
      { items: 'One:: story | Two:: more ', label: '' },
      m.initialState
    );
    expect(patch.tickerItems).toEqual(['One:: story', 'Two:: more']);
    expect(patch.tickerVisible).toBe(true);
    expect(patch.tickerLabel).toBe('Faire Wire'); // kept via orState
  });
});

describe('ffg manifest', () => {
  const m = loadManifest('ffg');
  const state = m.initialState;

  it('ffg_bump_score uses the team option in the field path', () => {
    const patch = applyOps(action(m, 'ffg_bump_score').ops, { team: 2, delta: 1 }, state);
    expect(patch.scores).toEqual([0, 0, 1, 0]);
  });

  it('ffg_set_matchup writes the selected slot', () => {
    const patch = applyOps(action(m, 'ffg_set_matchup').ops, { slot: 'B', first: 0, second: 3 }, state);
    expect(patch.h2h).toEqual({ slotA: [0, 1], slotB: [0, 3] });
  });

  it('ffg_set_winner records winner and snapshots finalScore from state', () => {
    const withScores = { ...state, scores: [4, 9, 2, 7] };
    const patch = applyOps(action(m, 'ffg_set_winner').ops, { team: 1 }, withScores);
    expect(patch.winner).toBe(1);
    expect(patch.finalScore).toBe(9);
  });

  it('timer start/stop honours timer.running and remaining seconds', () => {
    const now = 9_000_000;
    const ready = { ...state, timer: { running: false, remaining: 120, endsAt: 0 } };
    const started = applyOps(action(m, 'ffg_start_timer').ops, {}, ready, now);
    const t = started.timer as Record<string, unknown>;
    expect(t.endsAt).toBe(now + 120_000);
    expect(t.running).toBe(true);
    const stopped = applyOps(action(m, 'ffg_stop_timer').ops, {}, { ...ready, timer: t }, now + 30_000);
    const t2 = stopped.timer as Record<string, unknown>;
    expect(t2.running).toBe(false);
    expect(t2.endsAt).toBe(0);
    expect(t2.remaining).toBe(90);
  });

  it('timer start falls back to the 900 s default when remaining is null', () => {
    const now = 1_234_000;
    const started = applyOps(action(m, 'ffg_start_timer').ops, {}, state, now);
    expect((started.timer as Record<string, unknown>).endsAt).toBe(now + 900_000);
  });

  it('derived leader/tie feed the leader variable and feedbacks', () => {
    const derived = computeDerived(m.companionDerived, { ...state, scores: [3, 8, 1, 0] });
    expect(derived._leader).toBe(1);
    expect(derived._leaderName).toBe('Team 2');

    const tied = computeDerived(m.companionDerived, { ...state, scores: [5, 5, 1, 0] });
    expect(tied._leader).toBe(-1);
    const isTied = m.companionFeedbacks.find((f) => f.id === 'is_tied')!;
    expect(evalFeedback(isTied, {}, tied)).toBe(true);
    expect(evalFeedback(isTied, {}, derived)).toBe(false);

    const leaderVar = m.companionVariables.find((v) => v.id === 'leader')!;
    expect(variableValue(leaderVar, derived)).toBe('Team 2');
  });

  it('winner_set feedback uses notEquals null (team 0 counts as a winner)', () => {
    const fb = m.companionFeedbacks.find((f) => f.id === 'winner_set')!;
    expect(evalFeedback(fb, {}, state)).toBe(false);
    expect(evalFeedback(fb, {}, { ...state, winner: 0 })).toBe(true);
  });

  it('timer variable renders mm:ss from remaining seconds', () => {
    const timerVar = m.companionVariables.find((v) => v.id === 'timer')!;
    expect(variableValue(timerVar, { ...state, timer: { running: false, remaining: 95, endsAt: 0 } }, 0)).toBe('01:35');
    expect(variableValue(timerVar, state, 0)).toBe('--:--'); // remaining null, not started
  });
});
