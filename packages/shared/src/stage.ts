import { InquiryState } from './workflow.js';

/**
 * HP-23 — customer-facing inquiry **stage**: a derived projection over the workflow
 * state + how many subtasks have qualified. It is NOT a workflow state (no new states,
 * no version bump): the orchestrator pursues `Ready` (≥ READY_MIN qualified) and the
 * inquiry is `Partially ready` the moment ≥ PARTIAL_READY_MIN qualify (when the
 * partial report / freemium teaser becomes available). Promoted into the shared
 * contract (was FE-only) so the backend computes it once and the FE renders it from
 * the DTO/events instead of re-deriving.
 */
export const InquiryStage = {
  Draft: 'Draft',
  Preparing: 'Preparing',
  Questionnaire: 'Questionnaire',
  Researching: 'Researching',
  PartiallyReady: 'Partially ready',
  Ready: 'Ready',
} as const;
export type InquiryStage = (typeof InquiryStage)[keyof typeof InquiryStage];

/** Ordered stages (index = dashboard pipeline segment). */
export const STAGE_ORDER: InquiryStage[] = [
  InquiryStage.Draft, InquiryStage.Preparing, InquiryStage.Questionnaire,
  InquiryStage.Researching, InquiryStage.PartiallyReady, InquiryStage.Ready,
];
export function stageIndex(stage: InquiryStage): number {
  return STAGE_ORDER.indexOf(stage);
}

/**
 * Readiness thresholds (config). `Partially ready` once this many subtasks qualify
 * (partial report available); `Ready` once enough qualify. The orchestrator pursues
 * READY_MIN; a funnel exhausted with PARTIAL_READY_MIN..READY_MIN-1 stays Partially
 * ready and delivers a partial report rather than hanging.
 */
export const PARTIAL_READY_MIN = 2;
export const READY_MIN = 5;
export interface StageThresholds { partialReadyMin: number; readyMin: number }
export const DEFAULT_STAGE_THRESHOLDS: StageThresholds = { partialReadyMin: PARTIAL_READY_MIN, readyMin: READY_MIN };

/**
 * The single pure stage projection. Count-driven readiness (≥ partialReadyMin / ≥
 * readyMin) overrides the in-flight `Researching` stage; a delivered report is always
 * `Ready`. Terminal-bad states keep their underlying stage — the FE overlays a
 * failed/declined badge separately (see `isFailedState`).
 */
export function deriveStage({ state, qualifiedCount, thresholds = DEFAULT_STAGE_THRESHOLDS }: {
  state: string;
  qualifiedCount: number;
  thresholds?: StageThresholds;
}): InquiryStage {
  if (state === InquiryState.REPORT_DELIVERED) return InquiryStage.Ready;
  if (qualifiedCount >= thresholds.readyMin) return InquiryStage.Ready;
  if (qualifiedCount >= thresholds.partialReadyMin) return InquiryStage.PartiallyReady;
  switch (state) {
    case InquiryState.RECEIVED:
      return InquiryStage.Draft; // submitted, nothing processed yet
    case InquiryState.PRE_RESEARCH:
    case InquiryState.ENRICHMENT:
      return InquiryStage.Preparing;
    case InquiryState.QUESTIONNAIRE_SENT:
      return InquiryStage.Questionnaire;
    case InquiryState.BROAD_RESEARCH:
    case InquiryState.FUNNEL:
    case InquiryState.OUTREACH:
    case InquiryState.REPORT_GENERATION:
      return InquiryStage.Researching;
    default:
      return InquiryStage.Preparing; // terminal-bad / ON_HOLD — the badge carries the real status
  }
}
