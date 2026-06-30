import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AgentRunStatus, SubtaskStatus } from '@inqi/shared';
import { DbTx, PrismaService } from '../../infra/persistence/prisma.service';

/** Thin data-access for orchestrator pipeline stages (inquiry + epic + subtask writes). */
@Injectable()
export class OrchestratorRepository {
  constructor(private readonly db: PrismaService) {}

  /** Resolve the executor: a passed-in transaction, or the root client (auto-commit). */
  private exec(tx?: DbTx): DbTx {
    return tx ?? this.db;
  }

  findInquiry({ id, tx }: { id: string; tx?: DbTx }) {
    return this.exec(tx).inquiry.findUniqueOrThrow({ where: { id } });
  }

  findSubject({ inquiryId, tx }: { inquiryId: string; tx?: DbTx }) {
    return this.exec(tx).subject.findUnique({ where: { inquiryId } });
  }

  updateInquiry({ id, data, tx }: { id: string; data: Prisma.InquiryUncheckedUpdateInput; tx?: DbTx }) {
    return this.exec(tx).inquiry.update({ where: { id }, data });
  }

  createEpic({ data, tx }: { data: Prisma.EpicUncheckedCreateInput; tx?: DbTx }) {
    return this.exec(tx).epic.create({ data });
  }

  findLatestEpic({ inquiryId, tx }: { inquiryId: string; tx?: DbTx }) {
    return this.exec(tx).epic.findFirstOrThrow({ where: { inquiryId }, orderBy: { createdAt: 'desc' } });
  }

  createSubtask({ data, tx }: { data: Prisma.SubtaskUncheckedCreateInput; tx?: DbTx }) {
    return this.exec(tx).subtask.create({ data });
  }

  /** Pending subtasks for an epic, optionally restricted to specific waves (omit `waves` for all). */
  findPendingSubtasks({ epicId, waves, tx }: { epicId: string; waves?: number[]; tx?: DbTx }) {
    return this.exec(tx).subtask.findMany({
      where: { epicId, status: SubtaskStatus.Pending, ...(waves ? { wave: { in: waves } } : {}) },
    });
  }

  findEpicWithSubtasks({ epicId, tx }: { epicId: string; tx?: DbTx }) {
    return this.exec(tx).epic.findUniqueOrThrow({ where: { id: epicId }, include: { subtasks: true } });
  }

  updateSubtask({ id, data, tx }: { id: string; data: Prisma.SubtaskUncheckedUpdateInput; tx?: DbTx }) {
    return this.exec(tx).subtask.update({ where: { id }, data });
  }

  createFinding({ data, tx }: { data: Prisma.FindingUncheckedCreateInput; tx?: DbTx }) {
    return this.exec(tx).finding.create({ data });
  }

  // --- HP-09: agent-run liveness (reaper + retry bookkeeping) ---

  /** All currently-running runs (the reaper filters these by expired lease). */
  findRunningRuns({ tx }: { tx?: DbTx } = {}) {
    return this.exec(tx).agentRun.findMany({ where: { status: AgentRunStatus.Running } });
  }

  /** How many times this stage has run for the inquiry (= attempt count). */
  countAgentRuns({ inquiryId, stage, tx }: { inquiryId: string; stage: string; tx?: DbTx }) {
    return this.exec(tx).agentRun.count({ where: { inquiryId, stage } });
  }

  /** Mark a stuck run failed (used by the reaper before it recovers the inquiry). */
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
