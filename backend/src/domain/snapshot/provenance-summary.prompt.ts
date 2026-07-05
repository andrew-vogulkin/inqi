import { z } from 'zod';

// AI transparency summaries (HP-20 dossier). System prompt text lives centrally; re-exported here.
export { provenanceSummarySystem } from '../../infra/ai/prompts';

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
  outreach: { outcome: string; responseMinutes: number | null; rounds: number; reply: string | null };
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
      emailRounds: input.outreach.rounds,
      // The LATEST reply — after a multi-round chain this is the settled quote, not the opening question.
      latestReply: input.outreach.reply ?? 'no reply captured',
    },
  });
}
