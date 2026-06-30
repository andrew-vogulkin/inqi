import { z } from 'zod';
import { ReplyIntent } from './agent.types';

// DEPTH reply parser — the system prompt text lives centrally; re-exported here.
export { replyParseSystem } from '../../infra/ai/prompts';

export const replyParseSchema = z.object({
  intent: z.enum([ReplyIntent.Qualify, ReplyIntent.Disqualify, ReplyIntent.Continue]).catch(ReplyIntent.Qualify),
  price: z.number().nullable().catch(null),
  currency: z.string().nullable().catch(null),
  availability: z.string().nullable().catch(null),
  leadTime: z.string().nullable().catch(null),
  reason: z.string().catch(''),
});
export type ReplyParse = z.infer<typeof replyParseSchema>;
