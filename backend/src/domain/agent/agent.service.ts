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
import { replyEvaluateSystem, replyEvaluateSchema, replyAnswerSystem, replyAnswerSchema, replyDraftCheckSystem, replyDraftCheckSchema } from './reply.prompt';

/**
 * Safety cap for the reply loop: after this many outbound emails on one thread
 * without a sufficient answer, settle with whatever was extracted instead of
 * pestering the provider forever.
 */
const MAX_OUTBOUND_PER_THREAD = 4;

/**
 * Draft attempts in the ANSWER element: each draft is audited (forward progress
 * + topic correlation) before sending; a failing draft is redrafted once with
 * the issues fed back, then the safe canned follow-up ships instead.
 */
const MAX_DRAFT_ATTEMPTS = 2;

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
    if (r.duplicate) return r;
    if (r.blocked) {
      // The reply failed the ethical/legal gate: quarantine THE SOURCE only — the
      // message stays hidden and this channel goes silent (no follow-ups, no reply
      // loop). Verdicts the inquiry already earned (a clean earlier reply, research)
      // are untouched: one bad late reply must not kill a qualified option.
      await this.sources.blockThread({ sourceId: r.sourceId, reason: 'inbound reply blocked by the compliance review' });
      return r;
    }
    // sourceId pins the reply loop to the thread that received the email (an
    // inquiry can hold several channels — sales, booking, …).
    await this.boss.enqueue({ job: QueueJob.ProcessReply, data: { reportId: r.reportId, inquiryId: r.inquiryId, sourceId: r.sourceId } });
    return r;
  }

  async onModuleInit() {
    // 4.1 Per-subject-provider: research, then open the email thread.
    await this.boss.work<{ reportId: string; inquiryId: string }>({
      job: QueueJob.OutreachInquiry,
      handler: (job) => this.runOutreachInquiry(job.data),
    });

    // The reply loop: read the chain + epic memory, DEPTH-decide the next action.
    await this.boss.work<{ reportId: string; inquiryId: string; sourceId?: string }>({
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
        // A settled inquiry can still be emailed (e.g. confirmation outreach to a
        // research-qualified provider) — never downgrade its terminal status.
        const SETTLED: string[] = [InquiryStatus.Qualified, InquiryStatus.Failed, InquiryStatus.Skipped];
        const settled = SETTLED.includes(st.status);
        if (result.blocked) {
          if (!settled) await this.agents.updateInquiry({ id: inquiryId, data: { status: InquiryStatus.Failed } });
          await this.setThreadState({ inquiryId, convState: ConvState.Closed });
          await this.boss.enqueue({ job: QueueJob.InquirySettled, data: { reportId, epicId: st.epicId } });
          return;
        }
        if (!settled) await this.agents.updateInquiry({ id: inquiryId, data: { status: InquiryStatus.Contacted } });
        await this.setThreadState({ inquiryId, convState: ConvState.AwaitingReply });
        // Depth/background research is enqueued by the orchestrator per created inquiry
        // (funnel build / widen) — not here, so it isn't gated behind outreach waves.
        await log({ message: `Outreach email sent to ${st.name}; awaiting reply` });
      },
    });
  }

  private async processReply({ reportId, inquiryId, sourceId }: { reportId: string; inquiryId: string; sourceId?: string }): Promise<void> {
    void this.usage.recordAction({ reportId, kind: UsageKind.ReplyProcessed }); // cost accounting (HP-15)
    const st = await this.agents.findInquiry({ id: inquiryId });
    // Reflect the inbound on the inquiry + the thread that received it, then decide.
    // A settled inquiry keeps its terminal status (a late confirmation must not
    // downgrade qualified → replied while the decision runs).
    const SETTLED: string[] = [InquiryStatus.Qualified, InquiryStatus.Failed, InquiryStatus.Skipped];
    const settled = SETTLED.includes(st.status);
    if (!settled) await this.agents.updateInquiry({ id: inquiryId, data: { status: InquiryStatus.Replied } });
    if (sourceId) await this.sources.updateThreadState({ sourceId, convState: ConvState.NeedsAction });
    else await this.setThreadState({ inquiryId, convState: ConvState.NeedsAction });

    const chain = await this.outreach.buildChain({ inquiryId });
    const decision = await this.decideReply({ reportId, inquiryId, chain });

    if (decision.intent === ReplyIntent.Continue) {
      // Still negotiating — not a settlement; no reactor signal. The follow-up goes
      // to the thread that received the reply (sales vs booking).
      await this.outreach.sendFollowup({ reportId, inquiryId, sourceId, body: decision.draft });
      if (!settled) await this.agents.updateInquiry({ id: inquiryId, data: { status: InquiryStatus.Contacted } });
      if (sourceId) await this.sources.updateThreadState({ sourceId, convState: ConvState.AwaitingReply });
      else await this.setThreadState({ inquiryId, convState: ConvState.AwaitingReply });
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
          // Merge only what the reply actually evidenced — a null extraction (vague reply,
          // thread-cap settle) must never erase previously confirmed price/availability.
          const evidenced = Object.fromEntries(Object.entries(decision.result ?? {}).filter(([, v]) => v != null));
          await this.agents.updateFinding({
            id: existing.id,
            data: { ...(existing.data as Record<string, unknown>), ...evidenced, notes: 'confirmed by provider reply' } as Prisma.InputJsonValue,
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
   * The reply loop as a 2-element decision (DEPTH model):
   *  1. EVALUATE — does the thread now carry the chain target (a concrete cost
   *     estimate + timeline)? Sufficient → qualify with the extracted offer;
   *     declined → disqualify. The source is then evaluated as usual.
   *  2. ANSWER — otherwise the provider asked for more info first: draft the
   *     follow-up answering every question by priority — original search prompt,
   *     then questionnaire, then imagination (a plausible invented detail, kept
   *     consistent for the rest of the thread) — and re-ask for the target.
   * Falls back to a qualify if the model is unavailable/invalid, so the pipeline
   * still settles.
   */
  private async decideReply({ reportId, inquiryId, chain }: { reportId: string; inquiryId: string; chain: ChatMsg[] }): Promise<ReplyDecision> {
    const transcript = chain
      .map((m) => `${m.role === ChatRole.User ? 'PROVIDER' : 'INQI'}: ${m.content}`)
      .join('\n\n');
    try {
      // Focused report context (this inquiry first) so the decision sees the whole run, budget-capped.
      const ctx = await this.reportContext.buildAgentContext({ reportId, budgetTokens: 50_000, focusInquiryId: inquiryId });

      // Loop element 1 — EVALUATE the thread against the chain target.
      const ev = await this.ai.structured({
        system: replyEvaluateSystem(), user: `${ctx.text}\n\n# Thread\n${transcript}`, tier: ModelTier.Depth,
        validate: (raw) => replyEvaluateSchema.parse(raw),
      });
      if (ev.declined) return { intent: ReplyIntent.Disqualify, reason: ev.reason };
      const offer = { price: ev.price, currency: ev.currency, availability: ev.availability, leadTime: ev.leadTime };
      if (ev.sufficient) return { intent: ReplyIntent.Qualify, reason: ev.reason, result: offer };

      // Loop bound: enough outbound attempts — settle on what we have rather than loop forever.
      const outboundCount = chain.filter((m) => m.role === ChatRole.Assistant).length;
      if (outboundCount >= MAX_OUTBOUND_PER_THREAD) {
        this.logger.warn(`reply loop: thread cap (${MAX_OUTBOUND_PER_THREAD} outbound) reached on inquiry ${inquiryId} — settling with the extracted offer`);
        return { intent: ReplyIntent.Qualify, reason: 'thread cap reached without a full quote', result: offer };
      }

      // Loop element 2 — ANSWER by priority: prompt > questionnaire > imagination.
      // Each draft is audited before sending (anti-hallucination iterations):
      // (1) forward progress toward the chain target, (2) topic correlation.
      // A failing draft is redrafted with the issues fed back; when every attempt
      // fails, NO draft ships — sendFollowup's safe canned line asks for the
      // cost estimate + timeline without any room to hallucinate.
      const scope = await this.agents.findReportScope({ id: reportId });
      const scopeAndThread = `${this.scopeBlock(scope)}\n\n# Thread\n${transcript}`;
      let issues: string[] = [];
      for (let attempt = 1; attempt <= MAX_DRAFT_ATTEMPTS; attempt++) {
        const issuesBlock = issues.length ? `\n\n# Reviewer issues with your previous draft — fix ALL of them\n${issues.map((i) => `- ${i}`).join('\n')}` : '';
        const answer = await this.ai.structured({
          system: replyAnswerSystem(),
          user: `${scopeAndThread}${issuesBlock}`,
          tier: ModelTier.Depth,
          validate: (raw) => replyAnswerSchema.parse(raw),
        });
        const check = await this.ai.structured({
          system: replyDraftCheckSystem(),
          user: `${scopeAndThread}\n\n# DRAFT under review\n${answer.body}`,
          tier: ModelTier.Depth,
          validate: (raw) => replyDraftCheckSchema.parse(raw),
        });
        if (check.movesForward && check.onTopic) {
          this.logger.log(`reply loop: follow-up on inquiry ${inquiryId} answered from [${answer.answeredFrom.join(', ') || 'n/a'}] (draft attempt ${attempt} passed review)`);
          return { intent: ReplyIntent.Continue, reason: ev.reason, draft: answer.body };
        }
        issues = check.issues.length ? check.issues : [`forward progress: ${check.movesForward}, topic correlation: ${check.onTopic}`];
        this.logger.warn(`reply loop: draft attempt ${attempt} on inquiry ${inquiryId} failed review — ${issues.join(' | ')}`);
      }
      return { intent: ReplyIntent.Continue, reason: ev.reason }; // no draft → canned safe follow-up
    } catch {
      return { intent: ReplyIntent.Qualify, result: { price: null, currency: null, availability: 'available', leadTime: null } };
    }
  }

  /** The ANSWER step's priority sources, labeled exactly as the prompt names them. */
  private scopeBlock(scope: { rawRequest: string; questionnaire: { questions: unknown; answers: unknown; confirmed: boolean } | null }): string {
    const questions = Array.isArray(scope.questionnaire?.questions)
      ? (scope.questionnaire.questions as { id?: string; prompt?: string }[])
      : [];
    const answers = (scope.questionnaire?.answers ?? {}) as Record<string, string>;
    const qa = Object.entries(answers).map(([qid, a]) => {
      const prompt = questions.find((q) => q.id === qid)?.prompt ?? qid;
      return `- ${prompt}: ${a}`;
    });
    return [
      '# PRIORITY 1 — original search prompt',
      scope.rawRequest,
      '',
      '# PRIORITY 2 — confirmed questionnaire',
      qa.length ? qa.join('\n') : '(none)',
    ].join('\n');
  }
}
