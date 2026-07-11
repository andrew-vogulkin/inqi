import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  AgentEventKind, AgentRunStatus, BreadthState, EventType, PhaseControlEvent, PhaseKey,
  QueueJob, ReportState, TERMINAL_STATES, WorkflowStatus,
} from '@inqi/shared';
import type { PhaseRun, Prisma } from '@prisma/client';
import { BossService } from '../../infra/queue/boss.service';
import { OutboxService } from '../../infra/events/outbox.service';
import { ConfigService } from '../../infra/config/config.service';
import { PrismaService } from '../../infra/persistence/prisma.service';
import { UsageContextService } from '../../infra/usage/usage-context.service';
import { retryBackoffSeconds } from '../../infra/observability/reaper.logic';
import { StageLogger } from '../../infra/observability/activity.service';
import { ConflictError, ErrorCode, NotFoundError } from '../../common/errors';
import { WorkflowEngine } from '../orchestrator/workflow-engine.service';
import { configuredTunables } from './phase-tunables';
import { PhaseRunRepository } from './phase-run.repository';
import { PhaseRegistryService } from './phase-registry';
import { PhaseStepRegistry } from './phase-step.tokens';

/** pg-boss payload driving one step of a phase run. */
export interface PhaseStepPayload {
  runId: string;
  /** The state this delivery expects — a mismatch marks a stale duplicate (skip). */
  expectedState: string;
}

// FAILED/CANCELLED state names are shared by all three phase graphs.
const FAILED_STATE: string = BreadthState.FAILED;
const CANCELLED_STATE: string = BreadthState.CANCELLED;

/**
 * The generic engine driving phase runs (pre_research / breadth_search /
 * depth_search) from their DB workflow definitions — the PhaseRun counterpart of
 * {@link WorkflowEngine}. One pg-boss job (`phase_step`) executes the handler
 * registered for (key, state); the handler computes the outcome EVENT; the
 * transition row decides what happens next. Every run is shadowed by an AgentRun
 * so the activity timeline and the reaper lease keep working unchanged.
 */
@Injectable()
export class PhaseEngine implements OnModuleInit {
  private readonly logger = new Logger(PhaseEngine.name);
  /** (definitionId) → state name → info (terminal + composable-phase operator/params). Definitions are immutable once active — cache freely. */
  private readonly stateCache = new Map<string, Map<string, PhaseStateInfo>>();

  constructor(
    private readonly db: PrismaService,
    private readonly repo: PhaseRunRepository,
    private readonly boss: BossService,
    private readonly outbox: OutboxService,
    private readonly config: ConfigService,
    private readonly usageCtx: UsageContextService,
    private readonly registry: PhaseRegistryService,
    private readonly steps: PhaseStepRegistry,
  ) {}

  async onModuleInit() {
    // Handlers register in their provider constructors — all construction precedes
    // any onModuleInit, so the registry is complete before the first delivery.
    await this.boss.work<PhaseStepPayload>({ job: QueueJob.PhaseStep, handler: (j) => this.executeStep(j.data) });
  }

