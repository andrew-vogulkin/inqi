import { initSubjectBuildData } from './draft';
import {
  Ai, applyOutcome, opCategorySpecialize, opDisambiguate, opEnrichBasic, opEnrichWebGrounded, opIfElse, opReuseLookup, opSelfCritique, opTargetIndustrySet, opTooling,
} from './operators.runtime';

const data = (over: Partial<ReturnType<typeof initSubjectBuildData>> = {}) => ({ ...initSubjectBuildData({ rawRequest: 'a wedding venue in Tagaytay' }), ...over });

/** Fake AI: `structured` returns whatever `next` yields (post-validate); toggle configured. */
function fakeAi(next: () => unknown, configured = true): Ai {
  return { isConfigured: () => configured, structured: async ({ validate }) => validate(next()) as never };
}

describe('applyOutcome', () => {
  it('shallow-merges the draft, applies set fields, and bumps stepCount', () => {
    const out = applyOutcome(data({ draft: { title: 'old' } }), { event: 'DRAFTED', draft: { summary: 's' }, set: { referenceSet: ['x'] }, note: 'n' });
    expect(out.draft).toEqual({ title: 'old', summary: 's' });
    expect(out.referenceSet).toEqual(['x']);
    expect(out.stepCount).toBe(1);
    expect(out.notes).toEqual(['n']);
  });
});

describe('deterministic operators', () => {
  it('tooling binds the configured tools', () => {
    expect(opTooling({ config: { tools: ['maps', 'reviews'] } })).toEqual({ event: 'BOUND', set: { toolset: ['maps', 'reviews'] } });
  });
  it('target-industry-set picks the matching reference set', () => {
    const o = opTargetIndustrySet({ data: data() });
    expect(o.event).toBe('SET');
    expect(o.set?.referenceSet).toContain('theknot.com');
  });
  it('if-else routes on a registered predicate', () => {
    expect(opIfElse({ data: data({ draft: { confidence: 0.2 } }), config: { predicate: 'low-confidence' } }).event).toBe('THEN');
    expect(opIfElse({ data: data({ draft: { confidence: 0.9 } }), config: { predicate: 'low-confidence' } }).event).toBe('ELSE');
  });
});

describe('LLM operators', () => {
  it('enrich-basic uses the model output when configured', async () => {
    const ai = fakeAi(() => ({ title: 'Wedding venue, Tagaytay', category: 'organisation', summary: 'Outdoor venue', confidence: 0.8 }));
    const o = await opEnrichBasic({ data: data(), ai });
    expect(o).toMatchObject({ event: 'DRAFTED', draft: { title: 'Wedding venue, Tagaytay', category: 'organisation' } });
  });

  it('enrich-basic falls back to the naive draft when AI is unavailable (today behaviour)', async () => {
    const o = await opEnrichBasic({ data: data(), ai: fakeAi(() => ({}), false) });
    expect(o.event).toBe('DRAFTED');
    expect(o.draft?.title).toBe('a wedding venue in Tagaytay'); // rawRequest.slice fallback
    expect(o.note).toMatch(/fallback/);
  });

  it('enrich-basic fails open when the model output is invalid', async () => {
    const o = await opEnrichBasic({ data: data(), ai: fakeAi(() => ({ title: '' /* invalid */ })) });
    expect(o.event).toBe('DRAFTED'); // never throws; degrades
    expect(o.note).toMatch(/fallback/);
  });

  it('disambiguate emits AMBIGUOUS/CLEAR from the model and records the interpretation', async () => {
    const amb = await opDisambiguate({ data: data(), ai: fakeAi(() => ({ interpretation: 'a physical venue', ambiguous: true })) });
    expect(amb).toMatchObject({ event: 'AMBIGUOUS', draft: { interpretation: 'a physical venue' } });
    const clear = await opDisambiguate({ data: data(), ai: fakeAi(() => ({ interpretation: 'clear', ambiguous: false })) });
    expect(clear.event).toBe('CLEAR');
  });

  it('category-specialize / self-critique / web-grounded pass through their events and never throw', async () => {
    expect((await opCategorySpecialize({ data: data({ draft: { category: 'rental' } }), ai: fakeAi(() => ({ attributes: { bedrooms: 2 } })) })).draft?.attributes).toEqual({ bedrooms: 2 });
    expect((await opSelfCritique({ data: data(), ai: fakeAi(() => ({ title: 'Better', category: 'organisation', summary: 's' })) })).event).toBe('REFINED');
    expect((await opEnrichWebGrounded({ data: data({ referenceSet: ['theknot.com'] }), ai: fakeAi(() => ({ title: 'T', category: 'organisation', summary: 's' })) })).event).toBe('DRAFTED');
    // AI-down variants degrade without throwing
    expect((await opCategorySpecialize({ data: data(), ai: fakeAi(() => ({}), false) })).event).toBe('SPECIALIZED');
    expect((await opSelfCritique({ data: data(), ai: fakeAi(() => ({}), false) })).event).toBe('REFINED');
  });
});

describe('reuse-lookup', () => {
  it('adapts a prior subject on a hit, else NO_REUSE', async () => {
    const hit = await opReuseLookup({ data: data({ draft: { title: 'X' } }), findReuse: async () => ({ snapshotId: 'snap1', summary: 'prior' }) });
    expect(hit).toMatchObject({ event: 'REUSED', draft: { reusedFrom: 'snap1', summary: 'prior' } });
    const miss = await opReuseLookup({ data: data({ draft: { title: 'X' } }), findReuse: async () => null });
    expect(miss.event).toBe('NO_REUSE');
    const err = await opReuseLookup({ data: data(), findReuse: async () => { throw new Error('db'); } });
    expect(err.event).toBe('NO_REUSE'); // fails open
  });
});
