import {
  BreadthEvent, BreadthState, DepthEvent, DepthState, PhaseControlEvent, PhaseKey,
  PreResearchEvent, PreResearchState,
} from '@inqi/shared';

/**
 * The three phase workflow graphs (v1), as data. Single source of truth: the
 * seed installs these rows and the specs validate them, so the DB shape and the
 * step handlers can never drift apart silently. Same State/Transition shapes
 * the report seed uses.
 */
export type PhaseGraphState = { name: string; isInitial?: boolean; isTerminal?: boolean };
export type PhaseGraphTransition = { from: string; event: string; to: string; guard?: string; action?: string };
export interface PhaseGraph { key: PhaseKey; states: PhaseGraphState[]; transitions: PhaseGraphTransition[] }

/**
 * Named actions referenced by phase transitions — implemented in
 * `phase-registry.ts` (PhaseActions). Keep the two in sync: the graph spec
 * asserts every action string here has an implementation.
 */
export const PhaseAction = {
  /** Continue the machine: enqueue the next PhaseStep for the run. */
  EnqueueStep: 'phase:enqueue-step',
  // Parent-report bridging (pre_research terminals).
  ReportPreResearchPassed: 'report:PRE_RESEARCH_PASSED',
  ReportPreResearchDenied: 'report:PRE_RESEARCH_DENIED',
  ReportPreResearchFailed: 'report:PRE_RESEARCH_FAILED',
  /** Breadth run reached a result terminal → enqueue funnel assembly from run.data. */
  BreadthComplete: 'phase:breadth-complete',
  /** Breadth run failed → funnel purpose fails the report; widen purpose degrades to assembly with what exists. */
  BreadthFailed: 'phase:breadth-failed',
  /** Depth run died → clear researchPending + let the reactor settle around it. */
  InquiryResearchFailed: 'inquiry:research-failed',
} as const;
export type PhaseAction = (typeof PhaseAction)[keyof typeof PhaseAction];

/** Named guards referenced by phase transitions — pure predicates over run.data. */
export const PhaseGuard = {
  BreadthUnderCycleCap: 'breadth:under-cycle-cap',
  DepthUnderCycleCap: 'depth:under-cycle-cap',
} as const;
export type PhaseGuard = (typeof PhaseGuard)[keyof typeof PhaseGuard];

/** Every non-terminal state gets STEP_FAILED → FAILED and CANCEL → CANCELLED rows. */
function controlRows({ working, failedTo, cancelledTo, failAction, cancelAction }: {
  working: string[]; failedTo: string; cancelledTo: string; failAction?: string; cancelAction?: string;
}): PhaseGraphTransition[] {
  return [
    ...working.map((from) => ({ from, event: PhaseControlEvent.STEP_FAILED, to: failedTo, action: failAction })),
    ...working.map((from) => ({ from, event: PhaseControlEvent.CANCEL, to: cancelledTo, action: cancelAction })),
  ];
}

// ---- pre_research v1 -------------------------------------------------------

const PRE_RESEARCH_WORKING = [
  PreResearchState.COMPLIANCE_GATE, PreResearchState.FEASIBILITY, PreResearchState.SUBJECT,
  PreResearchState.QUESTIONNAIRE_GEN, PreResearchState.QUESTIONNAIRE_GATE,
];

