/** Canonical report states. The DB workflow definition mirrors these. */
export const ReportState = {
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
export type ReportState = (typeof ReportState)[keyof typeof ReportState];

/** Processing states an agent stage actively works in (eligible for failure/stall recovery). */
export const PROCESSING_STATES: ReportState[] = [
  ReportState.PRE_RESEARCH, ReportState.ENRICHMENT, ReportState.BROAD_RESEARCH,
  ReportState.FUNNEL, ReportState.OUTREACH, ReportState.REPORT_GENERATION,
];

/** Events that drive transitions (from humans/API or from agent jobs). */
export const WorkflowEvent = {
  START_PRE_RESEARCH: 'START_PRE_RESEARCH',
  PRE_RESEARCH_DENIED: 'PRE_RESEARCH_DENIED',
  PRE_RESEARCH_PASSED: 'PRE_RESEARCH_PASSED',     // -> QUESTIONNAIRE_SENT
  QUESTIONNAIRE_FILLED: 'QUESTIONNAIRE_FILLED',
  QUESTIONNAIRE_EXPIRED: 'QUESTIONNAIRE_EXPIRED',
  QUESTIONNAIRE_DENIED: 'QUESTIONNAIRE_DENIED',   // free-text answers failed the compliance gate -> DENIED
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
export const FAILURE_EVENT_BY_STATE: Partial<Record<ReportState, WorkflowEvent>> = {
  [ReportState.PRE_RESEARCH]: WorkflowEvent.PRE_RESEARCH_FAILED,
  [ReportState.ENRICHMENT]: WorkflowEvent.ENRICHMENT_FAILED,
  [ReportState.BROAD_RESEARCH]: WorkflowEvent.BROAD_RESEARCH_FAILED,
  [ReportState.FUNNEL]: WorkflowEvent.FUNNEL_FAILED,
  [ReportState.OUTREACH]: WorkflowEvent.OUTREACH_STALLED,
  [ReportState.REPORT_GENERATION]: WorkflowEvent.REPORT_FAILED,
};

/** Pure: the failure event to fire for a stuck report in `state`, or null if none applies. */
export function failureEventForState(state: string): WorkflowEvent | null {
  return FAILURE_EVENT_BY_STATE[state as ReportState] ?? null;
}

export const OutreachStrategy = {
  ONE_BY_ONE: 'one_by_one',
  ESCALATING: 'escalating', // 1:3:9
  PARALLEL: 'parallel',
} as const;
export type OutreachStrategy = (typeof OutreachStrategy)[keyof typeof OutreachStrategy];

export const TERMINAL_STATES: ReportState[] = [
  ReportState.DENIED, ReportState.DROPPED, ReportState.REPORT_DELIVERED,
  ReportState.FAILED, ReportState.CANCELLED,
];
