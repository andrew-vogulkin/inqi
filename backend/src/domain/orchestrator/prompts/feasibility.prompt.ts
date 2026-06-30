import { z } from 'zod';
import { SubjectCategory } from '@inqi/shared';

/** Pre-research verdict. */
export const FeasibilityVerdict = { Allow: 'allow', Deny: 'deny' } as const;
export type FeasibilityVerdict = (typeof FeasibilityVerdict)[keyof typeof FeasibilityVerdict];

const categoryValues = Object.values(SubjectCategory) as [string, ...string[]];

/** Structured output of the pre-research ethical + feasibility evaluation. */
export const feasibilitySchema = z.object({
  decision: z.enum([FeasibilityVerdict.Allow, FeasibilityVerdict.Deny]),
  riskTags: z.array(z.string()).default([]),
  reason: z.string().default(''),
  subject: z.object({
    title: z.string().min(1),
    category: z.enum(categoryValues).default(SubjectCategory.Item),
    summary: z.string().default(''),
  }),
});
export type FeasibilityResult = z.infer<typeof feasibilitySchema>;

// System prompt text lives centrally (inspectable + dynamic-ready); re-exported here.
export { feasibilitySystem } from '../../../infra/ai/prompts';

export const buildFeasibilityUser = ({ rawRequest }: { rawRequest: string }): string => rawRequest;
