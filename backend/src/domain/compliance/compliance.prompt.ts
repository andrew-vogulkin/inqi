import { z } from 'zod';
import { ComplianceCategory, ComplianceKind } from '@inqi/shared';

const categoryValues = Object.values(ComplianceCategory) as [string, ...string[]];

/** Structured output of the compliance scorer. */
export const complianceSchema = z.object({
  allowed: z.boolean(),
  riskScore: z.number().min(0).max(1).default(0),
  categories: z.array(z.enum(categoryValues)).default([]),
  reason: z.string().default(''),
});
export type ComplianceVerdict = z.infer<typeof complianceSchema>;

// System prompt text lives centrally (inspectable + dynamic-ready); re-exported here.
export { complianceSystem } from '../../infra/ai/prompts';

/** Tag the text with what's being scored so the rubric can weigh context. */
export const buildComplianceUser = ({ kind, text }: { kind: ComplianceKind; text: string }): string =>
  `[${kind}]\n${text}`;
