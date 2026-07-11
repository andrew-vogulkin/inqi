import { initSubjectBuildData } from './draft';
import { MAX_OPERATORS } from './validate';
import { runSubjectStep, SubjectStepDeps } from './subject-build.dispatch';
import { Ai } from './operators.runtime';

const okAi: Ai = { isConfigured: () => true, structured: async ({ validate }) => validate({ title: 'A venue', category: 'organisation', summary: 'Outdoor', confidence: 0.8 }) as never };
const noStore = { load: async () => null, save: async () => undefined };
const deps = (over: Partial<SubjectStepDeps> = {}): SubjectStepDeps => ({ ai: okAi, findReuse: async () => null, persist: async () => undefined, domainStore: noStore, ...over });
const base = () => initSubjectBuildData({ rawRequest: 'a wedding venue in Tagaytay' });

describe('runSubjectStep', () => {
  it('SUBJECT_IN emits READY', async () => {
    expect(await runSubjectStep({ operatorId: 'SUBJECT_IN', config: undefined, data: base(), deps: deps() })).toEqual({ event: 'READY' });
  });

  it('runs an operator, merges the draft, and bumps stepCount', async () => {
    const res = await runSubjectStep({ operatorId: 'enrich-basic', config: undefined, data: base(), deps: deps() });
    expect(res.event).toBe('DRAFTED');
    expect(res.data?.draft.title).toBe('A venue');
    expect(res.data?.stepCount).toBe(1);
  });

  it('SUBJECT_OUT persists the Subject when the invariant holds', async () => {
    let persisted: unknown;
    const data = { ...base(), draft: { title: 'Hillcreek', summary: 'A venue', category: 'organisation' } };
    const res = await runSubjectStep({ operatorId: 'SUBJECT_OUT', config: undefined, data, deps: deps({ persist: async (f) => { persisted = f; } }) });
    expect(res.event).toBe('SUBJECT_CREATED');
    expect(persisted).toEqual({ title: 'Hillcreek', description: 'A venue', category: 'organisation' });
  });

  it('SUBJECT_OUT fails cleanly (no persist) when the invariant is not met', async () => {
    let called = false;
    const res = await runSubjectStep({ operatorId: 'SUBJECT_OUT', config: undefined, data: { ...base(), draft: { title: 'X' } }, deps: deps({ persist: async () => { called = true; } }) });
    expect(res.event).toBe('STEP_FAILED');
    expect(called).toBe(false);
  });

  it(`enforces the runtime ${MAX_OPERATORS}-operator budget (a loop cannot escape it)`, async () => {
    const res = await runSubjectStep({ operatorId: 'self-critique', config: undefined, data: { ...base(), stepCount: MAX_OPERATORS }, deps: deps() });
    expect(res.event).toBe('STEP_FAILED');
    expect(res.data?.notes?.join(' ')).toMatch(new RegExp(`cap ${MAX_OPERATORS} reached`));
  });

  it('routes if-else on its predicate and fails an unknown operator', async () => {
    const branch = await runSubjectStep({ operatorId: 'if-else', config: { predicate: 'has-draft' }, data: { ...base(), draft: { title: 'X' } }, deps: deps() });
    expect(branch.event).toBe('THEN');
    const unknown = await runSubjectStep({ operatorId: 'no-such-op', config: undefined, data: base(), deps: deps() });
    expect(unknown.event).toBe('STEP_FAILED');
  });

  it('dispatches the domain-memory operators: recall loads priors, learn writes them back', async () => {
    const rows = new Map<string, unknown>();
    const store = {
      load: async ({ domain }: { domain: string }) => (rows.get(domain) as never) ?? null,
      save: async ({ domain, knowledge }: { domain: string; knowledge: unknown }) => { rows.set(domain, knowledge); },
    };
    // recall on a cold domain → NO_PRIORS but the label is resolved onto the blackboard
    const cold = await runSubjectStep({ operatorId: 'domain-recall', config: undefined, data: base(), deps: deps({ domainStore: store }) });
    expect(cold.event).toBe('NO_PRIORS');
    expect(cold.data?.domain).toBe('weddings-events');
    // learn from a finished draft → the row exists afterwards
    const data = { ...(cold.data ?? base()), draft: { title: 'Hillcreek Gardens', summary: 's', category: 'organisation', attributes: { capacity: 150 } } };
    const learned = await runSubjectStep({ operatorId: 'domain-learn', config: undefined, data, deps: deps({ domainStore: store }) });
    expect(learned.event).toBe('LEARNED');
    expect(rows.get('weddings-events')).toMatchObject({ buildCount: 1, attributes: { capacity: 150 } });
    // recall again → RECALLED with the learned priors
    const warm = await runSubjectStep({ operatorId: 'domain-recall', config: undefined, data: base(), deps: deps({ domainStore: store }) });
    expect(warm.event).toBe('RECALLED');
    expect(warm.data?.domainPriors?.buildCount).toBe(1);
  });

  it('join is a pure pass-through (MERGED)', async () => {
    const res = await runSubjectStep({ operatorId: 'join', config: undefined, data: base(), deps: deps() });
    expect(res.event).toBe('MERGED');
  });
});
