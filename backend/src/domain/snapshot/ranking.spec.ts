import { PRICE_WEIGHT, QUALITY_WEIGHT, priceBasisKey, rankOptions } from './ranking';

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

  // Rate-based markets: a €10/m² rate is NOT 2850× cheaper than a €28,500 job
  // quote. Only the largest same-basis cohort competes on price; other bases get
  // no price credit (observed: RPT-260719-11 ranked an aggregator's per-m² rate
  // above every negotiated all-in offer while the AI summary recommended the
  // cheapest confirmed total — list and summary contradicted each other).
  it('compares prices only within the largest same-basis cohort; rates outside it get no credit', () => {
    const ranked = rankOptions([
      { subjectProvider: 'Aggregator', price: 10, priceBasis: 'per m² per 4 weeks (for >250m², excl. VAT)', qualityScore: 0.85 },
      { subjectProvider: 'RateOnly', price: 10, priceBasis: 'per m² per 3 weeks (rental only)', qualityScore: 0.75 },
      { subjectProvider: 'ConfirmedCheap', price: 28500, qualityScore: 0.65 },
      { subjectProvider: 'ConfirmedMid', price: 28500, qualityScore: 0.6 },
      { subjectProvider: 'ConfirmedDear', price: 48500, qualityScore: 0.85 },
    ]);
    const byName = Object.fromEntries(ranked.map((o) => [o.subjectProvider, o]));
    expect(byName.ConfirmedCheap.priceScore).toBe(1);
    expect(byName.ConfirmedDear.priceScore).toBe(0);
    expect(byName.Aggregator.priceScore).toBe(0); // rate ≠ comparable to totals
    expect(ranked[0].subjectProvider).toBe('ConfirmedCheap'); // agrees with the synthesis verdict
  });

  it('same-unit rates DO compete when they are the largest cohort', () => {
    const ranked = rankOptions([
      { subjectProvider: 'A', price: 9.5, priceBasis: 'per m² per 4 weeks (incl. assembly)', qualityScore: 0.5 },
      { subjectProvider: 'B', price: 15, priceBasis: 'per m² per 4 weeks', qualityScore: 0.5 },
      { subjectProvider: 'C', price: 28500, qualityScore: 0.5 },
    ]);
    const byName = Object.fromEntries(ranked.map((o) => [o.subjectProvider, o]));
    expect(byName.A.priceScore).toBe(1);  // parentheticals stripped — same unit
    expect(byName.B.priceScore).toBe(0);
    expect(byName.C.priceScore).toBe(0);  // lone total is outside the cohort
  });

  it('with no ≥2 same-basis cohort, price is not a differentiator — quality decides', () => {
    const ranked = rankOptions([
      { subjectProvider: 'Rate', price: 46, priceBasis: 'per tonne', qualityScore: 0.4 },
      { subjectProvider: 'Total', price: 13750, qualityScore: 0.8 },
    ]);
    expect(ranked.every((o) => o.priceScore === 1)).toBe(true);
    expect(ranked[0].subjectProvider).toBe('Total');
  });

  it('priceBasisKey: null/empty → total; parentheticals and case are normalized', () => {
    expect(priceBasisKey(null)).toBe('total');
    expect(priceBasisKey('  ')).toBe('total');
    expect(priceBasisKey('Per m² per 4 weeks (excl. VAT)')).toBe('per m² per 4 weeks');
  });
});
