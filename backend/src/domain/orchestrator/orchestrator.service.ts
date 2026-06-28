import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { AgentStage, AuditAction, AuditTargetType, EventType, FindingKind, InquiryState, ModelTier, NotificationKind, OutreachStrategy, QueueJob, SubtaskStatus, TERMINAL_STATES, WorkflowEvent, failureEventForState } from '@inqi/shared';
import type { Prisma } from '@prisma/client';
import { BossService } from '../../infra/queue/boss.service';
import { OutboxService } from '../../infra/events/outbox.service';
import { ActivityService } from '../../infra/observability/activity.service';
import { AuditService } from '../../infra/observability/audit.service';
import { ConfigService } from '../../infra/config/config.service';
import { UsageContextService } from '../../infra/usage/usage-context.service';
import { decideReaperAction, findStuckRuns, retryBackoffSeconds } from '../../infra/observability/reaper.logic';
import { AI_PROVIDER, AiProvider } from '../../infra/ai/ai.tokens';
import { EnrichedSubject, SubjectsService } from '../subjects/subjects.service';
import { SubjectProvidersService } from '../subject-providers/subject-providers.service';
import { QuestionnaireService } from '../questionnaire/questionnaire.service';
import { QuestionnaireQuestion, QuestionType } from '../questionnaire/questionnaire.types';
import { ReportsService } from '../reports/reports.service';
import { ComplianceBlockedError, ConflictError } from '../../common/errors';
import { FEASIBILITY_SYSTEM, FeasibilityVerdict, buildFeasibilityUser, feasibilitySchema } from './prompts/feasibility.prompt';
import { assignWaves, decideNextAction, planSize } from './planning';
import { WorkflowEngine } from './workflow-engine.service';
import { OrchestratorRepository } from './orchestrator.repository';

/** Recoverable processing states → their AgentStage + the job to re-enqueue on retry (omit job = stall→fail). */
const RECOVERY: Partial<Record<InquiryState, { stage: AgentStage; job?: QueueJob }>> = {
  [InquiryState.PRE_RESEARCH]: { stage: AgentStage.PreResearch, job: QueueJob.PreResearch },
  [InquiryState.ENRICHMENT]: { stage: AgentStage.EnrichSubject, job: QueueJob.EnrichSubject },
  [InquiryState.BROAD_RESEARCH]: { stage: AgentStage.BroadResearch, job: QueueJob.BroadResearch },
  [InquiryState.FUNNEL]: { stage: AgentStage.BuildFunnel, job: QueueJob.BuildFunnel },
  [InquiryState.OUTREACH]: { stage: AgentStage.OutreachSubtask }, // no blind retry (idempotent sends guard re-runs); stall → fail
  [InquiryState.REPORT_GENERATION]: { stage: AgentStage.GenerateReport, job: QueueJob.GenerateReport },
};

/** Default questionnaire questions (TODO: generate from the enriched subject). */
const QUESTIONNAIRE_QUESTIONS: QuestionnaireQuestion[] = [
  { id: 'confirm', prompt: 'Is this what you are looking for?', type: QuestionType.Confirm },
  { id: 'budget', prompt: 'Whats your budget range?', type: QuestionType.Text },
  { id: 'where', prompt: 'Preferred location / radius?', type: QuestionType.Text },
  { id: 'when', prompt: 'By when do you need it?', type: QuestionType.Text },
];

/** Subtask statuses that count as in-flight (released, not yet settled). */
const IN_FLIGHT: SubtaskStatus[] = [SubtaskStatus.Researching, SubtaskStatus.Contacted, SubtaskStatus.Replied];
/** How many extra candidates to pull when the funnel runs dry. */
const WIDEN_BATCH = 6;
/** Hard cap on funnel size so widening can't loop forever. */
const MAX_FUNNEL = 30;

/**
 * The orchestrator: each pipeline stage is a pg-boss worker that advances the
 * versioned workflow, builds the funnel and releases outreach waves (priority +
 * rate-limited). Bodies are skeletons that emit realistic events; swap the TODO
 * blocks for real Qwen prompts / email / parsing.
 */
