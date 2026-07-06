/**
 * Dev fixture: nina.costa@example.com with one report per HP-23 stage —
 *   1 Draft · 2 Preparing · 3 Questionnaire (8 questions) · 4 Researching (0
 *   inquiries, agent activity only) · 5 Partially ready (2 ok + 1 error) ·
 *   6 Ready (10 ok + 1 error) · 7 Report error (failed at report generation).
 * Re-runnable (wipes Nina's prior reports/ledger first).
 *
 *   pnpm --filter @inqi/backend exec tsx prisma/seed-nina.ts
 */
import { randomBytes } from 'crypto';
import { resolve } from 'path';
import { PrismaClient, Prisma } from '@prisma/client';
import {
  AuthRole, ConvState, CreditKind, EventType, FindingKind, LeadSource, ReportState, MessageDirection,
  MessageStatus, InquiryStatus, SourceType, UsageKind, WorkflowStatus,
} from '@inqi/shared';
import { rankOptions, RankableOption } from '../src/domain/snapshot/ranking';

// Load DATABASE_URL from the repo-root .env (tsx doesn't auto-load it).
for (const p of [resolve(__dirname, '../../.env'), resolve(process.cwd(), '../.env'), resolve(process.cwd(), '.env')]) {
  try { process.loadEnvFile(p); break; } catch { /* try next */ }
}

const db = new PrismaClient();
const EMAIL = 'nina.costa@example.com';
const hex = () => randomBytes(16).toString('hex');
const S = InquiryStatus;

type Sub = { name: string; status: string; q?: number; price?: number; rating?: number; themes?: string[] };
type Spec = {
  key: string;
  state: string;
  rawRequest: string;
  subjectTitle: string;
  subjectDesc: string;
  currency: string;
  persona: string;
  facets: string[];
  questionnaire?: 'none' | 'sent' | 'confirmed';
  questions?: Prisma.InputJsonValue;
  answers?: Prisma.InputJsonValue;
  epic?: boolean;
  inquiries?: Sub[];
  activity?: string[];           // agent.progress messages (replay into the live report)
  failStage?: string;            // emits agent.failed for a "report error"
  report?: { summary: string };
};

// --- report 3: a valid 8-question questionnaire (each: 4 options, one default) ---
const TRAINER_QUESTIONS = [
  { id: 'goal', type: 'select', prompt: 'What is your main goal?', options: ['Build strength', 'Lose weight', 'General fitness', 'Mobility & posture'] },
  { id: 'experience', type: 'select', prompt: 'Your training experience?', options: ['Beginner', 'Intermediate', 'Advanced', 'Returning after a break'] },
  { id: 'frequency', type: 'select', prompt: 'Sessions per week?', options: ['2× a week', '3× a week', '4× a week', 'Flexible'] },
  { id: 'length', type: 'select', prompt: 'Preferred session length?', options: ['30 minutes', '45 minutes', '60 minutes', '90 minutes'] },
  { id: 'time', type: 'select', prompt: 'Best time of day?', options: ['Early morning', 'Daytime', 'Evening', 'Late night'] },
  { id: 'equipment', type: 'select', prompt: 'What equipment do you have?', options: ['Full gym', 'Home basics (dumbbells)', 'Bodyweight only', 'Resistance bands'] },
  { id: 'format', type: 'select', prompt: 'How should sessions run?', options: ['Live video', 'App-guided plan', 'Phone check-ins', 'Hybrid'] },
  { id: 'budget', type: 'select', prompt: 'Budget per session?', options: ['Up to £30', '£30–50', '£50–80', '£80+'] },
  { id: 'confirm', type: 'confirm', prompt: 'Is this the right scope to start outreach?' },
];
// the default (pre-selected) answer for each question
const TRAINER_DEFAULTS = { goal: 'Build strength', experience: 'Intermediate', frequency: '3× a week', length: '45 minutes', time: 'Evening', equipment: 'Home basics (dumbbells)', format: 'Live video', budget: '£30–50' };

