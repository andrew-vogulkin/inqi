import { initSubjectBuildData } from './draft';
import { DEFAULT_GRAPH, LAYERED_GRAPH_V2, SUBJECT_IN, SUBJECT_OUT } from './operators';
import { interpretSubjectBuild } from './subject-build.interpreter';
import { SubjectStepDeps } from './subject-build.dispatch';
import { MAX_OPERATORS, SubjectBuildGraph } from './validate';
import { Ai } from './operators.runtime';

const ai = (out: unknown, configured = true): Ai => ({ isConfigured: () => configured, structured: async ({ validate }) => validate(out) as never });
const noStore = { load: async () => null, save: async () => undefined };
const deps = (over: Partial<SubjectStepDeps> = {}): SubjectStepDeps => ({ ai: ai({ title: 'A venue', category: 'organisation', summary: 'Outdoor' }), findReuse: async () => null, persist: async () => undefined, domainStore: noStore, ...over });
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

  it('a self-critique loop cannot exceed the operator budget (legacy walk)', async () => {
    const graph: SubjectBuildGraph = {
      states: [{ name: SUBJECT_IN, isInitial: true }, { name: 'self-critique' }, { name: SUBJECT_OUT, isTerminal: true }],
      transitions: [
        { from: SUBJECT_IN, to: 'self-critique', event: 'READY' },
        { from: 'self-critique', to: 'self-critique', event: 'REFINED' }, // deliberate infinite loop
      ],
    };
    const r = await interpretSubjectBuild({ graph, data: data(), deps: deps({ ai: ai({ title: 'T', category: 'item', summary: 's' }) }) });
    expect(r.created).toBe(false);
    expect(r.data.stepCount).toBeLessThanOrEqual(MAX_OPERATORS); // dispatcher STEP_FAILED at the budget
  });
});

describe('interpretSubjectBuild — layered forward pass (M:M networks)', () => {
  // One AI stub that answers every operator's schema (draft fields + interpretation + attributes).
  const networkAi = ai({ title: 'Hillcreek Gardens wedding venue', category: 'organisation', summary: 'Outdoor ceremony venue', confidence: 0.8, interpretation: 'a venue', ambiguous: false, attributes: { capacity: 150 } });

  it('runs the seeded v2 network: IN fans out 1:3, drafting fans in 3:1, and OUT persists', async () => {
    let persisted: unknown;
    const saved: string[] = [];
    const store = { load: async () => null, save: async ({ domain }: { domain: string }) => { saved.push(domain); } };
    const r = await interpretSubjectBuild({
      graph: LAYERED_GRAPH_V2 as unknown as SubjectBuildGraph,
      data: data(),
      deps: deps({ ai: networkAi, domainStore: store, persist: async (f) => { persisted = f; } }),
    });
    expect(r.created).toBe(true);
    // every layer-1 node ran off the single READY (fan-out), then the fan-in nodes once each
    expect(r.path).toEqual([SUBJECT_IN, 'disambiguate', 'target-industry-set', 'domain-recall', 'enrich-web-grounded', 'attribute-mine', 'self-critique', 'domain-learn', SUBJECT_OUT]);
    expect(persisted).toMatchObject({ title: expect.stringContaining('Hillcreek') });
    expect(saved).toEqual(['weddings-events']); // the write head taught the domain memory exactly once
    expect(r.data.stepCount).toBe(7);
  });

  it('one dead branch does not kill the pass — the other route still reaches OUT', async () => {
    // enrich-basic and tooling in parallel; tooling's BOUND edge is deliberately
    // unwired, so that branch dies while the drafting branch persists.
    const graph: SubjectBuildGraph = {
      states: [
        { name: SUBJECT_IN, isInitial: true },
        { name: 'enrich-basic', config: { layer: 1 } },
        { name: 'tooling', config: { layer: 1 } },
        { name: 'self-critique', config: { layer: 2 } },
        { name: SUBJECT_OUT, isTerminal: true },
      ],
      transitions: [
        { from: SUBJECT_IN, to: 'enrich-basic', event: 'READY' },
        { from: SUBJECT_IN, to: 'tooling', event: 'READY' },
        { from: 'enrich-basic', to: 'self-critique', event: 'DRAFTED' },
        { from: 'self-critique', to: SUBJECT_OUT, event: 'REFINED' },
      ],
    };
    const r = await interpretSubjectBuild({ graph, data: data(), deps: deps({ ai: networkAi }) });
    expect(r.created).toBe(true);
    expect(r.path).toContain('tooling'); // it ran (READY fired it) — its unwired event just goes nowhere
  });

  it('the forward pass stops scheduling once the operator budget is exhausted', async () => {
    // An 11-layer chain of enrich-basic: the 11th operator must never run.
    const ops = Array.from({ length: MAX_OPERATORS + 1 }, (_, i) => ({ name: `op${i}`, handler: 'enrich-basic', config: { layer: i + 1 } }));
    const graph: SubjectBuildGraph = {
      states: [{ name: SUBJECT_IN, isInitial: true }, ...ops, { name: SUBJECT_OUT, isTerminal: true }],
      transitions: [
        { from: SUBJECT_IN, to: 'op0', event: 'READY' },
        ...ops.slice(0, -1).map((_, i) => ({ from: `op${i}`, to: `op${i + 1}`, event: 'DRAFTED' })),
        { from: `op${MAX_OPERATORS}`, to: SUBJECT_OUT, event: 'DRAFTED' },
      ],
    };
    const r = await interpretSubjectBuild({ graph, data: data(), deps: deps({ ai: networkAi }) });
    expect(r.created).toBe(false); // OUT's only feeder was never allowed to run
    expect(r.data.stepCount).toBe(MAX_OPERATORS);
    expect(r.data.notes.join(' ')).toMatch(/budget .* exhausted/);
  });
});
