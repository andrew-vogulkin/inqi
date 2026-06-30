import { z } from 'zod';

/**
 * AI transparency summaries (HP-20 dossier). One DEPTH call produces a short summary
 * for each evaluation section so the customer sees *how* inqi reached its verdict.
 * The `ranking` summary is written last, on top of the other three.
 */
export const PROVENANCE_SUMMARY_SYSTEM = [
  "You are inqi, transparently explaining to a customer how you evaluated ONE provider for their request.",
  'Write a short, concrete, honest summary (1-2 sentences) for each section:',
  '- web: what you found about the provider online — its ranking/standing and the key information available.',
  '- outreach: how the provider responded — their response time and the clarity/helpfulness of the reply.',
  '- feedback: which platforms the reviews came from and a summary of the recent reviews (sentiment + themes).',
  '- ranking: the final judgement — why this provider landed at its rank, grounded in the web, outreach and feedback above.',
  'Only state what the data supports; if a section has little data, say so plainly. Do not invent specifics.',
  'Respond as STRICT JSON only: { "web": string, "outreach": string, "feedback": string, "ranking": string }.',
].join('\n');

export const provenanceSummarySchema = z.object({
  web: z.string().catch(''),
  outreach: z.string().catch(''),
  feedback: z.string().catch(''),
  ranking: z.string().catch(''),
});
export type ProvenanceSummaryResult = z.infer<typeof provenanceSummarySchema>;

export interface ProvenanceSummaryInput {
  provider: string;
  request: string;
  rank: number;
  totalOptions: number;
  web: { source: string; url: string; snippet: string }[];
  feedback: { rating: number; sentiment: number; themes: string[]; quotes: string[] };
  scoring: { feedbackScore: number; priceScore: number; blendedScore: number };
  price: { amount: number | null; currency: string | null };
  outreach: { outcome: string; responseMinutes: number | null; reply: string | null };
}

/** The evaluation data the model summarizes (compact JSON). */
export function buildProvenanceSummaryUser(input: ProvenanceSummaryInput): string {
  return JSON.stringify({
    provider: input.provider,
    customerRequest: input.request,
    rank: `#${input.rank} of ${input.totalOptions}`,
    web: input.web.length ? input.web : 'no live web/ratings source was configured for this run',
    feedback: input.feedback,
    scoring: input.scoring,
    price: input.price,
    outreach: {
      outcome: input.outreach.outcome,
      responseTime: input.outreach.responseMinutes != null ? `${input.outreach.responseMinutes} minutes` : 'unknown',
      reply: input.outreach.reply ?? 'no reply captured',
    },
  });
}
