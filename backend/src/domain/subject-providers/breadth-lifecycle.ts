import { Logger } from '@nestjs/common';
import { BreadthEvent, LeadSource, ModelTier } from '@inqi/shared';
import { AiProvider } from '../../infra/ai/ai.tokens';
import { WebSearchProvider } from '../../infra/websearch/websearch.tokens';
import type { WebResult } from '../../infra/websearch/websearch.tools';
import { DiscoverArgs, DiscoveredProvider } from './discovery.tokens';
import {
  discoverySystem, discoveryQueriesSystem, discoveryFilterSystem, discoveryFallbackQueriesSystem, discoveryMarketingQueriesSystem,
  buildDiscoveryUser, buildDiscoveryQueriesUser, buildDiscoveryFilterUser, buildDiscoveryFallbackUser, buildDiscoveryMarketingUser,
  discoverySchema, discoveryQueriesSchema, discoveryFilterSchema, discoveryFallbackSchema, discoveryMarketingSchema,
} from './discovery.prompt';

const DEMO_REGIONS = ['HK', 'NL', 'UAE', 'South Africa', 'USA', 'Brazil', 'UK', 'Singapore'];
/** Cap on the merged multi-query hit pool handed to the mining call. */
export const MAX_WEB_HITS = 24;
/** Consecutive rounds yielding ZERO new candidates before the loop stops (search exhausted). */
export const MAX_DRY_ROUNDS = 2;

export type BreadthSubject = DiscoverArgs['subject'];
export type BreadthPoolHit = Pick<WebResult, 'title' | 'url' | 'content'>;

/**
 * Breadth-search lifecycle steps (see README "Breadth-search lifecycle").
 * Standalone functions — the breadth_search workflow's step handlers wire them
 * into the DB-driven loop (FORM_QUERIES → SEARCH → MINE → QUALIFY → CHECKPOINT
 * → RELAX → SEARCH …), so each is testable without the service dependency
 * graph. Every step degrades gracefully, exactly as the old in-memory loop did.
 */

/**
 * B. The model forms `queryCount` diverse, service-first queries (naive single query on
 * failure). `queryCount` is the primary search-cost dial — one query = one billable search.
 */
export async function formBreadthQueries({ ai, subject, queryCount, logger }: {
  ai: AiProvider; subject: BreadthSubject; queryCount: number; logger: Logger;
}): Promise<string[]> {
  try {
    const q = await ai.structured({
      system: discoveryQueriesSystem({ count: queryCount }),
      user: buildDiscoveryQueriesUser({ subject }),
      tier: ModelTier.Breadth,
      validate: (raw) => discoveryQueriesSchema.parse(raw),
    });
    if (Array.isArray(q?.queries) && q.queries.length) {
      logger.log(`discovery queries: ${q.queries.map((s) => `"${s}"`).join(', ')}`);
      return q.queries;
    }
  } catch (e) {
    logger.warn(`discovery query formation failed — using the naive query: ${(e as Error).message}`);
  }
  return [naiveBreadthQuery({ subject })];
}

export function naiveBreadthQuery({ subject }: { subject: BreadthSubject }): string {
  return `${subject.title} ${subject.description}`.slice(0, 200);
}

/** C. Run every query, merge + dedupe hits into one pool. Best-effort per query. `cap` = the poolCap gene. */
export async function searchBreadthPool({ web, queries, fallbackQuery, logger, cap = MAX_WEB_HITS }: {
  web: WebSearchProvider; queries: string[]; fallbackQuery: string; logger: Logger; cap?: number;
}): Promise<BreadthPoolHit[]> {
  const list = queries.length ? queries : [fallbackQuery];
  const settled = await Promise.all(list.map(async (query) => {
    try {
      return await web.webSearch({ query });
    } catch (e) {
      logger.warn(`discovery search "${query}" unavailable: ${(e as Error).message}`);
      return [] as WebResult[];
    }
  }));
  const seen = new Set<string>();
  const merged: BreadthPoolHit[] = [];
  for (const results of settled) {
    for (const { title, url, content } of results) {
      if (seen.has(url)) continue;
      seen.add(url);
      merged.push({ title, url, content });
      if (merged.length >= cap) return merged;
    }
  }
  return merged;
}

