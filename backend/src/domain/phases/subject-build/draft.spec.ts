import { draftToSubject, initSubjectBuildData, isInvariantMet } from './draft';
import { evalPredicate } from './predicates';
import { referenceSetFor } from './reference-sets';

describe('draft invariant + mapping', () => {
  it('isInvariantMet is strict — all of title/summary/category, non-empty', () => {
    expect(isInvariantMet({ title: 'A', summary: 'B', category: 'service' })).toBe(true);
    expect(isInvariantMet({ title: 'A', summary: 'B' })).toBe(false);      // no category
    expect(isInvariantMet({ title: ' ', summary: 'B', category: 'item' })).toBe(false); // blank title
    expect(isInvariantMet({})).toBe(false);
  });

  it('draftToSubject maps a satisfied draft; falls back only defensively', () => {
    expect(draftToSubject({ draft: { title: 'Hillcreek Gardens', summary: 'A venue', category: 'organisation' }, rawRequest: 'q' }))
      .toEqual({ title: 'Hillcreek Gardens', description: 'A venue', category: 'organisation' });
    const bare = draftToSubject({ draft: {}, rawRequest: 'a very long raw request '.repeat(5) });
    expect(bare.title.length).toBeLessThanOrEqual(80);
    expect(bare.category).toBe('item');
  });

  it('initSubjectBuildData seeds an empty draft + zero step count', () => {
    const d = initSubjectBuildData({ rawRequest: 'q', enriched: { title: 't' } });
    expect(d).toMatchObject({ rawRequest: 'q', draft: {}, stepCount: 0, notes: [] });
  });
});

describe('if-else predicates', () => {
  const base = initSubjectBuildData({ rawRequest: 'q' });
  it('low-confidence honours a config threshold', () => {
    expect(evalPredicate({ id: 'low-confidence', data: { ...base, draft: { confidence: 0.3 } } })).toBe(true);
    expect(evalPredicate({ id: 'low-confidence', data: { ...base, draft: { confidence: 0.3 } }, config: { threshold: 0.2 } })).toBe(false);
  });
  it('has-draft / category-is-service / has-reference-set', () => {
    expect(evalPredicate({ id: 'has-draft', data: { ...base, draft: { title: 'X' } } })).toBe(true);
    expect(evalPredicate({ id: 'category-is-service', data: { ...base, draft: { category: 'service' } } })).toBe(true);
    expect(evalPredicate({ id: 'has-reference-set', data: { ...base, referenceSet: ['x'] } })).toBe(true);
    expect(evalPredicate({ id: 'has-reference-set', data: base })).toBe(false);
  });
  it('an unregistered predicate id is false (validator blocks it at publish)', () => {
    expect(evalPredicate({ id: 'nope', data: base })).toBe(false);
  });
});

describe('referenceSetFor', () => {
  it('matches by request/category and returns curated sources', () => {
    expect(referenceSetFor({ rawRequest: 'a wedding venue in Tagaytay' })).toContain('theknot.com');
    expect(referenceSetFor({ rawRequest: 'a plumber for a bathroom renovation' })).toContain('checkatrade.com');
    expect(referenceSetFor({ rawRequest: 'a Pikachu trading card' })).toContain('tcgplayer.com');
    expect(referenceSetFor({ rawRequest: 'something with no known vertical xyzzy' })).toEqual([]);
  });
});
