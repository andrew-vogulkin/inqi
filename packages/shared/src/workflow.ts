/** Canonical inquiry states. The DB workflow definition mirrors these. */
export const InquiryState = {
  RECEIVED: 'RECEIVED',
  PRE_RESEARCH: 'PRE_RESEARCH',
  DENIED: 'DENIED',
  QUESTIONNAIRE_SENT: 'QUESTIONNAIRE_SENT',
  DROPPED: 'DROPPED',
  ENRICHMENT: 'ENRICHMENT',
  BROAD_RESEARCH: 'BROAD_RESEARCH',
  FUNNEL: 'FUNNEL',
  OUTREACH: 'OUTREACH',
  REPORT_GENERATION: 'REPORT_GENERATION',
  REPORT_DELIVERED: 'REPORT_DELIVERED',
  // v2 (HP-09): resilience / operator states.
  FAILED: 'FAILED',         // a stage failed terminally (after retries/reaper)
  CANCELLED: 'CANCELLED',   // operator/customer cancelled in-flight
  ON_HOLD: 'ON_HOLD',       // paused by operator (resumed by HP-11)
} as const;
export type InquiryState = (typeof InquiryState)[keyof typeof InquiryState];

/** Processing states an agent stage actively works in (eligible for failure/stall recovery). */
export const PROCESSING_STATES: InquiryState[] = [
  InquiryState.PRE_RESEARCH, InquiryState.ENRICHMENT, InquiryState.BROAD_RESEARCH,
  InquiryState.FUNNEL, InquiryState.OUTREACH, InquiryState.REPORT_GENERATION,
];

/** Events that drive transitions (from humans/API or from agent jobs). */
export const WorkflowEvent = {
  START_PRE_RESEARCH: 'START_PRE_RESEARCH',
  PRE_RESEARCH_DENIED: 'PRE_RESEARCH_DENIED',
  PRE_RESEARCH_PASSED: 'PRE_RESEARCH_PASSED',     // -> QUESTIONNAIRE_SENT
  QUESTIONNAIRE_FILLED: 'QUESTIONNAIRE_FILLED',
  QUESTIONNAIRE_EXPIRED: 'QUESTIONNAIRE_EXPIRED',
  ENRICHMENT_DONE: 'ENRICHMENT_DONE',
  BROAD_RESEARCH_DONE: 'BROAD_RESEARCH_DONE',
  REUSE_FOUND: 'REUSE_FOUND',                      // v2: prior-report reuse short-circuit -> REPORT_DELIVERED
  FUNNEL_BUILT: 'FUNNEL_BUILT',
  OUTREACH_DONE: 'OUTREACH_DONE',
  REPORT_READY: 'REPORT_READY',
  // v2 (HP-09): per-stage failure / stall, plus operator controls.
  PRE_RESEARCH_FAILED: 'PRE_RESEARCH_FAILED',
  ENRICHMENT_FAILED: 'ENRICHMENT_FAILED',
  BROAD_RESEARCH_FAILED: 'BROAD_RESEARCH_FAILED',
  FUNNEL_FAILED: 'FUNNEL_FAILED',
  OUTREACH_STALLED: 'OUTREACH_STALLED',
  REPORT_FAILED: 'REPORT_FAILED',
  CANCEL: 'CANCEL',
  HOLD: 'HOLD',
  RESUME: 'RESUME',
} as const;
export type WorkflowEvent = (typeof WorkflowEvent)[keyof typeof WorkflowEvent];

/** The failure/stall event valid from each processing state (state-based, robust to stage renames). */
export const FAILURE_EVENT_BY_STATE: Partial<Record<InquiryState, WorkflowEvent>> = {
  [InquiryState.PRE_RESEARCH]: WorkflowEvent.PRE_RESEARCH_FAILED,
  [InquiryState.ENRICHMENT]: WorkflowEvent.ENRICHMENT_FAILED,
  [InquiryState.BROAD_RESEARCH]: WorkflowEvent.BROAD_RESEARCH_FAILED,
  [InquiryState.FUNNEL]: WorkflowEvent.FUNNEL_FAILED,
  [InquiryState.OUTREACH]: WorkflowEvent.OUTREACH_STALLED,
  [InquiryState.REPORT_GENERATION]: WorkflowEvent.REPORT_FAILED,
};

/** Pure: the failure event to fire for a stuck inquiry in `state`, or null if none applies. */
export function failureEventForState(state: string): WorkflowEvent | null {
  return FAILURE_EVENT_BY_STATE[state as InquiryState] ?? null;
}

export const OutreachStrategy = {
  ONE_BY_ONE: 'one_by_one',
  ESCALATING: 'escalating', // 1:3:9
  PARALLEL: 'parallel',
} as const;
export type OutreachStrategy = (typeof OutreachStrategy)[keyof typeof OutreachStrategy];

export const TERMINAL_STATES: InquiryState[] = [
  InquiryState.DENIED, InquiryState.DROPPED, InquiryState.REPORT_DELIVERED,
  InquiryState.FAILED, InquiryState.CANCELLED,
];
