import { z } from 'zod';
import { AnswerSource } from './agent.types';

// Reply loop (2 elements) — the system prompt texts live centrally; re-exported here.
export { replyEvaluateSystem, replyAnswerSystem, replyDraftCheckSystem } from '../../infra/ai/prompts';

/**
 * Loop element 1 — EVALUATE: does the thread carry the chain target
 * (cost estimate + timeline)? Extracted offer fields ride along so a
 * sufficient thread settles without a second model call.
 */
export const replyEvaluateSchema = z.object({
  // A malformed answer means "not proven sufficient" — the loop keeps asking
  // (bounded by MAX_OUTBOUND_PER_THREAD) instead of settling on garbage.
  sufficient: z.boolean().catch(false),
  declined: z.boolean().catch(false),
  price: z.number().nullable().catch(null),
  currency: z.string().nullable().catch(null),
  /** The unit the provider quoted in ("per m²", "per day", "total for the job") — null when they quoted a plain total. */
  priceBasis: z.string().nullable().catch(null),
  availability: z.string().nullable().catch(null),
  leadTime: z.string().nullable().catch(null),
  reason: z.string().catch(''),
});
export type ReplyEvaluation = z.infer<typeof replyEvaluateSchema>;

/**
 * Loop element 2 — ANSWER: the follow-up email answering the provider's
 * questions by priority (prompt > questionnaire > imagination); `answeredFrom`
 * records which source supplied each answer (observability, logged).
 */
export const replyAnswerSchema = z.object({
  body: z.string().min(1),
  answeredFrom: z.array(z.enum([AnswerSource.Prompt, AnswerSource.Questionnaire, AnswerSource.Imagination])).catch([]),
});
export type ReplyAnswer = z.infer<typeof replyAnswerSchema>;

/**
 * The draft audit run between drafting and sending: (1) forward progress toward
 * the chain target, (2) topic correlation with scope + thread. Both fields
 * fail-open (a broken checker must not degrade every follow-up to the canned
 * fallback); a failing draft is redrafted with `issues` fed back.
 */
export const replyDraftCheckSchema = z.object({
  movesForward: z.boolean().catch(true),
  onTopic: z.boolean().catch(true),
  issues: z.array(z.string()).catch([]),
});
export type ReplyDraftCheck = z.infer<typeof replyDraftCheckSchema>;
