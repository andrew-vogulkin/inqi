import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AgentStage, ConvState, EventType, FindingKind, ModelTier, QueueJob, InquiryStatus, ReportState, UsageKind } from '@inqi/shared';
import { BossService } from '../../infra/queue/boss.service';
import { OutboxService } from '../../infra/events/outbox.service';
import { PrismaService } from '../../infra/persistence/prisma.service';
import { ActivityService } from '../../infra/observability/activity.service';
import { AI_PROVIDER, AiProvider, ChatMsg, ChatRole } from '../../infra/ai/ai.tokens';
import { UsageService } from '../../infra/usage/usage.service';
import { EmailChannelService, IngestResult } from '../source/email.service';
import { SourcesService } from '../source/sources.service';
import { ReportContextService } from '../report/report-context.service';
import { getPersona } from './personas';
import { AgentRepository } from './agent.repository';
import { ReplyDecision, ReplyIntent } from './agent.types';
import { replyParseSystem, replyParseSchema } from './reply.prompt';

/**
 * The agent: researches an individual subject provider, opens its email thread
 * and carries the conversation (reply loop) to a verdict. Triggered by inquiry
 * creation (outreach_inquiry) and inbound email (process_reply). It is the sole
 * writer of Inquiry status/result; email mechanics live in {@link EmailChannelService}.
 */
@Injectable()
export class AgentService implements OnModuleInit {
  private readonly logger = new Logger(AgentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly agents: AgentRepository,
    private readonly boss: BossService,
    private readonly outbox: OutboxService,
    private readonly activity: ActivityService,
    private readonly outreach: EmailChannelService,
    private readonly sources: SourcesService,
    private readonly reportContext: ReportContextService,
    private readonly usage: UsageService,
    @Inject(AI_PROVIDER) private readonly ai: AiProvider,
  ) {}

  /** Conversation state lives on the inquiry's email Source; no-op if the thread never opened. */
  private async setThreadState({ inquiryId, convState, tx }: { inquiryId: string; convState: ConvState; tx?: Parameters<SourcesService['updateThreadState']>[0]['tx'] }): Promise<void> {
    const thread = await this.sources.findEmailThread({ inquiryId, tx });
    if (thread) await this.sources.updateThreadState({ sourceId: thread.id, convState, tx });
  }

  /** Ingest an inbound email and kick the reply loop (idempotent on Message-ID). */
  async receiveInbound(email: Parameters<EmailChannelService['ingestInbound']>[0]): Promise<IngestResult> {
    const r = await this.outreach.ingestInbound(email);
    if (!r.duplicate) {
      await this.boss.enqueue({ job: QueueJob.ProcessReply, data: { reportId: r.reportId, inquiryId: r.inquiryId } });
    }
    return r;
  }

  async onModuleInit() {
    // 4.1 Per-subject-provider: research, then open the email thread.
    await this.boss.work<{ reportId: string; inquiryId: string }>({
      job: QueueJob.OutreachInquiry,
      handler: (job) => this.runOutreachInquiry(job.data),
    });

    // The reply loop: read the chain + epic memory, DEPTH-decide the next action.
    await this.boss.work<{ reportId: string; inquiryId: string }>({
      job: QueueJob.ProcessReply,
      handler: (job) => this.processReply(job.data),
    });
  }

  private async runOutreachInquiry({ reportId, inquiryId }: { reportId: string; inquiryId: string }): Promise<void> {
    await this.activity.runStage({
      reportId, stage: AgentStage.OutreachInquiry,
      fn: async (log) => {
        // The inquiry was already marked researching when its wave was released by the orchestrator.
        const st = await this.agents.findInquiry({ id: inquiryId });

        // DEPTH research + draft, then open the subject-provider email thread.
        const result = await this.outreach.composeAndSend({ reportId, inquiryId });
        if (result.blocked) {
          await this.agents.updateInquiry({ id: inquiryId, data: { status: InquiryStatus.Failed } });
          await this.setThreadState({ inquiryId, convState: ConvState.Closed });
          await this.boss.enqueue({ job: QueueJob.InquirySettled, data: { reportId, epicId: st.epicId } });
          return;
        }
        await this.agents.updateInquiry({ id: inquiryId, data: { status: InquiryStatus.Contacted } });
        await this.setThreadState({ inquiryId, convState: ConvState.AwaitingReply });
        // Depth/background research is enqueued by the orchestrator per created inquiry
        // (funnel build / widen) — not here, so it isn't gated behind outreach waves.
        await log({ message: `Outreach email sent to ${st.name}; awaiting reply` });
      },
    });
  }