  /**
   * Start a phase run: pin the key's active workflow version, enter its initial
   * state, open the shadow AgentRun (lease), and enqueue the first step.
   * `dedupe` skips when a live run for the same scope already exists (report-level
   * retries and reactor re-fires are at-least-once).
   */
  async startRun({ key, reportId, inquiryId, data, dedupe = true }: {
    key: PhaseKey; reportId: string; inquiryId?: string; data: Record<string, unknown>; dedupe?: boolean;
  }): Promise<PhaseRun | null> {
    const workflowVersionId = await this.reportEngineActiveVersion({ key });
    const states = await this.definitionStates({ definitionId: workflowVersionId });
    if (dedupe) {
      const terminals = [...states.entries()].filter(([, t]) => t).map(([name]) => name);
      const live = await this.repo.findActive({ reportId, key, inquiryId, terminalStates: terminals });
      if (live) {
        this.logger.debug(`live ${key} run ${live.id} already exists for report ${reportId} — not starting another`);
        return null;
      }
    }
    const initial = await this.db.workflowState.findFirst({ where: { definitionId: workflowVersionId, isInitial: true } });
    if (!initial) throw new NotFoundError({ code: ErrorCode.NotFound, message: `workflow ${key} has no initial state` });

    // Stage-1 evolution (docs/research-phase-evolution.md): genes set in the active
    // definition's state configs override the caller's constants — pinned into
    // run.data here so the run stays self-contained and replayable.
    const tunables = configuredTunables({ key, states: [...states.entries()].map(([name, info]) => ({ name, config: info.config ?? undefined })) });
    const run = await this.repo.create({ data: { key, workflowVersionId, state: initial.name, reportId, inquiryId: inquiryId ?? null, data: { ...data, ...tunables } as Prisma.InputJsonValue } });
    await this.repo.createShadowRun({ reportId, stage: key, inquiryId, phaseRunId: run.id, leaseUntil: this.leaseFromNow() });
    // `name` (the subject the run works on — depth runs carry the provider) rides on
    // every phase event so live feeds can say WHO, not just which machine.
    await this.outbox.emit({ type: EventType.PhaseRunStarted, reportId, inquiryId, data: { runId: run.id, key, state: initial.name, name: this.runName(data) } });
    await this.boss.enqueue({ job: QueueJob.PhaseStep, data: { runId: run.id, expectedState: initial.name } });
    return run;
  }

  /**
   * Fire an event on a run: transition lookup on the pinned version → guard →
   * optimistic commit (a lost race throws ConflictError — callers treat it as a
   * benign duplicate) → shadow-run heartbeat/close → outbox event → transition action.
   */
  async advanceRun({ runId, event, dataPatch }: { runId: string; event: string; dataPatch?: Record<string, unknown> }): Promise<string> {
    const run = await this.repo.findById({ id: runId });
    if (!run) throw new NotFoundError({ code: ErrorCode.NotFound, message: `phase run ${runId} not found` });

    // findFirst: the unique key now includes toState (subject_build networks fan out);
    // phase graphs keep (from, event) unique by construction, so this stays deterministic.
    const trans = await this.db.workflowTransition.findFirst({
      where: { definitionId: run.workflowVersionId, fromState: run.state, event },
    });
    if (!trans) {
      throw new ConflictError({ code: ErrorCode.InvalidWorkflowTransition, message: `no ${run.key} transition from ${run.state} on ${event}`, details: { from: run.state, event } });
    }
    // dataPatch merges BEFORE the guard so cap guards judge the state the step computed.
    const merged = { ...((run.data ?? {}) as Record<string, unknown>), ...(dataPatch ?? {}) };
    if (trans.guard && !this.registry.runGuard({ name: trans.guard, run: { ...run, data: merged } as PhaseRun })) {
      throw new ConflictError({ code: ErrorCode.WorkflowGuardBlocked, message: `guard ${trans.guard} blocked ${run.key} ${run.state} → ${trans.toState}`, details: { guard: trans.guard } });
    }
    if (!(await this.repo.advanceOptimistic({ id: runId, fromState: run.state, toState: trans.toState, data: merged as Prisma.InputJsonValue }))) {
      throw new ConflictError({ code: ErrorCode.InvalidWorkflowTransition, message: `run ${runId} already advanced past ${run.state} (lost race — benign)`, details: { from: run.state, event } });
    }

    const terminal = await this.isTerminal({ definitionId: run.workflowVersionId, state: trans.toState });
    const name = this.runName(merged);
    if (terminal) {
      await this.repo.closeShadowRun({ phaseRunId: runId, status: this.shadowStatusFor(trans.toState), error: trans.toState === FAILED_STATE ? String(merged.error ?? 'phase failed') : undefined });
      await this.outbox.emit({ type: EventType.PhaseRunFinished, reportId: run.reportId, inquiryId: run.inquiryId ?? undefined, data: { runId, key: run.key, state: trans.toState, name } });
    } else {
      await this.repo.heartbeatShadowRun({ phaseRunId: runId, leaseUntil: this.leaseFromNow() });
      await this.outbox.emit({ type: EventType.PhaseRunTransitioned, reportId: run.reportId, inquiryId: run.inquiryId ?? undefined, data: { runId, key: run.key, from: run.state, to: trans.toState, event, name } });
    }
    if (trans.action) await this.registry.runAction({ name: trans.action, ctx: { run: { ...run, state: trans.toState, data: merged } as PhaseRun, toState: trans.toState } });
    return trans.toState;
  }

