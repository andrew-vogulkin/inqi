import { NotificationKind, ReportState } from '@inqi/shared';

/**
 * The report lifecycle, seen from the customer's side. Workflow *states* drive the
 * pipeline; lifecycle *events* are the customer-visible moments derived from them —
 * plus `updated`, which has no workflow transition at all (the state stays
 * REPORT_DELIVERED while the snapshot is re-evaluated in place).
 *
 * ```
 * created    ← the request was submitted (RECEIVED is the initial state — no
 *              transition lands on it, so report intake dispatches this one itself)
 * needs-you  ← QUESTIONNAIRE_SENT reached (scope confirmation waiting on the customer)
 * delivered  ← REPORT_DELIVERED reached (report done, credit charged)
 * updated    ← a delivered snapshot re-ranked/re-synthesized (late reply / late research)
 * denied     ← PRE_RESEARCH rejected the request (ethics/feasibility/compliance)
 * dropped    ← questionnaire expired unconfirmed
 * failed     ← a pipeline stage dead-lettered after retries
 * cancelled  ← customer/operator cancelled the run
 * ```
 */
export const ReportLifecycleEvent = {
  Created: 'created',
  NeedsYou: 'needs_you',
  Delivered: 'delivered',
  Updated: 'updated',
  Denied: 'denied',
  Dropped: 'dropped',
  Failed: 'failed',
  Cancelled: 'cancelled',
} as const;
export type ReportLifecycleEvent = (typeof ReportLifecycleEvent)[keyof typeof ReportLifecycleEvent];

/** Pure: the lifecycle event a workflow state maps to (null for internal processing states). */
export function lifecycleEventForState(state: string): ReportLifecycleEvent | null {
  switch (state) {
    case ReportState.RECEIVED: return ReportLifecycleEvent.Created; // dispatched by intake, not the engine
    case ReportState.QUESTIONNAIRE_SENT: return ReportLifecycleEvent.NeedsYou;
    case ReportState.REPORT_DELIVERED: return ReportLifecycleEvent.Delivered;
    case ReportState.DENIED: return ReportLifecycleEvent.Denied;
    case ReportState.DROPPED: return ReportLifecycleEvent.Dropped;
    case ReportState.FAILED: return ReportLifecycleEvent.Failed;
    case ReportState.CANCELLED: return ReportLifecycleEvent.Cancelled;
    default: return null;
  }
}

/**
 * The lifecycle handler table: which events email the customer, and with what.
 * Dispatched centrally (workflow engine on every transition + the snapshot-refresh
 * worker for `updated`) — no stage hand-rolls its own notify call.
 */
export const LIFECYCLE_NOTIFICATIONS: Record<ReportLifecycleEvent, NotificationKind | null> = {
  [ReportLifecycleEvent.Created]: NotificationKind.ReportReceived,
  [ReportLifecycleEvent.NeedsYou]: NotificationKind.QuestionnaireRequest,
  [ReportLifecycleEvent.Delivered]: NotificationKind.ReportReady,
  [ReportLifecycleEvent.Updated]: NotificationKind.ReportUpdated,
  [ReportLifecycleEvent.Denied]: NotificationKind.Denial,
  [ReportLifecycleEvent.Dropped]: null,   // the questionnaire reminder already warned before expiry
  [ReportLifecycleEvent.Failed]: null,    // internal failure — operator concern; the run costs the customer nothing
  [ReportLifecycleEvent.Cancelled]: null, // customer/operator action — they already know
};

/** Pure: the customer notification a lifecycle event triggers (null → silent event). */
export function notificationForLifecycle(event: ReportLifecycleEvent): NotificationKind | null {
  return LIFECYCLE_NOTIFICATIONS[event];
}
