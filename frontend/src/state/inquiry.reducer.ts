import { EventType, InqiEvent } from '@inqi/shared';
import { AsyncStatus } from '../conventions/enums';
import { InquiryRecord } from '../conventions/inquiry';
import { ThreadMessageDto } from '../api/types';
import { Action, ActionType } from './actions';

export interface HistoryNode { status: string; at: string }

export interface InquiryState {
  status: AsyncStatus;
  inquiryId: string | null;
  record: InquiryRecord | null;
  chain: ThreadMessageDto[] | null;
  history: HistoryNode[]; // seeded from the record, appended on inquiry.updated
  seen: Record<string, true>;
}

export const initialInquiryState: InquiryState = {
  status: AsyncStatus.Idle,
  inquiryId: null,
  record: null,
  chain: null,
  history: [],
  seen: {},
};

/**
 * Inquiry system view (FE-11). The record comes from the admin board; the chain
 * from the admin thread endpoint; the **history is built here** from the seed
 * status + live `inquiry.updated` events (no backend history store). Idempotent by id.
 */
export function inquiryReducer(state: InquiryState, action: Action): InquiryState {
  switch (action.type) {
    case ActionType.InquiryLoaded:
      return {
        ...state,
        status: AsyncStatus.Ready,
        inquiryId: action.record.id,
        record: action.record,
        history: [{ status: action.record.status, at: action.at }],
        seen: {},
      };
    case ActionType.InquiryChainLoaded:
      return { ...state, chain: action.messages };
    case ActionType.EventReceived: {
      const e: InqiEvent = action.event;
      if (!state.inquiryId || e.inquiryId !== state.inquiryId) return state;
      if (state.seen[e.id]) return state;
      const seen = { ...state.seen, [e.id]: true as const };
      let next: InquiryState = { ...state, seen };
      if (e.type === EventType.InquiryUpdated && state.record) {
        const d = (e.data ?? {}) as { status?: string; qualityScore?: number };
        const status = d.status ?? state.record.status;
        next = {
          ...next,
          record: { ...state.record, status, qualityScore: typeof d.qualityScore === 'number' ? d.qualityScore : state.record.qualityScore },
          history: d.status ? [...state.history, { status: d.status, at: e.at }] : state.history,
        };
      }
      return next;
    }
    default:
      return state;
  }
}
