import { DEFAULT_GRAPH, SUBJECT_IN, SUBJECT_OUT } from './operators';
import { SubjectBuildGraph } from './validate';
import { Ai } from './operators.runtime';
import { SUBJECT_CASES, SubjectCase } from './subject-cases';
import { compareSubjectGraphs, rehearseSubjectGraph } from './subject-rehearsal';

/** Fake model: reads the request out of the prompt; a different transform per operator (by system text). */
function fakeAi(byOp: { enrich: (req: string) => object; critique?: (req: string) => object }): Ai {
  return {
    isConfigured: () => true,
    structured: async ({ system, user, validate }) => {
      const req = (user.match(/Request: (.+)/)?.[1] ?? '').trim();
      const t = /critique|improved/i.test(system) && byOp.critique ? byOp.critique : byOp.enrich;
      return validate(t(req)) as never;
    },
  };
}
const deps = (ai: Ai) => ({ ai, findReuse: async () => null });
const g = (states: SubjectBuildGraph['states'], transitions: SubjectBuildGraph['transitions']): SubjectBuildGraph => ({ states, transitions });

const goodAi = fakeAi({ enrich: (req) => ({ title: `Curated: ${req.slice(0, 60)}`, category: 'organisation', summary: 'x' }) });

describe('rehearseSubjectGraph', () => {
  it('scores the default graph across the golden cases (all build, non-naive)', async () => {
    const card = await rehearseSubjectGraph({ graph: DEFAULT_GRAPH as unknown as SubjectBuildGraph, cases: SUBJECT_CASES, deps: deps(goodAi) });
    expect(card).toMatchObject({ passed: SUBJECT_CASES.length, failed: 0 });
  });
});

describe('compareSubjectGraphs — the gate', () => {
  it('rejects a candidate that regresses (a graph that never builds a subject)', async () => {
    const broken = g([{ name: SUBJECT_IN, isInitial: true }, { name: 'tooling' }, { name: SUBJECT_OUT, isTerminal: true }],
      [{ from: SUBJECT_IN, to: 'tooling', event: 'READY' }, { from: 'tooling', to: SUBJECT_OUT, event: 'BOUND' }]);
    const cmp = await compareSubjectGraphs({ baseline: DEFAULT_GRAPH as unknown as SubjectBuildGraph, candidate: broken, cases: SUBJECT_CASES, deps: deps(goodAi) });
    expect(cmp.accept).toBe(false);
    expect(cmp.regressions.length).toBe(SUBJECT_CASES.length); // broke every case the baseline passed
  });

  it('accepts a candidate that fixes a case the baseline failed (self-critique rescues a naive title)', async () => {
    // ai returns the raw request as the title for enrich (naive), but an improved title for critique
    const ai = fakeAi({ enrich: (req) => ({ title: req, category: 'item', summary: 's' }), critique: (req) => ({ title: `Refined: ${req.slice(0, 20)}`, category: 'item', summary: 's' }) });
    const shortCase: SubjectCase[] = [{ id: 'short', request: 'a Pikachu card', expect: { mustBuild: true, notNaive: true } }];
    const withCritique = g(
      [{ name: SUBJECT_IN, isInitial: true }, { name: 'enrich-basic' }, { name: 'self-critique' }, { name: SUBJECT_OUT, isTerminal: true }],
      [{ from: SUBJECT_IN, to: 'enrich-basic', event: 'READY' }, { from: 'enrich-basic', to: 'self-critique', event: 'DRAFTED' }, { from: 'self-critique', to: SUBJECT_OUT, event: 'REFINED' }],
    );
    const cmp = await compareSubjectGraphs({ baseline: DEFAULT_GRAPH as unknown as SubjectBuildGraph, candidate: withCritique, cases: shortCase, deps: deps(ai) });
    expect(cmp.baseline.passed).toBe(0);  // naive title === rawRequest → notNaive fails
    expect(cmp.candidate.passed).toBe(1); // self-critique produced a non-naive title
    expect(cmp.gains).toEqual(['short']);
    expect(cmp.accept).toBe(true);
  });
});
