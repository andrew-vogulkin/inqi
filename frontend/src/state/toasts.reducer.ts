import { ToastKind } from '../conventions/enums';
import { Action, ActionType, ToastItem } from './actions';

export interface ToastsState { items: ToastItem[]; seq: number }
export const initialToastsState: ToastsState = { items: [], seq: 0 };

/** Cross-cutting toasts. The reconnect notice is generated here (deterministic id via `seq`). */
export function toastsReducer(state: ToastsState, action: Action): ToastsState {
  switch (action.type) {
    case ActionType.ToastPushed:
      return { ...state, items: [...state.items, action.toast] };
    case ActionType.ToastDismissed:
      return { ...state, items: state.items.filter((t) => t.id !== action.id) };
    case ActionType.SocketReconnected: {
      const item: ToastItem = { id: `reconnect-${state.seq}`, kind: ToastKind.Info, message: 'Reconnected — no events missed.' };
      return { items: [...state.items, item], seq: state.seq + 1 };
    }
    default:
      return state;
  }
}
