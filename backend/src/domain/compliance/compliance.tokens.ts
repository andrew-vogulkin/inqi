import { ComplianceCategory, ComplianceKind, ComplianceStatus, ModelTier } from '@inqi/shared';

export interface ComplianceResult {
  /** passed | blocked | unscored (fail-open with the scorer unavailable). */
  status: ComplianceStatus;
  /** 0..1, higher = riskier. */
  score: number;
  /** Flagged risk categories (empty when allowed). */
  categories: ComplianceCategory[];
  /** Short human-readable rationale. */
  reason?: string;
}

/**
 * Ethical + legal scoring gate. Every outbound email AND questionnaire passes
 * through this before it leaves inqi. Swappable rubric — bind a concrete impl to
 * {@link COMPLIANCE_SCORER}, inject by token. `kind` lets the rubric adapt; the
 * router starts BALANCED and escalates to DEPTH on a borderline verdict.
 */
export interface ComplianceScorer {
  score(args: { kind: ComplianceKind; text: string; tier?: ModelTier }): Promise<ComplianceResult>;
}
export const COMPLIANCE_SCORER = Symbol('ComplianceScorer');
