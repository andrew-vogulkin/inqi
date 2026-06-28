import { z } from 'zod';

/** Structured output of report synthesis. */
export const synthesisSchema = z.object({
  summary: z.string().min(1),
  highlights: z.array(z.string()).default([]),
});
export type SynthesisResult = z.infer<typeof synthesisSchema>;

export const SYNTHESIS_SYSTEM = [
  '[stage:synthesis] You are inqi\'s report writer.',
  'Given the ranked subject-provider options (each with price, availability, quality score and background),',
  'write a concise, neutral summary for the customer that explains the trade-offs and why the top option leads — quality, not just price.',
  'Respond as strict JSON: { "summary": string, "highlights": string[] }.',
].join(' ');

export const buildSynthesisUser = ({ options }: { options: unknown[] }): string => JSON.stringify({ options });
