import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AgentRunStatus, SubtaskStatus } from '@inqi/shared';
import { PrismaService } from '../../infra/persistence/prisma.service';

/** Thin data-access for orchestrator pipeline stages (inquiry + epic + subtask writes). */
@Injectable()
export class OrchestratorRepository {
  constructor(private readonly db: PrismaService) {}

  findInquiry({ id }: { id: string }) {
    return this.db.inquiry.findUniqueOrThrow({ where: { id } });
  }

  findSubject({ inquiryId }: { inquiryId: string }) {
    return this.db.subject.findUnique({ where: { inquiryId } });
  }

  updateInquiry({ id, data }: { id: string; data: Prisma.InquiryUncheckedUpdateInput }) {
    return this.db.inquiry.update({ where: { id }, data });
  }

  createEpic({ data }: { data: Prisma.EpicUncheckedCreateInput }) {
    return this.db.epic.create({ data });
  }

  findLatestEpic({ inquiryId }: { inquiryId: string }) {
    return this.db.epic.findFirstOrThrow({ where: { inquiryId }, orderBy: { createdAt: 'desc' } });
  }

  createSubtask({ data }: { data: Prisma.SubtaskUncheckedCreateInput }) {
    return this.db.subtask.create({ data });
  }

  /** Pending subtasks for an epic, optionally restricted to specific waves (omit `waves` for all). */
  findPendingSubtasks({ epicId, waves }: { epicId: string; waves?: number[] }) {
    return this.db.subtask.findMany({
      where: { epicId, status: SubtaskStatus.Pending, ...(waves ? { wave: { in: waves } } : {}) },
    });
  }

  findEpicWithSubtasks({ epicId }: { epicId: string }) {
    return this.db.epic.findUniqueOrThrow({ where: { id: epicId }, include: { subtasks: true } });
  }

  updateSubtask({ id, data }: { id: string; data: Prisma.SubtaskUncheckedUpdateInput }) {
    return this.db.subtask.update({ where: { id }, data });
  }

  createFinding({ data }: { data: Prisma.FindingUncheckedCreateInput }) {
    return this.db.finding.create({ data });
  }

  // --- HP-09: agent-run liveness (reaper + retry bookkeeping) ---

  /** All currently-running runs (the reaper filters these by expired lease). */
  findRunningRuns() {
    return this.db.agentRun.findMany({ where: { status: AgentRunStatus.Running } });
  }

  /** How many times this stage has run for the inquiry (= attempt count). */
  countAgentRuns({ inquiryId, stage }: { inquiryId: string; stage: string }) {
    return this.db.agentRun.count({ where: { inquiryId, stage } });
  }

  /** Mark a stuck run failed (used by the reaper before it recovers the inquiry). */
  failRun({ id, error }: { id: string; error: string }) {
    return this.db.agentRun.update({ where: { id }, data: { status: AgentRunStatus.Failed, error, endedAt: new Date(), leaseUntil: null } });
  }

  /** Atomic, idempotent wave-release marker: appends `wave` to Epic.releasedWaves only if absent. Returns true when it claimed the wave. */
  async claimWave({ epicId, wave }: { epicId: string; wave: number }): Promise<boolean> {
    const res = await this.db.$executeRawUnsafe(
      `UPDATE "Epic" SET "releasedWaves" = array_append("releasedWaves", $1)
       WHERE id = $2 AND NOT ($1 = ANY("releasedWaves"))`,
      wave, epicId,
    );
    return res === 1;
  }

  setEpicStatus({ epicId, status }: { epicId: string; status: string }) {
    return this.db.epic.update({ where: { id: epicId }, data: { status } });
  }
}
