import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { AgentStage, AuditAction, AuditTargetType, ComplianceKind, EpicStatus, EventType, FindingKind, ReportState, ModelTier, NotificationKind, OutreachStrategy, QueueJob, ReaperAction, ReviewStatus, InquiryStatus, TERMINAL_STATES, UsageStage, WorkflowEvent, failureEventForState, READY_MIN, PARTIAL_READY_MIN, deriveStage } from '@inqi/shared';
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
import { QuestionnaireGenerator } from '../questionnaire/questionnaire-generator';
import { SnapshotsService } from '../snapshot/snapshots.service';
import { SourcesService } from '../source/sources.service';
import { ComplianceBlockedError, ConflictError } from '../../common/errors';
import { COMPLIANCE_SCORER, ComplianceScorer } from '../compliance/compliance.tokens';
import { feasibilitySystem, FeasibilityVerdict, buildFeasibilityUser, feasibilitySchema } from './prompts/feasibility.prompt';
import { ReportLifecycleEvent, notificationForLifecycle } from '../report/report-lifecycle';
import { OutreachActionKind, SynthesisGate, assignWaves, decideNextAction, decideSynthesisGate, planSize } from './planning';
import { WorkflowEngine } from './workflow-engine.service';
import { OrchestratorRepository } from './orchestrator.repository';

/** Recoverable processing states → their AgentStage + the job to re-enqueue on retry (omit job = stall→fail). */
const RECOVERY: Partial<Record<ReportState, { stage: AgentStage; job?: QueueJob }>> = {
  [ReportState.PRE_RESEARCH]: { stage: AgentStage.PreResearch, job: QueueJob.PreResearch },
  [ReportState.ENRICHMENT]: { stage: AgentStage.EnrichSubject, job: QueueJob.EnrichSubject },
  [ReportState.BROAD_RESEARCH]: { stage: AgentStage.BroadResearch, job: QueueJob.BroadResearch },
  [ReportState.FUNNEL]: { stage: AgentStage.BuildFunnel, job: QueueJob.BuildFunnel },
  [ReportState.OUTREACH]: { stage: AgentStage.OutreachInquiry }, // no blind retry (idempotent sends guard re-runs); stall → fail
  [ReportState.REPORT_GENERATION]: { stage: AgentStage.GenerateReport, job: QueueJob.GenerateReport },
};

