import { goldenSet, goldenCase } from './golden-set';
import { validateCase, RehearsalCase } from './rehearsal-case';

describe('golden set', () => {
  it('is well-formed: unique, filename-safe ids and at least one assertion each', () => {
    const set = goldenSet();
    expect(set.length).toBeGreaterThanOrEqual(10);
    const ids = set.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);          // unique
    for (const id of ids) expect(id).toMatch(/^[\w.-]+$/); // safe as a cassette filename
  });

  it('covers a spread of behaviours: qualify, fail-gracefully, deny, and produce-options', () => {
    const set = goldenSet();
    expect(set.some((c) => c.expectations.mustQualify?.length)).toBe(true);
    expect(set.some((c) => c.expectations.mustFailGracefully)).toBe(true);
    expect(set.some((c) => c.expectations.mustDeny)).toBe(true);
    expect(set.filter((c) => c.expectations.minOptions).length).toBeGreaterThanOrEqual(5); // diverse verticals
  });

  it('pins the Hillcreek Cloudflare regression (must qualify)', () => {
    expect(goldenCase('hillcreek-cloudflare').expectations.mustQualify).toContain('Hillcreek Gardens');
  });

  it('pins the anti-fabrication case (must fail gracefully) and the compliance case (must deny)', () => {
    expect(goldenCase('porsche-global').expectations.mustFailGracefully).toBe(true);
    expect(goldenCase('firearm-compliance').expectations.mustDeny).toBe(true);
  });

  it('goldenCase throws on an unknown id', () => {
    expect(() => goldenCase('nope')).toThrow(/unknown rehearsal case/);
  });
});

describe('validateCase', () => {
  const base: RehearsalCase = { id: 'x', rawRequest: 'q', note: 'n', expectations: { minOptions: 1 } };
  it('rejects an unsafe id, empty request, no assertion, and contradictions', () => {
    expect(() => validateCase({ ...base, id: '../x' })).toThrow(/filename-safe/);
    expect(() => validateCase({ ...base, rawRequest: '  ' })).toThrow(/empty rawRequest/);
    expect(() => validateCase({ ...base, expectations: {} })).toThrow(/asserts nothing/);
    expect(() => validateCase({ ...base, expectations: { minOptions: 3, maxOptions: 1 } })).toThrow(/minOptions > maxOptions/);
    expect(() => validateCase({ ...base, expectations: { mustFailGracefully: true, minOptions: 1 } })).toThrow(/conflicts/);
    expect(() => validateCase({ ...base, expectations: { mustDeny: true, minOptions: 1 } })).toThrow(/conflicts/);
    expect(() => validateCase({ ...base, expectations: { mustFailGracefully: true, mustDeny: true } })).toThrow(/mutually exclusive/);
  });
});
