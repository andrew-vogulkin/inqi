import { initSubjectBuildData } from './draft';
import { DEFAULT_GRAPH, SUBJECT_IN, SUBJECT_OUT } from './operators';
import { interpretSubjectBuild } from './subject-build.interpreter';
import { SubjectStepDeps } from './subject-build.dispatch';
import { SubjectBuildGraph } from './validate';
import { Ai } from './operators.runtime';

const ai = (out: unknown, configured = true): Ai => ({ isConfigured: () => configured, structured: async ({ validate }) => validate(out) as never });
const deps = (over: Partial<SubjectStepDeps> = {}): SubjectStepDeps => ({ ai: ai({ title: 'A venue', category: 'organisation', summary: 'Outdoor' }), findReuse: async () => null, persist: async () => undefined, ...over });
const data = () => initSubjectBuildData({ rawRequest: 'a wedding venue in Tagaytay' });

describe('interpretSubjectBuild', () => {
  it('walks the default graph and persists a Subject', async () => {
    let persisted: unknown;
    const r = await interpretSubjectBuild({ graph: DEFAULT_GRAPH as unknown as SubjectBuildGraph, data: data(), deps: deps({ persist: async (f) => { persisted = f; } }) });
    expect(r.created).toBe(true);
    expect(r.path).toEqual([SUBJECT_IN, 'enrich-basic', SUBJECT_OUT]);
    expect(persisted).toEqual({ title: 'A venue', description: 'Outdoor', category: 'organisation' });
  });

  it('does NOT persist when the built draft misses the invariant (OUT fails)', async () => {
    // enrich-basic falls back (AI down) to a naive draft that has title+summary but its category is undefined
    const r = await interpretSubjectBuild({ graph: DEFAULT_GRAPH as unknown as SubjectBuildGraph, data: data(), deps: deps({ ai: ai({}, false) }) });
    expect(r.created).toBe(false); // fallback draft has no category → invariant unmet
  });

  it('stops at a dead end (an emitted event with no wired transition)', async () => {
    // disambiguate emits CLEAR, but only AMBIGUOUS is wired → dead end
    const graph: SubjectBuildGraph = {
      states: [{ name: SUBJECT_IN, isInitial: true }, { name: 'disambiguate' }, { name: 'enrich-basic' }, { name: SUBJECT_OUT, isTerminal: true }],
      transitions: [
        { from: SUBJECT_IN, to: 'disambiguate', event: 'READY' },
        { from: 'disambiguate', to: 'enrich-basic', event: 'AMBIGUOUS' },
        { from: 'enrich-basic', to: SUBJECT_OUT, event: 'DRAFTED' },
      ],
    };
    const r = await interpretSubjectBuild({ graph, data: data(), deps: deps({ ai: ai({ interpretation: 'clear', ambiguous: false }) }) });
    expect(r.created).toBe(false);
    expect(r.path).toEqual([SUBJECT_IN, 'disambiguate']); // stopped after the unrouted CLEAR
  });

  it('a self-critique loop cannot exceed the ≤5 operator cap', async () => {
    const graph: SubjectBuildGraph = {
      states: [{ name: SUBJECT_IN, isInitial: true }, { name: 'self-critique' }, { name: SUBJECT_OUT, isTerminal: true }],
      transitions: [
        { from: SUBJECT_IN, to: 'self-critique', event: 'READY' },
        { from: 'self-critique', to: 'self-critique', event: 'REFINED' }, // deliberate infinite loop
      ],
    };
    const r = await interpretSubjectBuild({ graph, data: data(), deps: deps({ ai: ai({ title: 'T', category: 'item', summary: 's' }) }) });
    expect(r.created).toBe(false);
    expect(r.data.stepCount).toBeLessThanOrEqual(5); // dispatcher STEP_FAILED at the cap
  });
});