function qualified(name: string, q: number, price: number, rating: number, themes: string[]): Sub { return { name, status: S.Qualified, q, price, rating, themes }; }
const failedSub = (name: string): Sub => ({ name, status: S.Failed });

const SPECS: Spec[] = [
  {
    key: 'draft', state: ReportState.RECEIVED,
    rawRequest: 'a standing desk, electric, under £400',
    subjectTitle: 'Electric standing desk', subjectDesc: 'Electric sit-stand desk, dual motor, 140cm, under £400',
    currency: 'GBP', persona: 'ellis', facets: ['electric / dual-motor', '140cm', 'under £400'],
    questionnaire: 'none',
  },
  {
    key: 'preparing', state: ReportState.PRE_RESEARCH,
    rawRequest: 'a dog walker, weekday lunchtimes, East London',
    subjectTitle: 'Dog walker, weekday lunchtimes', subjectDesc: 'Insured dog walker, weekday lunchtimes, small dog, East London (E2)',
    currency: 'GBP', persona: 'ellis', facets: ['weekday lunchtimes', 'small dog', 'insured', 'E2'],
    questionnaire: 'none', activity: ['Understanding your request', 'Checking your request makes sense'],
  },
  {
    key: 'questionnaire', state: ReportState.QUESTIONNAIRE_SENT,
    rawRequest: 'an online personal trainer, strength, 3× a week',
    subjectTitle: 'Online personal trainer (strength)', subjectDesc: 'Online strength coach, 3×/week, live video, home basics',
    currency: 'GBP', persona: 'ellis', facets: ['strength', '3× a week', 'online / live', 'evenings'],
    questionnaire: 'sent', questions: TRAINER_QUESTIONS as Prisma.InputJsonValue, answers: TRAINER_DEFAULTS as Prisma.InputJsonValue,
  },
  {
    key: 'researching', state: ReportState.OUTREACH,
    rawRequest: 'a wedding florist, seasonal, Edinburgh',
    subjectTitle: 'Wedding florist, seasonal', subjectDesc: 'Seasonal wedding florist, ~120 guests, Edinburgh, late summer',
    currency: 'GBP', persona: 'ellis', facets: ['seasonal blooms', '~120 guests', 'Edinburgh', 'late summer'],
    questionnaire: 'confirmed', // no epic/inquiries yet — agent activity only (exactly 4 steps)
    activity: ['Understanding your request', 'Researching 14 providers', 'Reaching out to 9 providers', '3 providers replied'],
  },
  {
    key: 'partial', state: ReportState.OUTREACH,
    rawRequest: 'a used Herman Miller Aeron, size B',
    subjectTitle: 'Used Herman Miller Aeron (size B)', subjectDesc: 'Used Aeron size B, fully adjustable, good condition, London pickup',
    currency: 'GBP', persona: 'ellis', facets: ['size B', 'fully loaded', 'good condition', 'London pickup'],
    questionnaire: 'confirmed', epic: true,
    inquiries: [
      qualified('Office Resale Co', 0.88, 620, 4.7, ['fully refurbished', 'warranty']),
      qualified('SecondDesk London', 0.79, 540, 4.4, ['fair pricing']),
      qualified('ErgoReseller', 0.72, 500, 4.2, ['quick collection']),
      failedSub('Gumtree Seller (gone)'),
    ],
  },
  {
    key: 'ready', state: ReportState.REPORT_DELIVERED,
    rawRequest: 'a Mandarin tutor, conversational, weekly',
    subjectTitle: 'Mandarin tutor, conversational', subjectDesc: 'Conversational Mandarin tutor, weekly, online, intermediate',
    currency: 'GBP', persona: 'ellis', facets: ['conversational', 'weekly', 'online', 'intermediate'],
    questionnaire: 'confirmed', epic: true, report: { summary: 'Found 10 qualified Mandarin tutors, ranked by public feedback + price.' },
    inquiries: [
      qualified('Ni Hao Tutoring', 0.93, 32, 4.9, ['patient', 'great structure', 'native speaker']),
      qualified('MandarinMate', 0.9, 30, 4.8, ['conversation focus']),
      qualified('Beijing Bridge', 0.86, 34, 4.7, ['exam + chat']),
      qualified('SpeakHanyu', 0.82, 28, 4.6, ['flexible hours']),
      qualified('TutorLoop Mandarin', 0.8, 27, 4.5, ['great materials']),
      qualified('LinguaPanda', 0.76, 26, 4.3, ['friendly']),
      qualified('Hutong Lessons', 0.72, 25, 4.2, ['responsive']),
      qualified('EasyMando', 0.69, 24, 4.1, ['budget-friendly']),
      qualified('Pinyin Pro', 0.66, 23, 4.0, ['beginner-friendly']),
      qualified('Dragon Dialogues', 0.84, 31, 4.6, ['immersive', 'reliable']),
      failedSub('Closed School (no reply)'),
    ],
  },
  {
    key: 'error', state: ReportState.FAILED,
    rawRequest: 'a vintage Vespa restorer, Milan',
    subjectTitle: 'Vintage Vespa restorer', subjectDesc: 'Restorer for a 1960s Vespa, parts sourcing + respray, Milan',
    currency: 'EUR', persona: 'bo', facets: ['1960s Vespa', 'parts + respray', 'Milan'],
    questionnaire: 'confirmed', epic: true, failStage: 'generate_report',
    inquiries: [
      qualified('Officina Vespa Milano', 0.8, 2400, 4.5, ['vintage specialist', 'parts network']),
      qualified('Brera Classics', 0.74, 2200, 4.3, ['careful work']),
      qualified('Navigli Restorations', 0.7, 2100, 4.2, ['good comms']),
      qualified('Isola Motoworks', 0.66, 1950, 4.0, ['fair price']),
      failedSub('Garibaldi Garage (unreachable)'),
    ],
  },
];

