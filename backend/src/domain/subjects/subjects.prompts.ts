import { z } from 'zod';

/** Structured output of subject enrichment (from questionnaire answers). */
export const enrichmentSchema = z.object({
  refinedDescription: z.string().default(''),
  attributes: z.record(z.string(), z.unknown()).default({}),
  constraints: z.array(z.string()).default([]),
});
export type EnrichmentResult = z.infer<typeof enrichmentSchema>;

// System prompt text lives centrally (inspectable + dynamic-ready); re-exported here.
export { enrichmentSystem, broadResearchSystem } from '../../infra/ai/prompts';

export const buildEnrichmentUser = ({ rawRequest, answers }: { rawRequest: string; answers: Record<string, unknown> }): string =>
  JSON.stringify({ rawRequest, answers });

/** Structured output of broad research (geo / time / price / economic sense). */
export const broadResearchSchema = z.object({
  geoConstraint: z.string().default(''),
  timeConstraint: z.string().default(''),
  priceRange: z
    .object({ min: z.number().nullable().default(null), max: z.number().nullable().default(null), currency: z.string().default('') })
    .default({ min: null, max: null, currency: '' }),
  economicSense: z.string().default(''),
  notes: z.array(z.string()).default([]),
});
export type BroadResearchResult = z.infer<typeof broadResearchSchema>;

export const buildBroadResearchUser = ({ subject }: { subject: Record<string, unknown> }): string => JSON.stringify(subject);
