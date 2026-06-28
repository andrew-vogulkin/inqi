import { complianceSchema } from './compliance.prompt';

describe('complianceSchema', () => {
  it('parses an allow verdict and applies defaults', () => {
    const r = complianceSchema.parse({ allowed: true });
    expect(r.allowed).toBe(true);
    expect(r.riskScore).toBe(0);
    expect(r.categories).toEqual([]);
    expect(r.reason).toBe('');
  });

  it('rejects an out-of-range riskScore', () => {
    expect(() => complianceSchema.parse({ allowed: false, riskScore: 2 })).toThrow();
  });

  it('rejects an unknown category', () => {
    expect(() => complianceSchema.parse({ allowed: false, categories: ['nope'] })).toThrow();
  });
});
