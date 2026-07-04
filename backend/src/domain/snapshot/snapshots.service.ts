import { Inject, Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { Prisma } from '@prisma/client';
import { EventType, FindingKind, ReportState, ModelTier, InquiryStatus, ProvenanceDto, ProvenanceDepth, OutreachOutcome, AuditAction, AuditTargetType, deriveStage, ReportStage } from '@inqi/shared';
import { OutboxService } from '../../infra/events/outbox.service';
import { PrismaService } from '../../infra/persistence/prisma.service';
import { AI_PROVIDER, AiProvider } from '../../infra/ai/ai.tokens';
import { ErrorCode, NotFoundError } from '../../common/errors';
import { ownsResource, OwnershipViewer } from '../../common/ownership';
import { CreditsService } from '../credits/credits.service';
import { AuditService } from '../../infra/observability/audit.service';
import { ReportContextService } from '../report/report-context.service';
import { AGENT_CONTEXT_BUDGET_TOKENS } from '../report/report-context';
import { SnapshotsRepository } from './snapshots.repository';
import { rankOptions, RankableOption, RankedOption } from './ranking';
import { synthesisSystem, buildSynthesisUser, synthesisSchema } from './synthesis.prompt';
import { provenanceSummarySystem, buildProvenanceSummaryUser, provenanceSummarySchema, ProvenanceSummaryInput } from './provenance-summary.prompt';
import { ProvenanceSummaries, MessageDirection, QuestionnaireQuestion } from '@inqi/shared';

const round3 = (n: number) => Math.round(n * 1000) / 1000;
const num = (v: unknown): number => (typeof v === 'number' ? v : 0);
const toStringArray = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);
const toRecordArray = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? { url: x } : (x as Record<string, unknown>))) : [];

/**
 * HP-21 freemium redaction: reveal only the **#5-ranked** option (or the lowest-ranked
 * if there are fewer than 5); the better-ranked options become **locked stubs** carrying
 * ONLY `{ id, locked, rank }` — no provider/price/quality leaks into the payload.
 */
export function redactFreemium(options: RankedOption[]): { options: unknown[]; lockedCount: number } {
  if (options.length === 0) return { options: [], lockedCount: 0 };
  const revealIdx = options.length >= 5 ? 4 : options.length - 1;
  const redacted = options.map((o, i) =>
    i === revealIdx
      ? { ...o, locked: false, rank: i + 1 }
      : { id: `locked-${i + 1}`, locked: true, rank: i + 1 },
  );
  return { options: redacted, lockedCount: options.length - 1 };
}

/** HP-21: the summary shown while a freemium report is locked (the real one names providers/prices). */
export function lockedSummary({ total }: { total: number }): string {
  return `Found ${total} qualified option${total === 1 ? '' : 's'}. The full ranking and the research summary are locked — unlock the report to reveal them.`;
}

/** Inquiry status → outreach outcome (HP-20). Unresponsive = still pending: the thread is open (long-poll). */
function outreachOutcomeFor(status: string): OutreachOutcome {
  if (status === InquiryStatus.Replied || status === InquiryStatus.Qualified) return OutreachOutcome.Replied;
  if (status === InquiryStatus.Contacted || status === InquiryStatus.Researching || status === InquiryStatus.Unresponsive) return OutreachOutcome.Pending;
  return OutreachOutcome.NotContacted;
}

/** Compact subject-provider background carried on each report option. */
function compactBackground(bg: Record<string, unknown>) {
  return {
    rating: bg.rating ?? null,
    reviewsCount: bg.reviewsCount ?? null,
    eligibility: bg.eligibility ?? null,
    redFlags: bg.redFlags ?? [],
    qualityScore: bg.qualityScore ?? null,
    sources: bg.sources ?? [],
  };
}

/** Minimal finding shape the assembler needs (kind + owning inquiry + payload). */
export interface FindingLike {
  kind: string;
  inquiryId: string | null;
  data: unknown;
}

