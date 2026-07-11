import { randomBytes } from 'crypto';
import { PrismaClient, Prisma } from '@prisma/client';
import {
  AuthRole, EpicStatus, FindingKind, InquiryStatus, LeadSource, OutreachStrategy,
  ReportState, SourceType, WorkflowEvent, WorkflowStatus,
} from '@inqi/shared';
import { WorkflowAction } from '../src/domain/orchestrator/workflow-registry';
import { PHASE_GRAPHS } from '../src/domain/phases/phase-graphs';
import { DEFAULT_GRAPH as SUBJECT_BUILD_V1, LAYERED_GRAPH_V2 as SUBJECT_BUILD_V2 } from '../src/domain/phases/subject-build/operators';
import { rankOptions, RankableOption } from '../src/domain/snapshot/ranking';

const db = new PrismaClient();

// inqi workflow — stored in DB so it can be versioned. A shipped version is
// immutable; new behaviour folds into the current working version (v2) while v1
// stays byte-identical for any report still pinned to it.
type State = { name: string; isInitial?: boolean; isTerminal?: boolean; handler?: string; config?: unknown };

const WORKFLOW_KEY = 'report';

const STATES_V1: State[] = [
  { name: ReportState.RECEIVED, isInitial: true },
  { name: ReportState.PRE_RESEARCH },
  { name: ReportState.DENIED, isTerminal: true },
  { name: ReportState.QUESTIONNAIRE_SENT },
  { name: ReportState.DROPPED, isTerminal: true },
  { name: ReportState.ENRICHMENT },
  { name: ReportState.BROAD_RESEARCH },
  { name: ReportState.FUNNEL },
  { name: ReportState.OUTREACH },
  { name: ReportState.REPORT_GENERATION },
  { name: ReportState.REPORT_DELIVERED, isTerminal: true },
];

// v2 adds the HP-09 resilience/operator states.
const STATES_V2: State[] = [
  ...STATES_V1,
  { name: ReportState.FAILED, isTerminal: true },
  { name: ReportState.CANCELLED, isTerminal: true },
  { name: ReportState.ON_HOLD },
];

const TRANSITIONS_V1 = [
  { from: ReportState.RECEIVED,           event: WorkflowEvent.START_PRE_RESEARCH,    to: ReportState.PRE_RESEARCH,      action: WorkflowAction.EnqueuePreResearch },
  { from: ReportState.PRE_RESEARCH,       event: WorkflowEvent.PRE_RESEARCH_DENIED,   to: ReportState.DENIED },
  { from: ReportState.PRE_RESEARCH,       event: WorkflowEvent.PRE_RESEARCH_PASSED,   to: ReportState.QUESTIONNAIRE_SENT, action: WorkflowAction.SendQuestionnaire },
  { from: ReportState.QUESTIONNAIRE_SENT, event: WorkflowEvent.QUESTIONNAIRE_EXPIRED, to: ReportState.DROPPED },
  { from: ReportState.QUESTIONNAIRE_SENT, event: WorkflowEvent.QUESTIONNAIRE_DENIED,  to: ReportState.DENIED },
  { from: ReportState.QUESTIONNAIRE_SENT, event: WorkflowEvent.QUESTIONNAIRE_FILLED,  to: ReportState.ENRICHMENT,         action: WorkflowAction.EnqueueEnrichSubject },
  { from: ReportState.ENRICHMENT,         event: WorkflowEvent.ENRICHMENT_DONE,       to: ReportState.BROAD_RESEARCH,     action: WorkflowAction.EnqueueBroadResearch },
  { from: ReportState.BROAD_RESEARCH,     event: WorkflowEvent.BROAD_RESEARCH_DONE,   to: ReportState.FUNNEL,             action: WorkflowAction.EnqueueBuildFunnel },
  { from: ReportState.FUNNEL,             event: WorkflowEvent.FUNNEL_BUILT,          to: ReportState.OUTREACH,           action: WorkflowAction.EnqueueStartOutreach },
  { from: ReportState.OUTREACH,           event: WorkflowEvent.OUTREACH_DONE,         to: ReportState.REPORT_GENERATION,  action: WorkflowAction.EnqueueGenerateReport },
  { from: ReportState.REPORT_GENERATION,  event: WorkflowEvent.REPORT_READY,          to: ReportState.REPORT_DELIVERED },
];

