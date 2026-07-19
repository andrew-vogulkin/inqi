/**
 * Quality-aware option ranking. We never recommend a cheap-but-low-quality
 * provider: quality is weighted above price. The blended score is
 *   score = QUALITY_WEIGHT * qualityScore + PRICE_WEIGHT * priceScore
 * where priceScore normalizes price across the option set (cheapest = 1).
 */
export const QUALITY_WEIGHT = 0.6;
export const PRICE_WEIGHT = 0.4;

export interface RankableOption {
  subjectProvider: string;
  price?: number | null;
  currency?: string | null;
  /** Unit the price is quoted in ("per m²", "per day") — null/absent for a plain total.
   *  NOTE: priceScore still compares raw numbers; mixed bases rank apples-to-oranges,
   *  so surfacing the basis to the customer is what keeps the ranking honest. */
  priceBasis?: string | null;
  availability?: string | null;
  leadTime?: string | null;
  qualityScore: number; // 0..1, higher = better
  background?: Record<string, unknown> | null;
}

export interface RankedOption extends RankableOption {
  priceScore: number; // 0..1, higher = cheaper relative to the set
  score: number;      // blended quality + price, higher = better
}

const round = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Comparable-price grouping key. A raw number is only comparable to another raw
 * number quoted in the SAME unit — €10/m² is not 2850× cheaper than a €28,500
 * job quote. Null/absent basis = a plain total for the request. Parenthetical
 * qualifiers ("(excl. VAT, for >250m²)") don't change the unit, so they are
 * stripped before grouping.
 */
export function priceBasisKey(basis: string | null | undefined): string {
  const cleaned = (basis ?? '').replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
  return cleaned || 'total';
}

/**
 * Rank options by the blended score (descending). priceScore compares prices
 * only WITHIN the largest group of options quoted on the same basis (ties break
 * toward plain totals — they answer the customer's actual question); everything
 * quoted on another basis earns no price credit, exactly like a missing price.
 * Within the group: cheapest = 1, dearest = 0; if the group's prices are all
 * equal (or no group has ≥2 priced options), price is not a differentiator —
 * every priced option gets 1 and quality decides.
 */
export function rankOptions(options: RankableOption[]): RankedOption[] {
  const priced = options.filter((o): o is RankableOption & { price: number } => typeof o.price === 'number');

  // Largest same-basis cohort of priced options; prefer 'total' on size ties.
  const cohorts = new Map<string, number>();
  for (const o of priced) cohorts.set(priceBasisKey(o.priceBasis), (cohorts.get(priceBasisKey(o.priceBasis)) ?? 0) + 1);
  const modal = [...cohorts.entries()].sort((a, b) => b[1] - a[1] || (a[0] === 'total' ? -1 : b[0] === 'total' ? 1 : 0))[0];
  const comparable = modal && modal[1] >= 2 ? priced.filter((o) => priceBasisKey(o.priceBasis) === modal[0]) : [];

  const prices = comparable.map((o) => o.price);
  const min = prices.length ? Math.min(...prices) : 0;
  const max = prices.length ? Math.max(...prices) : 0;
  const span = max - min;

  const ranked = options.map((o) => {
    let priceScore: number;
    if (typeof o.price !== 'number') priceScore = 0;
    else if (comparable.length < 2) priceScore = 1;                                  // price can't differentiate
    else if (priceBasisKey(o.priceBasis) !== priceBasisKey(comparable[0].priceBasis)) priceScore = 0; // not comparable
    else priceScore = span === 0 ? 1 : (max - o.price) / span;
    const score = QUALITY_WEIGHT * o.qualityScore + PRICE_WEIGHT * priceScore;
    return { ...o, priceScore: round(priceScore), score: round(score) };
  });

  return ranked.sort((a, b) => b.score - a.score);
}
