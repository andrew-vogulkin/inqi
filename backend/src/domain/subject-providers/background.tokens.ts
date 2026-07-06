/** One cited evidence page behind the background verdict (customer-visible proof). */
export interface BackgroundSource {
  source: string;         // display name (page title / site)
  url: string;
  snippet?: string | null;
}

/** Structured background/quality research for a subject provider. */
export interface SubjectProviderBackground {
  rating?: number;        // e.g. 0..5 stars
  reviewsCount?: number;
  sentiment?: number;     // 0..1 aggregated review sentiment
  themes?: string[];      // recurring review themes
  quotes?: string[];      // short review quotes
  sources: (BackgroundSource | string)[]; // cited pages (objects) or legacy labels (strings)
  eligibility: string;    // human-readable eligibility verdict
  redFlags: string[];
  /** Web-evidenced price for the request's unit (email replies refine it later). */
  price?: number | null;
  currency?: string | null;
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
  lookup(args: { name: string; regionHint?: string | null }): Promise<RawProviderSignals>;
}
export const BACKGROUND_RESEARCH_SOURCE = Symbol('BackgroundResearchSource');
