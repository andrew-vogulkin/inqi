import { feasibilitySchema } from './feasibility.prompt';

describe('feasibilitySchema', () => {
  it('parses a valid allow verdict and applies defaults', () => {
    const r = feasibilitySchema.parse({ decision: 'allow', subject: { title: 'Road bike, 56cm' } });
    expect(r.decision).toBe('allow');
    expect(r.riskTags).toEqual([]);
    expect(r.reason).toBe('');
    expect(r.subject.category).toBe('item'); // default
    expect(r.subject.summary).toBe('');
  });

  it('keeps a provided category and risk tags', () => {
    const r = feasibilitySchema.parse({ decision: 'deny', riskTags: ['weapon'], reason: 'illegal', subject: { title: 'X', category: 'service' } });
    expect(r.decision).toBe('deny');
    expect(r.riskTags).toEqual(['weapon']);
    expect(r.subject.category).toBe('service');
  });

  it('rejects an unknown decision value', () => {
    expect(() => feasibilitySchema.parse({ decision: 'maybe', subject: { title: 'x' } })).toThrow();
  });

  it('rejects an unknown category', () => {
    expect(() => feasibilitySchema.parse({ decision: 'allow', subject: { title: 'x', category: 'spaceship' } })).toThrow();
  });

  it('rejects a missing subject title', () => {
    expect(() => feasibilitySchema.parse({ decision: 'allow', subject: {} })).toThrow();
  });
});
