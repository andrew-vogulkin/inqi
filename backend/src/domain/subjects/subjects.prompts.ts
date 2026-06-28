import { z } from 'zod';

/** Structured output of subject enrichment (from questionnaire answers). */
export const enrichmentSchema = z.object({
  refinedDescription: z.string().default(''),
  attributes: z.record(z.string(), z.unknown()).default({}),
  constraints: z.array(z.string()).default([]),
});
export type EnrichmentResult = z.infer<typeof enrichmentSchema>;

export const ENRICHMENT_SYSTEM = [
  '[stage:enrichment] You are inqi\'s subject-enrichment analyst.',
  'Given the original request and the customer\'s confirmed questionnaire answers,',
  'refine the subject: a precise description, structured attributes (specs/preferences), and explicit constraints.',
  'Respond as strict JSON: { "refinedDescription": string, "attributes": object, "constraints": string[] }.',
].join(' ');

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

export const BROAD_RESEARCH_SYSTEM = [
  '[stage:broad-research] You are inqi\'s broad-research analyst (wide, cheap pass).',
  'Given the enriched subject, outline the realistic search space: geographic scope, timing, a sensible price range, and whether the request makes economic sense.',
  'Respond as strict JSON: { "geoConstraint": string, "timeConstraint": string, "priceRange": { "min": number|null, "max": number|null, "currency": string }, "economicSense": string, "notes": string[] }.',
].join(' ');

export const buildBroadResearchUser = ({ subject }: { subject: Record<string, unknown> }): string => JSON.stringify(subject);