  /** The `phase_step` worker body: guard staleness/cancel, execute the handler, advance. */
  async executeStep({ runId, expectedState }: PhaseStepPayload): Promise<void> {
    const run = await this.repo.findWithContext({ id: runId });
    if (!run) return; // wiped by a reset — nothing to do
    if (await this.isTerminal({ definitionId: run.workflowVersionId, state: run.state })) return; // idempotent redelivery
    if (run.state !== expectedState) {
      this.logger.debug(`stale phase_step for run ${runId}: expected ${expectedState}, at ${run.state} — skipping`);
      return;
    }
    // Cancel check before every step: the report flag stops phase work cleanly.
    if (run.report.cancelRequested || TERMINAL_STATES.includes(run.report.state as ReportState)) {
      await this.tolerantAdvance({ runId, event: PhaseControlEvent.CANCEL });
      return;
    }

    const handler = this.steps.find({ key: run.key, state: run.state });
    if (!handler) {
      this.logger.error(`no step handler for ${run.key}:${run.state} — failing the run`);
      await this.tolerantAdvance({ runId, event: PhaseControlEvent.STEP_FAILED, dataPatch: { error: `no handler for ${run.key}:${run.state}` } });
      return;
    }

    try {
      const log = this.stepLogger({ run });
      const info = await this.stateInfo({ definitionId: run.workflowVersionId, state: run.state });
      const outcome = await this.usageCtx.run({ reportId: run.reportId, stage: run.key }, () => handler.execute({ run, report: run.report, inquiry: run.inquiry ?? null, log, handler: info?.handler ?? run.state, config: info?.config }));
      await this.tolerantAdvance({ runId, event: outcome.event, dataPatch: outcome.dataPatch });
    } catch (e) {
      const error = String((e as Error)?.message ?? e);
      const { attempts } = await this.repo.bumpAttempts({ id: runId });
      if (attempts < this.config.resilience.maxAttempts) {
        const delay = retryBackoffSeconds({ attempts });
        this.logger.warn(`${run.key}:${run.state} step failed for run ${runId} (attempt ${attempts}) — retrying in ${delay}s: ${error}`);
        await this.repo.heartbeatShadowRun({ phaseRunId: runId, leaseUntil: this.leaseFromNow(delay) });
        await this.boss.enqueue({ job: QueueJob.PhaseStep, data: { runId, expectedState: run.state }, options: { startAfter: delay } });
        return;
      }
      this.logger.error(`${run.key}:${run.state} step exhausted attempts for run ${runId}: ${error}`);
      await this.tolerantAdvance({ runId, event: PhaseControlEvent.STEP_FAILED, dataPatch: { error } });
    }
  }

  /**
   * Reaper entry: a shadow AgentRun's lease expired (the process died mid-step).
   * Re-lease + re-enqueue while attempts remain; otherwise fail the run (its
   * FAILED action bridges to the parent report / inquiry).
   */
  async recover({ runId }: { runId: string }): Promise<void> {
    const run = await this.repo.findById({ id: runId });
    if (!run) return;
    if (await this.isTerminal({ definitionId: run.workflowVersionId, state: run.state })) {
      await this.repo.closeShadowRun({ phaseRunId: runId, status: this.shadowStatusFor(run.state) });
      return;
    }
    const { attempts } = await this.repo.bumpAttempts({ id: runId });
    if (attempts < this.config.resilience.maxAttempts) {
      const delay = retryBackoffSeconds({ attempts });
      this.logger.warn(`reaper: re-enqueueing ${run.key} run ${runId} at ${run.state} (attempt ${attempts}, +${delay}s)`);
      await this.repo.heartbeatShadowRun({ phaseRunId: runId, leaseUntil: this.leaseFromNow(delay) });
      await this.boss.enqueue({ job: QueueJob.PhaseStep, data: { runId, expectedState: run.state }, options: { startAfter: delay } });
      return;
    }
    await this.tolerantAdvance({ runId, event: PhaseControlEvent.STEP_FAILED, dataPatch: { error: 'lease expired (reaped)' } });
  }

