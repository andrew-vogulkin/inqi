import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { FindingKind } from '@inqi/shared';
import { DbTx, PrismaService } from '../../infra/persistence/prisma.service';

/** Thin data-access for subject-provider background research. */
@Injectable()
export class SubjectProvidersRepository {
  constructor(private readonly db: PrismaService) {}

  /** Resolve the executor: a passed-in transaction, or the root client (auto-commit). */
  private exec(tx?: DbTx): DbTx {
    return tx ?? this.db;
  }

  findInquiry({ id, tx }: { id: string; tx?: DbTx }) {
    return this.exec(tx).inquiry.findUniqueOrThrow({ where: { id } });
  }

  /** The report's enriched subject — context for the depth agent's judgement. */
  findSubjectByReport({ reportId, tx }: { reportId: string; tx?: DbTx }) {
    return this.exec(tx).subject.findUnique({ where: { reportId }, select: { title: true, description: true } });
  }

  /** Just the workflow state — decides whether a late verdict must refresh the delivered snapshot. */
  findReportState({ id, tx }: { id: string; tx?: DbTx }) {
    return this.exec(tx).report.findUnique({ where: { id }, select: { state: true } });
  }

  /** The customer's ranking priority (SearchFocus) — steers the depth prompts. */
  findReportFocus({ id, tx }: { id: string; tx?: DbTx }) {
    return this.exec(tx).report.findUnique({ where: { id }, select: { focus: true } });
  }

  /** Persist the depth verdict and clear `researchPending` — the queue holds no more research work for this inquiry. */
  updateBackground({ id, background, qualityScore, tx }: { id: string; background: Prisma.InputJsonValue; qualityScore: number; tx?: DbTx }) {
    return this.exec(tx).inquiry.update({ where: { id }, data: { background, qualityScore, researchPending: false } });
  }

  createFinding({ data, tx }: { data: Prisma.FindingUncheckedCreateInput; tx?: DbTx }) {
    return this.exec(tx).finding.create({ data });
  }

  /** Research settlement: flip the inquiry's status + parsed result in one write. */
  updateInquiryStatus({ id, status, result, tx }: { id: string; status: string; result?: Prisma.InputJsonValue; tx?: DbTx }) {
    return this.exec(tx).inquiry.update({ where: { id }, data: { status, ...(result !== undefined ? { result } : {}) } });
  }

  /** The inquiry's Option finding, if one exists (idempotency guard for research/reply races). */
  findOptionFinding({ inquiryId, tx }: { inquiryId: string; tx?: DbTx }) {
    return this.exec(tx).finding.findFirst({ where: { inquiryId, kind: FindingKind.Option } });
  }
}
