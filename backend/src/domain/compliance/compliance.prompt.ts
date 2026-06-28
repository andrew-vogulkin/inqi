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

/** System prompt. The `[stage:compliance]` tag lets test doubles route by stage. */
export const COMPLIANCE_SYSTEM = [
  "[stage:compliance] You are inqi's ethical + legal compliance gate.",
  'Score the given text (an outbound email to a supplier, or a customer questionnaire) for risk before it leaves inqi.',
  'Block anything that is illegal, facilitates harm, or is unsafe; otherwise allow.',
  'Respond as strict JSON: { "allowed": boolean, "riskScore": number (0..1), "categories": string[], "reason": string }.',
  `categories must be drawn from: ${categoryValues.join(', ')}.`,
].join(' ');

/** Tag the text with what's being scored so the rubric can weigh context. */
export const buildComplianceUser = ({ kind, text }: { kind: ComplianceKind; text: string }): string =>
  `[${kind}]\n${text}`;