@Injectable()
export class OrchestratorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OrchestratorService.name);
  private reaperTimer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly repo: OrchestratorRepository,
    private readonly boss: BossService,
    private readonly outbox: OutboxService,
    private readonly activity: ActivityService,
    private readonly wf: WorkflowEngine,
    private readonly subjects: SubjectsService,
    private readonly subjectProviders: SubjectProvidersService,
    private readonly questionnaire: QuestionnaireService,
    private readonly reports: ReportsService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
    private readonly usageCtx: UsageContextService,
    @Inject(AI_PROVIDER) private readonly ai: AiProvider,
  ) {}

  async onModuleInit() {
    // Pipeline stages run under a guard: skip if cancelled/terminal, and on an
    // inline throw hand off to recoverStage (retry-with-backoff or fail-transition).
    const stage = (s: AgentStage, fn: (d: { inquiryId: string }) => Promise<void>) =>
      (j: { data: { inquiryId: string } }) => this.runPipelineStage({ stage: s, inquiryId: j.data.inquiryId, fn: () => fn(j.data) });

    await this.boss.work<{ inquiryId: string }>({ job: QueueJob.PreResearch, handler: stage(AgentStage.PreResearch, (d) => this.preResearch(d)) });
    await this.boss.work<{ inquiryId: string }>({ job: QueueJob.SendQuestionnaire, handler: stage(AgentStage.SendQuestionnaire, (d) => this.sendQuestionnaire(d)) });
    await this.boss.work<{ inquiryId: string }>({ job: QueueJob.EnrichSubject, handler: stage(AgentStage.EnrichSubject, (d) => this.enrichSubject(d)) });
    await this.boss.work<{ inquiryId: string }>({ job: QueueJob.BroadResearch, handler: stage(AgentStage.BroadResearch, (d) => this.broadResearch(d)) });
    await this.boss.work<{ inquiryId: string }>({ job: QueueJob.BuildFunnel, handler: stage(AgentStage.BuildFunnel, (d) => this.buildFunnel(d)) });
    await this.boss.work<{ inquiryId: string }>({ job: QueueJob.StartOutreach, handler: stage(AgentStage.StartOutreach, (d) => this.startOutreach(d)) });
    // Agentic reactor: every subtask settlement (qualify/fail/blocked) drives the next move.
    await this.boss.work<{ inquiryId: string; epicId: string }>({ job: QueueJob.SubtaskSettled, handler: (j) => this.usageCtx.run({ inquiryId: j.data.inquiryId, stage: 'reactor' }, () => this.onSubtaskSettled(j.data)) });
    await this.boss.work<{ inquiryId: string }>({ job: QueueJob.GenerateReport, handler: stage(AgentStage.GenerateReport, (d) => this.generateReport(d)) });
    // Reaper: recover stuck runs so no job ever goes stale. In-process scheduler
    // (Postgres-only, no Redis); a multi-instance deployment would gate the sweep
    // behind a leader lock so only one node reaps at a time.
    this.reaperTimer = setInterval(() => { void this.runReaper(); }, this.config.resilience.reaperIntervalMs);
  }

  onModuleDestroy() {
    if (this.reaperTimer) clearInterval(this.reaperTimer);
  }

  /** Guard a pipeline stage: skip if cancelled/terminal; recover on inline failure. */
  private async runPipelineStage({ stage, inquiryId, fn }: { stage: AgentStage; inquiryId: string; fn: () => Promise<void> }): Promise<void> {
    const inq = await this.repo.findInquiry({ id: inquiryId });
    if (inq.cancelRequested || TERMINAL_STATES.includes(inq.state as InquiryState)) {
      await this.outbox.emit({ type: EventType.AgentCancelled, inquiryId, data: { stage, state: inq.state } });
      return;
    }
    try {
      await fn();
    } catch (e) {
      await this.recoverStage({ inquiryId, error: String((e as Error)?.message ?? e) });
    }
  }

  // 2. Pre-research + ethical/feasibility evaluation.
  private async preResearch({ inquiryId }: { inquiryId: string }): Promise<void> {
    await this.activity.runStage({
      inquiryId, stage: AgentStage.PreResearch,
      fn: async (log) => {
        const inq = await this.repo.findInquiry({ id: inquiryId });
        await log({ message: 'Pre-researching subject + ethical/feasibility evaluation' });

        let enriched: EnrichedSubject | undefined;
        if (this.ai.isConfigured()) {
          try {
            const verdict = await this.ai.structured({
              system: FEASIBILITY_SYSTEM,
              user: buildFeasibilityUser({ rawRequest: inq.rawRequest }),
              tier: ModelTier.Depth, // ethical/legal judgement is high-stakes
              validate: (raw) => feasibilitySchema.parse(raw),
            });
            if (verdict.decision === FeasibilityVerdict.Deny) {
              await this.repo.updateInquiry({ id: inquiryId, data: { denyReason: verdict.reason || 'policy' } });
              await log({ message: `Pre-research denied: ${verdict.reason || 'policy'}`, data: { riskTags: verdict.riskTags } });
              await this.wf.advance({ inquiryId, event: WorkflowEvent.PRE_RESEARCH_DENIED });
              await this.notify({ inquiryId, kind: NotificationKind.Denial });
              return;
            }
            enriched = verdict.subject;
          } catch (e) {
            // A model/parse failure must not block a legitimate inquiry — proceed without AI enrichment.
            this.logger.warn(`feasibility eval failed; proceeding without AI enrichment: ${(e as Error).message}`);
          }
        }

        await this.subjects.createFromInquiry({ inquiryId, rawRequest: inq.rawRequest, enriched });

        // Compliance-gate + create the questionnaire here so a block denies the inquiry
        // through the existing PRE_RESEARCH→DENIED gate (no workflow-v1 change).
        try {
          await this.questionnaire.createForInquiry({ inquiryId, questions: QUESTIONNAIRE_QUESTIONS });
        } catch (e) {
          if (e instanceof ComplianceBlockedError) {
            await this.repo.updateInquiry({ id: inquiryId, data: { denyReason: `questionnaire_compliance: ${String(e.details.reason ?? '')}` } });
            await log({ message: 'Questionnaire blocked by compliance — denying', data: e.details });
            await this.wf.advance({ inquiryId, event: WorkflowEvent.PRE_RESEARCH_DENIED });
            await this.notify({ inquiryId, kind: NotificationKind.Denial });
            return;
          }
          throw e;
        }
        await this.wf.advance({ inquiryId, event: WorkflowEvent.PRE_RESEARCH_PASSED }); // action: send:questionnaire
      },
    });
  }

  // 2.1 Build + send the questionnaire (temp link).
  private async sendQuestionnaire({ inquiryId }: { inquiryId: string }): Promise<void> {
    await this.activity.runStage({
      inquiryId, stage: AgentStage.SendQuestionnaire,
      fn: async (log) => {
        // The questionnaire was compliance-gated + created during pre-research; just send the link.
        const link = await this.questionnaire.linkForInquiry({ inquiryId });
        await log({ message: 'Questionnaire emailed to customer', data: { link } }); // TODO: real email send
      },
    });
  }

  // 3.1 Enrich subject from questionnaire answers.
  private async enrichSubject({ inquiryId }: { inquiryId: string }): Promise<void> {
    await this.activity.runStage({
      inquiryId, stage: AgentStage.EnrichSubject,
      fn: async (log) => {
        await log({ message: 'Enriching subject from questionnaire answers' });
        await this.subjects.enrich({ inquiryId });
        await this.wf.advance({ inquiryId, event: WorkflowEvent.ENRICHMENT_DONE });
      },
    });
  }

  // 3.2 Broad research: geo, time, price, economic sense (+ reuse check).
  private async broadResearch({ inquiryId }: { inquiryId: string }): Promise<void> {
    await this.activity.runStage({
      inquiryId, stage: AgentStage.BroadResearch,
      fn: async (log) => {
        // Prior-report reuse: a similar nearby inquiry already has a report → deliver a derived
        // report and short-circuit funnel/outreach via the v2 BROAD_RESEARCH→REPORT_DELIVERED gate.
        const prior = await this.subjects.reuseLookup({ inquiryId });
        if (prior) {
          await log({ message: `Reusing prior report ${prior.reportId} (similar nearby inquiry)`, data: { distance: prior.distance } });
          await this.reports.reuseFrom({ inquiryId, priorReportId: prior.reportId });
          await this.wf.advance({ inquiryId, event: WorkflowEvent.REUSE_FOUND });
          await this.notify({ inquiryId, kind: NotificationKind.ReportReady });
          return;
        }
        await log({ message: 'Broad research (BREADTH model): geo, time, price, economic sense' });
        await this.subjects.broadResearch({ inquiryId });
        await this.wf.advance({ inquiryId, event: WorkflowEvent.BROAD_RESEARCH_DONE });
      },
    });
  }

  // 4. Funnel: discover real subject-provider candidates → Epic + Subtasks (assigned to waves).
  private async buildFunnel({ inquiryId }: { inquiryId: string }): Promise<void> {
    await this.activity.runStage({
      inquiryId, stage: AgentStage.BuildFunnel,
      fn: async (log) => {
        const strategy = OutreachStrategy.ESCALATING;
        const epic = await this.repo.createEpic({
          data: { inquiryId, definition: { geo: true, time: true, price: true }, strategy, targetQualifiedOptions: 3 },
        });
        await this.outbox.emit({ type: EventType.EpicCreated, inquiryId, epicId: epic.id, data: { strategy } });

        const candidates = await this.subjectProviders.discover({ subject: await this.subjectContext({ inquiryId }), count: planSize(strategy), exclude: [] });
        for (const c of assignWaves(candidates, strategy)) {
          const st = await this.repo.createSubtask({ data: { epicId: epic.id, subjectProviderName: c.name, wave: c.wave, source: c.source, contact: { country: c.country } } });
          await this.outbox.emit({ type: EventType.SubtaskCreated, inquiryId, epicId: epic.id, subtaskId: st.id, data: { subjectProviderName: c.name, wave: c.wave, source: c.source } });
        }
        await log({ message: `Funnel built via discovery: ${candidates.length} candidates`, data: { strategy } });
        await this.wf.advance({ inquiryId, event: WorkflowEvent.FUNNEL_BUILT });
      },
    });
  }

  // 4.1 Outreach: release the first wave; the reactor escalates from there.
  private async startOutreach({ inquiryId }: { inquiryId: string }): Promise<void> {
    const epic = await this.repo.findEpicWithSubtasks({ epicId: (await this.repo.findLatestEpic({ inquiryId })).id });
    const pendingWaves = [...new Set(epic.subtasks.filter((s) => s.status === SubtaskStatus.Pending).map((s) => s.wave))];
    if (pendingWaves.length) await this.releaseWave({ inquiryId, epicId: epic.id, wave: Math.min(...pendingWaves), priority: epic.priority });
  }

  /**
   * Agentic reactor — runs on every subtask settlement. Stops at the target,
   * waits while a wave is in flight, releases the next wave, or widens discovery
   * when the funnel runs dry. Sequential (pg-boss default), so reads are consistent.
   */
  private async onSubtaskSettled({ inquiryId, epicId }: { inquiryId: string; epicId: string }): Promise<void> {
    const inq = await this.repo.findInquiry({ id: inquiryId });
    if (inq.state !== InquiryState.OUTREACH) return; // already moved on (e.g. reused/finished)

    const epic = await this.repo.findEpicWithSubtasks({ epicId });
    const subs = epic.subtasks;
    const qualified = subs.filter((s) => s.status === SubtaskStatus.Qualified).length;
    const inFlight = subs.filter((s) => IN_FLIGHT.includes(s.status as SubtaskStatus)).length;
    const pendingWaves = [...new Set(subs.filter((s) => s.status === SubtaskStatus.Pending).map((s) => s.wave))];

    const action = decideNextAction({ qualified, target: epic.targetQualifiedOptions, inFlight, pendingWaves });
    if (action.kind === 'wait') return;
    if (action.kind === 'release') {
      await this.releaseWave({ inquiryId, epicId, wave: action.wave, priority: epic.priority });
      return;
    }
    if (action.kind === 'finish') {
      await this.finishOutreach({ inquiryId });
      return;
    }
    // widen: discover more unless we've hit the cap or discovery is dry.
    if (subs.length >= MAX_FUNNEL) {
      await this.finishOutreach({ inquiryId });
      return;
    }
    const exclude = subs.map((s) => s.subjectProviderName);
    const fresh = (await this.subjectProviders.discover({ subject: await this.subjectContext({ inquiryId }), count: WIDEN_BATCH, exclude }))
      .filter((c) => !exclude.includes(c.name));
    if (!fresh.length) {
      await this.finishOutreach({ inquiryId });
      return;
    }
    const nextWave = Math.max(...subs.map((s) => s.wave)) + 1;
    for (const c of fresh) {
      const st = await this.repo.createSubtask({ data: { epicId, subjectProviderName: c.name, wave: nextWave, source: c.source, contact: { country: c.country } } });
      await this.outbox.emit({ type: EventType.SubtaskCreated, inquiryId, epicId, subtaskId: st.id, data: { subjectProviderName: c.name, wave: nextWave, source: c.source } });
    }
    await this.outbox.emit({ type: EventType.FunnelWidened, inquiryId, epicId, data: { added: fresh.length, wave: nextWave } });
    await this.repo.createFinding({ data: { inquiryId, epicId, kind: FindingKind.Note, data: { note: `Widened discovery: ${fresh.length} new candidates (wave ${nextWave})` } as Prisma.InputJsonValue } });
    await this.releaseWave({ inquiryId, epicId, wave: nextWave, priority: epic.priority });
  }

  /**
   * Mark a wave's pending subtasks released, emit wave.released, and enqueue their
   * outreach. Idempotent: `claimWave` atomically records the wave on the epic, so a
   * re-delivered SubtaskSettled (pg-boss is at-least-once) can never double-release
   * a wave (= double-send).
   */
  private async releaseWave({ inquiryId, epicId, wave, priority }: { inquiryId: string; epicId: string; wave: number; priority: number }): Promise<void> {
    if (!(await this.repo.claimWave({ epicId, wave }))) {
      this.logger.debug(`wave ${wave} already released for epic ${epicId} — skipping (idempotent)`);
      return;
    }
    const subs = await this.repo.findPendingSubtasks({ epicId, waves: [wave] });
    for (const s of subs) {
      await this.repo.updateSubtask({ id: s.id, data: { status: SubtaskStatus.Researching } });
      await this.outbox.emit({ type: EventType.SubtaskUpdated, inquiryId, epicId, subtaskId: s.id, data: { status: SubtaskStatus.Researching, wave } });
      await this.boss.enqueue({ job: QueueJob.OutreachSubtask, data: { inquiryId, subtaskId: s.id }, options: { priority: 10 - priority } });
    }
    if (subs.length) await this.outbox.emit({ type: EventType.WaveReleased, inquiryId, epicId, data: { wave, count: subs.length } });
  }

  /**
   * Advance OUTREACH_DONE → report generation; tolerate a lost race (already
   * advanced). First, retire any un-released (still-pending) subtasks to `skipped`
   * — a terminal state distinct from `failed` — so the board isn't perpetually
   * pending and the reaper never tries to revive a wave we stopped early.
   */
  private async finishOutreach({ inquiryId }: { inquiryId: string }): Promise<void> {
    const epic = await this.repo.findLatestEpic({ inquiryId });
    const pending = await this.repo.findPendingSubtasks({ epicId: epic.id, waves: undefined });
    for (const s of pending) {
      await this.repo.updateSubtask({ id: s.id, data: { status: SubtaskStatus.Skipped } });
      await this.outbox.emit({ type: EventType.SubtaskUpdated, inquiryId, epicId: epic.id, subtaskId: s.id, data: { status: SubtaskStatus.Skipped, wave: s.wave } });
    }
    await this.repo.setEpicStatus({ epicId: epic.id, status: 'done' });
    try {
      await this.wf.advance({ inquiryId, event: WorkflowEvent.OUTREACH_DONE });
    } catch (e) {
      if (!(e instanceof ConflictError)) throw e;
    }
  }

  // --- HP-09: failure recovery, reaper, cancellation ---

  /**
   * Recover a failed/stuck stage: while attempts remain, re-enqueue the stage job
   * with exponential backoff; otherwise dead-letter it by firing the workflow's
   * failure transition for the current state (→ FAILED). No-op if cancelled or the
   * inquiry already moved on.
   */
  private async recoverStage({ inquiryId, error }: { inquiryId: string; error: string }): Promise<void> {
    const inq = await this.repo.findInquiry({ id: inquiryId });
    if (inq.cancelRequested) return;
    const info = RECOVERY[inq.state as InquiryState];
    if (!info) return; // not in a recoverable processing state (already advanced / terminal)
    const attempts = await this.repo.countAgentRuns({ inquiryId, stage: info.stage });
    const action = info.job ? decideReaperAction({ attempts, maxAttempts: this.config.resilience.maxAttempts }) : 'fail';
    if (action === 'retry' && info.job) {
      const delay = retryBackoffSeconds({ attempts });
      await this.outbox.emit({ type: EventType.RunReaped, inquiryId, data: { stage: info.stage, action: 'retry', attempts, delay, error } });
      await this.boss.enqueue({ job: info.job, data: { inquiryId }, options: { startAfter: delay } });
      return;
    }
    const event = failureEventForState(inq.state);
    await this.outbox.emit({ type: EventType.RunReaped, inquiryId, data: { stage: info.stage, action: 'fail', attempts, error } });
    if (event) {
      try {
        await this.wf.advance({ inquiryId, event });
      } catch (e) {
        if (!(e instanceof ConflictError)) throw e;
      }
    }
  }

  /** Periodic sweep: fail leases that expired (a stage died mid-run) and recover them. */
  private async runReaper(): Promise<void> {
    try {
      const stuck = findStuckRuns({ runs: await this.repo.findRunningRuns(), now: new Date() });
      for (const r of stuck) {
        this.logger.warn(`reaper: run ${r.id} (${r.stage}) lease expired — recovering inquiry ${r.inquiryId}`);
        await this.repo.failRun({ id: r.id, error: 'lease expired (reaped)' });
        await this.outbox.emit({ type: EventType.AgentFailed, inquiryId: r.inquiryId, data: { stage: r.stage, error: 'lease expired (reaped)' } });
        await this.recoverStage({ inquiryId: r.inquiryId, error: 'lease expired (reaped)' });
      }
    } catch (e) {
      this.logger.error(`reaper sweep failed: ${(e as Error).message}`);
    }
  }

  /**
   * Cancel an inquiry (operator control, HP-11): set the flag in-flight jobs
   * observe, fire CANCEL → CANCELLED, audit it. Idempotent — a re-cancel or an
   * already-terminal inquiry is a no-op. Guarded stages skip + the reactor no-ops
   * once terminal, so in-flight work stops cleanly.
   */
  async cancel({ inquiryId, actor = 'system', reason }: { inquiryId: string; actor?: string; reason?: string }): Promise<InquiryState> {
    const inq = await this.repo.findInquiry({ id: inquiryId });
    if (inq.state === InquiryState.CANCELLED) return InquiryState.CANCELLED; // idempotent
    await this.repo.updateInquiry({ id: inquiryId, data: { cancelRequested: true } });
    let to = inq.state as InquiryState;
    try {
      to = await this.wf.advance({ inquiryId, event: WorkflowEvent.CANCEL });
    } catch (e) {
      if (!(e instanceof ConflictError)) throw e; // already terminal — flag is still set
    }
    await this.outbox.emit({ type: EventType.InquiryCancelled, inquiryId, data: { from: inq.state, to, actor, reason } });
    await this.audit.record({ actor, action: AuditAction.Cancel, targetType: AuditTargetType.Inquiry, targetId: inquiryId, reason, data: { from: inq.state, to } });
    return to;
  }

  /**
   * Pause an inquiry (operator control, HP-11): HOLD → ON_HOLD. While paused the
   * reactor releases no new waves and the reaper won't revive it; in-flight emails
   * may still settle. Idempotent. Pause is valid from OUTREACH (the long-running
   * stage); broadening it to other stages ships as a new workflow version (HP-12).
   */
  async pause({ inquiryId, actor = 'system', reason }: { inquiryId: string; actor?: string; reason?: string }): Promise<InquiryState> {
    const inq = await this.repo.findInquiry({ id: inquiryId });
    if (inq.state === InquiryState.ON_HOLD) return InquiryState.ON_HOLD; // idempotent
    const to = await this.wf.advance({ inquiryId, event: WorkflowEvent.HOLD }); // ConflictError if not pausable from here
    await this.repo.updateInquiry({ id: inquiryId, data: { heldFromState: inq.state } });
    await this.outbox.emit({ type: EventType.InquiryPaused, inquiryId, data: { from: inq.state, to, actor, reason } });
    await this.audit.record({ actor, action: AuditAction.Pause, targetType: AuditTargetType.Inquiry, targetId: inquiryId, reason, data: { from: inq.state, to } });
    return to;
  }

  /**
   * Resume a paused inquiry (operator control, HP-11): RESUME → prior state, then
   * re-kick the reactor so wave release continues from where it left off.
   * Idempotent — resuming a non-paused inquiry is a no-op.
   */
  async resume({ inquiryId, actor = 'system' }: { inquiryId: string; actor?: string }): Promise<InquiryState> {
    const inq = await this.repo.findInquiry({ id: inquiryId });
    if (inq.state !== InquiryState.ON_HOLD) return inq.state as InquiryState; // idempotent no-op
    const to = await this.wf.advance({ inquiryId, event: WorkflowEvent.RESUME });
    await this.repo.updateInquiry({ id: inquiryId, data: { heldFromState: null } });
    await this.outbox.emit({ type: EventType.InquiryResumed, inquiryId, data: { from: inq.state, to, actor } });
    await this.audit.record({ actor, action: AuditAction.Resume, targetType: AuditTargetType.Inquiry, targetId: inquiryId, data: { from: inq.state, to } });
    // Re-kick the agentic reactor so pending waves release again (settlements may have all fired while paused).
    if (to === InquiryState.OUTREACH) {
      const epic = await this.repo.findLatestEpic({ inquiryId });
      await this.boss.enqueue({ job: QueueJob.SubtaskSettled, data: { inquiryId, epicId: epic.id } });
    }
    return to;
  }

  /** Enqueue a customer notification (HP-13); the NotificationService dispatches it. */
  private async notify({ inquiryId, kind }: { inquiryId: string; kind: NotificationKind }): Promise<void> {
    await this.boss.enqueue({ job: QueueJob.SendNotification, data: { inquiryId, kind } });
  }

  /** Subject context for discovery (title/description/attributes). */
  private async subjectContext({ inquiryId }: { inquiryId: string }): Promise<{ title: string; description: string; attributes?: unknown }> {
    const subject = await this.repo.findSubject({ inquiryId });
    return { title: subject?.title ?? '', description: subject?.description ?? '', attributes: subject?.attributes };
  }

  // 5. Report synthesis.
  private async generateReport({ inquiryId }: { inquiryId: string }): Promise<void> {
    await this.activity.runStage({
      inquiryId, stage: AgentStage.GenerateReport,
      fn: async (log) => {
        await this.reports.generate({ inquiryId });
        await log({ message: 'Report generated' });
        await this.wf.advance({ inquiryId, event: WorkflowEvent.REPORT_READY }); // -> REPORT_DELIVERED
        await this.notify({ inquiryId, kind: NotificationKind.ReportReady });
      },
    });
  }
}
