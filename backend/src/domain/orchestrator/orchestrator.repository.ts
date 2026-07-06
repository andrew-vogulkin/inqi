import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AgentRunStatus, InquiryStatus } from '@inqi/shared';
import { DbTx, PrismaService } from '../../infra/persistence/prisma.service';

/** Thin data-access for orchestrator pipeline stages (report + epic + inquiry writes). */
@Injectable()
export class OrchestratorRepository {
  constructor(private readonly db: PrismaService) {}

  /** Resolve the executor: a passed-in transaction, or the root client (auto-commit). */
  private exec(tx?: DbTx): DbTx {
    return tx ?? this.db;
  }

  findReport({ id, tx }: { id: string; tx?: DbTx }) {
    return this.exec(tx).report.findUniqueOrThrow({ where: { id } });
  }

  findSubject({ reportId, tx }: { reportId: string; tx?: DbTx }) {
    return this.exec(tx).subject.findUnique({ where: { reportId } });
  }

  updateReport({ id, data, tx }: { id: string; data: Prisma.ReportUncheckedUpdateInput; tx?: DbTx }) {
    return this.exec(tx).report.update({ where: { id }, data });
  }

  createEpic({ data, tx }: { data: Prisma.EpicUncheckedCreateInput; tx?: DbTx }) {
    return this.exec(tx).epic.create({ data });
  }

  findLatestEpic({ reportId, tx }: { reportId: string; tx?: DbTx }) {
    return this.exec(tx).epic.findFirstOrThrow({ where: { reportId }, orderBy: { createdAt: 'desc' } });
  }

  createInquiry({ data, tx }: { data: Prisma.InquiryUncheckedCreateInput; tx?: DbTx }) {
    return this.exec(tx).inquiry.create({ data });
  }

  /** Pending inquiries for an epic, optionally restricted to specific waves (omit `waves` for all). */
  findPendingInquiries({ epicId, waves, tx }: { epicId: string; waves?: number[]; tx?: DbTx }) {
    return this.exec(tx).inquiry.findMany({
      where: { epicId, status: InquiryStatus.Pending, ...(waves ? { wave: { in: waves } } : {}) },
    });
  }

  findEpicWithInquiries({ epicId, tx }: { epicId: string; tx?: DbTx }) {
    return this.exec(tx).epic.findUniqueOrThrow({ where: { id: epicId }, include: { inquiries: true } });
  }

  updateInquiry({ id, data, tx }: { id: string; data: Prisma.InquiryUncheckedUpdateInput; tx?: DbTx }) {
    return this.exec(tx).inquiry.update({ where: { id }, data });
  }

  /** Contacted inquiries that have heard nothing since `olderThan` — reply-timeout candidates for the reaper. */
  findStaleContactedInquiries({ olderThan, tx }: { olderThan: Date; tx?: DbTx }) {
    return this.exec(tx).inquiry.findMany({
      where: { status: InquiryStatus.Contacted, updatedAt: { lt: olderThan } },
      select: { id: true, name: true, reportId: true, epicId: true },
    });
  }

  /**
   * How many of the report's inquiries still have a depth-research job queued/running.
   * Failed/skipped inquiries are excluded — they never surface as report options, so
   * their late research must not hold report generation back.
   */
  countResearchPending({ reportId, tx }: { reportId: string; tx?: DbTx }) {
    return this.exec(tx).inquiry.count({
      where: { reportId, researchPending: true, status: { notIn: [InquiryStatus.Failed, InquiryStatus.Skipped, InquiryStatus.Unresponsive] } },
    });
  }

  createFinding({ data, tx }: { data: Prisma.FindingUncheckedCreateInput; tx?: DbTx }) {
    return this.exec(tx).finding.create({ data });
  }

  // --- HP-09: agent-run liveness (reaper + retry bookkeeping) ---

  /** All currently-running runs (the reaper filters these by expired lease). */
  findRunningRuns({ tx }: { tx?: DbTx } = {}) {
    return this.exec(tx).agentRun.findMany({ where: { status: AgentRunStatus.Running } });
  }

  /** How many times this stage has run for the report (= attempt count). */
  countAgentRuns({ reportId, stage, tx }: { reportId: string; stage: string; tx?: DbTx }) {
    return this.exec(tx).agentRun.count({ where: { reportId, stage } });
  }

  /** Mark a stuck run failed (used by the reaper before it recovers the report). */
  failRun({ id, error, tx }: { id: string; error: string; tx?: DbTx }) {
    return this.exec(tx).agentRun.update({ where: { id }, data: { status: AgentRunStatus.Failed, error, endedAt: new Date(), leaseUntil: null } });
  }

  /** Atomic, idempotent wave-release marker: appends `wave` to Epic.releasedWaves only if absent. Returns true when it claimed the wave. */
  async claimWave({ epicId, wave, tx }: { epicId: string; wave: number; tx?: DbTx }): Promise<boolean> {
    const res = await this.exec(tx).$executeRawUnsafe(
      `UPDATE "Epic" SET "releasedWaves" = array_append("releasedWaves", $1)
       WHERE id = $2 AND NOT ($1 = ANY("releasedWaves"))`,
      wave, epicId,
    );
    return res === 1;
  }

  setEpicStatus({ epicId, status, tx }: { epicId: string; status: string; tx?: DbTx }) {
    return this.exec(tx).epic.update({ where: { id: epicId }, data: { status } });
  }
}
