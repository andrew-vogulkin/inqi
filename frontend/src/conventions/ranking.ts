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

/** Rank options by the blended score (descending); deterministic tie-break by id. */
export function rankOptions(options: ReportOption[]): RankedOption[] {
  const prices = options.map((o) => o.price).filter((p): p is number => typeof p === 'number');
  const min = prices.length ? Math.min(...prices) : 0;
  const max = prices.length ? Math.max(...prices) : 0;
  const span = max - min;

  return options
    .map((o) => {
      const quality = typeof o.qualityScore === 'number' ? o.qualityScore : 0;
      let priceScore: number;
      if (typeof o.price !== 'number') priceScore = 0;
      else if (span === 0) priceScore = 1;
      else priceScore = (max - o.price) / span;
      return { ...o, qualityScore: quality, priceScore: round(priceScore), score: round(QUALITY_WEIGHT * quality + PRICE_WEIGHT * priceScore) };
    })
    .sort((a, b) => (b.score - a.score) || optionId(a).localeCompare(optionId(b)));
}
