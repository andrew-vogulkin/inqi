import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { FindingKind, ReviewStatus } from '@inqi/shared';
import { DbTx, PrismaService } from '../../infra/persistence/prisma.service';

/** Thin data-access for snapshot synthesis (reads epics/inquiries/findings, writes ReportSnapshot). */
@Injectable()
export class SnapshotsRepository {
  constructor(private readonly db: PrismaService) {}

  /** Resolve the executor: a passed-in transaction, or the root client (auto-commit). */
  private exec(tx?: DbTx): DbTx {
    return tx ?? this.db;
  }

  findEpicsWithInquiries({ reportId, tx }: { reportId: string; tx?: DbTx }) {
    return this.exec(tx).epic.findMany({ where: { reportId }, include: { inquiries: true } });
  }

  /** Findings the dynamic report assembles options from (option + background). */
  findFindings({ reportId, kinds, tx }: { reportId: string; kinds: string[]; tx?: DbTx }) {
    return this.exec(tx).finding.findMany({ where: { reportId, kind: { in: kinds } }, orderBy: { createdAt: 'asc' } });
  }

  create({ data, tx }: { data: Prisma.ReportSnapshotUncheckedCreateInput; tx?: DbTx }) {
    return this.exec(tx).reportSnapshot.create({ data });
  }

  findByToken({ token, tx }: { token: string; tx?: DbTx }) {
    return this.exec(tx).reportSnapshot.findUnique({ where: { token } });
  }

  findById({ id, tx }: { id: string; tx?: DbTx }) {
    return this.exec(tx).reportSnapshot.findUnique({ where: { id } });
  }

  findReport({ id, tx }: { id: string; tx?: DbTx }) {
    return this.exec(tx).report.findUnique({ where: { id }, select: { id: true, ref: true, state: true, rawRequest: true, focus: true, freeReport: true, personaId: true, customerId: true, customerEmail: true } });
  }

  findSnapshotByReport({ reportId, tx }: { reportId: string; tx?: DbTx }) {
    return this.exec(tx).reportSnapshot.findUnique({ where: { reportId } });
  }

  /** The capability token for an unconfirmed questionnaire (so the owner's report view can route to it). */
  async findPendingQuestionnaireToken({ reportId, tx }: { reportId: string; tx?: DbTx }): Promise<string | null> {
    const q = await this.exec(tx).questionnaire.findUnique({ where: { reportId }, select: { token: true, confirmed: true } });
    return q && !q.confirmed ? q.token : null;
  }

  /** The questions + answers + confirmed flag (read-only scope, shown on the report). */
  findQuestionnaire({ reportId, tx }: { reportId: string; tx?: DbTx }) {
    return this.exec(tx).questionnaire.findUnique({ where: { reportId }, select: { questions: true, answers: true, confirmed: true } });
  }

  /** HP-21: flip a freemium report to unlocked (full options revealed). */
  setUnlocked({ id, tx }: { id: string; tx?: DbTx }) {
    return this.exec(tx).reportSnapshot.update({ where: { id }, data: { unlocked: true } });
  }

  /** Overwrite a delivered snapshot's content (late-verdict refresh) — token/freemium/unlocked untouched. */
  refreshContent({ id, summary, options, timeline, tx }: { id: string; summary: string; options: Prisma.InputJsonValue; timeline: Prisma.InputJsonValue; tx?: DbTx }) {
    return this.exec(tx).reportSnapshot.update({ where: { id }, data: { summary, options, timeline } });
  }

  /** HP-20: an inquiry's outreach/quality facts for the redacted provenance read. */
  findInquiryById({ id, tx }: { id: string; tx?: DbTx }) {
    return this.exec(tx).inquiry.findUnique({
      where: { id },
      // contact carries the provider's own website/socials — the dossier's carry-it-forward reference.
      select: { id: true, status: true, background: true, qualityScore: true, researchPending: true, contact: true },
    });
  }

  /**
   * The cached AI dossier summary for one option — keyed by inquiry when it has
   * one, else by the option ref stored in the finding data (option without inquiry).
   */
  findProvenanceSummary({ reportId, inquiryId, ref, tx }: { reportId: string; inquiryId: string | null; ref: string; tx?: DbTx }) {
    return this.exec(tx).finding.findFirst({
      where: {
        reportId, kind: FindingKind.ProvenanceSummary,
        ...(inquiryId ? { inquiryId } : { data: { path: ['ref'], equals: ref } }),
      },
    });
  }

  /** Write-through the freshly generated dossier summary (update in place, or first write). */
  saveProvenanceSummary({ id, reportId, epicId, inquiryId, data, tx }: {
    id: string | null; reportId: string; epicId: string; inquiryId: string | null; data: Prisma.InputJsonValue; tx?: DbTx;
  }) {
    if (id) return this.exec(tx).finding.update({ where: { id }, data: { data } });
    return this.exec(tx).finding.create({ data: { reportId, epicId, inquiryId, kind: FindingKind.ProvenanceSummary, data } });
  }

  /**
   * The thread messages for an inquiry (customer provenance + AI outreach-summary).
   * Compliance-blocked messages are excluded — they exist for audit only.
   */
  findMessages({ inquiryId, tx }: { inquiryId: string; tx?: DbTx }) {
    return this.exec(tx).message.findMany({
      where: { inquiryId, reviewStatus: { not: ReviewStatus.Blocked } },
      orderBy: { createdAt: 'asc' },
      // source.data carries the thread's channel label (sales, booking, …).
      // toAddr = the VENDOR's address on outbound mail — customer-safe (it is their
      // counterparty); the relay fromAddr + message ids stay internal.
      select: { direction: true, subject: true, body: true, createdAt: true, toAddr: true, source: { select: { data: true } } },
    });
  }
}
