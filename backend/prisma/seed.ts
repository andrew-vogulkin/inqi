import { PrismaClient } from '@prisma/client';
import { InquiryState, WorkflowEvent, WorkflowStatus } from '@inqi/shared';
import { WorkflowAction } from '../src/domain/orchestrator/workflow-registry';

const db = new PrismaClient();

// inqi workflow — stored in DB so it can be versioned. A shipped version is
// immutable; new behaviour folds into the current working version (v2) while v1
// stays byte-identical for any inquiry still pinned to it.
type State = { name: string; isInitial?: boolean; isTerminal?: boolean };

const STATES_V1: State[] = [
  { name: InquiryState.RECEIVED, isInitial: true },
  { name: InquiryState.PRE_RESEARCH },
  { name: InquiryState.DENIED, isTerminal: true },
  { name: InquiryState.QUESTIONNAIRE_SENT },
  { name: InquiryState.DROPPED, isTerminal: true },
  { name: InquiryState.ENRICHMENT },
  { name: InquiryState.BROAD_RESEARCH },
  { name: InquiryState.FUNNEL },
  { name: InquiryState.OUTREACH },
  { name: InquiryState.REPORT_GENERATION },
  { name: InquiryState.REPORT_DELIVERED, isTerminal: true },
];

// v2 adds the HP-09 resilience/operator states.
const STATES_V2: State[] = [
  ...STATES_V1,
  { name: InquiryState.FAILED, isTerminal: true },
  { name: InquiryState.CANCELLED, isTerminal: true },
  { name: InquiryState.ON_HOLD },
];

const TRANSITIONS_V1 = [
  { from: InquiryState.RECEIVED,           event: WorkflowEvent.START_PRE_RESEARCH,    to: InquiryState.PRE_RESEARCH,      action: WorkflowAction.EnqueuePreResearch },
  { from: InquiryState.PRE_RESEARCH,       event: WorkflowEvent.PRE_RESEARCH_DENIED,   to: InquiryState.DENIED },
  { from: InquiryState.PRE_RESEARCH,       event: WorkflowEvent.PRE_RESEARCH_PASSED,   to: InquiryState.QUESTIONNAIRE_SENT, action: WorkflowAction.SendQuestionnaire },
  { from: InquiryState.QUESTIONNAIRE_SENT, event: WorkflowEvent.QUESTIONNAIRE_EXPIRED, to: InquiryState.DROPPED },
  { from: InquiryState.QUESTIONNAIRE_SENT, event: WorkflowEvent.QUESTIONNAIRE_FILLED,  to: InquiryState.ENRICHMENT,         action: WorkflowAction.EnqueueEnrichSubject },
  { from: InquiryState.ENRICHMENT,         event: WorkflowEvent.ENRICHMENT_DONE,       to: InquiryState.BROAD_RESEARCH,     action: WorkflowAction.EnqueueBroadResearch },
  { from: InquiryState.BROAD_RESEARCH,     event: WorkflowEvent.BROAD_RESEARCH_DONE,   to: InquiryState.FUNNEL,             action: WorkflowAction.EnqueueBuildFunnel },
  { from: InquiryState.FUNNEL,             event: WorkflowEvent.FUNNEL_BUILT,          to: InquiryState.OUTREACH,           action: WorkflowAction.EnqueueStartOutreach },
  { from: InquiryState.OUTREACH,           event: WorkflowEvent.OUTREACH_DONE,         to: InquiryState.REPORT_GENERATION,  action: WorkflowAction.EnqueueGenerateReport },
  { from: InquiryState.REPORT_GENERATION,  event: WorkflowEvent.REPORT_READY,          to: InquiryState.REPORT_DELIVERED },
];

// Per-stage failure/stall → FAILED (HP-09), from each processing state.
const FAILURE_TRANSITIONS = [
  { from: InquiryState.PRE_RESEARCH,      event: WorkflowEvent.PRE_RESEARCH_FAILED,   to: InquiryState.FAILED },
  { from: InquiryState.ENRICHMENT,        event: WorkflowEvent.ENRICHMENT_FAILED,     to: InquiryState.FAILED },
  { from: InquiryState.BROAD_RESEARCH,    event: WorkflowEvent.BROAD_RESEARCH_FAILED, to: InquiryState.FAILED },
  { from: InquiryState.FUNNEL,            event: WorkflowEvent.FUNNEL_FAILED,         to: InquiryState.FAILED },
  { from: InquiryState.OUTREACH,          event: WorkflowEvent.OUTREACH_STALLED,      to: InquiryState.FAILED },
  { from: InquiryState.REPORT_GENERATION, event: WorkflowEvent.REPORT_FAILED,         to: InquiryState.FAILED },
];

// Operator/cancel transitions (HP-09; HP-11 expands resume semantics).
const CANCELLABLE_FROM = [
  InquiryState.RECEIVED, InquiryState.PRE_RESEARCH, InquiryState.QUESTIONNAIRE_SENT, InquiryState.ENRICHMENT,
  InquiryState.BROAD_RESEARCH, InquiryState.FUNNEL, InquiryState.OUTREACH, InquiryState.REPORT_GENERATION, InquiryState.ON_HOLD,
];
const CONTROL_TRANSITIONS = [
  ...CANCELLABLE_FROM.map((from) => ({ from, event: WorkflowEvent.CANCEL, to: InquiryState.CANCELLED })),
  { from: InquiryState.OUTREACH, event: WorkflowEvent.HOLD,   to: InquiryState.ON_HOLD },
  { from: InquiryState.ON_HOLD,  event: WorkflowEvent.RESUME, to: InquiryState.OUTREACH },
];

// v2 = v1 + prior-report reuse (HP-06) + full state machine (HP-09). v1 is untouched.
const TRANSITIONS_V2 = [
  ...TRANSITIONS_V1,
  { from: InquiryState.BROAD_RESEARCH, event: WorkflowEvent.REUSE_FOUND, to: InquiryState.REPORT_DELIVERED },
  ...FAILURE_TRANSITIONS,
  ...CONTROL_TRANSITIONS,
];

type Transition = { from: string; event: string; to: string; action?: string };

async function installVersion({ version, status, states, transitions }: { version: number; status: string; states: State[]; transitions: Transition[] }) {
  const existing = await db.workflowDefinition.findUnique({ where: { key_version: { key: 'inquiry', version } } });
  if (existing) {
    console.log(`workflow v${version} already present`);
    return;
  }
  const def = await db.workflowDefinition.create({
    data: {
      key: 'inquiry', version, status,
      states: { create: states.map((s) => ({ name: s.name, isInitial: !!s.isInitial, isTerminal: !!s.isTerminal })) },
      transitions: { create: transitions.map((t) => ({ fromState: t.from, toState: t.to, event: t.event, action: t.action ?? null })) },
    },
  });
  console.log(`Installed inquiry workflow v${version} (${def.id}, ${status}) — ${states.length} states, ${transitions.length} transitions`);
}

async function main() {
  await installVersion({ version: 1, status: WorkflowStatus.Archived, states: STATES_V1, transitions: TRANSITIONS_V1 });
  await installVersion({ version: 2, status: WorkflowStatus.Active, states: STATES_V2, transitions: TRANSITIONS_V2 });
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => db.$disconnect());
