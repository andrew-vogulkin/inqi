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

/** System prompt. The `[stage:feasibility]` tag lets test doubles route by stage. */
export const FEASIBILITY_SYSTEM = [
  '[stage:feasibility] You are inqi\'s pre-research analyst.',
  'Given a customer\'s free-text request for something they want to find (an item, service, rental, organisation, goods or trade),',
  'evaluate it for ethical and legal feasibility, then enrich the subject.',
  'Deny anything illegal, dangerous, or that facilitates harm; otherwise allow.',
  'Respond as strict JSON: { "decision": "allow"|"deny", "riskTags": string[], "reason": string,',
  '"subject": { "title": string, "category": "item"|"service"|"rental"|"organisation"|"goods"|"trade", "summary": string } }.',
].join(' ');

export const buildFeasibilityUser = ({ rawRequest }: { rawRequest: string }): string => rawRequest;
