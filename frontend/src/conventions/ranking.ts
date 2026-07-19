import { ReportOption } from '../api/types';

/**
 * Quality-aware option ranking (ported from the backend so the report reducer can
 * re-rank live as options upsert). Quality is weighted above price; cheapest in the
 * set earns the full price credit.
 */
export const QUALITY_WEIGHT = 0.6;
export const PRICE_WEIGHT = 0.4;

export interface RankedOption extends ReportOption {
  qualityScore: number;
  priceScore: number;
  score: number;
}

const round = (n: number) => Math.round(n * 1000) / 1000;

/** Stable id for an option. Prefers an explicit `id` (set on redacted freemium rows) over the provider name. */
export function optionId(option: ReportOption): string {
  return option.id ?? option.subjectProvider;
}

/**
 * Comparable-price grouping key (mirrors the backend): a raw number is only
 * comparable to another quoted in the SAME unit — €10/m² is not 2850× cheaper
 * than a €28,500 job quote. Null basis = a plain total for the request.
 */
export function priceBasisKey(basis: string | null | undefined): string {
  const cleaned = (basis ?? '').replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
  return cleaned || 'total';
}

/**
 * Rank options by the blended score (descending); deterministic tie-break by id.
 * priceScore compares prices only within the largest same-basis cohort (ties
 * prefer plain totals); other bases earn no price credit, like a missing price.
 */
export function rankOptions(options: ReportOption[]): RankedOption[] {
  const priced = options.filter((o): o is ReportOption & { price: number } => typeof o.price === 'number');
  const cohorts = new Map<string, number>();
  for (const o of priced) cohorts.set(priceBasisKey(o.priceBasis), (cohorts.get(priceBasisKey(o.priceBasis)) ?? 0) + 1);
  const modal = [...cohorts.entries()].sort((a, b) => b[1] - a[1] || (a[0] === 'total' ? -1 : b[0] === 'total' ? 1 : 0))[0];
  const comparable = modal && modal[1] >= 2 ? priced.filter((o) => priceBasisKey(o.priceBasis) === modal[0]) : [];

  const prices = comparable.map((o) => o.price);
  const min = prices.length ? Math.min(...prices) : 0;
  const max = prices.length ? Math.max(...prices) : 0;
  const span = max - min;

  return options
    .map((o) => {
      const quality = typeof o.qualityScore === 'number' ? o.qualityScore : 0;
      let priceScore: number;
      if (typeof o.price !== 'number') priceScore = 0;
      else if (comparable.length < 2) priceScore = 1;                          // price can't differentiate
      else if (priceBasisKey(o.priceBasis) !== modal[0]) priceScore = 0;       // not comparable
      else priceScore = span === 0 ? 1 : (max - o.price) / span;
      return { ...o, qualityScore: quality, priceScore: round(priceScore), score: round(QUALITY_WEIGHT * quality + PRICE_WEIGHT * priceScore) };
    })
    .sort((a, b) => (b.score - a.score) || optionId(a).localeCompare(optionId(b)));
}
