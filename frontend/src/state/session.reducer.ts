import { AuthState } from '../conventions/enums';
import { StoredSession, getStoredSession } from '../conventions/session-storage';
import { Action, ActionType } from './actions';

export interface SessionState {
  session: StoredSession | null;
  authState: AuthState; // sign-in flow (FE-02)
  error: string | null;
}

export const initialSessionState: SessionState = { session: null, authState: AuthState.SignedOut, error: null };

/** Hydrate from localStorage so a refresh stays signed in. */
export function hydratedSessionState(): SessionState {
  return { session: getStoredSession(), authState: AuthState.SignedOut, error: null };
}

/** Auth/session slice. Owns the whole sign-in flow; components only dispatch (convention #2). */
export function sessionReducer(state: SessionState, action: Action): SessionState {
  switch (action.type) {
    case ActionType.SessionRestored:
      return { session: action.session, authState: AuthState.SignedOut, error: null };
    case ActionType.SignInStarted:
      return { ...state, authState: AuthState.SigningIn, error: null };
    case ActionType.SignInFailed:
      return { ...state, authState: AuthState.Error, error: action.message };
    case ActionType.SignedIn:
      return { session: action.session, authState: AuthState.SignedOut, error: null };
    case ActionType.SignedOut:
      return { session: null, authState: AuthState.SignedOut, error: null };
    default:
      return state;
  }
}