// Per-stage failure/stall → FAILED (HP-09), from each processing state.
const FAILURE_TRANSITIONS = [
  { from: ReportState.PRE_RESEARCH,      event: WorkflowEvent.PRE_RESEARCH_FAILED,   to: ReportState.FAILED },
  { from: ReportState.ENRICHMENT,        event: WorkflowEvent.ENRICHMENT_FAILED,     to: ReportState.FAILED },
  { from: ReportState.BROAD_RESEARCH,    event: WorkflowEvent.BROAD_RESEARCH_FAILED, to: ReportState.FAILED },
  { from: ReportState.FUNNEL,            event: WorkflowEvent.FUNNEL_FAILED,         to: ReportState.FAILED },
  { from: ReportState.OUTREACH,          event: WorkflowEvent.OUTREACH_STALLED,      to: ReportState.FAILED },
  { from: ReportState.REPORT_GENERATION, event: WorkflowEvent.REPORT_FAILED,         to: ReportState.FAILED },
];

// Operator/cancel transitions (HP-09; HP-11 expands resume semantics).
const CANCELLABLE_FROM = [
  ReportState.RECEIVED, ReportState.PRE_RESEARCH, ReportState.QUESTIONNAIRE_SENT, ReportState.ENRICHMENT,
  ReportState.BROAD_RESEARCH, ReportState.FUNNEL, ReportState.OUTREACH, ReportState.REPORT_GENERATION, ReportState.ON_HOLD,
];
const CONTROL_TRANSITIONS = [
  ...CANCELLABLE_FROM.map((from) => ({ from, event: WorkflowEvent.CANCEL, to: ReportState.CANCELLED })),
  { from: ReportState.OUTREACH, event: WorkflowEvent.HOLD,   to: ReportState.ON_HOLD },
  { from: ReportState.ON_HOLD,  event: WorkflowEvent.RESUME, to: ReportState.OUTREACH },
];

// v2 = v1 + prior-report reuse (HP-06) + full state machine (HP-09). v1 is untouched.
const TRANSITIONS_V2 = [
  ...TRANSITIONS_V1,
  { from: ReportState.BROAD_RESEARCH, event: WorkflowEvent.REUSE_FOUND, to: ReportState.REPORT_DELIVERED },
  ...FAILURE_TRANSITIONS,
  ...CONTROL_TRANSITIONS,
];

type Transition = { from: string; event: string; to: string; guard?: string; action?: string };

