import { Injectable, Logger } from '@nestjs/common';
import { BreadthPurpose, QueueJob, WorkflowEvent } from '@inqi/shared';
import type { PhaseRun } from '@prisma/client';
import { BossService } from '../../infra/queue/boss.service';
import { ConflictError } from '../../common/errors';
import { WorkflowEngine } from '../orchestrator/workflow-engine.service';
import { PhaseAction, PhaseGuard } from './phase-graphs';
import { PhaseRunRepository } from './phase-run.repository';

export interface PhaseActionCtx {
  run: PhaseRun;
  /** The state the transition lands in (PhaseStep continuation targets this). */
  toState: string;
}

/** Cycle counters every looping phase keeps in run.data — guards read these. */
interface CycleData {
  cycle?: number;
  maxCycles?: number;
}

/**
 * Named actions + guards referenced by phase transitions (the strings live in
 * {@link PhaseAction}/{@link PhaseGuard} beside the graphs). Actions stay thin —
 * enqueue a job or fire a parent event; anything touching domain services
 * belongs in a step handler.
 */
@Injectable()
export class PhaseRegistryService {
  private readonly logger = new Logger(PhaseRegistryService.name);

  constructor(
    private readonly boss: BossService,
    private readonly reportEngine: WorkflowEngine,
    private readonly repo: PhaseRunRepository,
  ) {}

  /** Guards are pure assertions over run.data. A block = handler bug → the run fails cleanly. */
  runGuard({ name, run }: { name: string; run: PhaseRun }): boolean {
    const data = (run.data ?? {}) as CycleData;
    switch (name) {
      case PhaseGuard.BreadthUnderCycleCap:
      case PhaseGuard.DepthUnderCycleCap:
        return (data.cycle ?? 1) <= (data.maxCycles ?? 1);
      default:
        this.logger.warn(`unknown phase guard "${name}" — blocking`);
        return false;
    }
  }

  async runAction({ name, ctx }: { name: string; ctx: PhaseActionCtx }): Promise<void> {
    switch (name) {
      case PhaseAction.EnqueueStep:
        await this.boss.enqueue({ job: QueueJob.PhaseStep, data: { runId: ctx.run.id, expectedState: ctx.toState } });
        return;
      case PhaseAction.ReportPreResearchPassed:
        return this.advanceReport({ reportId: ctx.run.reportId, event: WorkflowEvent.PRE_RESEARCH_PASSED });
      case PhaseAction.ReportPreResearchDenied:
        return this.advanceReport({ reportId: ctx.run.reportId, event: WorkflowEvent.PRE_RESEARCH_DENIED });
      case PhaseAction.ReportPreResearchFailed:
        return this.advanceReport({ reportId: ctx.run.reportId, event: WorkflowEvent.PRE_RESEARCH_FAILED });
      case PhaseAction.BreadthComplete:
        await this.boss.enqueue({ job: QueueJob.AssembleFunnel, data: { runId: ctx.run.id } });
        return;
      case PhaseAction.BreadthFailed: {
        // Funnel purpose: no candidates → the report's FUNNEL stage failed. Widen
        // purpose degrades: assemble whatever the run gathered (possibly nothing —
        // assembly then finishes outreach with the existing funnel).
        const purpose = ((ctx.run.data ?? {}) as { purpose?: string }).purpose;
        if (purpose === BreadthPurpose.Funnel) return this.advanceReport({ reportId: ctx.run.reportId, event: WorkflowEvent.FUNNEL_FAILED });
        await this.boss.enqueue({ job: QueueJob.AssembleFunnel, data: { runId: ctx.run.id } });
        return;
      }
      case PhaseAction.InquiryResearchFailed: {
        if (!ctx.run.inquiryId) return;
        const { reportId, epicId } = await this.repo.clearResearchPending({ inquiryId: ctx.run.inquiryId });
        await this.boss.enqueue({ job: QueueJob.InquirySettled, data: { reportId, epicId } });
        return;
      }
      default:
        this.logger.warn(`unknown phase action "${name}" — skipping`);
    }
  }

  /** Bridge to the parent report machine; a lost race (already advanced) is benign. */
  private async advanceReport({ reportId, event }: { reportId: string; event: WorkflowEvent }): Promise<void> {
    try {
      await this.reportEngine.advance({ reportId, event });
    } catch (e) {
      if (!(e instanceof ConflictError)) throw e;
      this.logger.debug(`report ${reportId} already moved past ${event} — tolerated`);
    }
  }
}
