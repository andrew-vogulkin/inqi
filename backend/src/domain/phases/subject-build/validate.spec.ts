import { validateSubjectBuildGraph, MAX_OPERATORS, SubjectBuildGraph } from './validate';
import { DEFAULT_GRAPH, PALETTE, SUBJECT_IN, SUBJECT_OUT } from './operators';

const g = (states: SubjectBuildGraph['states'], transitions: SubjectBuildGraph['transitions']): SubjectBuildGraph => ({ states, transitions });
const IN = { name: SUBJECT_IN, isInitial: true };
const OUT = { name: SUBJECT_OUT, isTerminal: true };

describe('subject_build palette', () => {
  it('every non-exit operator can emit at least one event; SUBJECT_OUT emits SUBJECT_CREATED', () => {
    for (const op of Object.values(PALETTE)) {
      if (op.kind !== 'exit') expect(op.emits.length).toBeGreaterThan(0);
    }
    expect(PALETTE[SUBJECT_OUT].emits).toContain('SUBJECT_CREATED');
  });
});

describe('validateSubjectBuildGraph', () => {
  it('accepts the seeded default graph (IN → enrich-basic → OUT)', () => {
    expect(validateSubjectBuildGraph(DEFAULT_GRAPH as unknown as SubjectBuildGraph)).toEqual({ valid: true, errors: [] });
  });

  it('accepts a realistic 4-operator composition with satisfied I/O', () => {
    const res = validateSubjectBuildGraph(g(
      [IN, { name: 'disambiguate' }, { name: 'tis', handler: 'target-industry-set' }, { name: 'ewg', handler: 'enrich-web-grounded' }, { name: 'rl', handler: 'reuse-lookup' }, OUT],
      [
        { from: SUBJECT_IN, to: 'disambiguate', event: 'READY' },
        { from: 'disambiguate', to: 'tis', event: 'CLEAR' },
        { from: 'tis', to: 'ewg', event: 'SET' },
        { from: 'ewg', to: 'rl', event: 'DRAFTED' },
        { from: 'rl', to: SUBJECT_OUT, event: 'REUSED' },
      ],
    ));
    expect(res).toEqual({ valid: true, errors: [] });
  });

  it('rejects an operator whose reads are not produced upstream (reuse-lookup before any builder)', () => {
    const res = validateSubjectBuildGraph(g(
      [IN, { name: 'rl', handler: 'reuse-lookup' }, OUT],
      [{ from: SUBJECT_IN, to: 'rl', event: 'READY' }, { from: 'rl', to: SUBJECT_OUT, event: 'REUSED' }],
    ));
    expect(res.valid).toBe(false);
    expect(res.errors.join(' ')).toMatch(/reuse-lookup.*reads draft\.title not produced upstream/);
  });

  it('rejects a path that never writes the persist invariant', () => {
    const res = validateSubjectBuildGraph(g(
      [IN, { name: 'tooling' }, OUT],
      [{ from: SUBJECT_IN, to: 'tooling', event: 'READY' }, { from: 'tooling', to: SUBJECT_OUT, event: 'BOUND' }],
    ));
    expect(res.valid).toBe(false);
    expect(res.errors.join(' ')).toMatch(/never writes draft.title, draft.summary, draft.category/);
  });

  it(`rejects a composition that runs more than ${MAX_OPERATORS} operators between IN and OUT`, () => {
    const ops = Array.from({ length: 6 }, (_, i) => ({ name: `op${i}`, handler: 'enrich-basic' }));
    const chain = [IN, ...ops, OUT];
    const transitions = [
      { from: SUBJECT_IN, to: 'op0', event: 'READY' },
      ...ops.slice(0, -1).map((_, i) => ({ from: `op${i}`, to: `op${i + 1}`, event: 'DRAFTED' })),
      { from: 'op5', to: SUBJECT_OUT, event: 'DRAFTED' },
    ];
    const res = validateSubjectBuildGraph(g(chain, transitions));
    expect(res.valid).toBe(false);
    expect(res.errors.join(' ')).toMatch(new RegExp(`runs 6 operators \\(> ${MAX_OPERATORS}\\)`));
  });

  it('rejects an unregistered operator and an event the operator cannot emit', () => {
    const unreg = validateSubjectBuildGraph(g([IN, { name: 'frobnicate' }, OUT], [{ from: SUBJECT_IN, to: 'frobnicate', event: 'READY' }, { from: 'frobnicate', to: SUBJECT_OUT, event: 'DONE' }]));
    expect(unreg.errors.join(' ')).toMatch(/"frobnicate" is not a registered operator/);

    const badEvent = validateSubjectBuildGraph(g([IN, { name: 'enrich-basic' }, OUT], [{ from: SUBJECT_IN, to: 'enrich-basic', event: 'READY' }, { from: 'enrich-basic', to: SUBJECT_OUT, event: 'WRONG' }]));
    expect(badEvent.errors.join(' ')).toMatch(/enrich-basic" cannot emit "WRONG"/);
  });

  it('rejects if-else without a registered predicate, and bad slot boundaries', () => {
    const ifElse = validateSubjectBuildGraph(g([IN, { name: 'branch', handler: 'if-else', config: { predicate: 'nope' } }, OUT], [{ from: SUBJECT_IN, to: 'branch', event: 'READY' }, { from: 'branch', to: SUBJECT_OUT, event: 'THEN' }]));
    expect(ifElse.errors.join(' ')).toMatch(/needs a registered predicate/);

    const noInitial = validateSubjectBuildGraph(g([{ name: SUBJECT_IN }, { name: 'enrich-basic' }, OUT], [{ from: SUBJECT_IN, to: 'enrich-basic', event: 'READY' }, { from: 'enrich-basic', to: SUBJECT_OUT, event: 'DRAFTED' }]));
    expect(noInitial.errors.join(' ')).toMatch(new RegExp(`only initial state must be ${SUBJECT_IN}`));
  });

  it('flags an unreachable SUBJECT_OUT', () => {
    const res = validateSubjectBuildGraph(g([IN, { name: 'enrich-basic' }, OUT], [{ from: SUBJECT_IN, to: 'enrich-basic', event: 'READY' }]));
    expect(res.errors.join(' ')).toMatch(new RegExp(`${SUBJECT_OUT} is unreachable`));
  });
});
