import { InquiryState, InquiryStage, STAGE_ORDER, stageIndex, deriveStage } from '@inqi/shared';
import { StatusTone } from './enums';
import { Route, RouteMatch } from './routes';

/**
 * Customer-facing pipeline stage. HP-23 promoted `InquiryStage` + `deriveStage` into
 * the shared contract — the backend computes the stage from (state, qualifiedCount)
 * and the FE renders it from the DTO/events. These re-exports keep the FE call sites.
 */
export const Stage = InquiryStage;
export type Stage = InquiryStage;
export { STAGE_ORDER, stageIndex, deriveStage };

/** @deprecated state-only projection (qualifiedCount=0). Prefer the DTO `stage` via `stageForInquiry`. */
export function stageForInquiryState(state: string): Stage {
  return deriveStage({ state, qualifiedCount: 0 });
}

/** The stage to render for an inquiry row — trust the backend `stage`, else derive from state + count. */
export function stageForInquiry({ state, stage, qualifiedCount }: { state: string; stage?: string; qualifiedCount?: number }): Stage {
  return (stage as Stage) || deriveStage({ state, qualifiedCount: qualifiedCount ?? 0 });
}

/** Preparing / Researching / Partially ready show a live pulse (work is ongoing). */
export function isLiveStage(stage: Stage): boolean {
  return stage === Stage.Preparing || stage === Stage.Researching || stage === Stage.PartiallyReady;
}

/** A terminal *unsuccessful* state (paints the pipeline failed + a danger/warn badge). */
export function isFailedState(state: string): boolean {
  return state === InquiryState.DENIED || state === InquiryState.DROPPED || state === InquiryState.FAILED || state === InquiryState.CANCELLED;
}

/** Badge label + tone for an inquiry *state* (terminal/declined/needs-you). */
export function statusBadge(state: string): { label: string; tone: StatusTone } {
  switch (state) {
    case InquiryState.REPORT_DELIVERED: return { label: 'Ready', tone: StatusTone.Brand };
    case InquiryState.DENIED: return { label: 'Declined', tone: StatusTone.Danger };
    case InquiryState.DROPPED: return { label: 'Dropped', tone: StatusTone.Danger };
    case InquiryState.FAILED: return { label: 'Failed', tone: StatusTone.Danger };
    case InquiryState.CANCELLED: return { label: 'Cancelled', tone: StatusTone.Warn };
    case InquiryState.QUESTIONNAIRE_SENT: return { label: 'Needs you', tone: StatusTone.Warn };
    default: return { label: 'In progress', tone: StatusTone.Info };
  }
}

/**
 * HP-23 stage-aware badge: the label/tone follow the derived stage on the happy path
 * (Researching → Partially ready → Ready), while terminal-bad / on-hold states win.
 */
export function stageBadge({ stage, state }: { stage: Stage; state: string }): { label: string; tone: StatusTone } {
  if (isFailedState(state)) return statusBadge(state);
  if (state === InquiryState.ON_HOLD) return { label: 'On hold', tone: StatusTone.Warn };
  switch (stage) {
    case Stage.Ready: return { label: 'Ready', tone: StatusTone.Brand };
    case Stage.PartiallyReady: return { label: 'Partially ready', tone: StatusTone.Info };
    case Stage.Researching: return { label: 'Researching', tone: StatusTone.Info };
    case Stage.Questionnaire: return { label: 'Needs you', tone: StatusTone.Warn };
    case Stage.Preparing: return { label: 'Preparing', tone: StatusTone.Info };
    default: return { label: 'Draft', tone: StatusTone.Muted };
  }
}

/**
 * Row routing by stage (FE-03). Researching/Ready → the live report (own view);
 * Partially ready → freemium teaser; Questionnaire → own view (confirm); Draft → new inquiry.
 */
export function routeForStage({ stage, inquiryId }: { stage: Stage; inquiryId: string }): RouteMatch {
  switch (stage) {
    case Stage.Ready:
    case Stage.Researching:
    case Stage.Preparing:       // HP-23: preparing shows the live report too (minimal agent activity)
    case Stage.Questionnaire:   // the live report detects this stage and routes to the questions + confirm form
      return { route: Route.Inquiry, params: { id: inquiryId } };
    case Stage.PartiallyReady:
      return { route: Route.Freemium, params: { id: inquiryId } };
    case Stage.Draft:
    default:
      return { route: Route.NewInquiry, params: {} };
  }
}
