import { Injectable } from '@nestjs/common';
import { AgentRunStatus, InquiryStatus } from '@inqi/shared';
import type { PhaseRun, Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/persistence/prisma.service';

/** Data access for phase runs + their shadow AgentRun (activity timeline / reaper lease). */
@Injectable()
export class PhaseRunRepository {
  constructor(private readonly db: PrismaService) {}

  create({ data }: { data: { key: string; workflowVersionId: string; state: string; reportId: string; inquiryId?: string | null; data: Prisma.InputJsonValue } }) {
    return this.db.phaseRun.create({ data });
  }

  findById({ id }: { id: string }) {
    return this.db.phaseRun.findUnique({ where: { id } });
  }

  findWithContext({ id }: { id: string }) {
    return this.db.phaseRun.findUnique({ where: { id }, include: { report: true, inquiry: true } });
  }

  /** A live (non-terminal-state) run for the key/report — dedupes duplicate starts. */
  async findActive({ reportId, key, terminalStates, inquiryId }: { reportId: string; key: string; terminalStates: string[]; inquiryId?: string }): Promise<PhaseRun | null> {
    return this.db.phaseRun.findFirst({
      where: { reportId, key, state: { notIn: terminalStates }, ...(inquiryId ? { inquiryId } : {}) },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Optimistic transition commit: only advances if the run is still in `fromState`
   * (pg-boss is at-least-once — a lost race means another delivery already advanced).
   * Returns true when this call won.
   */
  async advanceOptimistic({ id, fromState, toState, data }: { id: string; fromState: string; toState: string; data: Prisma.InputJsonValue }): Promise<boolean> {
    const res = await this.db.phaseRun.updateMany({ where: { id, state: fromState }, data: { state: toState, data, attempts: 0 } });
    return res.count === 1;
  }

  bumpAttempts({ id }: { id: string }) {
    return this.db.phaseRun.update({ where: { id }, data: { attempts: { increment: 1 } } });
  }

  // ---- shadow AgentRun (one per run: activity timeline + reaper lease) ------

  createShadowRun({ reportId, stage, inquiryId, phaseRunId, leaseUntil }: { reportId: string; stage: string; inquiryId?: string | null; phaseRunId: string; leaseUntil: Date }) {
    return this.db.agentRun.create({ data: { reportId, stage, inquiryId, phaseRunId, leaseUntil, heartbeatAt: new Date() } });
  }

  findShadowRun({ phaseRunId }: { phaseRunId: string }) {
    return this.db.agentRun.findFirst({ where: { phaseRunId, status: AgentRunStatus.Running }, orderBy: { startedAt: 'desc' } });
  }

  async heartbeatShadowRun({ phaseRunId, leaseUntil }: { phaseRunId: string; leaseUntil: Date }): Promise<void> {
    await this.db.agentRun.updateMany({ where: { phaseRunId, status: AgentRunStatus.Running }, data: { heartbeatAt: new Date(), leaseUntil } });
  }

  async closeShadowRun({ phaseRunId, status, error }: { phaseRunId: string; status: AgentRunStatus; error?: string }): Promise<void> {
    await this.db.agentRun.updateMany({
      where: { phaseRunId, status: AgentRunStatus.Running },
      data: { status, error: error ?? null, endedAt: new Date(), leaseUntil: null },
    });
  }

  // ---- action helpers -------------------------------------------------------

  /** Depth run died: the inquiry's research debt is settled (never stalls synthesis). */
  async clearResearchPending({ inquiryId }: { inquiryId: string }): Promise<{ reportId: string; epicId: string; status: string }> {
    const inquiry = await this.db.inquiry.update({ where: { id: inquiryId }, data: { researchPending: false } });
    return { reportId: inquiry.reportId, epicId: inquiry.epicId, status: inquiry.status as InquiryStatus };
  }
}
