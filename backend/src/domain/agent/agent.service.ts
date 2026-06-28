import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AgentStage, ConvState, EventType, FindingKind, QueueJob, SubtaskStatus, UsageKind } from '@inqi/shared';
import { BossService } from '../../infra/queue/boss.service';
import { OutboxService } from '../../infra/events/outbox.service';
import { ActivityService } from '../../infra/observability/activity.service';
import { AI_PROVIDER, AiProvider } from '../../infra/ai/ai.tokens';
import { UsageService } from '../../infra/usage/usage.service';
import { OutreachService, IngestResult } from '../outreach/outreach.service';
import { getPersona } from './personas';
import { AgentRepository } from './agent.repository';
import { ReplyDecision, ReplyIntent } from './agent.types';

/**
 * The agent: researches an individual subject provider, opens its email thread
 * and carries the conversation (reply loop) to a verdict. Triggered by subtask
 * creation (outreach_subtask) and inbound email (process_reply). It is the sole
 * writer of Subtask status/result; email mechanics live in {@link OutreachService}.
 */
@Injectable()
export class AgentService implements OnModuleInit {
  constructor(
    private readonly agents: AgentRepository,
    private readonly boss: BossService,
    private readonly outbox: OutboxService,
    private readonly activity: ActivityService,
    private readonly outreach: OutreachService,
    private readonly usage: UsageService,
    @Inject(AI_PROVIDER) private readonly ai: AiProvider,
  ) {}

  /** Ingest an inbound email and kick the reply loop (idempotent on Message-ID). */
  async receiveInbound(email: Parameters<OutreachService['ingestInbound']>[0]): Promise<IngestResult> {
    const r = await this.outreach.ingestInbound(email);
    if (!r.duplicate) {
      await this.boss.enqueue({ job: QueueJob.ProcessReply, data: { inquiryId: r.inquiryId, subtaskId: r.subtaskId } });
    }
    return r;
  }

  async onModuleInit() {
    // 4.1 Per-subject-provider: research, then open the email thread.
    await this.boss.work<{ inquiryId: string; subtaskId: string }>({
      job: QueueJob.OutreachSubtask,
      handler: (job) => this.runOutreachSubtask(job.data),
    });

    // The reply loop: read the chain + epic memory, DEPTH-decide the next action.
    await this.boss.work<{ inquiryId: string; subtaskId: string }>({
      job: QueueJob.ProcessReply,
      handler: (job) => this.processReply(job.data),
    });
  }

  private async runOutreachSubtask({ inquiryId, subtaskId }: { inquiryId: string; subtaskId: string }): Promise<void> {
    await this.activity.runStage({
      inquiryId, stage: AgentStage.OutreachSubtask,
      fn: async (log) => {
        // The subtask was already marked researching when its wave was released by the orchestrator.
        const st = await this.agents.findSubtask({ id: subtaskId });

        // DEPTH research + draft, then open the subject-provider email thread.
        const result = await this.outreach.composeAndSend({ inquiryId, subtaskId });
        if (result.blocked) {
          await this.agents.updateSubtask({ id: subtaskId, data: { status: SubtaskStatus.Failed, convState: ConvState.Closed } });
          await this.boss.enqueue({ job: QueueJob.SubtaskSettled, data: { inquiryId, epicId: st.epicId } });
          return;
        }
        await this.agents.updateSubtask({
          id: subtaskId,
          data: { status: SubtaskStatus.Contacted, convState: ConvState.AwaitingReply, replyAddress: result.replyAddress, personaId: result.personaId },
        });
        // Background/quality research runs in its own job (isolation + orchestrator rate-limiting),
        // in parallel with awaiting the reply. The subject-providers module handles it.
        await this.boss.enqueue({ job: QueueJob.ResearchBackground, data: { inquiryId, subtaskId } });
        await log({ message: `Inquiry email sent to ${st.subjectProviderName}; awaiting reply` });
      },
    });
  }

  private async processReply({ inquiryId, subtaskId }: { inquiryId: string; subtaskId: string }): Promise<void> {
    void this.usage.recordAction({ inquiryId, kind: UsageKind.ReplyProcessed }); // cost accounting (HP-15)
    const st = await this.agents.findSubtask({ id: subtaskId });
    // Reflect the inbound on the subtask, then decide.
    await this.agents.updateSubtask({ id: subtaskId, data: { status: SubtaskStatus.Replied, convState: ConvState.NeedsAction, lastInboundAt: new Date() } });

    const chain = await this.outreach.buildChain({ subtaskId });
    const decision = await this.decideReply({ chain });

    if (decision.intent === ReplyIntent.Continue) {
      // Still negotiating — not a settlement; no reactor signal.
      await this.outreach.sendFollowup({ inquiryId, subtaskId, body: decision.draft });
      await this.agents.updateSubtask({ id: subtaskId, data: { status: SubtaskStatus.Contacted, convState: ConvState.AwaitingReply } });
      return;
    }

    if (decision.intent === ReplyIntent.Disqualify || decision.intent === ReplyIntent.Escalate) {
      await this.agents.updateSubtask({ id: subtaskId, data: { status: SubtaskStatus.Failed, convState: ConvState.Closed } });
      await this.outbox.emit({ type: EventType.SubtaskUpdated, inquiryId, epicId: st.epicId, subtaskId, data: { status: SubtaskStatus.Failed, reason: decision.reason } });
    } else {
      // qualify
      await this.agents.updateSubtask({ id: subtaskId, data: { status: SubtaskStatus.Qualified, convState: ConvState.Closed, result: decision.result as Prisma.InputJsonValue } });
      // Dynamic report: append a finding the report assembles on read. Idempotent —
      // a retried ProcessReply must not append a second option for this subtask.
      const existing = await this.agents.findFinding({ subtaskId, kind: FindingKind.Option });
      if (!existing) {
        await this.agents.createFinding({
          data: { inquiryId, epicId: st.epicId, subtaskId, kind: FindingKind.Option, data: { subjectProvider: st.subjectProviderName, ...decision.result } as Prisma.InputJsonValue },
        });
      }
      await this.outbox.emit({ type: EventType.SubtaskUpdated, inquiryId, epicId: st.epicId, subtaskId, data: { status: SubtaskStatus.Qualified, result: decision.result } });
    }

    // Settled (qualified/failed) → let the agentic orchestrator decide the next move.
    await this.boss.enqueue({ job: QueueJob.SubtaskSettled, data: { inquiryId, epicId: st.epicId } });
  }

  /**
   * DEPTH model decides: continue | qualify | disqualify | escalate (+ optional
   * draft/result). Stubbed to qualify so the demo flows; replace with
   * this.ai.json({ system: REPLY_SYS, user: JSON.stringify(chain), tier: ModelTier.Depth }).
   */
  private async decideReply({ chain: _chain }: { chain: unknown[] }): Promise<ReplyDecision> {
    return {
      intent: ReplyIntent.Qualify,
      result: { price: 100 + Math.floor(Math.random() * 900), currency: 'EUR', availability: 'in stock', leadTime: '1-2w' },
    };
  }
}
