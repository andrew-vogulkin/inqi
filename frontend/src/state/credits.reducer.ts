import { EventType } from '@inqi/shared';
import { AsyncStatus } from '../conventions/enums';
import { sortedLedger } from '../conventions/credits';
import { CreditEntry } from '../api/types';
import { Action, ActionType } from './actions';

export interface CreditsState {
  status: AsyncStatus;
  balance: number;
  history: CreditEntry[];
  /** Recency watermark (ISO): the newest ledger entry the loaded snapshot covered.
   *  Only credit events NEWER than this may move the balance — the dashboard replays
   *  each report's full event history, and those historical charges are already
   *  inside the snapshot (compounding them as deltas drove the chip negative). */
  asOf: string | null;
}
export const initialCreditsState: CreditsState = { status: AsyncStatus.Idle, balance: 0, history: [], asOf: null };

/** Credits slice (HP-19/FE-09). Reacts to realtime credit events; top-ups have no event (manual refresh). */
export function creditsReducer(state: CreditsState, action: Action): CreditsState {
  switch (action.type) {
    case ActionType.CreditsLoading:
      return { ...state, status: AsyncStatus.Loading };
    case ActionType.CreditsLoaded: {
      const history = sortedLedger(action.history);
      return { status: AsyncStatus.Ready, balance: action.balance, history, asOf: history[0]?.createdAt ?? state.asOf };
    }
    case ActionType.EventReceived: {
      const { type, at, data } = action.event;
      if (type !== EventType.CreditsCharged && type !== EventType.CreditsRefunded && type !== EventType.CreditsReserved) return state;
      const d = (data ?? {}) as { amount?: number; balance?: number };
      // The event carries the post-settlement balance — set it ABSOLUTELY, never as a
      // delta. Events without one (pre-balance-payload history) and events at/behind
      // the watermark are already reflected in the loaded snapshot: ignore them.
      if (typeof d.balance !== 'number') return state;
      if (state.asOf && at <= state.asOf) return state;
      return { ...state, balance: d.balance, asOf: at };
    }
    default:
      return state;
  }
}