function backgroundFor(s: Sub) {
  const q = s.q ?? 0.7;
  return {
    qualityScore: q, rating: s.rating ?? 4.2, reviewsCount: 30 + Math.round(q * 180), sentiment: q,
    themes: s.themes ?? ['reliable'], quotes: [`${(s.themes ?? ['reliable'])[0]} — a recent client`, `Would recommend ${s.name}.`],
    eligibility: 'open / available', redFlags: q < 0.5 ? ['slow to respond'] : [],
    sources: [
      { source: 'TrustReviews', url: `https://reviews.example/${encodeURIComponent(s.name)}`, snippet: `${s.rating ?? 4.2}★ across ${30 + Math.round(q * 180)} reviews` },
      { source: 'Local listings', url: `https://maps.example/${encodeURIComponent(s.name)}`, snippet: 'Verified business listing with contact details.' },
    ],
  };
}

let evClock = 0;
const evAt = (m: number) => new Date(evClock + m * 60_000);

async function createReport(spec: Spec, idx: number, customerId: string, workflowVersionId: string) {
  const createdAt = new Date(Date.now() - (idx + 1) * 6 * 3600_000);
  const inq = await db.report.create({
    data: { customerEmail: EMAIL, customerId, rawRequest: spec.rawRequest, state: spec.state, workflowVersionId, geoLabel: spec.subjectTitle.split(', ').pop() ?? null, personaId: spec.persona, createdAt },
  });
  await db.subject.create({ data: { reportId: inq.id, title: spec.subjectTitle, description: spec.subjectDesc, category: 'service', attributes: { facets: spec.facets } as Prisma.InputJsonValue } });

  let qToken: string | null = null;
  if (spec.questionnaire && spec.questionnaire !== 'none') {
    const confirmed = spec.questionnaire === 'confirmed';
    qToken = hex();
    await db.questionnaire.create({
      data: {
        reportId: inq.id, token: qToken,
        questions: (spec.questions ?? [{ id: 'confirm', type: 'confirm', prompt: 'Is this what you are looking for?' }]) as Prisma.InputJsonValue,
        answers: confirmed ? ({ confirm: true } as Prisma.InputJsonValue) : (spec.answers ?? Prisma.JsonNull),
        confirmed, reviewStatus: 'passed', expiresAt: new Date(Date.now() + 7 * 86400_000), filledAt: confirmed ? createdAt : null,
      },
    });
  }

  evClock = createdAt.getTime();
  const events: Prisma.EventOutboxCreateManyInput[] = [];
  const rankable: RankableOption[] = [];
  let qualifiedCount = 0;

  // Agent-activity-only reports (report 4): just the progress events, exactly N steps.
  if (spec.activity) {
    spec.activity.forEach((message, i) => events.push({ type: EventType.AgentProgress, reportId: inq.id, data: { stage: 'outreach', message } as Prisma.InputJsonValue, createdAt: evAt(2 + i * 2) }));
  }

  if (spec.epic) {
    const epic = await db.epic.create({ data: { reportId: inq.id, definition: { geo: spec.subjectTitle } as Prisma.InputJsonValue, strategy: 'escalating', targetQualifiedOptions: 5, status: spec.state === ReportState.REPORT_DELIVERED ? 'done' : 'open', releasedWaves: [1, 2], priority: 3 } });
    events.push({ type: EventType.EpicCreated, reportId: inq.id, epicId: epic.id, data: { strategy: 'escalating', target: 5 } as Prisma.InputJsonValue, createdAt: evAt(1) });

    const subs = spec.inquiries ?? [];
    for (let i = 0; i < subs.length; i++) {
      const sub = subs[i];
      const isQ = sub.status === S.Qualified;
      const contacted = isQ || sub.status === S.Failed || sub.status === S.Replied || sub.status === S.Contacted;
      const bg = backgroundFor(sub);
      const st = await db.inquiry.create({
        data: {
          reportId: inq.id, epicId: epic.id, name: sub.name, wave: i < 3 ? 1 : 2, status: sub.status,
          leadSource: LeadSource.Ai, contact: { email: `hello@${sub.name.toLowerCase().replace(/[^a-z]+/g, '')}.example` } as Prisma.InputJsonValue,
          qualityScore: isQ ? sub.q : null,
          background: isQ ? (bg as Prisma.InputJsonValue) : undefined,
          result: isQ ? ({ price: sub.price, currency: spec.currency, availability: 'available', leadTime: '1–2 weeks' } as Prisma.InputJsonValue) : undefined,
        },
      });
      events.push({ type: EventType.InquiryCreated, reportId: inq.id, epicId: epic.id, inquiryId: st.id, data: { name: sub.name, wave: i < 3 ? 1 : 2 } as Prisma.InputJsonValue, createdAt: evAt(4 + i) });

      // Channel sources: a websearch hit + (if qualified) a rating digest, and the email thread anchor.
      await db.source.create({
        data: { inquiryId: st.id, type: SourceType.Websearch, url: `https://maps.example/${encodeURIComponent(sub.name)}`, title: sub.name, snippet: 'Verified business listing with contact details.' },
      });
      if (isQ) {
        await db.source.create({
          data: { inquiryId: st.id, type: SourceType.RatingFeedback, url: `https://reviews.example/${encodeURIComponent(sub.name)}`, title: 'TrustReviews', snippet: `${sub.rating ?? 4.2}★`, data: bg as Prisma.InputJsonValue },
        });
      }
      const thread = contacted
        ? await db.source.create({
            data: {
              inquiryId: st.id, type: SourceType.Email, replyAddress: `reply+${hex().slice(0, 10)}@inqi.example`,
              convState: isQ ? ConvState.Closed : ConvState.AwaitingReply, lastInboundAt: isQ ? evAt(6 + i) : null,
            },
          })
        : null;

      if (thread) {
        await db.message.create({
          data: { sourceId: thread.id, inquiryId: st.id, direction: MessageDirection.Outbound, status: sub.status === S.Failed ? MessageStatus.Bounced : MessageStatus.Sent, personaId: spec.persona,
            fromAddr: thread.replyAddress, toAddr: (st.contact as { email: string }).email, subject: `Re: ${spec.subjectTitle}`,
            body: `Hi ${sub.name} — I'm helping a client find ${spec.rawRequest}. Could you share availability and pricing?`,
            externalId: hex(), reviewStatus: 'passed', createdAt: evAt(5 + i) },
        });
        events.push({ type: EventType.MessageSent, reportId: inq.id, epicId: epic.id, inquiryId: st.id, data: { sourceId: thread.id } as Prisma.InputJsonValue, createdAt: evAt(5 + i) });
      }
      if (isQ && thread) {
        await db.message.create({
          data: { sourceId: thread.id, inquiryId: st.id, direction: MessageDirection.Inbound, status: MessageStatus.Received, personaId: spec.persona,
            fromAddr: (st.contact as { email: string }).email, toAddr: thread.replyAddress, subject: `Re: ${spec.subjectTitle}`,
            body: `Thanks for reaching out — yes, we're available. Pricing is around ${sub.price} ${spec.currency}.`,
            externalId: hex(), parsed: { price: sub.price, currency: spec.currency, availability: 'available' } as Prisma.InputJsonValue, reviewStatus: 'passed', createdAt: evAt(6 + i) },
        });
        events.push({ type: EventType.MessageReceived, reportId: inq.id, epicId: epic.id, inquiryId: st.id, data: { sourceId: thread.id } as Prisma.InputJsonValue, createdAt: evAt(6 + i) });
        await db.finding.create({ data: { reportId: inq.id, epicId: epic.id, inquiryId: st.id, kind: FindingKind.SubjectProviderBackground, data: bg as Prisma.InputJsonValue, qualityScore: sub.q } });
        await db.finding.create({ data: { reportId: inq.id, epicId: epic.id, inquiryId: st.id, kind: FindingKind.Option, data: { subjectProvider: sub.name, price: sub.price, currency: spec.currency, availability: 'available', leadTime: '1–2 weeks' } as Prisma.InputJsonValue, qualityScore: sub.q } });
        rankable.push({ subjectProvider: sub.name, price: sub.price!, currency: spec.currency, availability: 'available', leadTime: '1–2 weeks', qualityScore: sub.q!, background: bg });
        events.push({ type: EventType.InquiryUpdated, reportId: inq.id, epicId: epic.id, inquiryId: st.id, data: { status: S.Qualified, qualityScore: sub.q } as Prisma.InputJsonValue, createdAt: evAt(7 + i) });
        qualifiedCount++;
      }
    }
  }

  // Report snapshot for delivered.
  const ranked = rankOptions(rankable);
  if (spec.report && ranked.length) {
    await db.reportSnapshot.create({ data: { reportId: inq.id, token: hex(), summary: spec.report.summary, options: ranked as unknown as Prisma.InputJsonValue, timeline: { generatedAt: new Date().toISOString() } as Prisma.InputJsonValue, freemium: false, unlocked: false } });
    events.push({ type: EventType.SnapshotReady, reportId: inq.id, data: { options: ranked.length } as Prisma.InputJsonValue, createdAt: evAt(40) });
  }
  if (spec.failStage) events.push({ type: EventType.AgentFailed, reportId: inq.id, data: { stage: spec.failStage, error: 'report synthesis failed after retries' } as Prisma.InputJsonValue, createdAt: evAt(42) });

  if (events.length) await db.eventOutbox.createMany({ data: events });

  // Usage (cost view) for reports that ran.
  if (spec.epic || spec.activity) {
    await db.usageRecord.createMany({ data: [
      { reportId: inq.id, kind: UsageKind.AiCall, model: 'qwen', tier: 'breadth', promptTokens: 4200, completionTokens: 1800, totalTokens: 6000 },
      { reportId: inq.id, kind: UsageKind.AiCall, model: 'claude-opus-4-8', tier: 'depth', promptTokens: 9000, completionTokens: 3200, totalTokens: 12200 },
      { reportId: inq.id, kind: UsageKind.EmailSent, quantity: (spec.inquiries ?? []).filter((s) => s.status !== S.Pending).length },
    ] });
  }

  const extra = qToken && spec.questionnaire === 'sent' ? `  · questionnaire: /#/q/${qToken}` : '';
  console.log(`  ${spec.key.padEnd(14)} ${spec.state.padEnd(18)} ${inq.id}  (${qualifiedCount} qualified · ${ranked.length} options · ${(spec.inquiries ?? []).length} inquiries)${extra}`);
  return { id: inq.id, key: spec.key };
}

