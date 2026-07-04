import { EventType, InqiEvent } from '@inqi/shared';
import { AsyncStatus } from '../conventions/enums';
import { sortThread, appendThreadMessage, messageDtoFromEvent } from '../conventions/thread';
import { ThreadMessageDto } from '../api/types';
import { Action, ActionType } from './actions';

export interface ThreadState {
  status: AsyncStatus;
  inquiryId: string | null;
  messages: ThreadMessageDto[];
  seen: Record<string, true>;
}

export const initialThreadState: ThreadState = {
  status: AsyncStatus.Idle,
  inquiryId: null,
  messages: [],
  seen: {},
};

/**
 * FE-17 — operator outreach thread. Holds one inquiry's messages, kept chronological
 * and deduped by id. A `message.*` admin-room event is idempotent by event id; it
 * directly appends when the payload carries the message (forward-compatible) and is
 * always recorded in `seen` so the component can refetch the authoritative thread.
 */
export function threadReducer(state: ThreadState, action: Action): ThreadState {
  switch (action.type) {
    case ActionType.ThreadLoaded: {
      // Switching inquiry resets the seen set; same inquiry just refreshes the list.
      const reset = action.inquiryId !== state.inquiryId;
      return {
        status: AsyncStatus.Ready,
        inquiryId: action.inquiryId,
        messages: sortThread({ messages: action.messages }),
        seen: reset ? {} : state.seen,
      };
    }

    case ActionType.EventReceived: {
      const e: InqiEvent = action.event;
      if (!state.inquiryId || e.inquiryId !== state.inquiryId) return state;
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
