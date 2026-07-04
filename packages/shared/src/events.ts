/** Realtime event envelope. Every EventOutbox row serializes to this shape. */
export interface InqiEvent<T = unknown> {
  id: string;          // monotonic outbox id (cursor for replay)
  type: EventType;
  reportId: string;
  epicId?: string;
  inquiryId?: string;  // one candidate under the report (sourceId travels in `data`)
  at: string;          // ISO timestamp
  data: T;
}

/** Canonical realtime event types (`EventOutbox.type`). */
export const EventType = {
  ReportCreated: 'report.created',
  ReportTransitioned: 'report.transitioned',
  AgentStarted: 'agent.started',
  AgentProgress: 'agent.progress',
  AgentStopped: 'agent.stopped',      // agent stopped working -> pushed as event (per brief)
  AgentFailed: 'agent.failed',
  AgentHeartbeat: 'agent.heartbeat',  // liveness ping from a running stage (lease keep-alive)
  AgentCancelled: 'agent.cancelled',  // run abandoned because the report was cancelled
  AgentNeedsInput: 'agent.needs_input',
  RunReaped: 'run.reaped',            // reaper recovered a stuck run (failed/rescheduled)
  EpicCreated: 'epic.created',
  WaveReleased: 'wave.released',       // a wave of inquiries was released for outreach
  FunnelWidened: 'funnel.widened',     // discovery widened the funnel because it ran dry
  InquiryCreated: 'inquiry.created',   // a candidate entered the funnel
  InquiryUpdated: 'inquiry.updated',   // candidate status/score changed
  SourceAdded: 'source.added',         // channel source(s) recorded under an inquiry
  ModelUsed: 'model.used',             // a model engaged for this report — data: { model, modelVersion, tier } (once per distinct model+version)
  MessageSent: 'message.sent',
  MessageReceived: 'message.received',
  SnapshotReady: 'snapshot.ready',     // final report snapshot delivered
  SnapshotUpdated: 'snapshot.updated', // HP-21: snapshot options changed (freemium unlock reveal)
  // operator controls + version management (HP-11 / HP-12)
  ReportCancelled: 'report.cancelled',
  ReportPaused: 'report.paused',
  ReportResumed: 'report.resumed',
  WorkflowPublished: 'workflow.published',
  NotificationSent: 'notification.sent',  // customer notification dispatched (HP-13)
  // credits (HP-19)
  CreditsTopup: 'credits.topup',          // admin granted credits to a customer
  CreditsReserved: 'credits.reserved',    // credits held on report submit
  CreditsCharged: 'credits.charged',      // reservation finalized on REPORT_DELIVERED
  CreditsRefunded: 'credits.refunded',    // reservation returned on a non-delivered terminal
} as const;
export type EventType = (typeof EventType)[keyof typeof EventType];

/** @deprecated use {@link EventType}. Retained as a type alias for compatibility. */
export type InqiEventType = EventType;
