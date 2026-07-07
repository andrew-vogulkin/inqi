import { Injectable } from '@nestjs/common';
import { PhaseKey } from '@inqi/shared';
import type { PhaseRun, Report, Inquiry } from '@prisma/client';
import { StageLogger } from '../../infra/observability/activity.service';

/**
 * What a step handler returns: the outcome EVENT it computed (the handler owns
 * branch decisions — TARGET_MET vs WENT_DRY vs CONTINUE) plus a shallow patch
 * merged into `run.data` by the engine when the transition commits.
 */
export interface StepOutcome {
  event: string;
  dataPatch?: Record<string, unknown>;
}

/** Everything a step executes against. `run.data` is the phase's working memory. */
export interface StepCtx {
  run: PhaseRun;
  report: Report;
  inquiry: Inquiry | null;
  log: StageLogger;
  /** For composable phases: the current state's operator id (`WorkflowState.handler`, defaults to the state name). */
  handler?: string | null;
  /** For composable phases: the current state's operator params (`WorkflowState.config`). */
  config?: Record<string, unknown> | null;
}

/** A per-key catch-all handler registers under this state; used when no exact (key,state) match exists. */
export const WILDCARD_STATE = '*';

export interface StepHandler {
  execute(ctx: StepCtx): Promise<StepOutcome>;
}

/**
 * Step handlers keyed by (phase key, state). Handlers register themselves in
 * their provider constructors — construction precedes every onModuleInit, so
 * registration always beats the first pg-boss delivery.
 */
@Injectable()
export class PhaseStepRegistry {
  private readonly handlers = new Map<string, StepHandler>();

  register({ key, state, handler }: { key: PhaseKey; state: string; handler: StepHandler }): void {
    this.handlers.set(`${key}:${state}`, handler);
  }

  find({ key, state }: { key: string; state: string }): StepHandler | null {
    // Exact (key,state) wins; a composable phase (subject_build) registers one
    // catch-all under WILDCARD_STATE because its state names are author-defined.
    return this.handlers.get(`${key}:${state}`) ?? this.handlers.get(`${key}:${WILDCARD_STATE}`) ?? null;
  }
}
