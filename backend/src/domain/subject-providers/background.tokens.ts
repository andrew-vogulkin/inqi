/** Structured background/quality research for a subject provider. */
export interface SubjectProviderBackground {
  rating?: number;        // e.g. 0..5 stars
  reviewsCount?: number;
  sources: string[];      // where signals came from
  eligibility: string;    // human-readable eligibility verdict
  redFlags: string[];
  qualityScore: number;   // 0..1, higher = better
}

/** Raw signals returned by an external ratings/search source (before judgement). */
export interface RawProviderSignals {
  sources: string[];
  rating?: number;
  reviewsCount?: number;
  notes?: string[];
}

/**
 * Swappable source of subject-provider signals (ratings / reviews / track
 * record). No live tooling yet — the stub returns nothing and the service falls
 * back to model-derived signals. Bind a real search/ratings API to
 * {@link BACKGROUND_RESEARCH_SOURCE} when available. Do not scrape.
 */
export interface BackgroundResearchSource {
  lookup(args: { subjectProviderName: string; regionHint?: string | null }): Promise<RawProviderSignals>;
}
export const BACKGROUND_RESEARCH_SOURCE = Symbol('BackgroundResearchSource');
