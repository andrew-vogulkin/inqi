import { Inject, Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { Prisma } from '@prisma/client';
import { EventType, FindingKind, InquiryState, ModelTier, SubtaskStatus, ProvenanceDto, ProvenanceDepth, OutreachOutcome, AuditAction, AuditTargetType } from '@inqi/shared';
import { OutboxService } from '../../infra/events/outbox.service';
import { AI_PROVIDER, AiProvider } from '../../infra/ai/ai.tokens';
import { ErrorCode, NotFoundError } from '../../common/errors';
import { CreditsService } from '../credits/credits.service';
import { AuditService } from '../../infra/observability/audit.service';
import { ReportsRepository } from './reports.repository';
import { rankOptions, RankableOption, RankedOption } from './ranking';
import { SYNTHESIS_SYSTEM, buildSynthesisUser, synthesisSchema } from './synthesis.prompt';

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

/** Subtask status → redacted outreach outcome (HP-20). */
function outreachOutcomeFor(status: string): OutreachOutcome {
  if (status === SubtaskStatus.Replied || status === SubtaskStatus.Qualified) return OutreachOutcome.Replied;
  if (status === SubtaskStatus.Contacted || status === SubtaskStatus.Researching) return OutreachOutcome.Pending;
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

/** Minimal finding shape the assembler needs (kind + owning subtask + payload). */
export interface FindingLike {
  kind: string;
  subtaskId: string | null;
  data: unknown;
}

/**
 * Pure dynamic-report assembly: merge `option` findings with their subtask's
 * `subject_provider_background`, then rank by blended quality+price. Shared by the
 * delivery snapshot ({@link ReportsService.generate}) and the live read
 * ({@link ReportsService.live}) so the in-progress view and the final report use
 * the exact same logic — the report is "alive" because it's assembled on read.
 */
export function assembleOptions(findings: FindingLike[]): RankedOption[] {
  const backgroundBySubtask = new Map<string, Record<string, unknown>>();
  for (const f of findings) {
    if (f.kind === FindingKind.SubjectProviderBackground && f.subtaskId) {
      backgroundBySubtask.set(f.subtaskId, (f.data ?? {}) as Record<string, unknown>);
    }
  }
  const rawOptions: RankableOption[] = findings
    .filter((f) => f.kind === FindingKind.Option)
    .map((f) => {
      const d = (f.data ?? {}) as Record<string, unknown>;
      const bg = f.subtaskId ? backgroundBySubtask.get(f.subtaskId) : undefined;
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
export class ReportsService {
  constructor(
    private readonly reports: ReportsRepository,
    private readonly outbox: OutboxService,
    @Inject(AI_PROVIDER) private readonly ai: AiProvider,
    private readonly credits: CreditsService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Assemble options dynamically from Finding rows (option + subject-provider
   * background, merged by subtask), rank them by blended quality+price, snapshot
   * the ranked set into a Report, and publish report.ready.
   */
  async generate({ inquiryId }: { inquiryId: string }) {
    const findings = await this.reports.findFindings({
      inquiryId,
      kinds: [FindingKind.Option, FindingKind.SubjectProviderBackground],
    });
    const ranked = assembleOptions(findings);
    const summary = await this.synthesize({ ranked });
    // HP-21: the free (freemium) report is delivered locked until a 1-credit unlock.
    const inquiry = await this.reports.findInquiry({ id: inquiryId });
    const report = await this.reports.create({
      data: {
        inquiryId,
        token: randomBytes(20).toString('hex'),
        summary,
        options: ranked as unknown as Prisma.InputJsonValue,
        timeline: { generatedAt: new Date().toISOString() },
        freemium: inquiry?.freeReport ?? false,
      },
    });
    await this.outbox.emit({ type: EventType.ReportReady, inquiryId, data: { reportToken: report.token, options: ranked.length } });
    return report;
  }

  /** Synthesize the prose summary (DEPTH tier); falls back to a template when AI is unconfigured or fails. */
  private async synthesize({ ranked }: { ranked: RankedOption[] }): Promise<string> {
    const fallback = `Found ${ranked.length} qualified options, ranked by quality + price.`;
    if (!this.ai.isConfigured() || ranked.length === 0) return fallback;
    try {
      const result = await this.ai.structured({
        system: SYNTHESIS_SYSTEM,
        user: buildSynthesisUser({ options: ranked }),
        tier: ModelTier.Depth,
        validate: (raw) => synthesisSchema.parse(raw),
      });
      return result.summary;
    } catch {
      return fallback; // never fail report delivery on a synthesis hiccup
    }
  }

  /** Deliver a report derived from a prior similar+nearby inquiry's report (reuse). */
  async reuseFrom({ inquiryId, priorReportId }: { inquiryId: string; priorReportId: string }) {
    const prior = await this.reports.findById({ id: priorReportId });
    if (!prior) throw new NotFoundError({ code: ErrorCode.ReportNotFound, message: 'prior report not found' });
    const report = await this.reports.create({
      data: {
        inquiryId,
        token: randomBytes(20).toString('hex'),
        summary: `Reused a prior report for a similar nearby inquiry. ${prior.summary}`,
        options: prior.options as Prisma.InputJsonValue,
        timeline: { generatedAt: new Date().toISOString(), reusedFrom: priorReportId },
        reusedFrom: priorReportId,
      },
    });
    await this.outbox.emit({ type: EventType.ReportReady, inquiryId, data: { reportToken: report.token, reused: true, reusedFrom: priorReportId } });
    return report;
  }

  async getByToken({ token }: { token: string }) {
    const report = await this.reports.findByToken({ token });
    if (!report) throw new NotFoundError({ code: ErrorCode.ReportNotFound, message: 'report not found' });
    // HP-21: redact a free + locked report's options (top withheld) until unlocked.
    if (report.freemium && !report.unlocked) {
      const ranked = (report.options ?? []) as unknown as RankedOption[];
      const { options, lockedCount } = redactFreemium(ranked);
      return { ...report, options, freemium: true, unlocked: false, lockedCount };
    }
    return { ...report, lockedCount: 0 };
  }

  /**
   * HP-21 — unlock a freemium report: charge 1 credit (HP-19 ledger), reveal all
   * options, and emit `report.updated`. Owner/admin only (404 otherwise — no leak);
   * **402** when out of credits; **idempotent** (already unlocked → no re-charge); audited.
   */
  async unlock({ reportId, viewer }: { reportId: string; viewer: { sub: string; email: string; role: string } }): Promise<{ id: string; unlocked: boolean; balance: number }> {
    const report = await this.reports.findById({ id: reportId });
    if (!report) throw new NotFoundError({ code: ErrorCode.ReportNotFound, message: 'report not found' });
    const inquiry = await this.reports.findInquiry({ id: report.inquiryId });
    if (!inquiry) throw new NotFoundError({ code: ErrorCode.ReportNotFound, message: 'report not found' });
    const isOwner = viewer.role === 'admin' || inquiry.customerId === viewer.sub || inquiry.customerEmail === viewer.email;
    if (!isOwner) throw new NotFoundError({ code: ErrorCode.ReportNotFound, message: 'report not found' });

    if (report.unlocked) {
      const balance = await this.credits.balance({ customerId: inquiry.customerId ?? viewer.sub });
      return { id: reportId, unlocked: true, balance }; // idempotent — no re-charge, no re-emit
    }

    const customerId = inquiry.customerId ?? viewer.sub;
    const { balance } = await this.credits.chargeUnlock({ customerId, inquiryId: report.inquiryId, actor: viewer.email });
    await this.reports.setUnlocked({ id: reportId });
    await this.audit.record({ actor: viewer.email, action: AuditAction.UnlockReport, targetType: AuditTargetType.Inquiry, targetId: report.inquiryId, data: { reportId } });
    const fullOptions = (report.options ?? []) as unknown as RankedOption[];
    await this.outbox.emit({ type: EventType.ReportUpdated, inquiryId: report.inquiryId, data: { reportToken: report.token, unlocked: true, options: fullOptions.length } });
    return { id: reportId, unlocked: true, balance };
  }

  /**
   * HP-20 — customer-safe provenance for one option (by subjectProvider `ref`). Built
   * from the option finding + subject-provider background + the subtask's outreach
   * facts, then ranked. The outreach block is **redacted**: persona + a generic relay
   * route + an outcome only — never addresses, bodies, or the message chain (those
   * stay on the admin `/comms/thread`). Owner/admin access is enforced at the edge.
   */
  async provenance({ inquiryId, ref }: { inquiryId: string; ref: string }): Promise<ProvenanceDto> {
    const findings = await this.reports.findFindings({ inquiryId, kinds: [FindingKind.Option, FindingKind.SubjectProviderBackground] });
    const ranked = assembleOptions(findings);
    const idx = ranked.findIndex((o) => o.subjectProvider === ref);
    if (idx === -1) throw new NotFoundError({ code: ErrorCode.ReportNotFound, message: 'option not found' });
    const opt = ranked[idx];

    const optionFinding = findings.find((f) => f.kind === FindingKind.Option && String((f.data as Record<string, unknown>)?.subjectProvider) === ref);
    const subtask = optionFinding?.subtaskId ? await this.reports.findSubtaskById({ id: optionFinding.subtaskId }) : null;
    // Use the *raw* background finding (the compacted option.background drops themes/quotes/sentiment).
    const bgFinding = findings.find((f) => f.kind === FindingKind.SubjectProviderBackground && f.subtaskId === optionFinding?.subtaskId);
    const bg = { ...((bgFinding?.data as Record<string, unknown>) ?? {}), ...((subtask?.background as Record<string, unknown>) ?? {}) } as Record<string, unknown>;

    const web = toRecordArray(bg.sources).map((s) => ({
      source: String(s.source ?? s.title ?? 'web'),
      url: String(s.url ?? ''),
      snippet: String(s.snippet ?? s.summary ?? ''),
    }));
    const themes = toStringArray(bg.themes);
    const quotes = toStringArray(bg.quotes);
    const status = subtask?.status ?? '';
    const contacted = status === SubtaskStatus.Contacted || status === SubtaskStatus.Replied || status === SubtaskStatus.Qualified;
    const hasFeedback = bg.rating != null || themes.length > 0;

    return {
      web,
      feedback: { rating: num(bg.rating), sentiment: num(bg.sentiment), themes, quotes },
      scoring: { feedbackScore: round3(opt.qualityScore), priceScore: round3(opt.priceScore), blendedScore: round3(opt.score), rank: idx + 1 },
      // REDACTED — no addresses/bodies/message ids; just persona + a generic relay + outcome.
      outreach: { persona: subtask?.personaId ?? 'inqi', route: 'via inqi', outcome: outreachOutcomeFor(status) },
      depth: contacted ? ProvenanceDepth.WebOutreachFeedback : hasFeedback ? ProvenanceDepth.WebFeedback : ProvenanceDepth.WebOnly,
    };
  }

  /**
   * Live report read (HP-08): assemble the ranked options from Findings *at any
   * point* during the run — the customer sees options appear + re-rank before the
   * snapshot exists. Once delivered/reused, return the persisted snapshot's summary
   * + token so the live view matches the final report. The frontend layers the
   * realtime event stream on top of this for the live timeline.
   */
  async live({ inquiryId }: { inquiryId: string }): Promise<LiveReport> {
    const inquiry = await this.reports.findInquiry({ id: inquiryId });
    if (!inquiry) throw new NotFoundError({ code: ErrorCode.ReportNotFound, message: 'inquiry not found' });
    const findings = await this.reports.findFindings({ inquiryId, kinds: [FindingKind.Option, FindingKind.SubjectProviderBackground] });
    const ranked = assembleOptions(findings);
    const snapshot = await this.reports.findReportByInquiry({ inquiryId });
    const delivered = inquiry.state === InquiryState.REPORT_DELIVERED;
    // HP-21: a free + locked report is redacted on read until unlocked.
    const locked = !!snapshot?.freemium && !snapshot?.unlocked;
    const redaction = locked ? redactFreemium(ranked) : null;
    return {
      inquiryId,
      state: inquiry.state,
      delivered,
      rawRequest: inquiry.rawRequest,
      reportId: snapshot?.id ?? null,
      reportToken: snapshot?.token ?? null,
      reusedFrom: snapshot?.reusedFrom ?? null,
      summary: snapshot?.summary ?? `Research in progress — ${ranked.length} option(s) so far.`,
      options: (redaction ? redaction.options : ranked) as RankedOption[],
      freemium: !!snapshot?.freemium,
      unlocked: !!snapshot?.unlocked,
      lockedCount: redaction?.lockedCount ?? 0,
    };
  }
}

/** Live-report read shape (HP-08): the same ranked options the snapshot uses, plus run state. */
export interface LiveReport {
  inquiryId: string;
  state: string;
  delivered: boolean;
  rawRequest: string;
  reportId: string | null;
  reportToken: string | null;
  reusedFrom: string | null;
  summary: string;
  options: RankedOption[];
  freemium: boolean;
  unlocked: boolean;
  lockedCount: number;
}