/**
 * Pure dynamic-report assembly: merge `option` findings with their inquiry's
 * `subject_provider_background`, then rank by blended quality+price. Shared by the
 * delivery snapshot ({@link SnapshotsService.generate}) and the live read
 * ({@link SnapshotsService.live}) so the in-progress view and the final report use
 * the exact same logic — the report is "alive" because it's assembled on read.
 */
export function assembleOptions(findings: FindingLike[]): RankedOption[] {
  const backgroundByInquiry = new Map<string, Record<string, unknown>>();
  for (const f of findings) {
    if (f.kind === FindingKind.SubjectProviderBackground && f.inquiryId) {
      backgroundByInquiry.set(f.inquiryId, (f.data ?? {}) as Record<string, unknown>);
    }
  }
  const rawOptions: RankableOption[] = findings
    .filter((f) => f.kind === FindingKind.Option)
    // An option with no provider name can never render meaningfully — drop it here
    // so unnamed rows never reach the ranked report.
    .filter((f) => String(((f.data ?? {}) as Record<string, unknown>).subjectProvider ?? '').trim().length > 0)
    .map((f) => {
      const d = (f.data ?? {}) as Record<string, unknown>;
      const bg = f.inquiryId ? backgroundByInquiry.get(f.inquiryId) : undefined;
      return {
        subjectProvider: String(d.subjectProvider ?? 'unknown'),
        price: typeof d.price === 'number' ? d.price : null,
        currency: (d.currency as string) ?? null,
        availability: (d.availability as string) ?? null,
        leadTime: (d.leadTime as string) ?? null,
        qualityScore: typeof bg?.qualityScore === 'number' ? (bg.qualityScore as number) : 0,
        background: bg ? compactBackground(bg) : null,
      };
    });
  return rankOptions(rawOptions);
}

