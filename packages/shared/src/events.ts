/** Realtime event envelope. Every EventOutbox row serializes to this shape. */
export interface InqiEvent<T = unknown> {
  id: string;          // monotonic outbox id (cursor for replay)
  type: InqiEventType;
  inquiryId: string;
  epicId?: string;
  subtaskId?: string;
  at: string;          // ISO timestamp
  data: T;
}

export type InqiEventType =
  | 'inquiry.created'
  | 'inquiry.transitioned'
  | 'agent.started'
  | 'agent.progress'
  | 'agent.stopped'      // agent stopped working -> pushed as event (per brief)
  | 'agent.failed'
  | 'epic.created'
  | 'subtask.created'
  | 'subtask.updated'
  | 'message.sent'
  | 'message.received'
  | 'report.ready';
