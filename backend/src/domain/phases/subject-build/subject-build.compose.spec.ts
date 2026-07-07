import { composeCandidate, composeSystem } from './subject-build.compose';
import { DEFAULT_GRAPH, SUBJECT_IN, SUBJECT_OUT } from './operators';
import { SubjectBuildGraph, validateSubjectBuildGraph } from './validate';
import { Ai } from './operators.runtime';

const ai = (graph: unknown): Ai => ({ isConfigured: () => true, structured: async ({ validate }) => validate(graph) as never });

describe('composeCandidate', () => {
  it('returns the model-proposed graph, which the static validator accepts', async () => {
    const proposed: SubjectBuildGraph = {
      states: [{ name: SUBJECT_IN, isInitial: true }, { name: 'target-industry-set' }, { name: 'enrich-web-grounded' }, { name: SUBJECT_OUT, isTerminal: true }],
      transitions: [
        { from: SUBJECT_IN, to: 'target-industry-set', event: 'READY' },
        { from: 'target-industry-set', to: 'enrich-web-grounded', event: 'SET' },
        { from: 'enrich-web-grounded', to: SUBJECT_OUT, event: 'DRAFTED' },
      ],
    };
    const out = await composeCandidate({ ai: ai(proposed), baseline: DEFAULT_GRAPH as unknown as SubjectBuildGraph });
    expect(out).toEqual(proposed);
    expect(validateSubjectBuildGraph(out).valid).toBe(true); // the proposer would rehearse this one
  });

  it('the system prompt advertises the palette + the ≤5 rule (so the model composes validly)', () => {
    const s = composeSystem();
    expect(s).toContain('enrich-web-grounded');
    expect(s).toContain('reuse-lookup');
    expect(s).toMatch(/at most 5 operators/i);
    expect(s).toContain(SUBJECT_OUT);
  });

  it('rejects malformed model output via the schema (missing transitions)', async () => {
    await expect(composeCandidate({ ai: ai({ states: [{ name: SUBJECT_IN }] }), baseline: DEFAULT_GRAPH as unknown as SubjectBuildGraph }))
      .rejects.toThrow();
  });
});
