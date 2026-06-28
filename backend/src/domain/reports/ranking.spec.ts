import { PRICE_WEIGHT, QUALITY_WEIGHT, rankOptions } from './ranking';

describe('rankOptions', () => {
  it('weights sum to 1 and quality outweighs price', () => {
    expect(QUALITY_WEIGHT + PRICE_WEIGHT).toBe(1);
    expect(QUALITY_WEIGHT).toBeGreaterThan(PRICE_WEIGHT);
  });

  it('ranks a high-quality mid-price provider above the cheapest low-quality one', () => {
    const ranked = rankOptions([
      { subjectProvider: 'Cheap-but-poor', price: 100, qualityScore: 0.35 },
      { subjectProvider: 'Quality', price: 150, qualityScore: 0.9 },
      { subjectProvider: 'Premium-mediocre', price: 300, qualityScore: 0.6 },
    ]);
    expect(ranked[0].subjectProvider).toBe('Quality');
    // The cheapest provider does not win on price alone.
    expect(ranked[0].subjectProvider).not.toBe('Cheap-but-poor');
  });

  it('normalizes price: cheapest = 1, dearest = 0', () => {
    const ranked = rankOptions([
      { subjectProvider: 'A', price: 100, qualityScore: 0.5 },
      { subjectProvider: 'B', price: 200, qualityScore: 0.5 },
      { subjectProvider: 'C', price: 300, qualityScore: 0.5 },
    ]);
    const byName = Object.fromEntries(ranked.map((o) => [o.subjectProvider, o]));
    expect(byName.A.priceScore).toBe(1);
    expect(byName.C.priceScore).toBe(0);
    expect(byName.B.priceScore).toBeCloseTo(0.5);
  });

  it('treats equal prices as a non-differentiator (priceScore 1) so quality decides', () => {
    const ranked = rankOptions([
      { subjectProvider: 'High', price: 100, qualityScore: 0.8 },
      { subjectProvider: 'Low', price: 100, qualityScore: 0.4 },
    ]);
    expect(ranked.every((o) => o.priceScore === 1)).toBe(true);
    expect(ranked[0].subjectProvider).toBe('High');
  });

  it('gives a missing price no price credit', () => {
    const ranked = rankOptions([{ subjectProvider: 'A', qualityScore: 0.5 }]);
    expect(ranked[0].priceScore).toBe(0);
    expect(ranked[0].score).toBeCloseTo(QUALITY_WEIGHT * 0.5);
  });
});
