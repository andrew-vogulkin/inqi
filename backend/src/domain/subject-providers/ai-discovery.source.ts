import { Inject, Injectable, Logger } from '@nestjs/common';
import { LeadSource, ModelTier } from '@inqi/shared';
import { ConfigService } from '../../infra/config/config.service';
import { AI_PROVIDER, AiProvider } from '../../infra/ai/ai.tokens';
import { WEB_SEARCH, WebSearchProvider } from '../../infra/websearch/websearch.tokens';
import type { WebResult } from '../../infra/websearch/websearch.tools';
import { DiscoverArgs, DiscoveredProvider, DiscoveryOutcome, DiscoverySource } from './discovery.tokens';
import {
  discoverySystem, discoveryQueriesSystem, discoveryFilterSystem, discoveryFallbackQueriesSystem,
  buildDiscoveryUser, buildDiscoveryQueriesUser, buildDiscoveryFilterUser, buildDiscoveryFallbackUser,
  discoverySchema, discoveryQueriesSchema, discoveryFilterSchema, discoveryFallbackSchema,
} from './discovery.prompt';

const DEMO_REGIONS = ['HK', 'NL', 'UAE', 'South Africa', 'USA', 'Brazil', 'UK', 'Singapore'];
/** Cap on the merged multi-query hit pool handed to the mining call. */
const MAX_WEB_HITS = 24;
/** Consecutive rounds yielding ZERO new candidates before the loop stops (search exhausted). */
const MAX_DRY_ROUNDS = 2;

/**
 * Breadth-search lifecycle (see README "Breadth-search lifecycle" for the diagram):
 *   A. context   — subject + exclusions in, service-first framing
 *   B. queries   — the model forms ~5 DIVERSE search queries
 *   C. search    — all queries run; hits merge + dedupe into one pool
 *   D. mine      — relevance-gated proposal (must PROVIDE the subject; evidence = real pool urls)
 *   E. qualify   — a cheap filter drops setting/keyword look-alikes (bar ≠ yoga studio)
 *   ✓ checkpoint — ADAPTIVE: keep cycling toward the FULL count while rounds are
 *                  productive; stop when the target is met, the search goes dry
 *                  (MAX_DRY_ROUNDS rounds with no new finds), the model has no new
 *                  queries left, or the hard cap (config `breadthMaxCycles`) hits.
 *   F. fallback  — the model relaxes the LEAST-essential constraint ("rooftop yoga
 *                  studio" → "yoga studio") and re-searches; fallback finds carry
 *                  `matchNote` so research/outreach confirm the relaxed dimension.
 * Degrades gracefully at every step: no search → AI-only proposal; filter/fallback
 * failure → fail-open/stop; no AI → deterministic fallback so the funnel builds offline.
 */
@Injectable()
export class AiDiscoverySource implements DiscoverySource {
  private readonly logger = new Logger(AiDiscoverySource.name);

  constructor(
    @Inject(AI_PROVIDER) private readonly ai: AiProvider,
    @Inject(WEB_SEARCH) private readonly web: WebSearchProvider,
    private readonly config: ConfigService,
  ) {}

  async discover({ subject, count, exclude }: DiscoverArgs): Promise<DiscoveryOutcome> {
    if (!this.ai.isConfigured()) return { candidates: this.fallback({ count, exclude }), notes: [] };

    const maxCycles = Math.max(1, this.config.research.breadthMaxCycles);
    const notes: string[] = [];
    const found: DiscoveredProvider[] = [];
    const seenNames = new Set(exclude);
    let queries = await this.formQueries({ subject });
    let matchNote: string | null = null; // set by fallback rounds — their finds only partially match
    let dryRounds = 0;

    for (let round = 1; round <= maxCycles; round++) {
      const pool = await this.searchAll({ queries, fallbackQuery: `${subject.title} ${subject.description}`.slice(0, 200) });
      let gained = 0;
      try {
        const proposed = await this.mine({ subject, count, exclude: [...seenNames], pool, matchNote });
        const kept = await this.qualify({ subject, candidates: proposed });
        for (const c of kept) {
          if (seenNames.has(c.name)) continue;
          seenNames.add(c.name);
          found.push(c);
          gained++;
        }
      } catch (e) {
        this.logger.warn(`AI discovery round ${round} failed: ${(e as Error).message}`);
      }

      // ✓ adaptive checkpoint — the loop self-adjusts: press toward the FULL target
      // while rounds still produce, stop the moment they don't.
      if (found.length >= count) break;
      dryRounds = gained === 0 ? dryRounds + 1 : 0;
      if (dryRounds >= MAX_DRY_ROUNDS) {
        const note = `search went dry after ${round} cycle(s) — stopping at ${found.length}/${count}`;
        notes.push(note);
        this.logger.log(`discovery: ${note}`);
        break;
      }
      if (round === maxCycles) {
        const note = `cycle cap (${maxCycles}) reached at ${found.length}/${count}`;
        notes.push(note);
        this.logger.warn(`discovery: ${note}`);
        break;
      }

      const relaxed = await this.relaxQueries({ subject, priorQueries: queries, qualifiedCount: found.length, needed: count });
      if (!relaxed) break; // fallback formation failed — ship what we have
      // Identical queries would only re-mine the same pool — the model has nothing new to try.
      if (relaxed.queries.join('\n') === queries.join('\n')) {
        this.logger.log(`discovery: fallback returned the same queries after ${round} cycle(s) — stopping at ${found.length}/${count}`);
        break;
      }
      queries = relaxed.queries;
      matchNote = `found without "${relaxed.relaxed}" — confirm via research/outreach`;
      const note = `search converted ${found.length}/${count} — relaxed "${relaxed.relaxed}", re-searching`;
      notes.push(note);
      this.logger.log(`discovery fallback round ${round}: ${note}`);
    }

    if (!found.length) return { candidates: this.fallback({ count, exclude }), notes };
    return { candidates: found.slice(0, count), notes };
  }