/** D. Relevance-gated mining over the pool; evidence limited to urls that really came back. */
export async function mineCandidates({ ai, subject, count, exclude, pool, matchNote, logger }: {
  ai: AiProvider; subject: BreadthSubject; count: number; exclude: string[]; pool: BreadthPoolHit[]; matchNote: string | null; logger: Logger;
}): Promise<DiscoveredProvider[]> {
  const result = await ai.structured({
    system: discoverySystem(),
    // matchNote doubles as the round's search context: relax/marketing rounds widened
    // the queries, so the relevance gate must judge the service CATEGORY, not the
    // full constraint set (which those rounds deliberately dropped).
    user: buildDiscoveryUser({ subject, count, exclude, webResults: pool, searchContext: matchNote }),
    tier: ModelTier.Breadth,
    validate: (raw) => discoverySchema.parse(raw),
  });
  const knownUrls = new Set(pool.map((r) => r.url));
  const mapped = result.candidates
    .filter((c) => !exclude.includes(c.name))
    .map((c) => ({
      name: c.name,
      country: c.country || 'unknown',
      source: LeadSource.Ai,
      matchNote,
      // The facts depth research strengthens later (site/socials/price mentions).
      website: c.website ?? null,
      socials: c.socials ?? [],
      facts: c.facts ?? [],
      // Only urls that really came back from the search — the model must not invent evidence.
      evidence: c.evidence
        .filter((url) => knownUrls.has(url))
        .map((url) => {
          const hit = pool.find((r) => r.url === url);
          return { url, title: hit?.title ?? null, snippet: hit?.content ?? null };
        }),
    }));
  // EVIDENCE FLOOR: when the search produced a pool, a candidate grounded in
  // nothing (no evidence url, no website) is a hallucination — drop it here
  // rather than letting depth research waste a verdict killing it. With an
  // EMPTY pool (search down) AI-only proposals are still allowed (degradation).
  if (!pool.length) return mapped;
  const grounded = mapped.filter((c) => c.evidence.length > 0 || !!c.website);
  const dropped = mapped.length - grounded.length;
  if (dropped) logger.log(`discovery evidence floor dropped ${dropped} ungrounded candidate(s): ${mapped.filter((c) => !grounded.includes(c)).map((c) => c.name).join(', ')}`);
  return grounded;
}

/**
 * E. The qualification filter (cheap check): keep only candidates that plausibly
 * PROVIDE the subject, judged on their evidence. Fail-open — a filter hiccup
 * must not empty the funnel.
 */
export async function qualifyCandidates({ ai, subject, candidates, logger }: {
  ai: AiProvider; subject: BreadthSubject; candidates: DiscoveredProvider[]; logger: Logger;
}): Promise<DiscoveredProvider[]> {
  if (candidates.length === 0) return candidates;
  try {
    const r = await ai.structured({
      system: discoveryFilterSystem(),
      user: buildDiscoveryFilterUser({
        subject,
        candidates: candidates.map((c) => ({ name: c.name, evidence: (c.evidence ?? []).map((e) => ({ title: e.title, snippet: e.snippet })) })),
      }),
      tier: ModelTier.Balanced,
      validate: (raw) => discoveryFilterSchema.parse(raw),
    });
    const keep = new Set(r.qualified);
    const kept = candidates.filter((c) => keep.has(c.name));
    const dropped = candidates.filter((c) => !keep.has(c.name)).map((c) => c.name);
    if (dropped.length) logger.log(`discovery filter dropped ${dropped.length} look-alike(s): ${dropped.join(', ')}`);
    return kept.length ? kept : candidates; // an over-eager filter must not empty the funnel
  } catch (e) {
    logger.warn(`discovery qualification filter failed (fail-open): ${(e as Error).message}`);
    return candidates;
  }
}

