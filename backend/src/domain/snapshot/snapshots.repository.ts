import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
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
    return this.exec(tx).report.findUnique({ where: { id }, select: { id: true, state: true, rawRequest: true, freeReport: true, personaId: true, customerId: true, customerEmail: true } });
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
      select: { id: true, status: true, background: true, qualityScore: true, researchPending: true },
    });
  }

  /** The thread messages for an inquiry (for the AI outreach-summary: timing + reply text). */
  findMessages({ inquiryId, tx }: { inquiryId: string; tx?: DbTx }) {
    return this.exec(tx).message.findMany({
      where: { inquiryId },
      orderBy: { createdAt: 'asc' },
      select: { direction: true, body: true, createdAt: true },
    });
  }
}
