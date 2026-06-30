import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DbTx, PrismaService } from '../../infra/persistence/prisma.service';

/** Thin data-access for report synthesis (reads epics/subtasks, writes Report). */
@Injectable()
export class ReportsRepository {
  constructor(private readonly db: PrismaService) {}

  /** Resolve the executor: a passed-in transaction, or the root client (auto-commit). */
  private exec(tx?: DbTx): DbTx {
    return tx ?? this.db;
  }

  findEpicsWithSubtasks({ inquiryId, tx }: { inquiryId: string; tx?: DbTx }) {
    return this.exec(tx).epic.findMany({ where: { inquiryId }, include: { subtasks: true } });
  }

  /** Findings the dynamic report assembles options from (option + background). */
  findFindings({ inquiryId, kinds, tx }: { inquiryId: string; kinds: string[]; tx?: DbTx }) {
    return this.exec(tx).finding.findMany({ where: { inquiryId, kind: { in: kinds } }, orderBy: { createdAt: 'asc' } });
  }

  create({ data, tx }: { data: Prisma.ReportUncheckedCreateInput; tx?: DbTx }) {
    return this.exec(tx).report.create({ data });
  }

  findByToken({ token, tx }: { token: string; tx?: DbTx }) {
    return this.exec(tx).report.findUnique({ where: { token } });
  }

  findById({ id, tx }: { id: string; tx?: DbTx }) {
    return this.exec(tx).report.findUnique({ where: { id } });
  }

  findInquiry({ id, tx }: { id: string; tx?: DbTx }) {
    return this.exec(tx).inquiry.findUnique({ where: { id }, select: { id: true, state: true, rawRequest: true, freeReport: true, customerId: true, customerEmail: true } });
  }

  findReportByInquiry({ inquiryId, tx }: { inquiryId: string; tx?: DbTx }) {
    return this.exec(tx).report.findUnique({ where: { inquiryId } });
  }

  /** The capability token for an unconfirmed questionnaire (so the owner's report view can route to it). */
  async findPendingQuestionnaireToken({ inquiryId, tx }: { inquiryId: string; tx?: DbTx }): Promise<string | null> {
    const q = await this.exec(tx).questionnaire.findUnique({ where: { inquiryId }, select: { token: true, confirmed: true } });
    return q && !q.confirmed ? q.token : null;
  }

  /** The questions + answers + confirmed flag (read-only scope, shown on the report). */
  findQuestionnaire({ inquiryId, tx }: { inquiryId: string; tx?: DbTx }) {
    return this.exec(tx).questionnaire.findUnique({ where: { inquiryId }, select: { questions: true, answers: true, confirmed: true } });
  }

  /** HP-21: flip a freemium report to unlocked (full options revealed). */
  setUnlocked({ id, tx }: { id: string; tx?: DbTx }) {
    return this.exec(tx).report.update({ where: { id }, data: { unlocked: true } });
  }

  /** HP-20: a subtask's outreach/quality facts for the redacted provenance read. */
  findSubtaskById({ id, tx }: { id: string; tx?: DbTx }) {
    return this.exec(tx).subtask.findUnique({
      where: { id },
      select: { id: true, status: true, personaId: true, replyAddress: true, background: true, qualityScore: true },
    });
  }

  /** The thread messages for a subtask (for the AI outreach-summary: timing + reply text). */
  findMessages({ subtaskId, tx }: { subtaskId: string; tx?: DbTx }) {
    return this.exec(tx).inquiryMessage.findMany({
      where: { subtaskId },
      orderBy: { createdAt: 'asc' },
      select: { direction: true, body: true, createdAt: true },
    });
  }
}
