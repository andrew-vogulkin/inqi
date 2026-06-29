import { EventType, InqiEvent } from '@inqi/shared';
import { AsyncStatus } from '../conventions/enums';
import { sortThread, appendThreadMessage, messageDtoFromEvent } from '../conventions/thread';
import { ThreadMessageDto } from '../api/types';
import { Action, ActionType } from './actions';

export interface ThreadState {
  status: AsyncStatus;
  subtaskId: string | null;
  messages: ThreadMessageDto[];
  seen: Record<string, true>;
}

export const initialThreadState: ThreadState = {
  status: AsyncStatus.Idle,
  subtaskId: null,
  messages: [],
  seen: {},
};

/**
 * FE-17 — operator outreach thread. Holds one subtask's messages, kept chronological
 * and deduped by id. A `message.*` admin-room event is idempotent by event id; it
 * directly appends when the payload carries the message (forward-compatible) and is
 * always recorded in `seen` so the component can refetch the authoritative thread.
 */
export function threadReducer(state: ThreadState, action: Action): ThreadState {
  switch (action.type) {
    case ActionType.ThreadLoaded: {
      // Switching subtask resets the seen set; same subtask just refreshes the list.
      const reset = action.subtaskId !== state.subtaskId;
      return {
        status: AsyncStatus.Ready,
        subtaskId: action.subtaskId,
        messages: sortThread({ messages: action.messages }),
        seen: reset ? {} : state.seen,
      };
    }

    case ActionType.EventReceived: {
      const e: InqiEvent = action.event;
      if (!state.subtaskId || e.subtaskId !== state.subtaskId) return state;
      const isMessageEvent = e.type === EventType.MessageSent || e.type === EventType.MessageReceived;
      if (!isMessageEvent) return state;
      const msg = messageDtoFromEvent({ event: e }); // null for thin live events (no id/body)
      if (state.seen[e.id]) return state;
      const seen = { ...state.seen, [e.id]: true as const };
      const messages = msg ? appendThreadMessage({ messages: state.messages, message: msg }) : state.messages;
      return { ...state, seen, messages };
    }

    default:
      return state;
  }
}
