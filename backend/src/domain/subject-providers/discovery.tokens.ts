/** A candidate subject provider proposed by discovery (before funnel/wave assignment). */
export interface DiscoveredProvider {
  name: string;
  country: string;
  /** Where the candidate came from (e.g. 'ai', 'web-search'). */
  source?: string;
}

export interface DiscoverArgs {
  subject: { title: string; description: string; attributes?: unknown };
  /** How many candidates to return. */
  count: number;
  /** Provider names already in the funnel — never propose these again (for widening). */
  exclude: string[];
}

/**
 * Swappable source of subject-provider candidates. AI-proposed today; a real
 * web-search / directory API plugs in behind this token later. Bind to
 * {@link DISCOVERY_SOURCE}; inject by token.
 */
export interface DiscoverySource {
  discover(args: DiscoverArgs): Promise<DiscoveredProvider[]>;
}
export const DISCOVERY_SOURCE = Symbol('DiscoverySource');
