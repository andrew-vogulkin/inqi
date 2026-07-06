import { z } from 'zod';

/** Structured output of report synthesis. */
export const synthesisSchema = z.object({
  summary: z.string().min(1),
  highlights: z.array(z.string()).default([]),
});
export type SynthesisResult = z.infer<typeof synthesisSchema>;

// System prompt text lives centrally (inspectable + dynamic-ready); re-exported here.
export { synthesisSystem } from '../../infra/ai/prompts';

export const buildSynthesisUser = ({ options, customerRequest }: { options: unknown[]; customerRequest?: string | null }): string =>
  // `customerRequest` verbatim: the summary must be written in ITS language (prompt-origin language rule).
  JSON.stringify({ ...(customerRequest ? { customerRequest } : {}), options });
