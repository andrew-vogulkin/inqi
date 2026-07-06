import { Injectable, Logger } from '@nestjs/common';
import { EpicStatus, EventType, InquiryStatus, QueueJob, WorkflowEvent } from '@inqi/shared';
import { BossService } from '../../infra/queue/boss.service';
import { OutboxService } from '../../infra/events/outbox.service';
import { ConflictError } from '../../common/errors';
import { WorkflowEngine } from './workflow-engine.service';
import { OrchestratorRepository } from './orchestrator.repository';

/**
 * Wave release + outreach completion, shared by the agentic reactor
 * (OrchestratorService) and funnel assembly (AssembleFunnelService in
 * domain/phases) — extracted so both can drive outreach without a module cycle.
 */
@Injectable()
export class OutreachControlService {
  private readonly logger = new Logger(OutreachControlService.name);

  constructor(
    private readonly repo: OrchestratorRepository,
    private readonly boss: BossService,
    private readonly outbox: OutboxService,
    private readonly wf: WorkflowEngine,
  ) {}

  /**
   * Mark a wave's pending inquiries released, emit wave.released, and enqueue their
   * outreach. Idempotent: `claimWave` atomically records the wave on the epic, so a
   * re-delivered InquirySettled (pg-boss is at-least-once) can never double-release
   * a wave (= double-send).
   */
  async releaseWave({ reportId, epicId, wave, priority }: { reportId: string; epicId: string; wave: number; priority: number }): Promise<void> {
    if (!(await this.repo.claimWave({ epicId, wave }))) {
      this.logger.debug(`wave ${wave} already released for epic ${epicId} — skipping (idempotent)`);
      return;
    }
    const subs = await this.repo.findPendingInquiries({ epicId, waves: [wave] });
    for (const s of subs) {
      await this.repo.updateInquiry({ id: s.id, data: { status: InquiryStatus.Researching } });
      await this.outbox.emit({ type: EventType.InquiryUpdated, reportId, epicId, inquiryId: s.id, data: { status: InquiryStatus.Researching, wave } });
      await this.boss.enqueue({ job: QueueJob.OutreachInquiry, data: { reportId, inquiryId: s.id }, options: { priority: 10 - priority } });
    }
    if (subs.length) await this.outbox.emit({ type: EventType.WaveReleased, reportId, epicId, data: { wave, count: subs.length } });
  }

  /**
   * Advance OUTREACH_DONE → report generation; tolerate a lost race (already
   * advanced). First, retire any un-released (still-pending) inquiries to `skipped`
   * — a terminal state distinct from `failed` — so the board isn't perpetually
   * pending and the reaper never tries to revive a wave we stopped early.
   */
  async finishOutreach({ reportId }: { reportId: string }): Promise<void> {
    const epic = await this.repo.findLatestEpic({ reportId });
    const pending = await this.repo.findPendingInquiries({ epicId: epic.id, waves: undefined });
    for (const s of pending) {
      await this.repo.updateInquiry({ id: s.id, data: { status: InquiryStatus.Skipped } });
      await this.outbox.emit({ type: EventType.InquiryUpdated, reportId, epicId: epic.id, inquiryId: s.id, data: { status: InquiryStatus.Skipped, wave: s.wave } });
    }
    await this.repo.setEpicStatus({ epicId: epic.id, status: EpicStatus.Done });
    try {
      await this.wf.advance({ reportId, event: WorkflowEvent.OUTREACH_DONE });
    } catch (e) {
      if (!(e instanceof ConflictError)) throw e;
    }
  }
}
