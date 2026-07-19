import { ReportState, ReportStage, STAGE_ORDER, stageIndex, deriveStage } from '@inqi/shared';
import { StatusTone } from './enums';
import { Route, RouteMatch } from './routes';

/**
 * Customer-facing pipeline stage. HP-23 promoted `ReportStage` + `deriveStage` into
 * the shared contract — the backend computes the stage from (state, qualifiedCount)
 * and the FE renders it from the DTO/events. These re-exports keep the FE call sites.
 */
export const Stage = ReportStage;
export type Stage = ReportStage;
export { STAGE_ORDER, stageIndex, deriveStage };

/** @deprecated state-only projection (qualifiedCount=0). Prefer the DTO `stage` via `stageForReport`. */
export function stageForReportState(state: string): Stage {
  return deriveStage({ state, qualifiedCount: 0 });
}

/** The stage to render for a report row — trust the backend `stage`, else derive from state + count. */
export function stageForReport({ state, stage, qualifiedCount }: { state: string; stage?: string; qualifiedCount?: number }): Stage {
  return (stage as Stage) || deriveStage({ state, qualifiedCount: qualifiedCount ?? 0 });
}

/** Preparing / Researching / Partially ready / Finalizing show a live pulse (work is ongoing). */
export function isLiveStage(stage: Stage): boolean {
  return stage === Stage.Preparing || stage === Stage.Researching || stage === Stage.PartiallyReady || stage === Stage.Finalizing;
}

/** A terminal *unsuccessful* state (paints the pipeline failed + a danger/warn badge). */
export function isFailedState(state: string): boolean {
  return state === ReportState.DENIED || state === ReportState.DROPPED || state === ReportState.FAILED || state === ReportState.CANCELLED;
}

/** Badge label + tone for a report *state* (terminal/declined/needs-you). */
export function statusBadge(state: string): { label: string; tone: StatusTone } {
  switch (state) {
    case ReportState.REPORT_DELIVERED: return { label: 'Ready', tone: StatusTone.Brand };
    case ReportState.DENIED: return { label: 'Declined', tone: StatusTone.Danger };
    case ReportState.DROPPED: return { label: 'Dropped', tone: StatusTone.Danger };
    case ReportState.FAILED: return { label: 'Failed', tone: StatusTone.Danger };
    case ReportState.CANCELLED: return { label: 'Cancelled', tone: StatusTone.Warn };
    case ReportState.QUESTIONNAIRE_SENT: return { label: 'Needs you', tone: StatusTone.Warn };
    default: return { label: 'In progress', tone: StatusTone.Info };
  }
}

/**
 * HP-23 stage-aware badge: the label/tone follow the derived stage on the happy path
 * (Researching → Partially ready → Ready), while terminal-bad / on-hold states win.
 */
export function stageBadge({ stage, state }: { stage: Stage; state: string }): { label: string; tone: StatusTone } {
  if (isFailedState(state)) return statusBadge(state);
  if (state === ReportState.ON_HOLD) return { label: 'On hold', tone: StatusTone.Warn };
  switch (stage) {
    case Stage.Ready: return { label: 'Ready', tone: StatusTone.Brand };
    case Stage.Finalizing: return { label: 'Finalizing', tone: StatusTone.Info };
    case Stage.PartiallyReady: return { label: 'Partially ready', tone: StatusTone.Info };
    case Stage.Researching: return { label: 'Researching', tone: StatusTone.Info };
    case Stage.Questionnaire: return { label: 'Needs you', tone: StatusTone.Warn };
    case Stage.Preparing: return { label: 'Preparing', tone: StatusTone.Info };
    default: return { label: 'Draft', tone: StatusTone.Muted };
  }
}

/**
 * Row routing by stage (FE-03). Every in-flight or delivered stage → the live report
 * (it renders partial runs natively); Questionnaire → own view (confirm); Draft → new
 * report. (The freemium teaser route is retired — partial results are not gated.)
 */
export function routeForStage({ stage, reportId }: { stage: Stage; reportId: string }): RouteMatch {
  switch (stage) {
    case Stage.Ready:
    case Stage.Finalizing:      // target met, delivery wrapping up — the live report shows the countdown
    case Stage.PartiallyReady:  // 2–4 qualified mid-run — the live report shows "N options so far"
    case Stage.Researching:
    case Stage.Preparing:       // HP-23: preparing shows the live report too (minimal agent activity)
    case Stage.Questionnaire:   // the live report detects this stage and routes to the questions + confirm form
      return { route: Route.Report, params: { id: reportId } };
    case Stage.Draft:
    default:
      return { route: Route.NewReport, params: {} };
  }
}
