import { PrismaClient } from '@prisma/client';
const db = new PrismaClient();

// inqi workflow v1 — mirrors DESIGN.md §1. Stored in DB so it can be versioned.
// action `enqueue:<stage>` is resolved by the workflow registry to a pg-boss job.
const STATES = [
  { name: 'RECEIVED', isInitial: true },
  { name: 'PRE_RESEARCH' },
  { name: 'DENIED', isTerminal: true },
  { name: 'QUESTIONNAIRE_SENT' },
  { name: 'DROPPED', isTerminal: true },
  { name: 'ENRICHMENT' },
  { name: 'BROAD_RESEARCH' },
  { name: 'FUNNEL' },
  { name: 'OUTREACH' },
  { name: 'REPORT_GENERATION' },
  { name: 'REPORT_DELIVERED', isTerminal: true },
];

const TRANSITIONS = [
  { from: 'RECEIVED',          event: 'START_PRE_RESEARCH',    to: 'PRE_RESEARCH',      action: 'enqueue:pre_research' },
  { from: 'PRE_RESEARCH',      event: 'PRE_RESEARCH_DENIED',   to: 'DENIED' },
  { from: 'PRE_RESEARCH',      event: 'PRE_RESEARCH_PASSED',   to: 'QUESTIONNAIRE_SENT', action: 'send:questionnaire' },
  { from: 'QUESTIONNAIRE_SENT',event: 'QUESTIONNAIRE_EXPIRED', to: 'DROPPED' },
  { from: 'QUESTIONNAIRE_SENT',event: 'QUESTIONNAIRE_FILLED',  to: 'ENRICHMENT',         action: 'enqueue:enrich_subject' },
  { from: 'ENRICHMENT',        event: 'ENRICHMENT_DONE',       to: 'BROAD_RESEARCH',     action: 'enqueue:broad_research' },
  { from: 'BROAD_RESEARCH',    event: 'BROAD_RESEARCH_DONE',   to: 'FUNNEL',             action: 'enqueue:build_funnel' },
  { from: 'FUNNEL',            event: 'FUNNEL_BUILT',          to: 'OUTREACH',           action: 'enqueue:start_outreach' },
  { from: 'OUTREACH',          event: 'OUTREACH_DONE',         to: 'REPORT_GENERATION',  action: 'enqueue:generate_report' },
  { from: 'REPORT_GENERATION', event: 'REPORT_READY',         to: 'REPORT_DELIVERED' },
];

async function main() {
  const existing = await db.workflowDefinition.findUnique({ where: { key_version: { key: 'inquiry', version: 1 } } });
  if (existing) { console.log('workflow v1 already present'); return; }

  const def = await db.workflowDefinition.create({
    data: {
      key: 'inquiry', version: 1, status: 'active',
      states: { create: STATES.map(s => ({ name: s.name, isInitial: !!s.isInitial, isTerminal: !!s.isTerminal })) },
      transitions: { create: TRANSITIONS.map(t => ({ fromState: t.from, toState: t.to, event: t.event, action: t.action ?? null })) },
    },
  });
  console.log(`Installed inquiry workflow v1 (${def.id}) — ${STATES.length} states, ${TRANSITIONS.length} transitions`);
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => db.$disconnect());
