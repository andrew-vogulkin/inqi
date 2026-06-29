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
      if (e.type === EventType.InquiryTransitioned && state.byId[e.inquiryId]) {
        const to = (e.data as { to?: string })?.to;
        if (to) return { ...state, byId: { ...state.byId, [e.inquiryId]: { ...state.byId[e.inquiryId], state: to } } };
      }
      return state;
    }
    default:
      return state;
  }
}
