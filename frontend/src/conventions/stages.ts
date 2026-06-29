import { InquiryState } from '@inqi/shared';
import { StatusTone } from './enums';
import { Route, RouteMatch } from './routes';

/**
 * Customer-facing 6-stage pipeline (FE-03). The internal workflow has more states;
 * these are the stages a customer sees. Order drives the StagePipeline segments.
 */
export const Stage = {
  Draft: 'Draft',
  Preparing: 'Preparing',
  Questionnaire: 'Questionnaire',
  Researching: 'Researching',
  PartiallyReady: 'Partially ready',
  Ready: 'Ready',
} as const;
export type Stage = (typeof Stage)[keyof typeof Stage];

/** Ordered stages (index = StagePipeline segment). */
export const STAGE_ORDER: Stage[] = [Stage.Draft, Stage.Preparing, Stage.Questionnaire, Stage.Researching, Stage.PartiallyReady, Stage.Ready];

export function stageIndex(stage: Stage): number {
  return STAGE_ORDER.indexOf(stage);
}

/** Map an internal InquiryState → the customer stage. */
export function stageForInquiryState(state: string): Stage {
  switch (state) {
    case InquiryState.RECEIVED:
    case InquiryState.PRE_RESEARCH:
      return Stage.Preparing;
    case InquiryState.QUESTIONNAIRE_SENT:
      return Stage.Questionnaire;
    case InquiryState.ENRICHMENT:
    case InquiryState.BROAD_RESEARCH:
    case InquiryState.FUNNEL:
    case InquiryState.OUTREACH:
    case InquiryState.REPORT_GENERATION:
      return Stage.Researching;
    case InquiryState.REPORT_DELIVERED:
      return Stage.Ready;
    default:
      return Stage.Preparing; // terminal-bad states show via the badge; pipeline marked failed
  }
}

/** Preparing / Researching show a live pulse. */
export function isLiveStage(stage: Stage): boolean {
  return stage === Stage.Preparing || stage === Stage.Researching;
}

/** A terminal *unsuccessful* state (paints the pipeline failed + a danger/warn badge). */
export function isFailedState(state: string): boolean {
  return state === InquiryState.DENIED || state === InquiryState.DROPPED || state === InquiryState.FAILED || state === InquiryState.CANCELLED;
}

/** Badge label + tone for an inquiry state (customer-facing). */
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
 * Row routing by stage (FE-03). Researching/Ready → the live report (own view);
 * Partially ready → freemium teaser; Questionnaire → own view (confirm); Draft → new inquiry.
 */
export function routeForStage({ stage, inquiryId }: { stage: Stage; inquiryId: string }): RouteMatch {
  switch (stage) {
    case Stage.Ready:
    case Stage.Researching:
    case Stage.Questionnaire:
      return { route: Route.Inquiry, params: { id: inquiryId } };
    case Stage.PartiallyReady:
      return { route: Route.Freemium, params: { id: inquiryId } };
    case Stage.Draft:
    default:
      return { route: Route.NewInquiry, params: {} };
  }
}
