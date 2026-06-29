import { EventType, InqiEvent } from '@inqi/shared';
import { AsyncStatus } from '../conventions/enums';
import { SubtaskRecord } from '../conventions/subtask';
import { ThreadMessageDto } from '../api/types';
import { Action, ActionType } from './actions';

export interface HistoryNode { status: string; at: string }

export interface SubtaskState {
  status: AsyncStatus;
  subtaskId: string | null;
  record: SubtaskRecord | null;
  chain: ThreadMessageDto[] | null;
  history: HistoryNode[]; // seeded from the record, appended on subtask.updated
  seen: Record<string, true>;
}

export const initialSubtaskState: SubtaskState = {
  status: AsyncStatus.Idle,
  subtaskId: null,
  record: null,
  chain: null,
  history: [],
  seen: {},
};

/**
 * Subtask system view (FE-11). The record comes from the admin board; the chain
 * from the admin thread endpoint; the **history is built here** from the seed
 * status + live `subtask.updated` events (no backend history store). Idempotent by id.
 */
export function subtaskReducer(state: SubtaskState, action: Action): SubtaskState {
  switch (action.type) {
    case ActionType.SubtaskLoaded:
      return {
        ...state,
        status: AsyncStatus.Ready,
        subtaskId: action.record.id,
        record: action.record,
        history: [{ status: action.record.status, at: action.at }],
        seen: {},
      };
    case ActionType.SubtaskChainLoaded:
      return { ...state, chain: action.messages };
    case ActionType.EventReceived: {
      const e: InqiEvent = action.event;
      if (!state.subtaskId || e.subtaskId !== state.subtaskId) return state;
      if (state.seen[e.id]) return state;
      const seen = { ...state.seen, [e.id]: true as const };
      let next: SubtaskState = { ...state, seen };
      if (e.type === EventType.SubtaskUpdated && state.record) {
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
