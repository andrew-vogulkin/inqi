/** Realtime event envelope. Every EventOutbox row serializes to this shape. */
export interface InqiEvent<T = unknown> {
  id: string;          // monotonic outbox id (cursor for replay)
  type: EventType;
  inquiryId: string;
  epicId?: string;
  subtaskId?: string;
  at: string;          // ISO timestamp
  data: T;
}

/** Canonical realtime event types (`EventOutbox.type`). */
export const EventType = {
  InquiryCreated: 'inquiry.created',
  InquiryTransitioned: 'inquiry.transitioned',
  AgentStarted: 'agent.started',
  AgentProgress: 'agent.progress',
  AgentStopped: 'agent.stopped',      // agent stopped working -> pushed as event (per brief)
  AgentFailed: 'agent.failed',
  AgentHeartbeat: 'agent.heartbeat',  // liveness ping from a running stage (lease keep-alive)
  AgentCancelled: 'agent.cancelled',  // run abandoned because the inquiry was cancelled
  AgentNeedsInput: 'agent.needs_input',
  RunReaped: 'run.reaped',            // reaper recovered a stuck run (failed/rescheduled)
  EpicCreated: 'epic.created',
  WaveReleased: 'wave.released',       // a wave of subtasks was released for outreach
  FunnelWidened: 'funnel.widened',     // discovery widened the funnel because it ran dry
  SubtaskCreated: 'subtask.created',
  SubtaskUpdated: 'subtask.updated',
  MessageSent: 'message.sent',
  MessageReceived: 'message.received',
  ReportReady: 'report.ready',
} as const;
export type EventType = (typeof EventType)[keyof typeof EventType];

/** @deprecated use {@link EventType}. Retained as a type alias for compatibility. */
export type InqiEventType = EventType;
