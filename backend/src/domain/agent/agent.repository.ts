import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DbTx, PrismaService } from '../../infra/persistence/prisma.service';

/** Thin data-access for agent-owned writes: inquiry state + findings. */
@Injectable()
export class AgentRepository {
  constructor(private readonly db: PrismaService) {}

  /** Resolve the executor: a passed-in transaction, or the root client (auto-commit). */
  private exec(tx?: DbTx): DbTx {
    return tx ?? this.db;
  }

  findInquiry({ id, tx }: { id: string; tx?: DbTx }) {
    return this.exec(tx).inquiry.findUniqueOrThrow({ where: { id } });
  }

  updateInquiry({ id, data, tx }: { id: string; data: Prisma.InquiryUncheckedUpdateInput; tx?: DbTx }) {
    return this.exec(tx).inquiry.update({ where: { id }, data });
  }

  createFinding({ data, tx }: { data: Prisma.FindingUncheckedCreateInput; tx?: DbTx }) {
    return this.exec(tx).finding.create({ data });
  }

  /** Existing finding of a kind for an inquiry — guards against duplicate findings on job retries. */
  findFinding({ inquiryId, kind, tx }: { inquiryId: string; kind: string; tx?: DbTx }) {
    return this.exec(tx).finding.findFirst({ where: { inquiryId, kind } });
  }

  /** Enrich a finding in place (a provider reply refining a research-qualified option). */
  updateFinding({ id, data, tx }: { id: string; data: Prisma.InputJsonValue; tx?: DbTx }) {
    return this.exec(tx).finding.update({ where: { id }, data: { data } });
  }

  /** Just the workflow state — decides whether a late reply must refresh the delivered snapshot. */
  findReportState({ id, tx }: { id: string; tx?: DbTx }) {
    return this.exec(tx).report.findUnique({ where: { id }, select: { state: true } });
  }

  /** The customer scope the reply loop answers from: the raw prompt (priority 1) + questionnaire (priority 2). */
  findReportScope({ id, tx }: { id: string; tx?: DbTx }) {
    return this.exec(tx).report.findUniqueOrThrow({
      where: { id },
      select: { rawRequest: true, questionnaire: { select: { questions: true, answers: true, confirmed: true } } },
    });
  }
}
