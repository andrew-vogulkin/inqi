import { randomBytes } from 'crypto';
import { PrismaClient, Prisma } from '@prisma/client';
import { AuthRole, FindingKind, InquiryState, SubtaskStatus, WorkflowEvent, WorkflowStatus } from '@inqi/shared';
import { WorkflowAction } from '../src/domain/orchestrator/workflow-registry';
import { rankOptions, RankableOption } from '../src/domain/reports/ranking';

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

// ---------------------------------------------------------------------------
// Dev fixtures (HP-19/20/21/22): customers for the operator directory + a freemium
// (free-first, locked) report so FE-07 unlock and FE-08 provenance are exercisable.
// ---------------------------------------------------------------------------

async function upsertCustomer({ email, name, role, credits, freeReportUsed }: { email: string; name: string; role: string; credits: number; freeReportUsed: boolean }) {
  return db.customer.upsert({
    where: { email },
    update: { name, role, credits, freeReportUsed },
    create: { email, name, role, credits, freeReportUsed },
  });
}

/** A directory of customers so HP-22 `GET /admin/customers?q=` returns real matches. */
async function seedCustomers() {
  await upsertCustomer({ email: 'ops@inqi.example', name: 'Operator Ada', role: AuthRole.Admin, credits: 0, freeReportUsed: true });
  const customers = await Promise.all([
    upsertCustomer({ email: 'nina.costa@example.com', name: 'Nina Costa', role: AuthRole.Customer, credits: 3, freeReportUsed: true }),
    upsertCustomer({ email: 'omar.haddad@example.com', name: 'Omar Haddad', role: AuthRole.Customer, credits: 0, freeReportUsed: false }), // still owed a free report
    upsertCustomer({ email: 'mei.tan@example.com', name: 'Mei Tan', role: AuthRole.Customer, credits: 5, freeReportUsed: true }),
    upsertCustomer({ email: 'lukas.berg@example.com', name: 'Lukas Berg', role: AuthRole.Customer, credits: 1, freeReportUsed: true }), // 1 credit → can unlock a freemium report
  ]);
  console.log(`Seeded ${customers.length + 1} customers (1 admin) for the directory/search`);
  return customers;
}

const FREEMIUM_PROVIDERS = [
  { name: 'Ace Tennis Academy', quality: 0.92, price: 420, rating: 4.8, themes: ['great coaching', 'pro courts'] },
  { name: 'Porto Padel & Tennis', quality: 0.86, price: 380, rating: 4.6, themes: ['friendly', 'flexible hours'] },
  { name: 'Riverside Racquets', quality: 0.74, price: 300, rating: 4.2, themes: ['good value'] },
  { name: 'City Sports Club', quality: 0.61, price: 260, rating: 3.9, themes: ['central', 'busy'] },
  { name: 'Foz Coaching Co', quality: 0.55, price: 240, rating: 3.7, themes: ['budget', 'beginner-friendly'] }, // the #5 taster
];

/** A delivered, free + locked (freemium) report for `owner`: 5 ranked options with
 *  findings (so FE-08 provenance has web/feedback) and a redacted snapshot (FE-07). */
async function seedFreemiumReport({ owner, workflowVersionId }: { owner: { id: string; email: string }; workflowVersionId: string }) {
  if (await db.inquiry.findFirst({ where: { customerId: owner.id }, select: { id: true } })) {
    console.log('freemium fixture already present — skipping');
    return;
  }
  const inq = await db.inquiry.create({
    data: { customerEmail: owner.email, customerId: owner.id, rawRequest: 'a weekly tennis coach near Porto', state: InquiryState.REPORT_DELIVERED, workflowVersionId, freeReport: true },
  });
  const epic = await db.epic.create({ data: { inquiryId: inq.id, definition: {}, strategy: 'escalating', targetQualifiedOptions: 3, status: 'done' } });

  const rankable: RankableOption[] = [];
  for (const p of FREEMIUM_PROVIDERS) {
    const subtask = await db.subtask.create({
      data: { epicId: epic.id, subjectProviderName: p.name, wave: 1, status: SubtaskStatus.Qualified, personaId: 'persona_porto', qualityScore: p.quality },
    });
    const background = {
      qualityScore: p.quality, rating: p.rating, reviewsCount: 40, sentiment: p.quality,
      themes: p.themes, quotes: [`"${p.themes[0]}" — a recent client`], eligibility: 'open to new clients',
      sources: [{ source: 'TrustReviews', url: `https://reviews.example/${encodeURIComponent(p.name)}`, snippet: `${p.rating}★ across 40 reviews` }],
    };
    await db.finding.create({ data: { inquiryId: inq.id, epicId: epic.id, subtaskId: subtask.id, kind: FindingKind.SubjectProviderBackground, data: background as Prisma.InputJsonValue, qualityScore: p.quality } });
    await db.finding.create({ data: { inquiryId: inq.id, epicId: epic.id, subtaskId: subtask.id, kind: FindingKind.Option, data: { subjectProvider: p.name, price: p.price, currency: 'EUR', availability: 'weekly slots', leadTime: '1 week' } as Prisma.InputJsonValue } });
    rankable.push({ subjectProvider: p.name, price: p.price, currency: 'EUR', availability: 'weekly slots', leadTime: '1 week', qualityScore: p.quality, background });
  }

  const ranked = rankOptions(rankable);
  await db.report.create({
    data: {
      inquiryId: inq.id, token: randomBytes(20).toString('hex'),
      summary: 'Found 5 coaches near Porto, ranked by quality + price.',
      options: ranked as unknown as Prisma.InputJsonValue,
      timeline: { generatedAt: new Date().toISOString() },
      freemium: true, unlocked: false,
    },
  });
  console.log(`Seeded freemium report for ${owner.email} (${ranked.length} options, locked)`);
}

async function main() {
  await installVersion({ version: 1, status: WorkflowStatus.Archived, states: STATES_V1, transitions: TRANSITIONS_V1 });
  await installVersion({ version: 2, status: WorkflowStatus.Active, states: STATES_V2, transitions: TRANSITIONS_V2 });

  const customers = await seedCustomers();
  const active = await db.workflowDefinition.findFirst({ where: { key: 'inquiry', status: WorkflowStatus.Active }, select: { id: true } });
  if (active) await seedFreemiumReport({ owner: customers[3], workflowVersionId: active.id }); // Lukas (1 credit → can unlock)
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => db.$disconnect());
