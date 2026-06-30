import { OutreachStrategy } from '@inqi/shared';
import { assignWaves, decideNextAction, planSize } from './planning';

const cands = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `P${i}`, country: 'X' }));

describe('planSize', () => {
  it('escalating seeds 1+3+9 = 13', () => expect(planSize(OutreachStrategy.ESCALATING)).toBe(13));
  it('other strategies seed a positive pool', () => {
    expect(planSize(OutreachStrategy.PARALLEL)).toBeGreaterThan(0);
    expect(planSize(OutreachStrategy.ONE_BY_ONE)).toBeGreaterThan(0);
  });
});

describe('assignWaves', () => {
  it('escalating → 1:3:9', () => {
    const w = assignWaves({ candidates: cands(13), strategy: OutreachStrategy.ESCALATING });
    const byWave = (n: number) => w.filter((x) => x.wave === n).length;
    expect([byWave(1), byWave(2), byWave(3)]).toEqual([1, 3, 9]);
  });
  it('escalating overflow falls into the last wave', () => {
    const w = assignWaves({ candidates: cands(15), strategy: OutreachStrategy.ESCALATING });
    expect(w.filter((x) => x.wave === 3).length).toBe(11);
  });
  it('parallel → all wave 1', () => {
    expect(assignWaves({ candidates: cands(5), strategy: OutreachStrategy.PARALLEL }).every((x) => x.wave === 1)).toBe(true);
  });
  it('one_by_one → ascending waves', () => {
    expect(assignWaves({ candidates: cands(3), strategy: OutreachStrategy.ONE_BY_ONE }).map((x) => x.wave)).toEqual([1, 2, 3]);
  });
});

describe('decideNextAction', () => {
  it('finishes at target when nothing is in flight', () => {
    expect(decideNextAction({ qualified: 3, target: 3, inFlight: 0, pendingWaves: [2, 3] })).toEqual({ kind: 'finish' });
  });
  it('waits at target while subtasks are still in flight', () => {
    expect(decideNextAction({ qualified: 3, target: 3, inFlight: 1, pendingWaves: [] })).toEqual({ kind: 'wait' });
  });
  it('waits while the current wave is in flight', () => {
    expect(decideNextAction({ qualified: 0, target: 3, inFlight: 2, pendingWaves: [2] })).toEqual({ kind: 'wait' });
  });
  it('releases the lowest pending wave when idle and under target', () => {
    expect(decideNextAction({ qualified: 1, target: 3, inFlight: 0, pendingWaves: [3, 2] })).toEqual({ kind: 'release', wave: 2 });
  });
  it('widens when the funnel is dry and under target', () => {
    expect(decideNextAction({ qualified: 1, target: 3, inFlight: 0, pendingWaves: [] })).toEqual({ kind: 'widen' });
  });
});
