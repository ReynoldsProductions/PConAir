import { describe, it, expect } from 'vitest';
import upgradeScripts from '../packages/companion-module-pconair/src/upgrades';

describe('companion module upgrade scripts', () => {
  const upgrade = upgradeScripts[0];

  function runUpgrade(actions: Array<{ actionId: string; options: Record<string, unknown> }>, feedbacks: Array<{ feedbackId: string; options: Record<string, unknown> }> = []) {
    return upgrade(
      {} as never,
      { config: null, actions, feedbacks } as never
    );
  }

  it('exists (v0.3.0 number → textinput migration)', () => {
    expect(upgradeScripts.length).toBeGreaterThanOrEqual(1);
  });

  it('stringifies numeric options on converted actions', () => {
    const a1 = { actionId: 'go_to_slide', options: { slide: 4 } };
    const a2 = { actionId: 'slides_goto', options: { slide_number: 12 } };
    const a3 = { actionId: 'stills_slideshow_play', options: { item_ids: '', interval_sec: 8, transition: 'cut' } };
    const result = runUpgrade([a1, a2, a3]);
    expect(result.updatedActions).toHaveLength(3);
    expect(a1.options.slide).toBe('4');
    expect(a2.options.slide_number).toBe('12');
    expect(a3.options.interval_sec).toBe('8');
  });

  it('leaves already-string options and unrelated actions untouched', () => {
    const already = { actionId: 'go_to_slide', options: { slide: '4' } };
    const unrelated = { actionId: 'slides_next', options: {} };
    const result = runUpgrade([already, unrelated]);
    expect(result.updatedActions).toHaveLength(0);
    expect(already.options.slide).toBe('4');
  });

  it('stringifies numeric options on converted feedbacks', () => {
    const f1 = { feedbackId: 'slide_at', options: { slide_number: 3 } };
    const f2 = { feedbackId: 'on_slide', options: { slide: 9 } };
    const f3 = { feedbackId: 'is_connected', options: {} };
    const result = runUpgrade([], [f1, f2, f3]);
    expect(result.updatedFeedbacks).toHaveLength(2);
    expect(f1.options.slide_number).toBe('3');
    expect(f2.options.slide).toBe('9');
  });
});