export const PRE_RESEARCH_GRAPH: PhaseGraph = {
  key: PhaseKey.PreResearch,
  states: [
    { name: PreResearchState.COMPLIANCE_GATE, isInitial: true },
    { name: PreResearchState.FEASIBILITY },
    { name: PreResearchState.SUBJECT },
    { name: PreResearchState.QUESTIONNAIRE_GEN },
    { name: PreResearchState.QUESTIONNAIRE_GATE },
    { name: PreResearchState.PASSED, isTerminal: true },
    { name: PreResearchState.DENIED, isTerminal: true },
    { name: PreResearchState.FAILED, isTerminal: true },
    { name: PreResearchState.CANCELLED, isTerminal: true },
  ],
  transitions: [
    { from: PreResearchState.COMPLIANCE_GATE, event: PreResearchEvent.GATE_PASSED, to: PreResearchState.FEASIBILITY, action: PhaseAction.EnqueueStep },
    { from: PreResearchState.COMPLIANCE_GATE, event: PreResearchEvent.GATE_BLOCKED, to: PreResearchState.DENIED, action: PhaseAction.ReportPreResearchDenied },
    { from: PreResearchState.FEASIBILITY, event: PreResearchEvent.FEASIBILITY_OK, to: PreResearchState.SUBJECT, action: PhaseAction.EnqueueStep },
    { from: PreResearchState.FEASIBILITY, event: PreResearchEvent.FEASIBILITY_DENY, to: PreResearchState.DENIED, action: PhaseAction.ReportPreResearchDenied },
    { from: PreResearchState.SUBJECT, event: PreResearchEvent.SUBJECT_CREATED, to: PreResearchState.QUESTIONNAIRE_GEN, action: PhaseAction.EnqueueStep },
    { from: PreResearchState.QUESTIONNAIRE_GEN, event: PreResearchEvent.QUESTIONS_READY, to: PreResearchState.QUESTIONNAIRE_GATE, action: PhaseAction.EnqueueStep },
    { from: PreResearchState.QUESTIONNAIRE_GATE, event: PreResearchEvent.QUESTIONNAIRE_OK, to: PreResearchState.PASSED, action: PhaseAction.ReportPreResearchPassed },
    { from: PreResearchState.QUESTIONNAIRE_GATE, event: PreResearchEvent.QUESTIONNAIRE_BLOCKED, to: PreResearchState.DENIED, action: PhaseAction.ReportPreResearchDenied },
    ...controlRows({
      working: PRE_RESEARCH_WORKING, failedTo: PreResearchState.FAILED, cancelledTo: PreResearchState.CANCELLED,
      failAction: PhaseAction.ReportPreResearchFailed,
    }),
  ],
};

// ---- breadth_search --------------------------------------------------------

const BREADTH_WORKING = [
  BreadthState.FORM_QUERIES, BreadthState.SEARCH, BreadthState.MINE,
  BreadthState.QUALIFY, BreadthState.CHECKPOINT, BreadthState.RELAX,
  BreadthState.MARKETING,
];

export const BREADTH_SEARCH_GRAPH: PhaseGraph = {
  key: PhaseKey.BreadthSearch,
  states: [
    { name: BreadthState.FORM_QUERIES, isInitial: true },
    { name: BreadthState.SEARCH },
    { name: BreadthState.MINE },
    { name: BreadthState.QUALIFY },
    { name: BreadthState.CHECKPOINT },
    { name: BreadthState.RELAX },
    { name: BreadthState.MARKETING },
    { name: BreadthState.TARGET_MET, isTerminal: true },
    { name: BreadthState.WENT_DRY, isTerminal: true },
    { name: BreadthState.CAP_REACHED, isTerminal: true },
    { name: BreadthState.FAILED, isTerminal: true },
    { name: BreadthState.CANCELLED, isTerminal: true },
  ],
  transitions: [
    { from: BreadthState.FORM_QUERIES, event: BreadthEvent.QUERIES_FORMED, to: BreadthState.SEARCH, action: PhaseAction.EnqueueStep },
    // No AI configured: FORM_QUERIES degrades straight to a dry terminal carrying fallback candidates.
    { from: BreadthState.FORM_QUERIES, event: BreadthEvent.WENT_DRY, to: BreadthState.WENT_DRY, action: PhaseAction.BreadthComplete },
    { from: BreadthState.SEARCH, event: BreadthEvent.POOL_READY, to: BreadthState.MINE, action: PhaseAction.EnqueueStep },
    { from: BreadthState.MINE, event: BreadthEvent.CANDIDATES_MINED, to: BreadthState.QUALIFY, action: PhaseAction.EnqueueStep },
    { from: BreadthState.QUALIFY, event: BreadthEvent.CANDIDATES_QUALIFIED, to: BreadthState.CHECKPOINT, action: PhaseAction.EnqueueStep },
    { from: BreadthState.CHECKPOINT, event: BreadthEvent.TARGET_MET, to: BreadthState.TARGET_MET, action: PhaseAction.BreadthComplete },
    // Dry is NOT terminal yet: every dry verdict funnels through MARKETING, which
    // either spends its one category-language pass or exhausts to the real terminal.
    { from: BreadthState.CHECKPOINT, event: BreadthEvent.WENT_DRY, to: BreadthState.MARKETING, action: PhaseAction.EnqueueStep },
    { from: BreadthState.CHECKPOINT, event: BreadthEvent.CAP_REACHED, to: BreadthState.CAP_REACHED, action: PhaseAction.BreadthComplete },
    { from: BreadthState.CHECKPOINT, event: BreadthEvent.CONTINUE, to: BreadthState.RELAX, guard: PhaseGuard.BreadthUnderCycleCap, action: PhaseAction.EnqueueStep },
    // RELAX loops to SEARCH (not FORM_QUERIES): the relax step itself produces the new queries.
    { from: BreadthState.RELAX, event: BreadthEvent.RELAXED, to: BreadthState.SEARCH, action: PhaseAction.EnqueueStep },
    // Relaxation exhausted → the same MARKETING pass: re-describe the subject in the
    // short commercial category language businesses use for SEO ("tea cups supplier")
    // and search once more before conceding dry. Its second visit exhausts to WENT_DRY.
    { from: BreadthState.RELAX, event: BreadthEvent.RELAX_EXHAUSTED, to: BreadthState.MARKETING, action: PhaseAction.EnqueueStep },
    { from: BreadthState.MARKETING, event: BreadthEvent.MARKETING_QUERIES, to: BreadthState.SEARCH, action: PhaseAction.EnqueueStep },
    { from: BreadthState.MARKETING, event: BreadthEvent.MARKETING_EXHAUSTED, to: BreadthState.WENT_DRY, action: PhaseAction.BreadthComplete },
    ...controlRows({
      working: BREADTH_WORKING, failedTo: BreadthState.FAILED, cancelledTo: BreadthState.CANCELLED,
      failAction: PhaseAction.BreadthFailed,
    }),
  ],
};

