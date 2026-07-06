import { AuthState } from '../conventions/enums';
import { StoredSession, getStoredSession } from '../conventions/session-storage';
import { Action, ActionType } from './actions';

export interface SessionState {
  session: StoredSession | null;
  authState: AuthState; // two-step sign-in flow (FE-02): email → MFA code
  /** The email step 1 was accepted for — the code step verifies THIS address. */
  pendingEmail: string | null;
  error: string | null;
}

export const initialSessionState: SessionState = { session: null, authState: AuthState.SignedOut, pendingEmail: null, error: null };

/** Hydrate from localStorage so a refresh stays signed in. */
export function hydratedSessionState(): SessionState {
  return { session: getStoredSession(), authState: AuthState.SignedOut, pendingEmail: null, error: null };
}

/** Auth/session slice. Owns the whole two-step sign-in flow; components only dispatch (convention #2). */
export function sessionReducer(state: SessionState, action: Action): SessionState {
  switch (action.type) {
    case ActionType.SessionRestored:
      return { session: action.session, authState: AuthState.SignedOut, pendingEmail: null, error: null };
    case ActionType.SignInStarted:
      return { ...state, authState: AuthState.SigningIn, error: null };
    case ActionType.CodeSent:
      return { ...state, authState: AuthState.CodeSent, pendingEmail: action.email, error: null };
    case ActionType.SignInFailed:
      // Keep pendingEmail: a wrong code re-shows the code step for the same address.
      return { ...state, authState: AuthState.Error, error: action.message };
    case ActionType.SignedIn:
      return { session: action.session, authState: AuthState.SignedOut, pendingEmail: null, error: null };
    case ActionType.SignedOut:
      return { session: null, authState: AuthState.SignedOut, pendingEmail: null, error: null };
    default:
      return state;
  }
}