/** Statuses that are settled for flow purposes (nothing further is owed by the queue). */
const SETTLED_FOR_FLOW: InquiryStatus[] = [InquiryStatus.Qualified, InquiryStatus.Failed, InquiryStatus.Skipped, InquiryStatus.Unresponsive];
/** How many extra candidates to pull when the funnel runs dry (bounded by the breadth cap). */
const WIDEN_BATCH = 6;
/** Depth-research gate: poll interval + upper bound (90 × 20s = 30 min) before synthesis proceeds anyway. */
const RESEARCH_WAIT_SECONDS = 20;
const RESEARCH_WAIT_MAX = 90;

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
    private readonly questionnaireGen: QuestionnaireGenerator,
    private readonly reports: SnapshotsService,
    private readonly sources: SourcesService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
    private readonly usageCtx: UsageContextService,
    @Inject(AI_PROVIDER) private readonly ai: AiProvider,
    @Inject(COMPLIANCE_SCORER) private readonly compliance: ComplianceScorer,
  ) {}

  async onModuleInit() {
    // Pipeline stages run under a guard: skip if cancelled/terminal, and on an
    // inline throw hand off to recoverStage (retry-with-backoff or fail-transition).
    const stage = (s: AgentStage, fn: (d: { reportId: string }) => Promise<void>) =>
      (j: { data: { reportId: string } }) => this.runPipelineStage({ stage: s, reportId: j.data.reportId, fn: () => fn(j.data) });

    await this.boss.work<{ reportId: string }>({ job: QueueJob.PreResearch, handler: stage(AgentStage.PreResearch, (d) => this.preResearch(d)) });
    await this.boss.work<{ reportId: string }>({ job: QueueJob.SendQuestionnaire, handler: stage(AgentStage.SendQuestionnaire, (d) => this.sendQuestionnaire(d)) });
    await this.boss.work<{ reportId: string }>({ job: QueueJob.EnrichSubject, handler: stage(AgentStage.EnrichSubject, (d) => this.enrichSubject(d)) });
    await this.boss.work<{ reportId: string }>({ job: QueueJob.BroadResearch, handler: stage(AgentStage.BroadResearch, (d) => this.broadResearch(d)) });
    await this.boss.work<{ reportId: string }>({ job: QueueJob.BuildFunnel, handler: stage(AgentStage.BuildFunnel, (d) => this.buildFunnel(d)) });
    await this.boss.work<{ reportId: string }>({ job: QueueJob.StartOutreach, handler: stage(AgentStage.StartOutreach, (d) => this.startOutreach(d)) });
    // Agentic reactor: every inquiry settlement (qualify/fail/blocked) drives the next move.
    await this.boss.work<{ reportId: string; epicId: string }>({ job: QueueJob.InquirySettled, handler: (j) => this.usageCtx.run({ reportId: j.data.reportId, stage: UsageStage.Reactor }, () => this.onInquirySettled(j.data)) });
    await this.boss.work<{ reportId: string; researchWaits?: number }>({
      job: QueueJob.GenerateReport,
      handler: (j) => this.runPipelineStage({ stage: AgentStage.GenerateReport, reportId: j.data.reportId, fn: () => this.generateReport(j.data) }),
    });
    // Late evidence (depth verdict / provider reply) on a delivered report →
    // re-rank + re-synthesize the snapshot in place, then run the `updated`
    // lifecycle handler: the customer gets an email with the new placement.
    await this.boss.work<{ reportId: string }>({
      job: QueueJob.RefreshSnapshot,
      handler: (j) => this.usageCtx.run({ reportId: j.data.reportId, stage: UsageStage.Reactor }, async () => {
        const refreshed = await this.reports.refresh({ reportId: j.data.reportId });
        if (refreshed) {
          const kind = notificationForLifecycle(ReportLifecycleEvent.Updated);
          if (kind) await this.notify({ reportId: j.data.reportId, kind });
        }
      }),
    });
    // Reaper: recover stuck runs so no job ever goes stale. In-process scheduler
    // (Postgres-only, no Redis); a multi-instance deployment would gate the sweep
    // behind a leader lock so only one node reaps at a time.
    this.reaperTimer = setInterval(() => { void this.runReaper(); }, this.config.resilience.reaperIntervalMs);
  }

  onModuleDestroy() {
    if (this.reaperTimer) clearInterval(this.reaperTimer);
  }

  /** Guard a pipeline stage: skip if cancelled/terminal; recover on inline failure. */
  private async runPipelineStage({ stage, reportId, fn }: { stage: AgentStage; reportId: string; fn: () => Promise<void> }): Promise<void> {
    const inq = await this.repo.findReport({ id: reportId });
    if (inq.cancelRequested || TERMINAL_STATES.includes(inq.state as ReportState)) {
      await this.outbox.emit({ type: EventType.AgentCancelled, reportId, data: { stage, state: inq.state } });
      return;
    }
    try {
      await fn();
    } catch (e) {
      await this.recoverStage({ reportId, error: String((e as Error)?.message ?? e) });
    }
  }

  // 2. Pre-research + ethical/feasibility evaluation.
  private async preResearch({ reportId }: { reportId: string }): Promise<void> {
    await this.activity.runStage({
      reportId, stage: AgentStage.PreResearch,
      fn: async (log) => {
        const inq = await this.repo.findReport({ id: reportId });
        await log({ message: 'Pre-researching subject + ethical/feasibility evaluation' });

        // Compliance gate on the CUSTOMER'S RAW PROMPT (ethical + legal rubric) —
        // a blocked request denies the report before any research spends a token.
        const promptReview = await this.compliance.score({ kind: ComplianceKind.CustomerRequest, text: inq.rawRequest, tier: ModelTier.Depth });
        if (promptReview.status === ReviewStatus.Blocked) {
          await this.repo.updateReport({ id: reportId, data: { denyReason: `request_compliance: ${promptReview.reason || promptReview.categories.join(', ') || 'policy'}` } });
          await log({ message: `Request blocked by the compliance gate: ${promptReview.reason || 'policy'}`, data: { categories: promptReview.categories, riskScore: promptReview.score } });
          await this.wf.advance({ reportId, event: WorkflowEvent.PRE_RESEARCH_DENIED }); // lifecycle handler emails the denial
          return;
        }

        let enriched: EnrichedSubject | undefined;
        if (this.ai.isConfigured()) {
          try {
            const verdict = await this.ai.structured({
              system: feasibilitySystem(),
              user: buildFeasibilityUser({ rawRequest: inq.rawRequest }),
              tier: ModelTier.Depth, // ethical/legal judgement is high-stakes
              validate: (raw) => feasibilitySchema.parse(raw),
            });
            if (verdict.decision === FeasibilityVerdict.Deny) {
              await this.repo.updateReport({ id: reportId, data: { denyReason: verdict.reason || 'policy' } });
              await log({ message: `Pre-research denied: ${verdict.reason || 'policy'}`, data: { riskTags: verdict.riskTags } });
              await this.wf.advance({ reportId, event: WorkflowEvent.PRE_RESEARCH_DENIED }); // lifecycle handler emails the denial
              return;
            }
            enriched = verdict.subject;
          } catch (e) {
            // A model/parse failure must not block a legitimate report — proceed without AI enrichment.
            this.logger.warn(`feasibility eval failed; proceeding without AI enrichment: ${(e as Error).message}`);
          }
        }

        await this.subjects.createFromReport({ reportId, rawRequest: inq.rawRequest, enriched });

        // The questionnaire agent researches the topic (~5 web searches) and generates
        // 7–10 select questions with 3–4 concrete options each (static fallback inside).
        await log({ message: 'Researching the topic to design the scope questionnaire' });
        const questions = await this.questionnaireGen.generate({
          rawRequest: inq.rawRequest,
          subject: enriched ? { title: enriched.title, summary: enriched.summary } : null,
        });

        // Compliance-gate + create the questionnaire here so a block denies the report
        // through the existing PRE_RESEARCH→DENIED gate (no workflow-v1 change).
        try {
          await this.questionnaire.createForReport({ reportId, questions });
        } catch (e) {
          if (e instanceof ComplianceBlockedError) {
            await this.repo.updateReport({ id: reportId, data: { denyReason: `questionnaire_compliance: ${String(e.details.reason ?? '')}` } });
            await log({ message: 'Questionnaire blocked by compliance — denying', data: e.details });
            await this.wf.advance({ reportId, event: WorkflowEvent.PRE_RESEARCH_DENIED }); // lifecycle handler emails the denial
            return;
          }
          throw e;
        }
        await this.wf.advance({ reportId, event: WorkflowEvent.PRE_RESEARCH_PASSED }); // action: send:questionnaire
      },
    });
  }

  // 2.1 Build + send the questionnaire (temp link).
  private async sendQuestionnaire({ reportId }: { reportId: string }): Promise<void> {
    await this.activity.runStage({
      reportId, stage: AgentStage.SendQuestionnaire,
      fn: async (log) => {
        // The questionnaire was compliance-gated + created during pre-research. The email
        // itself is sent by the `needs-you` lifecycle handler when QUESTIONNAIRE_SENT was
        // entered — this stage just records the link on the activity timeline.
        const link = await this.questionnaire.linkForReport({ reportId });
        await log({ message: 'Questionnaire link emailed to customer (needs-you lifecycle)', data: { link } });
      },
    });
  }

  // 3.1 Enrich subject from questionnaire answers.
  private async enrichSubject({ reportId }: { reportId: string }): Promise<void> {
    await this.activity.runStage({
      reportId, stage: AgentStage.EnrichSubject,
      fn: async (log) => {
        await log({ message: 'Enriching subject from questionnaire answers' });
        await this.subjects.enrich({ reportId });
        await this.wf.advance({ reportId, event: WorkflowEvent.ENRICHMENT_DONE });
      },
    });
  }

  // 3.2 Broad research: geo, time, price, economic sense (+ reuse check).
  private async broadResearch({ reportId }: { reportId: string }): Promise<void> {
    await this.activity.runStage({
      reportId, stage: AgentStage.BroadResearch,
      fn: async (log) => {
        // Prior-report reuse: a similar nearby report already has a report → deliver a derived
        // report and short-circuit funnel/outreach via the v2 BROAD_RESEARCH→REPORT_DELIVERED gate.
        const prior = await this.subjects.reuseLookup({ reportId });
        if (prior) {
          await log({ message: `Reusing prior report ${prior.snapshotId} (similar nearby report)`, data: { distance: prior.distance } });
          await this.reports.reuseFrom({ reportId, priorSnapshotId: prior.snapshotId });
          await this.wf.advance({ reportId, event: WorkflowEvent.REUSE_FOUND }); // lifecycle handler emails report-ready
          return;
        }
        await log({ message: 'Broad research (BREADTH model): geo, time, price, economic sense' });
        await this.subjects.broadResearch({ reportId });
        await this.wf.advance({ reportId, event: WorkflowEvent.BROAD_RESEARCH_DONE });
      },
    });
  }

  // 4. Funnel: discover real subject-provider candidates → Epic + Inquiries (assigned to waves).
  private async buildFunnel({ reportId }: { reportId: string }): Promise<void> {
    await this.activity.runStage({
      reportId, stage: AgentStage.BuildFunnel,
      fn: async (log) => {
        const strategy = OutreachStrategy.ESCALATING;
        const epic = await this.repo.createEpic({
          data: { reportId, definition: { geo: true, time: true, price: true }, strategy, targetQualifiedOptions: READY_MIN }, // HP-23: pursue Ready (≥5); supersedes HP-07 target=3
        });
        await this.outbox.emit({ type: EventType.EpicCreated, reportId, epicId: epic.id, data: { strategy } });

        // Breadth-search lifecycle (multi-query + conversion-driven fallback), hard-capped
        // at the per-report inquiry limit. Lifecycle notes (relaxed constraints) go on the
        // activity timeline so the customer sees WHY broader matches appeared.
        const breadthCap = this.config.research.maxBreadthInquiries;
        const { candidates, notes } = await this.subjectProviders.discover({ subject: await this.subjectContext({ reportId }), count: Math.min(planSize(strategy), breadthCap), exclude: [] });
        for (const note of notes) await log({ message: `Discovery: ${note}` });
        for (const c of assignWaves({ candidates: candidates.slice(0, breadthCap), strategy })) {
          const st = await this.repo.createInquiry({ data: { reportId, epicId: epic.id, name: c.name, wave: c.wave, leadSource: c.source, contact: { country: c.country, ...(c.matchNote ? { matchNote: c.matchNote } : {}), ...(c.website ? { website: c.website } : {}), ...(c.socials?.length ? { socials: c.socials } : {}), ...(c.facts?.length ? { facts: c.facts } : {}) } } });
          if (c.evidence?.length) await this.sources.addWebsearch({ reportId, inquiryId: st.id, results: c.evidence });
          await this.outbox.emit({ type: EventType.InquiryCreated, reportId, epicId: epic.id, inquiryId: st.id, data: { name: c.name, wave: c.wave, leadSource: c.source } });
          // Depth task per found candidate — queued immediately (not gated behind outreach waves).
          await this.boss.enqueue({ job: QueueJob.ResearchBackground, data: { reportId, inquiryId: st.id } });
        }
        await log({ message: `Funnel built via discovery: ${Math.min(candidates.length, breadthCap)} candidates (cap ${breadthCap})`, data: { strategy } });
        await this.wf.advance({ reportId, event: WorkflowEvent.FUNNEL_BUILT });
      },
    });
  }

  // 4.1 Outreach: release the first wave; the reactor escalates from there.
  private async startOutreach({ reportId }: { reportId: string }): Promise<void> {
    const epic = await this.repo.findEpicWithInquiries({ epicId: (await this.repo.findLatestEpic({ reportId })).id });
    const pendingWaves = [...new Set(epic.inquiries.filter((s) => s.status === InquiryStatus.Pending).map((s) => s.wave))];
    if (pendingWaves.length) await this.releaseWave({ reportId, epicId: epic.id, wave: Math.min(...pendingWaves), priority: epic.priority });
  }

  /**
   * Agentic reactor — runs on every inquiry settlement. Stops at the target,
   * waits while a wave is in flight, releases the next wave, or widens discovery
   * when the funnel runs dry. Sequential (pg-boss default), so reads are consistent.
   */
  private async onInquirySettled({ reportId, epicId }: { reportId: string; epicId: string }): Promise<void> {
    const inq = await this.repo.findReport({ id: reportId });
    if (inq.state !== ReportState.OUTREACH) return; // already moved on (e.g. reused/finished)

    const epic = await this.repo.findEpicWithInquiries({ epicId });
    const subs = epic.inquiries;
    const qualified = subs.filter((s) => s.status === InquiryStatus.Qualified).length;
    // EMAIL IS NON-BLOCKING: in-flight = the queue still owes a depth verdict
    // (researchPending). A contacted/replied thread with research concluded never
    // holds the funnel — the inbound webhook triggers evaluation when (if) a reply
    // arrives, and a delivered report re-evaluates itself then.
    const inFlight = subs.filter((s) => s.researchPending && !SETTLED_FOR_FLOW.includes(s.status as InquiryStatus)).length;
    const pendingWaves = [...new Set(subs.filter((s) => s.status === InquiryStatus.Pending).map((s) => s.wave))];

    // HP-23: the report's stage is derived from qualified count. While the workflow
    // state holds at OUTREACH, crossing a readiness threshold (Researching → Partially
    // ready → Ready) is itself a stage transition — emit it so the dashboard pipeline
    // updates live (edge-triggered; settlements are sequential, so `qualified` is monotonic).
    if (qualified === PARTIAL_READY_MIN || qualified === READY_MIN) {
      await this.outbox.emit({ type: EventType.ReportTransitioned, reportId, data: { from: inq.state, to: inq.state, stage: deriveStage({ state: inq.state, qualifiedCount: qualified }), qualifiedCount: qualified } });
    }

    const action = decideNextAction({ qualified, target: epic.targetQualifiedOptions, inFlight, pendingWaves });
    if (action.kind === OutreachActionKind.Wait) return;
    if (action.kind === OutreachActionKind.Release) {
      await this.releaseWave({ reportId, epicId, wave: action.wave, priority: epic.priority });
      return;
    }
    if (action.kind === OutreachActionKind.Finish) {
      await this.finishOutreach({ reportId });
      return;
    }
    // widen: discover more unless we've hit the per-report inquiry cap or discovery is dry.
    const breadthCap = this.config.research.maxBreadthInquiries;
    if (subs.length >= breadthCap) {
      await this.finishOutreach({ reportId });
      return;
    }
    const exclude = subs.map((s) => s.name);
    const widened = await this.subjectProviders.discover({ subject: await this.subjectContext({ reportId }), count: Math.min(WIDEN_BATCH, breadthCap - subs.length), exclude });
    for (const note of widened.notes) this.logger.log(`widen discovery: ${note}`);
    const fresh = widened.candidates
      .filter((c) => !exclude.includes(c.name))
      .slice(0, breadthCap - subs.length);
    if (!fresh.length) {
      await this.finishOutreach({ reportId });
      return;
    }
    const nextWave = Math.max(...subs.map((s) => s.wave)) + 1;
    for (const c of fresh) {
      const st = await this.repo.createInquiry({ data: { reportId, epicId, name: c.name, wave: nextWave, leadSource: c.source, contact: { country: c.country, ...(c.matchNote ? { matchNote: c.matchNote } : {}), ...(c.website ? { website: c.website } : {}), ...(c.socials?.length ? { socials: c.socials } : {}), ...(c.facts?.length ? { facts: c.facts } : {}) } } });
      if (c.evidence?.length) await this.sources.addWebsearch({ reportId, inquiryId: st.id, results: c.evidence });
      await this.outbox.emit({ type: EventType.InquiryCreated, reportId, epicId, inquiryId: st.id, data: { name: c.name, wave: nextWave, leadSource: c.source } });
      await this.boss.enqueue({ job: QueueJob.ResearchBackground, data: { reportId, inquiryId: st.id } });
    }
    await this.outbox.emit({ type: EventType.FunnelWidened, reportId, epicId, data: { added: fresh.length, wave: nextWave } });
    await this.repo.createFinding({ data: { reportId, epicId, kind: FindingKind.Note, data: { note: `Widened discovery: ${fresh.length} new candidates (wave ${nextWave})` } as Prisma.InputJsonValue } });
    await this.releaseWave({ reportId, epicId, wave: nextWave, priority: epic.priority });
  }

  /**
   * Mark a wave's pending inquiries released, emit wave.released, and enqueue their
   * outreach. Idempotent: `claimWave` atomically records the wave on the epic, so a
   * re-delivered InquirySettled (pg-boss is at-least-once) can never double-release
   * a wave (= double-send).
   */
  private async releaseWave({ reportId, epicId, wave, priority }: { reportId: string; epicId: string; wave: number; priority: number }): Promise<void> {
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
  private async finishOutreach({ reportId }: { reportId: string }): Promise<void> {
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

  // --- HP-09: failure recovery, reaper, cancellation ---

  /**
   * Recover a failed/stuck stage: while attempts remain, re-enqueue the stage job
   * with exponential backoff; otherwise dead-letter it by firing the workflow's
   * failure transition for the current state (→ FAILED). No-op if cancelled or the
   * report already moved on.
   */
  private async recoverStage({ reportId, error }: { reportId: string; error: string }): Promise<void> {
    const inq = await this.repo.findReport({ id: reportId });
    if (inq.cancelRequested) return;
    const info = RECOVERY[inq.state as ReportState];
    if (!info) return; // not in a recoverable processing state (already advanced / terminal)
    const attempts = await this.repo.countAgentRuns({ reportId, stage: info.stage });
    const action = info.job ? decideReaperAction({ attempts, maxAttempts: this.config.resilience.maxAttempts }) : ReaperAction.Fail;
    if (action === ReaperAction.Retry && info.job) {
      const delay = retryBackoffSeconds({ attempts });
      await this.outbox.emit({ type: EventType.RunReaped, reportId, data: { stage: info.stage, action: ReaperAction.Retry, attempts, delay, error } });
      await this.boss.enqueue({ job: info.job, data: { reportId }, options: { startAfter: delay } });
      return;
    }
    const event = failureEventForState(inq.state);
    await this.outbox.emit({ type: EventType.RunReaped, reportId, data: { stage: info.stage, action: ReaperAction.Fail, attempts, error } });
    if (event) {
      try {
        await this.wf.advance({ reportId, event });
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
        this.logger.warn(`reaper: run ${r.id} (${r.stage}) lease expired — recovering report ${r.reportId}`);
        await this.repo.failRun({ id: r.id, error: 'lease expired (reaped)' });
        await this.outbox.emit({ type: EventType.AgentFailed, reportId: r.reportId, data: { stage: r.stage, error: 'lease expired (reaped)' } });
        await this.recoverStage({ reportId: r.reportId, error: 'lease expired (reaped)' });
      }
      await this.reapSilentThreads();
    } catch (e) {
      this.logger.error(`reaper sweep failed: ${(e as Error).message}`);
    }
  }

  /**
   * Reply-wait sweep: a contacted inquiry silent past `replyTimeoutMinutes` is marked
   * **unresponsive** — NOT failed. Silence is not a verdict: the email thread stays
   * open (long-poll), and a reply landing any time later runs the normal reply loop
   * (qualify/disqualify → settle → snapshot refresh on a delivered report). Since
   * email became fully non-blocking (the reactor only waits on depth verdicts), this
   * mark is status hygiene for the UI — it no longer gates any flow.
   */
  private async reapSilentThreads(): Promise<void> {
    const { replyTimeoutMinutes } = this.config.resilience;
    const olderThan = new Date(Date.now() - replyTimeoutMinutes * 60_000);
    const stale = await this.repo.findStaleContactedInquiries({ olderThan });
    for (const s of stale) {
      this.logger.log(`reaper: inquiry "${s.name}" (${s.id}) silent for ${replyTimeoutMinutes} min — marking unresponsive (thread stays open)`);
      await this.repo.updateInquiry({ id: s.id, data: { status: InquiryStatus.Unresponsive } });
      await this.outbox.emit({ type: EventType.InquiryUpdated, reportId: s.reportId, epicId: s.epicId, inquiryId: s.id, data: { name: s.name, status: InquiryStatus.Unresponsive, reason: 'no reply yet — the thread stays open; a late reply re-evaluates the report' } });
      await this.boss.enqueue({ job: QueueJob.InquirySettled, data: { reportId: s.reportId, epicId: s.epicId } });
    }
  }

  /**
   * Cancel a report (operator control, HP-11): set the flag in-flight jobs
   * observe, fire CANCEL → CANCELLED, audit it. Idempotent — a re-cancel or an
   * already-terminal report is a no-op. Guarded stages skip + the reactor no-ops
   * once terminal, so in-flight work stops cleanly.
   */
  async cancel({ reportId, actor = 'system', reason }: { reportId: string; actor?: string; reason?: string }): Promise<ReportState> {
    const inq = await this.repo.findReport({ id: reportId });
    if (inq.state === ReportState.CANCELLED) return ReportState.CANCELLED; // idempotent
    await this.repo.updateReport({ id: reportId, data: { cancelRequested: true } });
    let to = inq.state as ReportState;
    try {
      to = await this.wf.advance({ reportId, event: WorkflowEvent.CANCEL });
    } catch (e) {
      if (!(e instanceof ConflictError)) throw e; // already terminal — flag is still set
    }
    await this.outbox.emit({ type: EventType.ReportCancelled, reportId, data: { from: inq.state, to, actor, reason } });
    await this.audit.record({ actor, action: AuditAction.Cancel, targetType: AuditTargetType.Report, targetId: reportId, reason, data: { from: inq.state, to } });
    return to;
  }

  /**
   * Pause a report (operator control, HP-11): HOLD → ON_HOLD. While paused the
   * reactor releases no new waves and the reaper won't revive it; in-flight emails
   * may still settle. Idempotent. Pause is valid from OUTREACH (the long-running
   * stage); broadening it to other stages ships as a new workflow version (HP-12).
   */
  async pause({ reportId, actor = 'system', reason }: { reportId: string; actor?: string; reason?: string }): Promise<ReportState> {
    const inq = await this.repo.findReport({ id: reportId });
    if (inq.state === ReportState.ON_HOLD) return ReportState.ON_HOLD; // idempotent
    const to = await this.wf.advance({ reportId, event: WorkflowEvent.HOLD }); // ConflictError if not pausable from here
    await this.repo.updateReport({ id: reportId, data: { heldFromState: inq.state } });
    await this.outbox.emit({ type: EventType.ReportPaused, reportId, data: { from: inq.state, to, actor, reason } });
    await this.audit.record({ actor, action: AuditAction.Pause, targetType: AuditTargetType.Report, targetId: reportId, reason, data: { from: inq.state, to } });
    return to;
  }

  /**
   * Resume a paused report (operator control, HP-11): RESUME → prior state, then
   * re-kick the reactor so wave release continues from where it left off.
   * Idempotent — resuming a non-paused report is a no-op.
   */
  async resume({ reportId, actor = 'system' }: { reportId: string; actor?: string }): Promise<ReportState> {
    const inq = await this.repo.findReport({ id: reportId });
    if (inq.state !== ReportState.ON_HOLD) return inq.state as ReportState; // idempotent no-op
    const to = await this.wf.advance({ reportId, event: WorkflowEvent.RESUME });
    await this.repo.updateReport({ id: reportId, data: { heldFromState: null } });
    await this.outbox.emit({ type: EventType.ReportResumed, reportId, data: { from: inq.state, to, actor } });
    await this.audit.record({ actor, action: AuditAction.Resume, targetType: AuditTargetType.Report, targetId: reportId, data: { from: inq.state, to } });
    // Re-kick the agentic reactor so pending waves release again (settlements may have all fired while paused).
    if (to === ReportState.OUTREACH) {
      const epic = await this.repo.findLatestEpic({ reportId });
      await this.boss.enqueue({ job: QueueJob.InquirySettled, data: { reportId, epicId: epic.id } });
    }
    return to;
  }

  /** Enqueue a customer notification (HP-13); the NotificationService dispatches it. */
  private async notify({ reportId, kind }: { reportId: string; kind: NotificationKind }): Promise<void> {
    await this.boss.enqueue({ job: QueueJob.SendNotification, data: { reportId, kind } });
  }

  /** Subject context for discovery (title/description/attributes). */
  private async subjectContext({ reportId }: { reportId: string }): Promise<{ title: string; description: string; attributes?: unknown }> {
    const subject = await this.repo.findSubject({ reportId });
    return { title: subject?.title ?? '', description: subject?.description ?? '', attributes: subject?.attributes };
  }

  // 5. Report synthesis.
  private async generateReport({ reportId, researchWaits = 0 }: { reportId: string; researchWaits?: number }): Promise<void> {
    // Depth-research gate: an inquiry's ResearchBackground job can outlive outreach
    // (it's queued at creation and runs independently). Never synthesize while one is
    // still pending — the customer would see clickable options with empty dossiers.
    // Bounded wait: after RESEARCH_WAIT_MAX polls we proceed anyway (a permanently
    // failed research job must not strand the report).
    const outstanding = await this.repo.countResearchPending({ reportId });
    if (decideSynthesisGate({ outstandingResearch: outstanding, waits: researchWaits, maxWaits: RESEARCH_WAIT_MAX }) === SynthesisGate.Defer) {
      this.logger.log(`report ${reportId}: ${outstanding} depth-research job(s) still pending — deferring synthesis (poll ${researchWaits + 1}/${RESEARCH_WAIT_MAX})`);
      await this.boss.enqueue({ job: QueueJob.GenerateReport, data: { reportId, researchWaits: researchWaits + 1 }, options: { startAfter: RESEARCH_WAIT_SECONDS } });
      return;
    }
    if (outstanding > 0) this.logger.warn(`report ${reportId}: synthesizing with ${outstanding} research job(s) still pending — wait deadline reached`);
    await this.activity.runStage({
      reportId, stage: AgentStage.GenerateReport,
      fn: async (log) => {
        await this.reports.generate({ reportId });
        await log({ message: 'Report generated' });
        await this.wf.advance({ reportId, event: WorkflowEvent.REPORT_READY }); // -> REPORT_DELIVERED (lifecycle handler emails report-ready)
      },
    });
  }
}