// ---- depth_search v1 -------------------------------------------------------

const DEPTH_WORKING = [
  DepthState.FORM_QUERIES, DepthState.SEARCH_LEADS, DepthState.INVESTIGATE,
  DepthState.GATE, DepthState.PERSIST,
];

export const DEPTH_SEARCH_GRAPH: PhaseGraph = {
  key: PhaseKey.DepthSearch,
  states: [
    { name: DepthState.FORM_QUERIES, isInitial: true },
    { name: DepthState.SEARCH_LEADS },
    { name: DepthState.INVESTIGATE },
    { name: DepthState.GATE },
    { name: DepthState.PERSIST },
    { name: DepthState.SUFFICIENT, isTerminal: true },
    { name: DepthState.STALLED, isTerminal: true },
    { name: DepthState.CAP_REACHED, isTerminal: true },
    { name: DepthState.FAILED, isTerminal: true },
    { name: DepthState.CANCELLED, isTerminal: true },
  ],
  transitions: [
    { from: DepthState.FORM_QUERIES, event: DepthEvent.QUERIES_FORMED, to: DepthState.SEARCH_LEADS, action: PhaseAction.EnqueueStep },
    { from: DepthState.SEARCH_LEADS, event: DepthEvent.LEADS_READY, to: DepthState.INVESTIGATE, action: PhaseAction.EnqueueStep },
    { from: DepthState.INVESTIGATE, event: DepthEvent.VERDICT_READY, to: DepthState.GATE, action: PhaseAction.EnqueueStep },
    // Cap hit (or unrecoverable cycle failure): skip the gate, persist the best verdict so far.
    { from: DepthState.INVESTIGATE, event: DepthEvent.CYCLE_CAP, to: DepthState.PERSIST, action: PhaseAction.EnqueueStep },
    { from: DepthState.GATE, event: DepthEvent.EVIDENCE_SUFFICIENT, to: DepthState.PERSIST, action: PhaseAction.EnqueueStep },
    { from: DepthState.GATE, event: DepthEvent.STALLED, to: DepthState.PERSIST, action: PhaseAction.EnqueueStep },
    // Refine loops to INVESTIGATE (not FORM_QUERIES): refine cycles reuse the lead pool with the named gaps.
    { from: DepthState.GATE, event: DepthEvent.GAPS_NAMED, to: DepthState.INVESTIGATE, guard: PhaseGuard.DepthUnderCycleCap, action: PhaseAction.EnqueueStep },
    { from: DepthState.PERSIST, event: DepthEvent.PERSISTED_SUFFICIENT, to: DepthState.SUFFICIENT },
    { from: DepthState.PERSIST, event: DepthEvent.PERSISTED_STALLED, to: DepthState.STALLED },
    { from: DepthState.PERSIST, event: DepthEvent.PERSISTED_CAP, to: DepthState.CAP_REACHED },
    ...controlRows({
      working: DEPTH_WORKING, failedTo: DepthState.FAILED, cancelledTo: DepthState.CANCELLED,
      // Both fail AND cancel clear researchPending — a dead run must never stall report synthesis.
      failAction: PhaseAction.InquiryResearchFailed, cancelAction: PhaseAction.InquiryResearchFailed,
    }),
  ],
};

export const PHASE_GRAPHS: PhaseGraph[] = [PRE_RESEARCH_GRAPH, BREADTH_SEARCH_GRAPH, DEPTH_SEARCH_GRAPH];
