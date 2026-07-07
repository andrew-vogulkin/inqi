import { PROPOSE_PROBABILITY, shouldPropose } from './subject-build.trigger';
import { runProposal, ProposalDeps } from './subject-build.proposer';
import { DEFAULT_GRAPH, SUBJECT_IN, SUBJECT_OUT } from './operators';
import { SubjectBuildGraph } from './validate';
import { RehearsalComparison } from './subject-rehearsal';

describe('shouldPropose (the 5% trigger)', () => {
  it('defaults to a 5% probability', () => {
    expect(PROPOSE_PROBABILITY).toBeCloseTo(0.05);
  });
  it('proposes iff the roll falls below the probability (strict <)', () => {
    expect(shouldPropose({ roll: 0.049 })).toBe(true);
    expect(shouldPropose({ roll: 0.05 })).toBe(false);   // boundary excluded
    expect(shouldPropose({ roll: 0.5 })).toBe(false);
    expect(shouldPropose({ roll: 0, probability: 0 })).toBe(false); // disabled
    expect(shouldPropose({ roll: 0.99, probability: 1 })).toBe(true); // forced
  });
});

describe('runProposal', () => {
  const baseline = DEFAULT_GRAPH as unknown as SubjectBuildGraph;
  const validCandidate: SubjectBuildGraph = {
    states: [{ name: SUBJECT_IN, isInitial: true }, { name: 'enrich-web-grounded' }, { name: SUBJECT_OUT, isTerminal: true }],
    transitions: [{ from: SUBJECT_IN, to: 'enrich-web-grounded', event: 'READY' }, { from: 'enrich-web-grounded', to: SUBJECT_OUT, event: 'DRAFTED' }],
  };
  const cmp = (accept: boolean): RehearsalComparison => ({ baseline: { passed: 3, failed: 1, total: 4, cases: [] }, candidate: { passed: accept ? 4 : 2, failed: accept ? 0 : 2, total: 4, cases: [] }, regressions: accept ? [] : ['x'], gains: accept ? ['y'] : [], accept });

  function deps(over: Partial<ProposalDeps> = {}): ProposalDeps & { calls: Record<string, number> } {
    const calls = { compose: 0, rehearse: 0, saveDraft: 0 };
    return {
      calls,
      compose: async () => { calls.compose++; return validCandidate; },
      rehearse: async () => { calls.rehearse++; return cmp(true); },
      saveDraft: async () => { calls.saveDraft++; },
      ...over,
    };
  }

  it('drafts a winning candidate (proposed), never auto-publishing', async () => {
    const d = deps();
    const r = await runProposal({ baseline, cases: [], deps: d });
    expect(r.outcome).toBe('proposed');
    expect(d.calls.saveDraft).toBe(1);
  });

  it('drops an invalid candidate before spending a rehearsal', async () => {
    const bad: SubjectBuildGraph = { states: [{ name: SUBJECT_IN, isInitial: true }, { name: 'reuse-lookup' }, { name: SUBJECT_OUT, isTerminal: true }], transitions: [{ from: SUBJECT_IN, to: 'reuse-lookup', event: 'READY' }, { from: 'reuse-lookup', to: SUBJECT_OUT, event: 'REUSED' }] };
    const d = deps({ compose: async () => bad });
    const r = await runProposal({ baseline, cases: [], deps: d });
    expect(r.outcome).toBe('invalid');
    expect(d.calls.rehearse).toBe(0);  // never rehearsed
    expect(d.calls.saveDraft).toBe(0);
  });

  it('discards a valid candidate that does not beat the baseline (rejected)', async () => {
    const d = deps({ rehearse: async () => cmp(false) });
    const r = await runProposal({ baseline, cases: [], deps: d });
    expect(r.outcome).toBe('rejected');
    expect(d.calls.saveDraft).toBe(0);  // operator never bothered
  });
});
