/**
 * Curated professional sources per industry — what the `target-industry-set`
 * operator writes into `run.data.referenceSet` for `enrich-web-grounded` (and later
 * breadth) to prefer. Tunable DATA, not a prompt: the first set whose pattern
 * matches the request/category wins. Extend freely; an unmatched request → [].
 */
export interface ReferenceSet {
  label: string;
  match: RegExp;      // over `${category} ${rawRequest}`
  sources: string[];  // site hints / directories to prefer
}

export const REFERENCE_SETS: ReferenceSet[] = [
  { label: 'weddings-events', match: /wedding|venue|reception|banquet|event space|photograph/i, sources: ['theknot.com', 'weddingwire.com', 'tripadvisor.com', 'google maps'] },
  { label: 'trades-home', match: /plumb|electric|contractor|renovat|hvac|handyman|roofing|cleaning/i, sources: ['checkatrade.com', 'houzz.com', 'yelp.com', 'google maps'] },
  { label: 'real-estate', match: /apartment|rent|flat|property|lease|housing|for sale/i, sources: ['idealista.com', 'rightmove.co.uk', 'zillow.com', 'booking.com'] },
  { label: 'hospitality', match: /hotel|resort|restaurant|catering|bar\b|cafe/i, sources: ['tripadvisor.com', 'booking.com', 'google maps', 'yelp.com'] },
  { label: 'collectibles-goods', match: /card|collectible|vintage|antique|memorabilia|figure|coin|stamp/i, sources: ['ebay.com', 'tcgplayer.com', 'catawiki.com', 'etsy.com'] },
  { label: 'vehicles', match: /car|vehicle|motorcycle|bike|bicycle|scooter/i, sources: ['autotrader.com', 'mobile.de', 'marktplaats.nl', 'ebay.com'] },
  { label: 'professional-services', match: /lawyer|accountant|consultant|agency|designer|developer|coach|tutor/i, sources: ['clutch.co', 'linkedin.com', 'google maps', 'trustpilot.com'] },
];

/** The reference set for a request; the first matching set's sources, else []. */
export function referenceSetFor({ rawRequest, category }: { rawRequest: string; category?: string | null }): string[] {
  const hay = `${category ?? ''} ${rawRequest}`;
  return REFERENCE_SETS.find((s) => s.match.test(hay))?.sources ?? [];
}
