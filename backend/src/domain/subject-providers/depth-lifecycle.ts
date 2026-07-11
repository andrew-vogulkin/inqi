import { Logger } from '@nestjs/common';
import { DepthEvent, DepthOutcome, ModelTier, SearchFocus } from '@inqi/shared';
import { AiProvider } from '../../infra/ai/ai.tokens';
import { WebSearchProvider } from '../../infra/websearch/websearch.tokens';
import {
  depthQueriesSystem, depthGateSystem,
  buildDepthQueriesUser, buildDepthGateUser,
  depthQueriesSchema, depthGateSchema,
  DepthGateResult, DepthResearchResult, DepthSearchLead,
} from './background.prompt';

/** Cap on the merged multi-query lead pool seeded into the depth agent's first cycle. */
export const DEPTH_MAX_LEADS = 12;
/** Lead snippets are trimmed — the agent opens the page itself for the full text. */
const LEAD_SNIPPET_CHARS = 300;

export interface DepthSubject { title: string; description: string }

/**
 * Depth-research lifecycle steps B, C and E (see README "Depth-research
 * lifecycle" for the diagram). Standalone functions (not service methods) so
 * they are testable without the SubjectProvidersService dependency graph —
 * the service wires them into its investigate() loop:
 *   B. queries — the model forms ~5 targeted queries for ONE candidate
 *   C. search  — all queries run; hits merge + dedupe into a lead pool
 *   D. (service) agentic investigation seeded with the pool
 *   E. gate    — a cheap audit judges the verdict's evidence sufficiency
 *   F. (service) refine cycles target the gate's named gaps
 * Every step degrades gracefully: query formation → naive query; search →
 * empty pool; gate → fail-SUFFICIENT (a broken auditor must not burn cycles).
 */

/** B. The model forms ~5 targeted queries for the candidate (naive "name + region" on failure). */
export async function formDepthQueries({ ai, name, regionHint, subject, matchNote, focus = null, logger }: {
  ai: AiProvider; name: string; regionHint: string | null; subject: DepthSubject | null; matchNote: string | null; focus?: SearchFocus | null; logger: Logger;
}): Promise<string[]> {
  const naive = `${name}${regionHint ? ` ${regionHint}` : ''}`;
  try {
    const q = await ai.structured({
      system: depthQueriesSystem({ focus }),
      user: buildDepthQueriesUser({ name, regionHint, subject, matchNote }),
      tier: ModelTier.Breadth,
      validate: (raw) => depthQueriesSchema.parse(raw),
    });
    if (Array.isArray(q?.queries) && q.queries.length) {
      logger.log(`depth[${name}] queries: ${q.queries.map((s) => `"${s}"`).join(', ')}`);
      return q.queries;
    }
  } catch (e) {
    logger.warn(`depth[${name}] query formation failed — using the naive query: ${(e as Error).message}`);
  }
  return [naive];
}

/** C. Run every query, merge + dedupe hits into one lead pool. Best-effort per query. */
export async function searchDepthLeads({ web, name, queries, logger, cap = DEPTH_MAX_LEADS }: {
  web: WebSearchProvider; name: string; queries: string[]; logger: Logger; cap?: number;
}): Promise<DepthSearchLead[]> {
  const settled = await Promise.all(queries.map(async (query) => {
    try {
      return await web.webSearch({ query });
    } catch (e) {
      logger.warn(`depth[${name}] search "${query}" unavailable: ${(e as Error).message}`);
      return [];
    }
  }));
  const seen = new Set<string>();
  const leads: DepthSearchLead[] = [];
  for (const results of settled) {
    for (const { title, url, content } of results) {
      if (seen.has(url)) continue;
      seen.add(url);
      leads.push({ url, title: title ?? null, snippet: content ? content.slice(0, LEAD_SNIPPET_CHARS) : null });
      if (leads.length >= cap) return leads;
    }
  }
  return leads;
}

/**
 * E. The evaluation gate: a cheap audit of whether the verdict's evidence is
 * sufficient to settle the candidate. Fail-SUFFICIENT — a broken auditor must
 * not burn refine cycles (the old always-refine behaviour was the ceiling).
 */
export async function evaluateDepthVerdict({ ai, name, subject, matchNote, verdict, focus = null, logger }: {
  ai: AiProvider; name: string; subject: DepthSubject | null; matchNote: string | null; verdict: DepthResearchResult; focus?: SearchFocus | null; logger: Logger;
}): Promise<DepthGateResult> {
  try {
    return await ai.structured({
      system: depthGateSystem({ focus }),
      user: buildDepthGateUser({ name, subject, matchNote, verdict }),
      tier: ModelTier.Balanced,
      validate: (raw) => depthGateSchema.parse(raw),
    });
  } catch (e) {
    logger.warn(`depth[${name}] evaluation gate failed (fail-sufficient): ${(e as Error).message}`);
    return { sufficient: true, gaps: [] };
  }
}

/** Refine cycles that cite no NEW evidence before the loop stalls (see decideDepthGate). */
export const DEPTH_STALL_PATIENCE = 2;

/**
 * F. What the loop does with a gate result, pure: sufficient stops early; no
 * actionable gaps or the SAME gaps twice stop as stalled. The gate also stalls
 * on NO PROGRESS — a model that keeps naming freshly-worded gaps while its refine
 * cycles cite no new sources is chasing answers that aren't on the open web; we
 * count consecutive no-evidence-gained cycles (`noProgressStreak`) and stall once
 * `stallPatience` runs out, so re-worded gaps can't grind to the cycle cap.
 */
export function decideDepthGate({
  sufficient, gaps, priorGapsKey,
  evidenceCount = 0, priorEvidenceCount = 0, noProgressStreak = 0, stallPatience = DEPTH_STALL_PATIENCE,
}: {
  sufficient: boolean; gaps: string[]; priorGapsKey: string;
  evidenceCount?: number; priorEvidenceCount?: number; noProgressStreak?: number; stallPatience?: number;
}): { event: DepthEvent; outcome: DepthOutcome | null; gapsKey: string; noProgressStreak: number } {
  const gapsKey = gaps.map((g) => g.trim().toLowerCase()).sort().join('|');
  if (sufficient) return { event: DepthEvent.EVIDENCE_SUFFICIENT, outcome: DepthOutcome.Sufficient, gapsKey, noProgressStreak: 0 };
  if (!gaps.length || gapsKey === priorGapsKey) return { event: DepthEvent.STALLED, outcome: DepthOutcome.Stalled, gapsKey, noProgressStreak };
  const streak = evidenceCount > priorEvidenceCount ? 0 : noProgressStreak + 1;
  if (streak >= stallPatience) return { event: DepthEvent.STALLED, outcome: DepthOutcome.Stalled, gapsKey, noProgressStreak: streak };
  return { event: DepthEvent.GAPS_NAMED, outcome: null, gapsKey, noProgressStreak: streak };
}
