import { validateSubjectBuildGraph, MAX_OPERATORS, SubjectBuildGraph } from './validate';
import { DEFAULT_GRAPH, LAYERED_GRAPH_V2, PALETTE, SUBJECT_IN, SUBJECT_OUT } from './operators';

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
    expect(res.errors.join(' ')).toMatch(/reuse-lookup.*reads draft\.title not written by any ancestor/);
  });

  it('rejects a network that never writes the persist invariant', () => {
    const res = validateSubjectBuildGraph(g(
      [IN, { name: 'tooling' }, OUT],
      [{ from: SUBJECT_IN, to: 'tooling', event: 'READY' }, { from: 'tooling', to: SUBJECT_OUT, event: 'BOUND' }],
    ));
    expect(res.valid).toBe(false);
    expect(res.errors.join(' ')).toMatch(/no ancestor of SUBJECT_OUT writes draft.title, draft.summary, draft.category/);
  });

  it(`rejects a composition with more than ${MAX_OPERATORS} reachable operators (the run budget)`, () => {
    const ops = Array.from({ length: MAX_OPERATORS + 1 }, (_, i) => ({ name: `op${i}`, handler: 'enrich-basic' }));
    const chain = [IN, ...ops, OUT];
    const transitions = [
      { from: SUBJECT_IN, to: 'op0', event: 'READY' },
      ...ops.slice(0, -1).map((_, i) => ({ from: `op${i}`, to: `op${i + 1}`, event: 'DRAFTED' })),
      { from: `op${MAX_OPERATORS}`, to: SUBJECT_OUT, event: 'DRAFTED' },
    ];
    const res = validateSubjectBuildGraph(g(chain, transitions));
    expect(res.valid).toBe(false);
    expect(res.errors.join(' ')).toMatch(new RegExp(`${MAX_OPERATORS + 1} operators reachable .*> ${MAX_OPERATORS}`));
  });

  it(`accepts a ${MAX_OPERATORS}-operator chain (the raised budget)`, () => {
    const ops = Array.from({ length: MAX_OPERATORS }, (_, i) => ({ name: `op${i}`, handler: 'enrich-basic' }));
    const transitions = [
      { from: SUBJECT_IN, to: 'op0', event: 'READY' },
      ...ops.slice(0, -1).map((_, i) => ({ from: `op${i}`, to: `op${i + 1}`, event: 'DRAFTED' })),
      { from: `op${MAX_OPERATORS - 1}`, to: SUBJECT_OUT, event: 'DRAFTED' },
    ];
    expect(validateSubjectBuildGraph(g([IN, ...ops, OUT], transitions))).toEqual({ valid: true, errors: [] });
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

  // Regression: a live-composed candidate whose transition targets a state that
  // isn't declared. Such an edge lands on an IN→OUT path, so the typed-I/O pass
  // used to deref an undefined state (`opOf(undefined)`) and THROW. The validator
  // must reject cleanly instead — a malformed candidate is rejected, never a crash.
  it('rejects (does not throw) a transition to an undeclared state on the IN→OUT path', () => {
    const graph = g(
      [IN, { name: 'enrich-basic' }, OUT], // 'ghost' is intentionally absent from states
      [
        { from: SUBJECT_IN, to: 'enrich-basic', event: 'READY' },
        { from: 'enrich-basic', to: 'ghost', event: 'DRAFTED' },
        { from: 'ghost', to: SUBJECT_OUT, event: 'DRAFTED' },
      ],
    );
    let res!: ReturnType<typeof validateSubjectBuildGraph>;
    expect(() => { res = validateSubjectBuildGraph(graph); }).not.toThrow();
    expect(res.valid).toBe(false);
    expect(res.errors.join(' ')).toMatch(/targets an unknown state/);
  });
});

describe('validateSubjectBuildGraph — layered M:M networks', () => {
  it('accepts the seeded v2 network (fan-out, fan-in, domain memory)', () => {
    expect(validateSubjectBuildGraph(LAYERED_GRAPH_V2 as unknown as SubjectBuildGraph)).toEqual({ valid: true, errors: [] });
  });

  it('rejects an edge that does not deepen (same authored layer)', () => {
    const res = validateSubjectBuildGraph(g(
      [IN, { name: 'enrich-basic', config: { layer: 2 } }, { name: 'self-critique', config: { layer: 2 } }, OUT],
      [
        { from: SUBJECT_IN, to: 'enrich-basic', event: 'READY' },
        { from: 'enrich-basic', to: 'self-critique', event: 'DRAFTED' }, // 2 → 2: sideways, forbidden
        { from: 'self-critique', to: SUBJECT_OUT, event: 'REFINED' },
      ],
    ));
    expect(res.valid).toBe(false);
    expect(res.errors.join(' ')).toMatch(/does not deepen/);
  });

  it('rejects an authored layer outside 1..10', () => {
    const res = validateSubjectBuildGraph(g(
      [IN, { name: 'enrich-basic', config: { layer: 11 } }, OUT],
      [{ from: SUBJECT_IN, to: 'enrich-basic', event: 'READY' }, { from: 'enrich-basic', to: SUBJECT_OUT, event: 'DRAFTED' }],
    ));
    expect(res.valid).toBe(false);
    expect(res.errors.join(' ')).toMatch(/layer 11 \(must be 1\.\.10\)/);
  });

  it('accepts fan-in reads satisfied across parallel ancestors (the blackboard merge)', () => {
    // attribute-mine reads draft.title — written by enrich-basic on a PARALLEL branch
    // that is still an ancestor via the join. Legacy per-path checking would allow it
    // too, but this is the canonical M:M shape: two L1 nodes feeding one L2 node.
    const res = validateSubjectBuildGraph(g(
      [
        IN,
        { name: 'enrich-basic', config: { layer: 1 } },
        { name: 'domain-recall', config: { layer: 1 } },
        { name: 'attribute-mine', config: { layer: 2 } },
        OUT,
      ],
      [
        { from: SUBJECT_IN, to: 'enrich-basic', event: 'READY' },
        { from: SUBJECT_IN, to: 'domain-recall', event: 'READY' },
        { from: 'enrich-basic', to: 'attribute-mine', event: 'DRAFTED' },
        { from: 'domain-recall', to: 'attribute-mine', event: 'RECALLED' },
        { from: 'domain-recall', to: 'attribute-mine', event: 'NO_PRIORS' },
        { from: 'attribute-mine', to: SUBJECT_OUT, event: 'MINED' },
      ],
    ));
    expect(res).toEqual({ valid: true, errors: [] });
  });

  it('still validates cyclic graphs under the legacy walk rules', () => {
    // self-critique loop (cycle) + a proper exit — legacy mode, still valid
    const res = validateSubjectBuildGraph(g(
      [IN, { name: 'enrich-basic' }, { name: 'self-critique' }, OUT],
      [
        { from: SUBJECT_IN, to: 'enrich-basic', event: 'READY' },
        { from: 'enrich-basic', to: 'self-critique', event: 'DRAFTED' },
        { from: 'self-critique', to: 'self-critique', event: 'REFINED' }, // loop
      ],
    ));
    // OUT unreachable in this cyclic graph → legacy rules still catch it
    expect(res.valid).toBe(false);
    expect(res.errors.join(' ')).toMatch(/SUBJECT_OUT is unreachable/);
  });
});
