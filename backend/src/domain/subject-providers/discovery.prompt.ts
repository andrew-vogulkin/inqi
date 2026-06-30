import { z } from 'zod';

/** Structured output of AI candidate discovery. */
export const discoverySchema = z.object({
  candidates: z
    .array(z.object({ name: z.string().min(1), country: z.string().default('') }))
    .default([]),
});
export type DiscoveryResult = z.infer<typeof discoverySchema>;

// System prompt text lives centrally (inspectable + dynamic-ready); re-exported here.
export { discoverySystem } from '../../infra/ai/prompts';

export const buildDiscoveryUser = ({ subject, count, exclude }: { subject: unknown; count: number; exclude: string[] }): string =>
  JSON.stringify({ subject, count, exclude });
