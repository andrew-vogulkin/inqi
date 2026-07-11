import { initSubjectBuildData } from './draft';
import { EMPTY_PRIORS, mergeDomainKnowledge, resolveDomainLabel } from './domain-knowledge';

const build = (over: Partial<ReturnType<typeof initSubjectBuildData>> = {}) => ({ ...initSubjectBuildData({ rawRequest: 'x' }), ...over });

describe('resolveDomainLabel', () => {
  it('matches a curated reference-set label from the request text', () => {
    expect(resolveDomainLabel({ rawRequest: 'a wedding venue in Tagaytay' })).toBe('weddings-events');
    expect(resolveDomainLabel({ rawRequest: 'a reliable plumber for a renovation' })).toBe('trades-home');
  });
  it('falls back to a per-category slug, else null', () => {
    expect(resolveDomainLabel({ rawRequest: 'something unmatchable', category: 'service' })).toBe('service-general');
    expect(resolveDomainLabel({ rawRequest: 'something unmatchable' })).toBeNull();
  });
});

describe('mergeDomainKnowledge', () => {
  it('a first build seeds the row: attributes, evidence hosts, the title exemplar, buildCount 1', () => {
    const data = build({
      draft: { title: 'Hillcreek Gardens venue', category: 'organisation', summary: 's', attributes: { capacity: 150 } },
      evidence: [{ url: 'https://www.theknot.com/x', snippet: 's' }],
      referenceSet: ['weddingwire.com'],
    });
    expect(mergeDomainKnowledge({ prior: null, data })).toEqual({
      attributes: { capacity: 150 },
      sources: ['theknot.com', 'weddingwire.com'],
      titleHints: ['Hillcreek Gardens venue'],
      buildCount: 1,
      category: 'organisation',
    });
  });

  it('later builds accumulate: new attribute keys win, sources/titles dedupe, buildCount grows', () => {
    const prior = { attributes: { capacity: 100, style: 'garden' }, sources: ['theknot.com'], titleHints: ['Old venue'], buildCount: 3, category: 'organisation' };
    const data = build({ draft: { title: 'New venue', category: 'organisation', summary: 's', attributes: { capacity: 200 } }, evidence: [{ url: 'https://theknot.com/y', snippet: 's' }] });
    const merged = mergeDomainKnowledge({ prior, data });
    expect(merged.attributes).toEqual({ capacity: 200, style: 'garden' }); // fresh evidence wins, old keys kept
    expect(merged.sources).toEqual(['theknot.com']);                       // deduped
    expect(merged.titleHints).toEqual(['New venue', 'Old venue']);         // newest exemplar first
    expect(merged.buildCount).toBe(4);
  });

  it('caps the memory: sources ≤ 16, title hints ≤ 12 (a summary, not an archive)', () => {
    const prior = { ...EMPTY_PRIORS, sources: Array.from({ length: 20 }, (_, i) => `s${i}.com`), titleHints: Array.from({ length: 20 }, (_, i) => `t${i}`), buildCount: 1 };
    const merged = mergeDomainKnowledge({ prior, data: build({ draft: { title: 'fresh', category: 'item', summary: 's' } }) });
    expect(merged.sources.length).toBeLessThanOrEqual(16);
    expect(merged.titleHints.length).toBeLessThanOrEqual(12);
    expect(merged.titleHints[0]).toBe('fresh'); // the newest exemplar survives the cap
  });

  it('junk evidence URLs are dropped, not thrown on', () => {
    const data = build({ draft: { title: 't', category: 'item', summary: 's' }, evidence: [{ url: 'not a url', snippet: 's' }] });
    expect(mergeDomainKnowledge({ prior: null, data }).sources).toEqual([]);
  });
});
