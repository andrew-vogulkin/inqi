import { WorkflowEvent } from './workflow.js';

/**
 * Research-phase workflow types (DB-stored, versioned — same infrastructure as
 * the 'report' workflow). Each phase execution is one PhaseRun row pinned to a
 * WorkflowDefinition version and advanced step-by-step by the PhaseEngine:
 * pre_research + breadth_search run once per report; depth_search once per
 * inquiry. Values mirror the seeded WorkflowState/WorkflowTransition rows —
 * the seed and the engine both reference these, never a literal.
 */
export const PhaseKey = {
  PreResearch: 'pre_research',
  BreadthSearch: 'breadth_search',
  DepthSearch: 'depth_search',
} as const;
export type PhaseKey = (typeof PhaseKey)[keyof typeof PhaseKey];

/** Control events every phase graph carries from every working state. */
export const PhaseControlEvent = {
  STEP_FAILED: 'STEP_FAILED',
  CANCEL: 'CANCEL',
} as const;
export type PhaseControlEvent = (typeof PhaseControlEvent)[keyof typeof PhaseControlEvent];

// ---- pre_research ----------------------------------------------------------

/** pre_research run states — one per step of the intake gate sequence. */
export const PreResearchState = {
  COMPLIANCE_GATE: 'COMPLIANCE_GATE',
  FEASIBILITY: 'FEASIBILITY',
  SUBJECT: 'SUBJECT',
  QUESTIONNAIRE_GEN: 'QUESTIONNAIRE_GEN',
  QUESTIONNAIRE_GATE: 'QUESTIONNAIRE_GATE',
  PASSED: 'PASSED',
  DENIED: 'DENIED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
} as const;
export type PreResearchState = (typeof PreResearchState)[keyof typeof PreResearchState];

export const PreResearchEvent = {
  GATE_PASSED: 'GATE_PASSED',
  GATE_BLOCKED: 'GATE_BLOCKED',
  FEASIBILITY_OK: 'FEASIBILITY_OK',
  FEASIBILITY_DENY: 'FEASIBILITY_DENY',
  SUBJECT_CREATED: 'SUBJECT_CREATED',
  QUESTIONS_READY: 'QUESTIONS_READY',
  QUESTIONNAIRE_OK: 'QUESTIONNAIRE_OK',
  QUESTIONNAIRE_BLOCKED: 'QUESTIONNAIRE_BLOCKED',
} as const;
export type PreResearchEvent = (typeof PreResearchEvent)[keyof typeof PreResearchEvent];

// ---- breadth_search --------------------------------------------------------

/** breadth_search run states — the adaptive discovery loop, one state per step. */
export const BreadthState = {
  FORM_QUERIES: 'FORM_QUERIES',
  SEARCH: 'SEARCH',
  MINE: 'MINE',
  QUALIFY: 'QUALIFY',
  CHECKPOINT: 'CHECKPOINT',
  RELAX: 'RELAX',
  MARKETING: 'MARKETING',
  TARGET_MET: 'TARGET_MET',
  WENT_DRY: 'WENT_DRY',
  CAP_REACHED: 'CAP_REACHED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
} as const;
export type BreadthState = (typeof BreadthState)[keyof typeof BreadthState];

export const BreadthEvent = {
  QUERIES_FORMED: 'QUERIES_FORMED',
  POOL_READY: 'POOL_READY',
  CANDIDATES_MINED: 'CANDIDATES_MINED',
  CANDIDATES_QUALIFIED: 'CANDIDATES_QUALIFIED',
  TARGET_MET: 'TARGET_MET',
  WENT_DRY: 'WENT_DRY',
  CAP_REACHED: 'CAP_REACHED',
  CONTINUE: 'CONTINUE',
  RELAXED: 'RELAXED',
  RELAX_EXHAUSTED: 'RELAX_EXHAUSTED',
  MARKETING_QUERIES: 'MARKETING_QUERIES',
  MARKETING_EXHAUSTED: 'MARKETING_EXHAUSTED',
} as const;
export type BreadthEvent = (typeof BreadthEvent)[keyof typeof BreadthEvent];

/** Why a breadth run started — drives funnel assembly + failure mapping. */
export const BreadthPurpose = {
  Funnel: 'funnel',
  Widen: 'widen',
} as const;
export type BreadthPurpose = (typeof BreadthPurpose)[keyof typeof BreadthPurpose];

// ---- depth_search ----------------------------------------------------------

/** depth_search run states — the per-inquiry verify→strengthen loop, one per step. */
export const DepthState = {
  FORM_QUERIES: 'FORM_QUERIES',
  SEARCH_LEADS: 'SEARCH_LEADS',
  INVESTIGATE: 'INVESTIGATE',
  GATE: 'GATE',
  PERSIST: 'PERSIST',
  SUFFICIENT: 'SUFFICIENT',
  STALLED: 'STALLED',
  CAP_REACHED: 'CAP_REACHED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
} as const;
export type DepthState = (typeof DepthState)[keyof typeof DepthState];

export const DepthEvent = {
  QUERIES_FORMED: 'QUERIES_FORMED',
  LEADS_READY: 'LEADS_READY',
  VERDICT_READY: 'VERDICT_READY',
  CYCLE_CAP: 'CYCLE_CAP',
  EVIDENCE_SUFFICIENT: 'EVIDENCE_SUFFICIENT',
  STALLED: 'STALLED',
  GAPS_NAMED: 'GAPS_NAMED',
  PERSISTED_SUFFICIENT: 'PERSISTED_SUFFICIENT',
  PERSISTED_STALLED: 'PERSISTED_STALLED',
  PERSISTED_CAP: 'PERSISTED_CAP',
} as const;
export type DepthEvent = (typeof DepthEvent)[keyof typeof DepthEvent];

/** How the depth verdict resolved — recorded in run.data.outcome, drives PERSIST's terminal event. */
export const DepthOutcome = {
  Sufficient: 'sufficient',
  Stalled: 'stalled',
  Cap: 'cap',
} as const;
export type DepthOutcome = (typeof DepthOutcome)[keyof typeof DepthOutcome];

// ---- parent bridging -------------------------------------------------------

/**
 * The parent-report event a FAILED phase run maps to. Depth failures settle the
 * inquiry instead of failing the report (null); a widen-purpose breadth failure
 * degrades to finishing outreach with what exists (null).
 */
export function parentFailureEventForPhase({ key, purpose }: { key: PhaseKey; purpose?: string }): WorkflowEvent | null {
  if (key === PhaseKey.PreResearch) return WorkflowEvent.PRE_RESEARCH_FAILED;
  if (key === PhaseKey.BreadthSearch) return purpose === BreadthPurpose.Funnel ? WorkflowEvent.FUNNEL_FAILED : null;
  return null;
}
