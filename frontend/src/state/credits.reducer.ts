import { EventType } from '@inqi/shared';
import { AsyncStatus } from '../conventions/enums';
import { sortedLedger } from '../conventions/credits';
import { CreditEntry } from '../api/types';
import { Action, ActionType } from './actions';

export interface CreditsState { status: AsyncStatus; balance: number; history: CreditEntry[] }
export const initialCreditsState: CreditsState = { status: AsyncStatus.Idle, balance: 0, history: [] };

/** Credits slice (HP-19/FE-09). Reacts to realtime credit events; top-ups have no event (manual refresh). */
export function creditsReducer(state: CreditsState, action: Action): CreditsState {
  switch (action.type) {
    case ActionType.CreditsLoading:
      return { ...state, status: AsyncStatus.Loading };
    case ActionType.CreditsLoaded:
      return { status: AsyncStatus.Ready, balance: action.balance, history: sortedLedger(action.history) };
    case ActionType.EventReceived: {
      const { type, data } = action.event;
      const d = (data ?? {}) as { amount?: number; balance?: number };
      if (type === EventType.CreditsReserved) {
        return { ...state, balance: typeof d.balance === 'number' ? d.balance : state.balance - (d.amount ?? 0) };
      }
      if (type === EventType.CreditsRefunded) {
        return { ...state, balance: state.balance + (d.amount ?? 0) };
      }
      return state; // charge finalizes a hold → no balance change
    }
    default:
      return state;
  }
}
