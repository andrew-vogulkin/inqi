import { ReportState } from './workflow.js';

/**
 * HP-23 — customer-facing report **stage**: a derived projection over the workflow
 * state + how many inquiries have qualified. It is NOT a workflow state (no new states,
 * no version bump): the orchestrator pursues `Ready` (≥ READY_MIN qualified) and the
 * report is `Partially ready` the moment ≥ PARTIAL_READY_MIN qualify (when the
 * partial report / freemium teaser becomes available). Promoted into the shared
 * contract (was FE-only) so the backend computes it once and the FE renders it from
 * the DTO/events instead of re-deriving.
 */
export const ReportStage = {
  Draft: 'Draft',
  Preparing: 'Preparing',
  Questionnaire: 'Questionnaire',
  Researching: 'Researching',
  PartiallyReady: 'Partially ready',
  /** Target met, but depth research / synthesis is still wrapping up — NOT Ready yet. */
  Finalizing: 'Finalizing',
  Ready: 'Ready',
} as const;
export type ReportStage = (typeof ReportStage)[keyof typeof ReportStage];

/** Ordered stages (index = dashboard pipeline segment). */
export const STAGE_ORDER: ReportStage[] = [
  ReportStage.Draft, ReportStage.Preparing, ReportStage.Questionnaire,
  ReportStage.Researching, ReportStage.PartiallyReady, ReportStage.Finalizing, ReportStage.Ready,
];
export function stageIndex(stage: ReportStage): number {
  return STAGE_ORDER.indexOf(stage);
}

/**
 * Readiness thresholds (config). `Partially ready` once this many inquiries qualify
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
 * readyMin) overrides the in-flight `Researching` stage, but `Ready` is reserved
 * for a **delivered** report: with the target met and delivery still pending
 * (depth research + the synthesis gate), the stage is `Finalizing` — never
 * promise Ready while dossiers may still be filling in. Terminal-bad states keep
 * their underlying stage — the FE overlays a failed/declined badge separately.
 */
export function deriveStage({ state, qualifiedCount, thresholds = DEFAULT_STAGE_THRESHOLDS }: {
  state: string;
  qualifiedCount: number;
  thresholds?: StageThresholds;
}): ReportStage {
  if (state === ReportState.REPORT_DELIVERED) return ReportStage.Ready;
  if (qualifiedCount >= thresholds.readyMin) return ReportStage.Finalizing;
  if (qualifiedCount >= thresholds.partialReadyMin) return ReportStage.PartiallyReady;
  switch (state) {
    case ReportState.RECEIVED:
      return ReportStage.Draft; // submitted, nothing processed yet
    case ReportState.PRE_RESEARCH:
    case ReportState.ENRICHMENT:
      return ReportStage.Preparing;
    case ReportState.QUESTIONNAIRE_SENT:
      return ReportStage.Questionnaire;
    case ReportState.BROAD_RESEARCH:
    case ReportState.FUNNEL:
    case ReportState.OUTREACH:
    case ReportState.REPORT_GENERATION:
      return ReportStage.Researching;
    default:
      return ReportStage.Preparing; // terminal-bad / ON_HOLD — the badge carries the real status
  }
}