async function wipeNina(customerId: string) {
  const prior = await db.report.findMany({ where: { customerId }, select: { id: true } });
  if (prior.length) {
    await db.creditLedger.deleteMany({ where: { customerId } });
    await db.report.deleteMany({ where: { customerId } });
    console.log(`  wiped ${prior.length} prior reports + ledger`);
  }
}

async function main() {
  const customer = await db.customer.upsert({
    where: { email: EMAIL },
    update: { name: 'Nina Costa', role: AuthRole.Customer, freeReportUsed: true },
    create: { email: EMAIL, name: 'Nina Costa', role: AuthRole.Customer, credits: 0, freeReportUsed: true },
  });
  const active = await db.workflowDefinition.findFirst({ where: { key: 'report', status: WorkflowStatus.Active }, select: { id: true } });
  if (!active) throw new Error('No active workflow version — run the base seed first.');

  console.log(`Seeding ${SPECS.length} reports (one per stage) for ${EMAIL}:`);
  await wipeNina(customer.id);

  const made: { id: string; key: string }[] = [];
  for (let i = 0; i < SPECS.length; i++) made.push(await createReport(SPECS[i], i, customer.id, active.id));

  // Ledger: topups + a reserve per report that started research (not the draft) + charge (ready) + refund (error).
  const ledger: Prisma.CreditLedgerCreateManyInput[] = [
    { customerId: customer.id, kind: CreditKind.Topup, amount: 5, reason: 'Onboarding grant', actor: 'system', createdAt: new Date(Date.now() - 60 * 86400_000) },
    { customerId: customer.id, kind: CreditKind.Topup, amount: 3, reason: 'Operator top-up', actor: 'ops@inqi.example', createdAt: new Date(Date.now() - 5 * 86400_000) },
  ];
  for (const m of made) {
    if (m.key === 'draft') continue; // not submitted → no reservation
    ledger.push({ customerId: customer.id, kind: CreditKind.Reserve, amount: 1, reason: 'Report run', actor: 'system', reportId: m.id });
    if (m.key === 'ready') ledger.push({ customerId: customer.id, kind: CreditKind.Charge, amount: 1, reason: 'Report delivered', actor: 'system', reportId: m.id });
    if (m.key === 'error') ledger.push({ customerId: customer.id, kind: CreditKind.Refund, amount: 1, reason: 'Run failed — reservation returned', actor: 'system', reportId: m.id });
  }
  await db.creditLedger.createMany({ data: ledger });
  const balance = ledger.reduce((b, l) => b + (l.kind === CreditKind.Topup || l.kind === CreditKind.Refund ? l.amount : l.kind === CreditKind.Reserve ? -l.amount : 0), 0);
  await db.customer.update({ where: { id: customer.id }, data: { credits: balance } });
  console.log(`Ledger: ${ledger.length} entries · balance = ${balance} credits`);
  console.log('Done.');
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => db.$disconnect());