async function installVersion({ key, version, status, states, transitions }: { key: string; version: number; status: string; states: State[]; transitions: Transition[] }) {
  const existing = await db.workflowDefinition.findUnique({ where: { key_version: { key, version } } });
  if (existing) {
    console.log(`workflow ${key} v${version} already present`);
    return;
  }
  const def = await db.workflowDefinition.create({
    data: {
      key, version, status,
      states: { create: states.map((s) => ({ name: s.name, isInitial: !!s.isInitial, isTerminal: !!s.isTerminal, handler: s.handler ?? null, config: (s.config as Prisma.InputJsonValue) ?? Prisma.JsonNull })) },
      transitions: { create: transitions.map((t) => ({ fromState: t.from, toState: t.to, event: t.event, guard: t.guard ?? null, action: t.action ?? null })) },
    },
  });
  console.log(`Installed ${key} workflow v${version} (${def.id}, ${status}) — ${states.length} states, ${transitions.length} transitions`);
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

/** A delivered, free + locked (freemium) report for `owner`: 5 qualified inquiries
 *  with websearch + rating_feedback sources, findings (so FE-08 provenance has
 *  web/feedback) and a redacted snapshot (FE-07). */
async function seedFreemiumReport({ owner, workflowVersionId }: { owner: { id: string; email: string }; workflowVersionId: string }) {
  if (await db.report.findFirst({ where: { customerId: owner.id }, select: { id: true } })) {
    console.log('freemium fixture already present — skipping');
    return;
  }
  const report = await db.report.create({
    data: {
      customerEmail: owner.email, customerId: owner.id, rawRequest: 'a weekly tennis coach near Porto',
      state: ReportState.REPORT_DELIVERED, workflowVersionId, freeReport: true,
      personaId: 'ellis', // London hub — serves western Europe (Porto)
    },
  });
  const epic = await db.epic.create({ data: { reportId: report.id, definition: {}, strategy: OutreachStrategy.ESCALATING, targetQualifiedOptions: 3, status: EpicStatus.Done } });

  const rankable: RankableOption[] = [];
  for (const p of FREEMIUM_PROVIDERS) {
    const inquiry = await db.inquiry.create({
      data: { reportId: report.id, epicId: epic.id, name: p.name, leadSource: LeadSource.Fallback, wave: 1, status: InquiryStatus.Qualified, qualityScore: p.quality, researchPending: false },
    });
    // channel sources: what the funnel/background research would have recorded
    await db.source.create({
      data: {
        inquiryId: inquiry.id, type: SourceType.Websearch,
        url: `https://directory.example/${encodeURIComponent(p.name)}`, title: p.name,
        snippet: `${p.name} — coaching listings and contact details`,
      },
    });
    await db.source.create({
      data: {
        inquiryId: inquiry.id, type: SourceType.RatingFeedback,
        url: `https://reviews.example/${encodeURIComponent(p.name)}`, title: 'TrustReviews',
        snippet: `${p.rating}★ across 40 reviews`,
        data: { rating: p.rating, reviewsCount: 40, themes: p.themes } as Prisma.InputJsonValue,
      },
    });
    const background = {
      qualityScore: p.quality, rating: p.rating, reviewsCount: 40, sentiment: p.quality,
      themes: p.themes, quotes: [`"${p.themes[0]}" — a recent client`], eligibility: 'open to new clients',
      sources: [{ source: 'TrustReviews', url: `https://reviews.example/${encodeURIComponent(p.name)}`, snippet: `${p.rating}★ across 40 reviews` }],
    };
    await db.finding.create({ data: { reportId: report.id, epicId: epic.id, inquiryId: inquiry.id, kind: FindingKind.SubjectProviderBackground, data: background as Prisma.InputJsonValue, qualityScore: p.quality } });
    await db.finding.create({ data: { reportId: report.id, epicId: epic.id, inquiryId: inquiry.id, kind: FindingKind.Option, data: { subjectProvider: p.name, price: p.price, currency: 'EUR', availability: 'weekly slots', leadTime: '1 week' } as Prisma.InputJsonValue } });
    rankable.push({ subjectProvider: p.name, price: p.price, currency: 'EUR', availability: 'weekly slots', leadTime: '1 week', qualityScore: p.quality, background });
  }

  const ranked = rankOptions(rankable);
  await db.reportSnapshot.create({
    data: {
      reportId: report.id, token: randomBytes(20).toString('hex'),
      summary: 'Found 5 coaches near Porto, ranked by quality + price.',
      options: ranked as unknown as Prisma.InputJsonValue,
      timeline: { generatedAt: new Date().toISOString() },
      freemium: true, unlocked: false,
    },
  });
  console.log(`Seeded freemium report for ${owner.email} (${ranked.length} options, locked)`);
}

async function main() {
  await installVersion({ key: WORKFLOW_KEY, version: 1, status: WorkflowStatus.Archived, states: STATES_V1, transitions: TRANSITIONS_V1 });
  await installVersion({ key: WORKFLOW_KEY, version: 2, status: WorkflowStatus.Active, states: STATES_V2, transitions: TRANSITIONS_V2 });

  // Research-phase workflows (pre_research / breadth_search / depth_search) —
  // graphs live in src/domain/phases/phase-graphs.ts (single source of truth).
  for (const graph of PHASE_GRAPHS) {
    await installVersion({ key: graph.key, version: 1, status: WorkflowStatus.Active, states: graph.states, transitions: graph.transitions });
  }

  // subject_build — the composable SUBJECT slot the AI experiments on. v1 is the
  // legacy linear baseline (IN → enrich-basic → OUT, kept for rollback/diff); v2 is
  // the ACTIVE layered M:M network with domain memory (docs/subject-build-network.md).
  // Both are interpreted, not engine-run; the loader picks the highest active version.
  await installVersion({
    key: 'subject_build', version: 1, status: WorkflowStatus.Archived,
    states: SUBJECT_BUILD_V1.states.map((s) => ({ ...s })),
    transitions: SUBJECT_BUILD_V1.transitions.map((t) => ({ from: t.from, to: t.to, event: t.event })),
  });
  await installVersion({
    key: 'subject_build', version: 2, status: WorkflowStatus.Active,
    states: SUBJECT_BUILD_V2.states.map((s) => ({ ...s })),
    transitions: SUBJECT_BUILD_V2.transitions.map((t) => ({ from: t.from, to: t.to, event: t.event })),
  });

  const customers = await seedCustomers();
  const active = await db.workflowDefinition.findFirst({ where: { key: WORKFLOW_KEY, status: WorkflowStatus.Active }, select: { id: true } });
  if (active) await seedFreemiumReport({ owner: customers[3], workflowVersionId: active.id }); // Lukas (1 credit → can unlock)
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => db.$disconnect());
