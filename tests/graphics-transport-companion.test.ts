import { describe, it, expect } from 'vitest';
import {
  synthesizeTransportDefs,
  type PkgRenderInfo,
} from '../packages/companion-module-pconair/src/pkg-engine';

describe('T12 — synthesised transport companion interface', () => {
  const renders: PkgRenderInfo[] = [
    { id: 'card-a', label: 'Card A', transport: { stops: 2 } },
    { id: 'card-b', label: 'Card B', transport: { stops: 3 } },
    { id: 'plain', label: 'Plain (not transport-managed)' },
  ];

  it('yields five actions, one feedback and two variables for two transport renders', () => {
    const defs = synthesizeTransportDefs(renders);
    expect(defs.actions).toHaveLength(5);
    expect(defs.actions.map((a) => a.id).sort()).toEqual(
      ['transport_clear', 'transport_clear_all', 'transport_next', 'transport_play', 'transport_stop'].sort()
    );
    expect(defs.feedbacks).toHaveLength(1);
    expect(defs.feedbacks[0].id).toBe('transport_phase');
    expect(defs.variables).toHaveLength(2);
    expect(defs.variables.map((v) => v.id).sort()).toEqual(['transport_card-a_phase', 'transport_card-b_phase'].sort());
  });

  it('the renderId dropdown lists exactly the transport-managed renders', () => {
    const defs = synthesizeTransportDefs(renders);
    const play = defs.actions.find((a) => a.id === 'transport_play')!;
    const renderIdOpt = play.options!.find((o) => o.id === 'renderId')!;
    expect(renderIdOpt.type).toBe('dropdown');
    expect(renderIdOpt.choices!.map((c) => c.id).sort()).toEqual(['card-a', 'card-b'].sort());
  });

  it('transport_clear_all takes no options', () => {
    const defs = synthesizeTransportDefs(renders);
    const clearAll = defs.actions.find((a) => a.id === 'transport_clear_all')!;
    expect(clearAll.options ?? []).toHaveLength(0);
    expect(clearAll.ops).toEqual([{ op: 'transport_verb', verb: 'clear_all' }]);
  });

  it('each verb action carries the matching transport_verb op', () => {
    const defs = synthesizeTransportDefs(renders);
    for (const verb of ['play', 'next', 'stop', 'clear'] as const) {
      const action = defs.actions.find((a) => a.id === `transport_${verb}`)!;
      expect(action.ops).toEqual([{ op: 'transport_verb', verb }]);
    }
  });

  it('the feedback options include renderId and a phase dropdown covering all five phases', () => {
    const defs = synthesizeTransportDefs(renders);
    const feedback = defs.feedbacks[0];
    const phaseOpt = feedback.options!.find((o) => o.id === 'phase')!;
    expect(phaseOpt.choices!.map((c) => c.id)).toEqual(['idle', 'playing-in', 'holding', 'playing-out', 'finished']);
  });

  it('a package with no transport-managed renders yields nothing', () => {
    const defs = synthesizeTransportDefs([{ id: 'plain', label: 'Plain' }]);
    expect(defs.actions).toHaveLength(0);
    expect(defs.feedbacks).toHaveLength(0);
    expect(defs.variables).toHaveLength(0);
  });
});
