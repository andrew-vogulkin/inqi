/** A candidate subject provider proposed by discovery (before funnel/wave assignment). */
export interface DiscoveredProvider {
  name: string;
  country: string;
  /** Where the lead came from (LeadSource: 'ai', 'fallback'; later 'web-search'). */
  source?: string;
  /** Web pages backing this candidate — persisted as `websearch` Source rows under its Inquiry. */
  evidence?: { url: string; title?: string | null; snippet?: string | null }[];
  /**
   * Set on fallback-round candidates: the constraint discovery relaxed to find them
   * (e.g. found without "rooftop"). Depth research + outreach must confirm it.
   */
  matchNote?: string | null;
  /** Official website as seen in the search results (depth opens this FIRST). */
  website?: string | null;
  /** Social profile urls seen in the results (instagram, facebook, …). */
  socials?: string[];
  /** Verbatim facts from result titles/snippets (prices, addresses, ratings) — depth strengthens these. */
  facts?: string[];
}

export interface DiscoverArgs {
  subject: { title: string; description: string; attributes?: unknown };
  /** How many candidates to return. */
  count: number;
  /** Provider names already in the funnel — never propose these again (for widening). */
  exclude: string[];
}

/** Discovery result: the candidates + human-readable lifecycle notes (fallback rounds, relaxed constraints). */
export interface DiscoveryOutcome {
  candidates: DiscoveredProvider[];
  /** e.g. `converted 2/8 — relaxed "rooftop", re-searching` — logged into agent activity. */
  notes: string[];
}

/**
 * Swappable source of subject-provider candidates. AI-proposed today; a real
 * web-search / directory API plugs in behind this token later. Bind to
 * {@link DISCOVERY_SOURCE}; inject by token.
 */
export interface DiscoverySource {
  discover(args: DiscoverArgs): Promise<DiscoveryOutcome>;
}
export const DISCOVERY_SOURCE = Symbol('DiscoverySource');
