import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/persistence/prisma.service';

/** Thin data-access for report synthesis (reads epics/subtasks, writes Report). */
@Injectable()
export class ReportsRepository {
  constructor(private readonly db: PrismaService) {}

  findEpicsWithSubtasks({ inquiryId }: { inquiryId: string }) {
    return this.db.epic.findMany({ where: { inquiryId }, include: { subtasks: true } });
  }

  /** Findings the dynamic report assembles options from (option + background). */
  findFindings({ inquiryId, kinds }: { inquiryId: string; kinds: string[] }) {
    return this.db.finding.findMany({ where: { inquiryId, kind: { in: kinds } }, orderBy: { createdAt: 'asc' } });
  }

  create({ data }: { data: Prisma.ReportUncheckedCreateInput }) {
    return this.db.report.create({ data });
  }

  findByToken({ token }: { token: string }) {
    return this.db.report.findUnique({ where: { token } });
  }

  findById({ id }: { id: string }) {
    return this.db.report.findUnique({ where: { id } });
  }

  findInquiry({ id }: { id: string }) {
    return this.db.inquiry.findUnique({ where: { id }, select: { id: true, state: true, rawRequest: true, freeReport: true, customerId: true, customerEmail: true } });
  }

  findReportByInquiry({ inquiryId }: { inquiryId: string }) {
    return this.db.report.findUnique({ where: { inquiryId } });
  }

  /** The capability token for an unconfirmed questionnaire (so the owner's report view can route to it). */
  async findPendingQuestionnaireToken({ inquiryId }: { inquiryId: string }): Promise<string | null> {
    const q = await this.db.questionnaire.findUnique({ where: { inquiryId }, select: { token: true, confirmed: true } });
    return q && !q.confirmed ? q.token : null;
  }

  /** The questions + answers + confirmed flag (read-only scope, shown on the report). */
  findQuestionnaire({ inquiryId }: { inquiryId: string }) {
    return this.db.questionnaire.findUnique({ where: { inquiryId }, select: { questions: true, answers: true, confirmed: true } });
  }

  /** HP-21: flip a freemium report to unlocked (full options revealed). */
  setUnlocked({ id }: { id: string }) {
    return this.db.report.update({ where: { id }, data: { unlocked: true } });
  }

  /** HP-20: a subtask's outreach/quality facts for the redacted provenance read. */
  findSubtaskById({ id }: { id: string }) {
    return this.db.subtask.findUnique({
      where: { id },
      select: { id: true, status: true, personaId: true, replyAddress: true, background: true, qualityScore: true },
    });
  }

  /** The thread messages for a subtask (for the AI outreach-summary: timing + reply text). */
  findMessages({ subtaskId }: { subtaskId: string }) {
    return this.db.inquiryMessage.findMany({
      where: { subtaskId },
      orderBy: { createdAt: 'asc' },
      select: { direction: true, body: true, createdAt: true },
    });
  }
}
