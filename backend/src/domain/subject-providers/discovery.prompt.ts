import { z } from 'zod';

/** Structured output of AI candidate discovery. */
export const discoverySchema = z.object({
  candidates: z
    .array(z.object({ name: z.string().min(1), country: z.string().default('') }))
    .default([]),
});
export type DiscoveryResult = z.infer<typeof discoverySchema>;

export const DISCOVERY_SYSTEM = [
  "[stage:discovery] You are inqi's subject-provider discovery analyst (wide, cheap pass).",
  'Given the enriched subject and how many candidates are needed, propose realistic subject providers (sellers/services/landlords/orgs) that could supply it, spread across plausible regions.',
  'Never repeat any name in the provided exclude list.',
  'Respond as strict JSON: { "candidates": [ { "name": string, "country": string } ] }.',
].join(' ');

export const buildDiscoveryUser = ({ subject, count, exclude }: { subject: unknown; count: number; exclude: string[] }): string =>
  JSON.stringify({ subject, count, exclude });
