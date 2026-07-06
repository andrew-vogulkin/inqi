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

// NOTE: the DiscoverySource seam is gone — discovery is the `breadth_search`
// workflow type now (domain/phases + breadth-lifecycle.ts). Swapping discovery
// behaviour means publishing a new workflow version, not rebinding a token.