  private async processReply({ reportId, inquiryId }: { reportId: string; inquiryId: string }): Promise<void> {
    void this.usage.recordAction({ reportId, kind: UsageKind.ReplyProcessed }); // cost accounting (HP-15)
    const st = await this.agents.findInquiry({ id: inquiryId });
    // Reflect the inbound on the inquiry + its thread source, then decide.
    await this.agents.updateInquiry({ id: inquiryId, data: { status: InquiryStatus.Replied } });
    await this.setThreadState({ inquiryId, convState: ConvState.NeedsAction });

    const chain = await this.outreach.buildChain({ inquiryId });
    const decision = await this.decideReply({ reportId, inquiryId, chain });

    if (decision.intent === ReplyIntent.Continue) {
      // Still negotiating — not a settlement; no reactor signal.
      await this.outreach.sendFollowup({ reportId, inquiryId, body: decision.draft });
      await this.agents.updateInquiry({ id: inquiryId, data: { status: InquiryStatus.Contacted } });
      await this.setThreadState({ inquiryId, convState: ConvState.AwaitingReply });
      return;
    }

    // The settlement is one atomic unit: the inquiry's terminal status, the option
    // finding (qualify) and the realtime event commit or roll back together. The
    // reactor kick is a queue side-effect, enqueued only after the commit.
    await this.prisma.$transaction(async (tx) => {
      await this.setThreadState({ inquiryId, convState: ConvState.Closed, tx });
      if (decision.intent === ReplyIntent.Disqualify || decision.intent === ReplyIntent.Escalate) {
        // Persist WHY on the inquiry (not just the event): report synthesis reads it —
        // an empty report must be able to say "none qualified because …".
        await this.agents.updateInquiry({ id: inquiryId, data: { status: InquiryStatus.Failed, result: { disqualified: decision.reason } as Prisma.InputJsonValue }, tx });
        await this.outbox.emit({ type: EventType.InquiryUpdated, reportId, epicId: st.epicId, inquiryId, data: { name: st.name, status: InquiryStatus.Failed, reason: decision.reason }, tx });
      } else {
        // qualify
        await this.agents.updateInquiry({ id: inquiryId, data: { status: InquiryStatus.Qualified, result: decision.result as Prisma.InputJsonValue }, tx });
        // Dynamic report: one Option finding per inquiry. Research may have qualified
        // it already (email never gates an inquiry) — the provider's actual reply is
        // the better evidence, so it OVERWRITES the web-derived price/availability.
        const existing = await this.agents.findFinding({ inquiryId, kind: FindingKind.Option, tx });
        if (existing) {
          await this.agents.updateFinding({
            id: existing.id,
            data: { ...(existing.data as Record<string, unknown>), ...decision.result, notes: 'confirmed by provider reply' } as Prisma.InputJsonValue,
            tx,
          });
        } else {
          await this.agents.createFinding({
            data: { reportId, epicId: st.epicId, inquiryId, kind: FindingKind.Option, data: { subjectProvider: st.name, ...decision.result } as Prisma.InputJsonValue },
            tx,
          });
        }
        await this.outbox.emit({ type: EventType.InquiryUpdated, reportId, epicId: st.epicId, inquiryId, data: { name: st.name, status: InquiryStatus.Qualified, result: decision.result }, tx });
      }
    });

    // Settled (qualified/failed) → let the agentic orchestrator decide the next move.
    await this.boss.enqueue({ job: QueueJob.InquirySettled, data: { reportId, epicId: st.epicId } });

    // Late reply on a DELIVERED report: a qualify/disqualify changes the option set
    // (scoring inputs moved), so the frozen snapshot must be re-evaluated. A `continue`
    // never reaches here — chit-chat doesn't burn a re-synthesis. singletonKey
    // coalesces a burst of replies into one refresh (+ one report-updated email).
    const report = await this.agents.findReportState({ id: reportId });
    if (report?.state === ReportState.REPORT_DELIVERED) {
      await this.boss.enqueue({ job: QueueJob.RefreshSnapshot, data: { reportId }, options: { singletonKey: `refresh:${reportId}` } });
      this.logger.log(`late reply settled "${st.name}" on delivered report ${reportId} — snapshot refresh enqueued`);
    }
  }

  /**
   * DEPTH model: read the email chain and decide continue | qualify | disqualify,
   * extracting the provider's offer (price + their local currency + availability)
   * straight from the reply text. Falls back to a qualify if the model is
   * unavailable/invalid, so the pipeline still settles.
   */
  private async decideReply({ reportId, inquiryId, chain }: { reportId: string; inquiryId: string; chain: ChatMsg[] }): Promise<ReplyDecision> {
    const transcript = chain
      .map((m) => `${m.role === ChatRole.User ? 'PROVIDER' : 'INQI'}: ${m.content}`)
      .join('\n\n');
    try {
      // Focused report context (this inquiry first) so the decision sees the whole run, budget-capped.
      const ctx = await this.reportContext.buildAgentContext({ reportId, budgetTokens: 50_000, focusInquiryId: inquiryId });
      const p = await this.ai.structured({
        system: replyParseSystem(), user: `${ctx.text}\n\n# Thread\n${transcript}`, tier: ModelTier.Depth,
        validate: (raw) => replyParseSchema.parse(raw),
      });
      if (p.intent === ReplyIntent.Qualify) {
        return { intent: ReplyIntent.Qualify, reason: p.reason, result: { price: p.price, currency: p.currency, availability: p.availability, leadTime: p.leadTime } };
      }
      return { intent: p.intent, reason: p.reason };
    } catch {
      return { intent: ReplyIntent.Qualify, result: { price: null, currency: null, availability: 'available', leadTime: null } };
    }
  }
}
