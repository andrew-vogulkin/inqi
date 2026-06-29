import { AsyncStatus } from '../conventions/enums';
import { AuditFilter, sortEntries } from '../conventions/audit';
import { AuditEntryDto } from '../api/types';
import { Action, ActionType } from './actions';

export interface AuditState {
  status: AsyncStatus;
  filter: AuditFilter;
  entries: AuditEntryDto[];
  error: string | null;
}

export const initialAuditState: AuditState = {
  status: AsyncStatus.Idle,
  filter: AuditFilter.All,
  entries: [],
  error: null,
};

/**
 * FE-14 — audit trail filter + rows. The selected filter chip is reducer state
 * (convention #2); the component refetches when it changes. Entries are kept
 * newest-first.
 */
export function auditReducer(state: AuditState, action: Action): AuditState {
  switch (action.type) {
    case ActionType.AuditFilterSelected:
      return { ...state, filter: action.filter, status: AsyncStatus.Loading };
    case ActionType.AuditLoading:
      return { ...state, status: AsyncStatus.Loading, error: null };
    case ActionType.AuditLoaded:
      return { ...state, status: AsyncStatus.Ready, entries: sortEntries({ entries: action.entries }), error: null };
    case ActionType.AuditLoadFailed:
      return { ...state, status: AsyncStatus.Error, error: action.message };
    default:
      return state;
  }
}
