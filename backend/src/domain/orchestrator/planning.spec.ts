import { InquiryStatus, OutreachStrategy } from '@inqi/shared';
import { OutreachActionKind, SynthesisGate, assignWaves, decideNextAction, decideSynthesisGate, pendingUnreleasedWaves, planSize } from './planning';

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

describe('pendingUnreleasedWaves', () => {
  const inq = (status: string, wave: number) => ({ status, wave });

  it('returns the distinct waves that still hold pending inquiries', () => {
    const inquiries = [inq(InquiryStatus.Pending, 2), inq(InquiryStatus.Pending, 2), inq(InquiryStatus.Pending, 3), inq(InquiryStatus.Qualified, 1)];
    expect(pendingUnreleasedWaves({ inquiries, releasedWaves: [1] }).sort()).toEqual([2, 3]);
  });

  it('EXCLUDES a wave already released — a pending inquiry left behind after release is NOT releasable', () => {
    // The wedge: wave 3 released, but two inquiries sit `pending` (ambiguous verdict / a
    // send that never settled them). Without the exclusion the reactor loops on Release(3).
    const inquiries = [inq(InquiryStatus.Qualified, 1), inq(InquiryStatus.Pending, 3), inq(InquiryStatus.Pending, 3)];
    expect(pendingUnreleasedWaves({ inquiries, releasedWaves: [1, 2, 3] })).toEqual([]);
  });

  it('non-pending inquiries never count as a releasable wave', () => {
    const inquiries = [inq(InquiryStatus.Contacted, 2), inq(InquiryStatus.Failed, 2), inq(InquiryStatus.Qualified, 3)];
    expect(pendingUnreleasedWaves({ inquiries, releasedWaves: [] })).toEqual([]);
  });
});

describe('decideNextAction', () => {
  it('finishes at target when nothing is in flight', () => {
    expect(decideNextAction({ qualified: 3, target: 3, inFlight: 0, pendingWaves: [2, 3] })).toEqual({ kind: OutreachActionKind.Finish });
  });
  it('waits at target while inquiries are still in flight', () => {
    expect(decideNextAction({ qualified: 3, target: 3, inFlight: 1, pendingWaves: [] })).toEqual({ kind: OutreachActionKind.Wait });
  });
  it('waits while the current wave is in flight', () => {
    expect(decideNextAction({ qualified: 0, target: 3, inFlight: 2, pendingWaves: [2] })).toEqual({ kind: OutreachActionKind.Wait });
  });
  it('releases the lowest pending wave when idle and under target', () => {
    expect(decideNextAction({ qualified: 1, target: 3, inFlight: 0, pendingWaves: [3, 2] })).toEqual({ kind: OutreachActionKind.Release, wave: 2 });
  });
  it('widens when the funnel is dry and under target', () => {
    expect(decideNextAction({ qualified: 1, target: 3, inFlight: 0, pendingWaves: [] })).toEqual({ kind: OutreachActionKind.Widen });
  });
});

describe('decideSynthesisGate (depth-research gate before report synthesis)', () => {
  it('defers while research jobs are outstanding and waits remain', () => {
    expect(decideSynthesisGate({ outstandingResearch: 2, waits: 0, maxWaits: 90 })).toBe(SynthesisGate.Defer);
  });
  it('proceeds once all research has landed', () => {
    expect(decideSynthesisGate({ outstandingResearch: 0, waits: 5, maxWaits: 90 })).toBe(SynthesisGate.Proceed);
  });
  it('proceeds at the wait deadline even with research still pending (never strands the report)', () => {
    expect(decideSynthesisGate({ outstandingResearch: 1, waits: 90, maxWaits: 90 })).toBe(SynthesisGate.Proceed);
  });
});
