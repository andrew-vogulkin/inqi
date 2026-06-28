/** Canonical inquiry states. The DB workflow definition mirrors these (v1). */
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
} as const;
export type InquiryState = (typeof InquiryState)[keyof typeof InquiryState];

/** Events that drive transitions (from humans/API or from agent jobs). */
export const WorkflowEvent = {
  START_PRE_RESEARCH: 'START_PRE_RESEARCH',
  PRE_RESEARCH_DENIED: 'PRE_RESEARCH_DENIED',
  PRE_RESEARCH_PASSED: 'PRE_RESEARCH_PASSED',     // -> QUESTIONNAIRE_SENT
  QUESTIONNAIRE_FILLED: 'QUESTIONNAIRE_FILLED',
  QUESTIONNAIRE_EXPIRED: 'QUESTIONNAIRE_EXPIRED',
  ENRICHMENT_DONE: 'ENRICHMENT_DONE',
  BROAD_RESEARCH_DONE: 'BROAD_RESEARCH_DONE',
  FUNNEL_BUILT: 'FUNNEL_BUILT',
  OUTREACH_DONE: 'OUTREACH_DONE',
  REPORT_READY: 'REPORT_READY',
} as const;
export type WorkflowEvent = (typeof WorkflowEvent)[keyof typeof WorkflowEvent];

export const OutreachStrategy = {
  ONE_BY_ONE: 'one_by_one',
  ESCALATING: 'escalating', // 1:3:9
  PARALLEL: 'parallel',
} as const;
export type OutreachStrategy = (typeof OutreachStrategy)[keyof typeof OutreachStrategy];

export const TERMINAL_STATES: InquiryState[] = [
  InquiryState.DENIED, InquiryState.DROPPED, InquiryState.REPORT_DELIVERED,
];
