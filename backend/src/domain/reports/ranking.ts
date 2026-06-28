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
 * Rank options by the blended score (descending). priceScore normalizes price to
 * 0..1 (cheapest = 1, dearest = 0); a missing price earns no price credit; if all
 * prices are equal, price is not a differentiator (priceScore = 1 for all).
 */
export function rankOptions(options: RankableOption[]): RankedOption[] {
  const prices = options.map((o) => o.price).filter((p): p is number => typeof p === 'number');
  const min = prices.length ? Math.min(...prices) : 0;
  const max = prices.length ? Math.max(...prices) : 0;
  const span = max - min;

  const ranked = options.map((o) => {
    let priceScore: number;
    if (typeof o.price !== 'number') priceScore = 0;
    else if (span === 0) priceScore = 1;
    else priceScore = (max - o.price) / span;
    const score = QUALITY_WEIGHT * o.qualityScore + PRICE_WEIGHT * priceScore;
    return { ...o, priceScore: round(priceScore), score: round(score) };
  });

  return ranked.sort((a, b) => b.score - a.score);
}
