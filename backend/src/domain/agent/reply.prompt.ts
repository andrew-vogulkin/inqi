import { z } from 'zod';
import { ReplyIntent } from './agent.types';

/**
 * DEPTH reply parser — reads a subject-provider's email reply and decides the
 * outcome + extracts the offer. The currency is taken verbatim from the provider's
 * reply (their LOCAL currency — never converted), so the report shows real terms.
 */
export const REPLY_PARSE_SYSTEM = [
  "You are inqi's outreach agent reading a service provider's email reply to a customer inquiry.",
  'Decide the outcome and extract the offer they quoted.',
  'Respond as STRICT JSON only: { "intent": "qualify"|"disqualify"|"continue", "price": number|null, "currency": string|null, "availability": string|null, "leadTime": string|null, "reason": string }.',
  '- "qualify": they can help and quoted (or clearly implied) a price/availability.',
  '- "disqualify": they decline, cannot help, or are unavailable.',
  '- "continue": they need more info before quoting.',
  '- price: the number they quoted (no thousands separators), else null.',
  '- currency: exactly the currency they used — a 3-letter code (THB, GBP, USD, EUR, …) or the symbol — never convert it.',
  '- availability / leadTime: short phrases taken from the reply (e.g. "available", "in stock", "1-2 weeks"), else null.',
  '- reason: one short sentence.',
].join('\n');

export const replyParseSchema = z.object({
  intent: z.enum([ReplyIntent.Qualify, ReplyIntent.Disqualify, ReplyIntent.Continue]).catch(ReplyIntent.Qualify),
  price: z.number().nullable().catch(null),
  currency: z.string().nullable().catch(null),
  availability: z.string().nullable().catch(null),
  leadTime: z.string().nullable().catch(null),
  reason: z.string().catch(''),
});
export type ReplyParse = z.infer<typeof replyParseSchema>;
