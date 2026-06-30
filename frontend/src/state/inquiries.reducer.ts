import { EventType } from '@inqi/shared';
import { AsyncStatus } from '../conventions/enums';
import { InquiryDto } from '../api/types';
import { Action, ActionType } from './actions';

export interface InquiriesState {
  status: AsyncStatus;
  byId: Record<string, InquiryDto>;
  order: string[]; // display order (most recent first, as loaded)
}
export const initialInquiriesState: InquiriesState = { status: AsyncStatus.Idle, byId: {}, order: [] };

function index(inquiries: InquiryDto[]): Pick<InquiriesState, 'byId' | 'order'> {
  const byId: Record<string, InquiryDto> = {};
  const order: string[] = [];
  for (const i of inquiries) { byId[i.id] = i; order.push(i.id); }
  return { byId, order };
}

/** Customer's inquiries slice. A transition event updates the matching inquiry's state. */
export function inquiriesReducer(state: InquiriesState, action: Action): InquiriesState {
  switch (action.type) {
    case ActionType.InquiriesLoaded:
      return { status: AsyncStatus.Ready, ...index(action.inquiries) };
    case ActionType.InquiryUpserted: {
      const i = action.inquiry;
      const exists = !!state.byId[i.id];
      return {
        ...state,
        byId: { ...state.byId, [i.id]: i },
        order: exists ? state.order : [i.id, ...state.order],
      };
    }
    case ActionType.EventReceived: {
      const e = action.event;
      // HP-23: a transition carries the new state AND the derived stage/qualifiedCount.
      // A stage-only transition (to === from) updates the pipeline without a state change.
      if (e.type === EventType.InquiryTransitioned && state.byId[e.inquiryId]) {
        const d = (e.data ?? {}) as { to?: string; stage?: string; qualifiedCount?: number };
        const cur = state.byId[e.inquiryId];
        const next = {
          ...cur,
          ...(d.to ? { state: d.to } : {}),
          ...(d.stage ? { stage: d.stage } : {}),
          ...(typeof d.qualifiedCount === 'number' ? { qualifiedCount: d.qualifiedCount } : {}),
        };
        return { ...state, byId: { ...state.byId, [e.inquiryId]: next } };
      }
      return state;
    }
    default:
      return state;
  }
}