/** F. Low conversion → the model relaxes the least-essential constraint and re-forms queries. */
export async function relaxBreadthQueries({ ai, subject, priorQueries, qualifiedCount, needed, queryCount, logger }: {
  ai: AiProvider; subject: BreadthSubject; priorQueries: string[]; qualifiedCount: number; needed: number; queryCount: number; logger: Logger;
}): Promise<{ relaxed: string; queries: string[] } | null> {
  try {
    const r = await ai.structured({
      system: discoveryFallbackQueriesSystem({ count: queryCount }),
      user: buildDiscoveryFallbackUser({ subject, priorQueries, qualifiedCount, needed }),
      tier: ModelTier.Breadth,
      validate: (raw) => discoveryFallbackSchema.parse(raw),
    });
    if (r?.relaxed && Array.isArray(r?.queries) && r.queries.length) return { relaxed: r.relaxed, queries: r.queries };
    return null;
  } catch (e) {
    logger.warn(`discovery fallback query formation failed: ${(e as Error).message}`);
    return null;
  }
}

/**
 * G. The last search pass: re-describe the subject in the short commercial category
 * language businesses use for SEO ("tea cups supplier Bangkok") — the request's
 * specifics never match how providers word their own pages. Null = nothing usable.
 */
export async function marketingBreadthQueries({ ai, subject, priorQueries, logger }: {
  ai: AiProvider; subject: BreadthSubject; priorQueries: string[]; logger: Logger;
}): Promise<string[] | null> {
  try {
    const r = await ai.structured({
      system: discoveryMarketingQueriesSystem(),
      user: buildDiscoveryMarketingUser({ subject, priorQueries }),
      tier: ModelTier.Breadth,
      validate: (raw) => discoveryMarketingSchema.parse(raw),
    });
    if (Array.isArray(r?.queries) && r.queries.length) {
      logger.log(`marketing-language queries: ${r.queries.map((s) => `"${s}"`).join(', ')}`);
      return r.queries;
    }
    return null;
  } catch (e) {
    logger.warn(`discovery marketing query formation failed: ${(e as Error).message}`);
    return null;
  }
}

/** ✓ The adaptive checkpoint, pure: what the loop does after a qualify round. */
export function decideBreadthCheckpoint({ foundCount, targetCount, gained, dryRounds, cycle, maxCycles, dryPatience = MAX_DRY_ROUNDS }: {
  foundCount: number; targetCount: number; gained: number; dryRounds: number; cycle: number; maxCycles: number; dryPatience?: number;
}): { event: BreadthEvent; dryRounds: number } {
  const nextDry = gained === 0 ? dryRounds + 1 : 0;
  if (foundCount >= targetCount) return { event: BreadthEvent.TARGET_MET, dryRounds: nextDry };
  if (nextDry >= dryPatience) return { event: BreadthEvent.WENT_DRY, dryRounds: nextDry };
  if (cycle >= maxCycles) return { event: BreadthEvent.CAP_REACHED, dryRounds: nextDry };
  return { event: BreadthEvent.CONTINUE, dryRounds: nextDry };
}

/** Deterministic candidates, skipping any already-excluded names (no-AI degradation + empty-run backstop). */
export function fallbackCandidates({ count, exclude }: { count: number; exclude: string[] }): DiscoveredProvider[] {
  const out: DiscoveredProvider[] = [];
  for (let i = 1; out.length < count && i < count + exclude.length + 1; i++) {
    const name = `Subject Provider ${i}`;
    if (exclude.includes(name)) continue;
    out.push({ name, country: DEMO_REGIONS[(i - 1) % DEMO_REGIONS.length], source: LeadSource.Fallback });
  }
  return out;
}
