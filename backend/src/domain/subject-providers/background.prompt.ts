import { z } from 'zod';

/** Structured output of the depth-research agent (tool loop → strict JSON). */
export const depthResearchSchema = z.object({
  rating: z.number().min(0).max(5).nullish(),
  reviewsCount: z.number().int().min(0).nullish(),
  sentiment: z.number().min(0).max(1).catch(0.5),
  themes: z.array(z.string()).default([]),
  quotes: z.array(z.string()).default([]),
  eligibility: z.string().default('unknown'),
  redFlags: z.array(z.string()).default([]),
  /** Web-evidenced price for the request's unit (e.g. per class) — email replies refine it later. */
  price: z.number().nullish(),
  currency: z.string().nullish(),
  /** The unit/basis the price is quoted in, verbatim-ish ("per m²", "per day incl. operator",
   *  "total for the job") — rate-based markets (per m²/tonne/day) are meaningless without it. */
  priceBasis: z.string().nullish(),
  qualityScore: z.number().min(0).max(1),
  sources: z.array(z.object({
    source: z.string().default('web'),
    url: z.string(),
    snippet: z.string().nullish(),
  })).default([]),
});
export type DepthResearchResult = z.infer<typeof depthResearchSchema>;

/** Step B — the model's per-candidate search queries (diverse angles: site, reviews, pricing, red flags, constraint). */
export const depthQueriesSchema = z.object({ queries: z.array(z.string().min(1)).min(1).max(8) });

/** Step E — the evaluation gate's audit of a verdict's evidence sufficiency. */
export const depthGateSchema = z.object({
  sufficient: z.boolean(),
  gaps: z.array(z.string()).default([]),
});
export type DepthGateResult = z.infer<typeof depthGateSchema>;

/** A pre-fetched search lead seeded into the agent's first cycle. */
export interface DepthSearchLead { title: string | null; url: string; snippet: string | null }

/** The facts breadth discovery collected — depth STRENGTHENS these (opens the site first). */
export interface KnownFacts { website?: string | null; socials?: string[]; facts?: string[] }

// System prompt text lives centrally (inspectable + dynamic-ready); re-exported here.
export { depthResearchSystem, depthQueriesSystem, depthGateSystem } from '../../infra/ai/prompts';

export const buildDepthQueriesUser = ({ name, regionHint, subject, matchNote }: {
  name: string; regionHint?: string | null; subject?: { title: string; description: string } | null; matchNote?: string | null;
}): string =>
  JSON.stringify({
    candidate: name,
    ...(regionHint ? { region: regionHint } : {}),
    ...(subject ? { customerIsLookingFor: `${subject.title} — ${subject.description}` } : {}),
    ...(matchNote ? { unconfirmedConstraint: matchNote } : {}),
  });

export const buildDepthGateUser = ({ name, subject, matchNote, verdict }: {
  name: string; subject?: { title: string; description: string } | null; matchNote?: string | null; verdict: DepthResearchResult;
}): string =>
  JSON.stringify({
    candidate: name,
    ...(subject ? { customerIsLookingFor: `${subject.title} — ${subject.description}` } : {}),
    ...(matchNote ? { unconfirmedConstraint: matchNote } : {}),
    verdict,
  });

export const buildDepthResearchUser = ({ name, regionHint, subject, matchNote, searchLeads, knownFacts }: {
  name: string; regionHint?: string | null; subject?: { title: string; description: string } | null; matchNote?: string | null;
  searchLeads?: DepthSearchLead[]; knownFacts?: KnownFacts | null;
}): string =>
  JSON.stringify({
    candidate: name,
    ...(regionHint ? { region: regionHint } : {}),
    ...(subject ? { customerIsLookingFor: `${subject.title} — ${subject.description}` } : {}),
    // Fallback-discovery find: one constraint was relaxed to surface this candidate —
    // VERIFY whether they actually satisfy it; reflect the answer in eligibility.
    ...(matchNote ? { unconfirmedConstraint: matchNote } : {}),
    // Breadth's collected facts — STRENGTHEN these (open the website first).
    ...(knownFacts && (knownFacts.website || knownFacts.socials?.length || knownFacts.facts?.length) ? { knownFacts } : {}),
    // Pre-fetched multi-query hits — the agent opens the best ones instead of re-searching blindly.
    ...(searchLeads?.length ? { searchLeads } : {}),
  });

/** Cycle 2+: the agent re-reads its own verdict with a fresh tool budget and hardens it. */
export const buildDepthRefineUser = ({ name, regionHint, subject, prior, cycle, gaps }: {
  name: string; regionHint?: string | null; subject?: { title: string; description: string } | null;
  prior: DepthResearchResult; cycle: number; gaps?: string[];
}): string =>
  JSON.stringify({
    candidate: name,
    ...(regionHint ? { region: regionHint } : {}),
    ...(subject ? { customerIsLookingFor: `${subject.title} — ${subject.description}` } : {}),
    refinementCycle: cycle,
    priorVerdict: prior,
    // The evaluation gate's named gaps — close these FIRST before generic hardening.
    ...(gaps?.length ? { evidenceGaps: gaps } : {}),
    instruction: [
      'This is a verification cycle over your prior verdict above. With a fresh tool budget:',
      ...(gaps?.length ? ['0) FIRST close every line in evidenceGaps — they are audited shortfalls in your evidence;'] : []),
      '1) cross-check the rating/reviewsCount against at least one source you have not cited yet;',
      '2) fill the gaps — any null/empty field you can now evidence;',
      '3) actively look for red flags (closures, complaints, mismatched location);',
      '4) drop anything the pages no longer support.',
      'Then return the FULL corrected JSON verdict (same schema). Keep prior sources that still hold; add the new ones you used.',
    ].join(' '),
  });