/** Report synthesis + dynamic assembly from the Finding store. */
@Injectable()
export class SnapshotsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reports: SnapshotsRepository,
    private readonly outbox: OutboxService,
    @Inject(AI_PROVIDER) private readonly ai: AiProvider,
    private readonly credits: CreditsService,
    private readonly audit: AuditService,
    private readonly reportContext: ReportContextService,
  ) {}

  /**
   * Assemble options dynamically from Finding rows (option + subject-provider
   * background, merged by inquiry), rank them by blended quality+price, snapshot
   * the ranked set into a Report, and publish snapshot.ready.
   */
  async generate({ reportId }: { reportId: string }) {
    const findings = await this.reports.findFindings({
      reportId,
      kinds: [FindingKind.Option, FindingKind.SubjectProviderBackground],
    });
    const ranked = assembleOptions(findings);
    const summary = await this.synthesize({ reportId, ranked });
    // HP-21: the free (freemium) report is delivered locked until a 1-credit unlock.
    const report = await this.reports.findReport({ id: reportId });
    // Snapshot + its ready event commit together (AI synthesis already done, above the tx).
    return this.prisma.$transaction(async (tx) => {
      const snapshot = await this.reports.create({
        data: {
          reportId,
          token: randomBytes(20).toString('hex'),
          summary,
          options: ranked as unknown as Prisma.InputJsonValue,
          timeline: { generatedAt: new Date().toISOString() },
          freemium: report?.freeReport ?? false,
        },
        tx,
      });
      await this.outbox.emit({ type: EventType.SnapshotReady, reportId, data: { snapshotToken: snapshot.token, options: ranked.length }, tx });
      return snapshot;
    });
  }

  /**
   * Re-rank + re-synthesize an already-delivered snapshot in place (token, freemium
   * and unlocked state untouched). Runs when a depth verdict lands *after* delivery
   * — the frozen summary must never contradict the live re-ranked options (e.g. it
   * praises a provider the fresh feedback score just demoted). No-op without a
   * snapshot, or on a reused one (its content belongs to the prior report).
   */
  async refresh({ reportId }: { reportId: string }) {
    const snapshot = await this.reports.findSnapshotByReport({ reportId });
    if (!snapshot || snapshot.reusedFrom) return null;
    const findings = await this.reports.findFindings({ reportId, kinds: [FindingKind.Option, FindingKind.SubjectProviderBackground] });
    const ranked = assembleOptions(findings);
    const summary = await this.synthesize({ reportId, ranked });
    const timeline = { ...((snapshot.timeline as Record<string, unknown>) ?? {}), refreshedAt: new Date().toISOString() };
    return this.prisma.$transaction(async (tx) => {
      const updated = await this.reports.refreshContent({
        id: snapshot.id, summary, options: ranked as unknown as Prisma.InputJsonValue, timeline: timeline as Prisma.InputJsonValue, tx,
      });
      await this.outbox.emit({ type: EventType.SnapshotUpdated, reportId, data: { snapshotToken: snapshot.token, refreshed: true, options: ranked.length }, tx });
      return updated;
    });
  }

  /**
   * Synthesize the prose summary (DEPTH tier); falls back to a template when AI is
   * unconfigured or fails. Runs for an EMPTY report too — the customer must still get
   * a real explanation ("none qualified because …" + near-misses + a suggestion),
   * built from the full report context (failed inquiries carry their reasons).
   */
  private async synthesize({ reportId, ranked }: { reportId: string; ranked: RankedOption[] }): Promise<string> {
    const fallback = ranked.length === 0
      ? 'No providers qualified in this run. Unresponsive providers may still reply — the report updates itself when they do.'
      : `Found ${ranked.length} qualified options, ranked by quality + price.`;
    if (!this.ai.isConfigured()) return fallback;
    try {
      // Everything the run learned (inquiries + sources + threads), packed under the 100k budget.
      const ctx = await this.reportContext.buildAgentContext({ reportId, budgetTokens: AGENT_CONTEXT_BUDGET_TOKENS });
      const result = await this.ai.structured({
        system: synthesisSystem(),
        user: `${buildSynthesisUser({ options: ranked })}\n\n# Research context\n${ctx.text}`,
        tier: ModelTier.Depth,
        validate: (raw) => synthesisSchema.parse(raw),
      });
      return result.summary;
    } catch {
      return fallback; // never fail report delivery on a synthesis hiccup
    }
  }

  /** Deliver a snapshot derived from a prior similar+nearby report's snapshot (reuse). */
  async reuseFrom({ reportId, priorSnapshotId }: { reportId: string; priorSnapshotId: string }) {
    const prior = await this.reports.findById({ id: priorSnapshotId });
    if (!prior) throw new NotFoundError({ code: ErrorCode.SnapshotNotFound, message: 'prior snapshot not found' });
    return this.prisma.$transaction(async (tx) => {
      const snapshot = await this.reports.create({
        data: {
          reportId,
          token: randomBytes(20).toString('hex'),
          summary: `Reused a prior report for a similar nearby request. ${prior.summary}`,
          options: prior.options as Prisma.InputJsonValue,
          timeline: { generatedAt: new Date().toISOString(), reusedFrom: priorSnapshotId },
          reusedFrom: priorSnapshotId,
        },
        tx,
      });
      await this.outbox.emit({ type: EventType.SnapshotReady, reportId, data: { snapshotToken: snapshot.token, reused: true, reusedFrom: priorSnapshotId }, tx });
      return snapshot;
    });
  }

  async getByToken({ token, viewer }: { token: string; viewer: OwnershipViewer }) {
    const snapshot = await this.reports.findByToken({ token });
    if (!snapshot) throw new NotFoundError({ code: ErrorCode.SnapshotNotFound, message: 'report not found' });
    // HP-24: resolve the token within the owner's scope — non-owner → same 404 (no leak).
    const report = await this.reports.findReport({ id: snapshot.reportId });
    if (!report || !ownsResource({ resource: report, viewer })) throw new NotFoundError({ code: ErrorCode.SnapshotNotFound, message: 'report not found' });
    // HP-21: redact a free + locked report's options (top withheld) until unlocked.
    // The AI summary names providers/prices — it reveals the whole verdict, so it
    // is withheld behind the unlock too.
    if (snapshot.freemium && !snapshot.unlocked) {
      const ranked = (snapshot.options ?? []) as unknown as RankedOption[];
      const { options, lockedCount } = redactFreemium(ranked);
      return { ...snapshot, options, freemium: true, unlocked: false, lockedCount, summary: lockedSummary({ total: ranked.length }) };
    }
    return { ...snapshot, lockedCount: 0 };
  }

  /**
   * HP-21 — unlock a freemium report: charge 1 credit (HP-19 ledger), reveal all
   * options, and emit `snapshot.updated`. Owner/admin only (404 otherwise — no leak);
   * **402** when out of credits; **idempotent** (already unlocked → no re-charge); audited.
   */
  async unlock({ snapshotId, viewer }: { snapshotId: string; viewer: { sub: string; email: string; role: string } }): Promise<{ id: string; unlocked: boolean; balance: number }> {
    const snapshot = await this.reports.findById({ id: snapshotId });
    if (!snapshot) throw new NotFoundError({ code: ErrorCode.SnapshotNotFound, message: 'report not found' });
    const report = await this.reports.findReport({ id: snapshot.reportId });
    if (!report) throw new NotFoundError({ code: ErrorCode.SnapshotNotFound, message: 'report not found' });
    const isOwner = viewer.role === 'admin' || report.customerId === viewer.sub || report.customerEmail === viewer.email;
    if (!isOwner) throw new NotFoundError({ code: ErrorCode.SnapshotNotFound, message: 'report not found' });

    if (snapshot.unlocked) {
      const balance = await this.credits.balance({ customerId: report.customerId ?? viewer.sub });
      return { id: snapshotId, unlocked: true, balance }; // idempotent — no re-charge, no re-emit
    }

    // NOTE: deliberately NOT wrapped in a single $transaction. `chargeUnlock` owns its
    // own transaction with P2002 race-recovery (concurrent unlock → already-charged);
    // an outer tx would abort on that P2002 and defeat the recovery. Both steps are
    // idempotent (charge keyed by (reportId,unlock); setUnlocked sets a flag), so a
    // mid-way failure is safely re-runnable by the caller without double-charging.
    const customerId = report.customerId ?? viewer.sub;
    const { balance } = await this.credits.chargeUnlock({ customerId, reportId: snapshot.reportId, actor: viewer.email });
    await this.reports.setUnlocked({ id: snapshotId });
    await this.audit.record({ actor: viewer.email, action: AuditAction.UnlockReport, targetType: AuditTargetType.Report, targetId: snapshot.reportId, data: { snapshotId } });
    const fullOptions = (snapshot.options ?? []) as unknown as RankedOption[];
    await this.outbox.emit({ type: EventType.SnapshotUpdated, reportId: snapshot.reportId, data: { snapshotToken: snapshot.token, unlocked: true, options: fullOptions.length } });
    return { id: snapshotId, unlocked: true, balance };
  }

  /**
   * HP-20 — customer-safe provenance for one option (by subjectProvider `ref`). Built
   * from the option finding + subject-provider background + the inquiry's outreach
   * facts, then ranked. The outreach block carries the **full email chain**
   * (direction + body + timestamp) — the customer sees the conversation as it
   * happened; only relay addresses/message ids stay internal. Owner/admin access
   * is enforced at the edge.
   */
  async provenance({ reportId, ref }: { reportId: string; ref: string }): Promise<ProvenanceDto> {
    const findings = await this.reports.findFindings({ reportId, kinds: [FindingKind.Option, FindingKind.SubjectProviderBackground] });
    const ranked = assembleOptions(findings);
    const idx = ranked.findIndex((o) => o.subjectProvider === ref);
    if (idx === -1) throw new NotFoundError({ code: ErrorCode.SnapshotNotFound, message: 'option not found' });
    const opt = ranked[idx];

    const optionFinding = findings.find((f) => f.kind === FindingKind.Option && String((f.data as Record<string, unknown>)?.subjectProvider) === ref);
    const inquiry = optionFinding?.inquiryId ? await this.reports.findInquiryById({ id: optionFinding.inquiryId }) : null;
    // Use the *raw* background finding (the compacted option.background drops themes/quotes/sentiment).
    const bgFinding = findings.find((f) => f.kind === FindingKind.SubjectProviderBackground && f.inquiryId === optionFinding?.inquiryId);
    const bg = { ...((bgFinding?.data as Record<string, unknown>) ?? {}), ...((inquiry?.background as Record<string, unknown>) ?? {}) } as Record<string, unknown>;

    const web = toRecordArray(bg.sources).map((s) => ({
      source: String(s.source ?? s.title ?? 'web'),
      url: String(s.url ?? ''),
      snippet: String(s.snippet ?? s.summary ?? ''),
    }));
    const themes = toStringArray(bg.themes);
    const quotes = toStringArray(bg.quotes);
    const status = inquiry?.status ?? '';
    const contacted = status === InquiryStatus.Contacted || status === InquiryStatus.Replied || status === InquiryStatus.Qualified;
    const hasFeedback = bg.rating != null || themes.length > 0;

    const feedback = { rating: num(bg.rating), sentiment: num(bg.sentiment), themes, quotes };
    const scoring = { feedbackScore: round3(opt.qualityScore), priceScore: round3(opt.priceScore), blendedScore: round3(opt.score), rank: idx + 1 };
    const outcome = outreachOutcomeFor(status);
    const owner = await this.reports.findReport({ id: reportId }); // persona lives on the report (one voice per report)
    // The conversation as it happened (no addresses/ids — findMessages selects direction/body/time only).
    const msgs = optionFinding?.inquiryId ? await this.reports.findMessages({ inquiryId: optionFinding.inquiryId }) : [];
    const chain = msgs.map((m) => ({ direction: m.direction, body: m.body, at: m.createdAt.toISOString() }));

    // AI transparency summaries (best-effort; the dossier still renders without them).
    const summaries = await this.summarizeProvenance({
      provider: ref, reportId, inquiryId: optionFinding?.inquiryId ?? null,
      web, feedback, scoring, outcome, rank: idx + 1, totalOptions: ranked.length,
      price: { amount: typeof opt.price === 'number' ? opt.price : null, currency: opt.currency ?? null },
    });

    return {
      web,
      feedback,
      scoring,
      outreach: { persona: owner?.personaId ?? 'inqi', route: 'via inqi', outcome, chain },
      depth: contacted ? ProvenanceDepth.WebOutreachFeedback : hasFeedback ? ProvenanceDepth.WebFeedback : ProvenanceDepth.WebOnly,
      researchPending: inquiry?.researchPending ?? false,
      summaries,
    };
  }

  /** One DEPTH call → a short transparency summary per evaluation section (best-effort). */
  private async summarizeProvenance(ctx: {
    provider: string; reportId: string; inquiryId: string | null;
    web: { source: string; url: string; snippet: string }[];
    feedback: { rating: number; sentiment: number; themes: string[]; quotes: string[] };
    scoring: { feedbackScore: number; priceScore: number; blendedScore: number; rank: number };
    outcome: string; rank: number; totalOptions: number; price: { amount: number | null; currency: string | null };
  }): Promise<ProvenanceSummaries | undefined> {
    try {
      if (!this.ai?.isConfigured?.()) return undefined;
      const report = await this.reports.findReport({ id: ctx.reportId });
      const msgs = ctx.inquiryId ? await this.reports.findMessages({ inquiryId: ctx.inquiryId }) : [];
      const outbound = msgs.find((m) => m.direction === MessageDirection.Outbound);
      const inbound = msgs.find((m) => m.direction === MessageDirection.Inbound);
      const responseMinutes = outbound && inbound ? Math.max(0, Math.round((inbound.createdAt.getTime() - outbound.createdAt.getTime()) / 60_000)) : null;

      const input: ProvenanceSummaryInput = {
        provider: ctx.provider, request: report?.rawRequest ?? '', rank: ctx.rank, totalOptions: ctx.totalOptions,
        web: ctx.web, feedback: ctx.feedback, scoring: { feedbackScore: ctx.scoring.feedbackScore, priceScore: ctx.scoring.priceScore, blendedScore: ctx.scoring.blendedScore },
        price: ctx.price,
        outreach: { outcome: ctx.outcome, responseMinutes, reply: inbound?.body ?? null },
      };
      const r = await this.ai.structured({
        system: provenanceSummarySystem(), user: buildProvenanceSummaryUser(input), tier: ModelTier.Depth,
        validate: (raw) => provenanceSummarySchema.parse(raw),
      });
      return { web: r.web ?? '', outreach: r.outreach ?? '', feedback: r.feedback ?? '', ranking: r.ranking ?? '' };
    } catch {
      return undefined; // never fail the dossier on a summary hiccup
    }
  }

  /**
   * Live report read (HP-08): assemble the ranked options from Findings *at any
   * point* during the run — the customer sees options appear + re-rank before the
   * snapshot exists. Once delivered/reused, return the persisted snapshot's summary
   * + token so the live view matches the final report. The frontend layers the
   * realtime event stream on top of this for the live timeline.
   */
  async live({ reportId, viewer }: { reportId: string; viewer: OwnershipViewer }): Promise<LiveReport> {
    const report = await this.reports.findReport({ id: reportId });
    if (!report) throw new NotFoundError({ code: ErrorCode.SnapshotNotFound, message: 'report not found' });
    // HP-24: owner/admin only — a non-owner gets the same 404 (no existence leak).
    if (!ownsResource({ resource: report, viewer })) throw new NotFoundError({ code: ErrorCode.SnapshotNotFound, message: 'report not found' });
    const findings = await this.reports.findFindings({ reportId, kinds: [FindingKind.Option, FindingKind.SubjectProviderBackground] });
    const ranked = assembleOptions(findings);
    const snapshot = await this.reports.findSnapshotByReport({ reportId });
    const delivered = report.state === ReportState.REPORT_DELIVERED;
    // HP-21: a free + locked report is redacted on read until unlocked.
    const locked = !!snapshot?.freemium && !snapshot?.unlocked;
    const redaction = locked ? redactFreemium(ranked) : null;
    // HP-23: qualified count = the assembled (pre-redaction) options; drives the stage.
    const qualifiedCount = ranked.length;
    const stage = deriveStage({ state: report.state, qualifiedCount });
    // While awaiting scope confirmation, surface the questionnaire token so the owner's
    // report view (/i/:id) can route to the questions + confirm form.
    const questionnaireToken = stage === ReportStage.Questionnaire ? await this.reports.findPendingQuestionnaireToken({ reportId }) : null;
    // The answered scope, read-only, so the report can show what the customer confirmed.
    const q = await this.reports.findQuestionnaire({ reportId });
    const questionnaire: LiveReport['questionnaire'] = q
      ? { questions: (q.questions ?? []) as unknown as QuestionnaireQuestion[], answers: (q.answers ?? null) as unknown as Record<string, string> | null, confirmed: q.confirmed }
      : null;
    return {
      reportId,
      personaId: report.personaId ?? null,
      state: report.state,
      stage,
      qualifiedCount,
      questionnaireToken,
      questionnaire,
      delivered,
      rawRequest: report.rawRequest,
      snapshotId: snapshot?.id ?? null,
      snapshotToken: snapshot?.token ?? null,
      reusedFrom: snapshot?.reusedFrom ?? null,
      // HP-21: the real summary names providers/prices — withheld while locked.
      summary: locked ? lockedSummary({ total: ranked.length }) : snapshot?.summary ?? `Research in progress — ${ranked.length} option(s) so far.`,
      options: (redaction ? redaction.options : ranked) as RankedOption[],
      freemium: !!snapshot?.freemium,
      unlocked: !!snapshot?.unlocked,
      lockedCount: redaction?.lockedCount ?? 0,
    };
  }
}

/** Live-report read shape (HP-08): the same ranked options the snapshot uses, plus run state. */
export interface LiveReport {
  reportId: string;
  personaId: string | null;
  state: string;
  stage: string;
  qualifiedCount: number;
  questionnaireToken: string | null;
  questionnaire: { questions: QuestionnaireQuestion[]; answers: Record<string, string> | null; confirmed: boolean } | null;
  delivered: boolean;
  rawRequest: string;
  snapshotId: string | null;
  snapshotToken: string | null;
  reusedFrom: string | null;
  summary: string;
  options: RankedOption[];
  freemium: boolean;
  unlocked: boolean;
  lockedCount: number;
}