  /** Advance, swallowing the benign lost-race/no-transition ConflictError. */
  private async tolerantAdvance({ runId, event, dataPatch }: { runId: string; event: string; dataPatch?: Record<string, unknown> }): Promise<void> {
    try {
      await this.advanceRun({ runId, event, dataPatch });
    } catch (e) {
      if (!(e instanceof ConflictError)) throw e;
      this.logger.debug(`advance ${event} on run ${runId} lost/blocked — tolerated: ${(e as Error).message}`);
    }
  }

  /** Progress logger for steps: AgentEvent on the shadow run + progress/heartbeat events. */
  private stepLogger({ run }: { run: PhaseRun }): StageLogger {
    return async ({ message, data }) => {
      const shadow = await this.repo.findShadowRun({ phaseRunId: run.id });
      if (shadow) await this.db.agentEvent.create({ data: { runId: shadow.id, kind: AgentEventKind.Progress, message, data: data as Prisma.InputJsonValue } });
      await this.repo.heartbeatShadowRun({ phaseRunId: run.id, leaseUntil: this.leaseFromNow() });
      await this.outbox.emit({ type: EventType.AgentProgress, reportId: run.reportId, data: { stage: run.key, message } });
    };
  }

  /** The run's display subject when its working memory carries one (depth runs: the provider name). */
  private runName(data: Record<string, unknown>): string | null {
    return typeof data.name === 'string' && data.name ? data.name : null;
  }

  private shadowStatusFor(state: string): AgentRunStatus {
    if (state === FAILED_STATE) return AgentRunStatus.Failed;
    if (state === CANCELLED_STATE) return AgentRunStatus.Cancelled;
    return AgentRunStatus.Done;
  }

  private leaseFromNow(extraSeconds = 0): Date {
    return new Date(Date.now() + this.config.resilience.leaseMs + extraSeconds * 1000);
  }

  private async reportEngineActiveVersion({ key }: { key: string }): Promise<string> {
    // Reuse the report engine's parameterized lookup semantics without importing it
    // here (keeps PhasesModule → OrchestratorModule the only coupling point, via the registry).
    const def = await this.db.workflowDefinition.findFirst({ where: { key, status: WorkflowStatus.Active }, orderBy: { version: 'desc' } });
    if (!def) throw new NotFoundError({ code: ErrorCode.NoActiveWorkflow, message: `no active workflow for "${key}" — run db:seed` });
    return def.id;
  }

  private async definitionStates({ definitionId }: { definitionId: string }): Promise<Map<string, PhaseStateInfo>> {
    const cached = this.stateCache.get(definitionId);
    if (cached) return cached;
    const rows = await this.db.workflowState.findMany({ where: { definitionId } });
    const map = new Map(rows.map((r) => [r.name, { isTerminal: r.isTerminal, handler: r.handler ?? null, config: (r.config as Record<string, unknown> | null) ?? null }]));
    this.stateCache.set(definitionId, map);
    return map;
  }

  private async isTerminal({ definitionId, state }: { definitionId: string; state: string }): Promise<boolean> {
    return (await this.definitionStates({ definitionId })).get(state)?.isTerminal ?? false;
  }

  /** The current state's operator id + params for a composable phase (null for a plain step). */
  private async stateInfo({ definitionId, state }: { definitionId: string; state: string }): Promise<PhaseStateInfo | null> {
    return (await this.definitionStates({ definitionId })).get(state) ?? null;
  }
}

interface PhaseStateInfo { isTerminal: boolean; handler: string | null; config: Record<string, unknown> | null }