  /** B. The model forms ~5 diverse, service-first queries (naive single query on failure). */
  private async formQueries({ subject }: { subject: DiscoverArgs['subject'] }): Promise<string[]> {
    try {
      const q = await this.ai.structured({
        system: discoveryQueriesSystem(),
        user: buildDiscoveryQueriesUser({ subject }),
        tier: ModelTier.Breadth,
        validate: (raw) => discoveryQueriesSchema.parse(raw),
      });
      if (Array.isArray(q?.queries) && q.queries.length) {
        this.logger.log(`discovery queries: ${q.queries.map((s) => `"${s}"`).join(', ')}`);
        return q.queries;
      }
    } catch (e) {
      this.logger.warn(`discovery query formation failed — using the naive query: ${(e as Error).message}`);
    }
    return [`${subject.title} ${subject.description}`.slice(0, 200)];
  }

  /** F. Low conversion → the model relaxes the least-essential constraint and re-forms queries. */
  private async relaxQueries({ subject, priorQueries, qualifiedCount, needed }: {
    subject: DiscoverArgs['subject']; priorQueries: string[]; qualifiedCount: number; needed: number;
  }): Promise<{ relaxed: string; queries: string[] } | null> {
    try {
      const r = await this.ai.structured({
        system: discoveryFallbackQueriesSystem(),
        user: buildDiscoveryFallbackUser({ subject, priorQueries, qualifiedCount, needed }),
        tier: ModelTier.Breadth,
        validate: (raw) => discoveryFallbackSchema.parse(raw),
      });
      if (r?.relaxed && Array.isArray(r?.queries) && r.queries.length) return { relaxed: r.relaxed, queries: r.queries };
      return null;
    } catch (e) {
      this.logger.warn(`discovery fallback query formation failed: ${(e as Error).message}`);
      return null;
    }
  }

  /** C. Run every query, merge + dedupe hits into one pool. Best-effort per query. */
  private async searchAll({ queries, fallbackQuery }: { queries: string[]; fallbackQuery: string }): Promise<Pick<WebResult, 'title' | 'url' | 'content'>[]> {
    const list = queries.length ? queries : [fallbackQuery];
    const settled = await Promise.all(list.map(async (query) => {
      try {
        return await this.web.webSearch({ query });
      } catch (e) {
        this.logger.warn(`discovery search "${query}" unavailable: ${(e as Error).message}`);
        return [] as WebResult[];
      }
    }));
    const seen = new Set<string>();
    const merged: Pick<WebResult, 'title' | 'url' | 'content'>[] = [];
    for (const results of settled) {
      for (const { title, url, content } of results) {
        if (seen.has(url)) continue;
        seen.add(url);
        merged.push({ title, url, content });
        if (merged.length >= MAX_WEB_HITS) return merged;
      }
    }
    return merged;
  }

  /** D. Relevance-gated mining over the pool; evidence limited to urls that really came back. */
  private async mine({ subject, count, exclude, pool, matchNote }: {
    subject: DiscoverArgs['subject']; count: number; exclude: string[]; pool: Pick<WebResult, 'title' | 'url' | 'content'>[]; matchNote: string | null;
  }): Promise<DiscoveredProvider[]> {
    const result = await this.ai.structured({
      system: discoverySystem(),
      user: buildDiscoveryUser({ subject, count, exclude, webResults: pool }),
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
    if (dropped) this.logger.log(`discovery evidence floor dropped ${dropped} ungrounded candidate(s): ${mapped.filter((c) => !grounded.includes(c)).map((c) => c.name).join(', ')}`);
    return grounded;
  }

  /**
   * The qualification filter (cheap check): keep only candidates that plausibly
   * PROVIDE the subject, judged on their evidence. Fail-open — a filter hiccup
   * must not empty the funnel.
   */
  private async qualify({ subject, candidates }: { subject: DiscoverArgs['subject']; candidates: DiscoveredProvider[] }): Promise<DiscoveredProvider[]> {
    if (candidates.length === 0) return candidates;
    try {
      const r = await this.ai.structured({
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
      if (dropped.length) this.logger.log(`discovery filter dropped ${dropped.length} look-alike(s): ${dropped.join(', ')}`);
      return kept.length ? kept : candidates; // an over-eager filter must not empty the funnel
    } catch (e) {
      this.logger.warn(`discovery qualification filter failed (fail-open): ${(e as Error).message}`);
      return candidates;
    }
  }

  /** Deterministic candidates, skipping any already-excluded names (for widening). */
  private fallback({ count, exclude }: { count: number; exclude: string[] }): DiscoveredProvider[] {
    const out: DiscoveredProvider[] = [];
    for (let i = 1; out.length < count && i < count + exclude.length + 1; i++) {
      const name = `Subject Provider ${i}`;
      if (exclude.includes(name)) continue;
      out.push({ name, country: DEMO_REGIONS[(i - 1) % DEMO_REGIONS.length], source: LeadSource.Fallback });
    }
    return out;
  }
}
