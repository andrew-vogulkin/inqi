import { Inject, Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { Prisma } from '@prisma/client';
import { EventType, FindingKind, InquiryState, ModelTier } from '@inqi/shared';
import { OutboxService } from '../../infra/events/outbox.service';
import { AI_PROVIDER, AiProvider } from '../../infra/ai/ai.tokens';
import { ErrorCode, NotFoundError } from '../../common/errors';
import { ReportsRepository } from './reports.repository';
import { rankOptions, RankableOption, RankedOption } from './ranking';
import { SYNTHESIS_SYSTEM, buildSynthesisUser, synthesisSchema } from './synthesis.prompt';

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
    const report = await this.reports.create({
      data: {
        inquiryId,
        token: randomBytes(20).toString('hex'),
        summary,
        options: ranked as unknown as Prisma.InputJsonValue,
        timeline: { generatedAt: new Date().toISOString() },
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
    return report;
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
    const options = assembleOptions(findings);
    const snapshot = await this.reports.findReportByInquiry({ inquiryId });
    const delivered = inquiry.state === InquiryState.REPORT_DELIVERED;
    return {
      inquiryId,
      state: inquiry.state,
      delivered,
      rawRequest: inquiry.rawRequest,
      reportToken: snapshot?.token ?? null,
      reusedFrom: snapshot?.reusedFrom ?? null,
      summary: snapshot?.summary ?? `Research in progress — ${options.length} option(s) so far.`,
      options,
    };
  }
}

/** Live-report read shape (HP-08): the same ranked options the snapshot uses, plus run state. */
export interface LiveReport {
  inquiryId: string;
  state: string;
  delivered: boolean;
  rawRequest: string;
  reportToken: string | null;
  reusedFrom: string | null;
  summary: string;
  options: RankedOption[];
}
