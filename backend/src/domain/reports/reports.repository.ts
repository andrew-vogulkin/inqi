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
    return this.db.inquiry.findUnique({ where: { id }, select: { id: true, state: true, rawRequest: true } });
  }

  findReportByInquiry({ inquiryId }: { inquiryId: string }) {
    return this.db.report.findUnique({ where: { inquiryId } });
  }
}
