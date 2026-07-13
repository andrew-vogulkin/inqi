import { z } from 'zod';
import type { WebResult } from '../../infra/websearch/websearch.tools';

/**
 * Structured output of AI candidate discovery. `evidence` = urls of the provided
 * web results the candidate was drawn from. The FACTS block is what depth research
 * later STRENGTHENS (rather than re-verifying from scratch): the official website,
 * social profiles and verbatim price/address mentions actually seen in the results.
 */
export const discoverySchema = z.object({
  candidates: z
    .array(z.object({
      name: z.string().min(1),
      country: z.string().default(''),
      evidence: z.array(z.string()).default([]),
      /** Official website when a result shows/IS it (e.g. ericeirasurfschool.pt). */
      website: z.string().nullish(),
      /** Social profile urls seen in the results (instagram, facebook, …). */
      socials: z.array(z.string()).default([]),
      /** Verbatim facts copied from result titles/snippets: prices, addresses, ratings. */
      facts: z.array(z.string()).default([]),
    }))
    .default([]),
});
export type DiscoveryResult = z.infer<typeof discoverySchema>;

/** Step 0 output — the model-formed search queries (~10 high-recall angles on the subject). */
export const discoveryQueriesSchema = z.object({
  queries: z.array(z.string().min(3)).min(3).max(12),
});

/** Step 2 output — the qualification filter: names that plausibly PROVIDE the subject. */
export const discoveryFilterSchema = z.object({
  qualified: z.array(z.string()).default([]),
});

/** Fallback-round output — the relaxed constraint + broader queries. */
export const discoveryFallbackSchema = z.object({
  relaxed: z.string().min(1),
  queries: z.array(z.string().min(3)).min(3).max(12),
});

/** Marketing-round output — short commercial category queries (the last search pass). */
export const discoveryMarketingSchema = z.object({
  queries: z.array(z.string().min(3)).min(2).max(8),
});

// System prompt text lives centrally (inspectable + dynamic-ready); re-exported here.
export { discoverySystem, discoveryQueriesSystem, discoveryFilterSystem, discoveryFallbackQueriesSystem, discoveryMarketingQueriesSystem } from '../../infra/ai/prompts';

export const buildDiscoveryUser = ({ subject, count, exclude, webResults, searchContext }: {
  subject: unknown; count: number; exclude: string[]; webResults?: Pick<WebResult, 'title' | 'url' | 'content'>[];
  /** How this round searched (relaxed constraint / marketing-language pass) — widens the relevance gate to the service category. */
  searchContext?: string | null;
}): string =>
  JSON.stringify({
    subject,
    count,
    exclude,
    ...(searchContext ? { searchContext } : {}),
    // Breadth search context: real web hits the model should mine for candidates (cite their urls as evidence).
    ...(webResults?.length ? { webResults } : {}),
  });

export const buildDiscoveryQueriesUser = ({ subject }: { subject: unknown }): string => JSON.stringify({ subject });

export const buildDiscoveryFallbackUser = ({ subject, priorQueries, qualifiedCount, needed }: {
  subject: unknown; priorQueries: string[]; qualifiedCount: number; needed: number;
}): string => JSON.stringify({ subject, priorQueries, conversion: `${qualifiedCount} of ${needed} qualified` });

export const buildDiscoveryMarketingUser = ({ subject, priorQueries }: {
  subject: unknown; priorQueries: string[];
}): string => JSON.stringify({ subject, priorQueries });

export const buildDiscoveryFilterUser = ({ subject, candidates }: {
  subject: unknown;
  candidates: { name: string; evidence: { title?: string | null; snippet?: string | null }[] }[];
}): string => JSON.stringify({ subject, candidates });
