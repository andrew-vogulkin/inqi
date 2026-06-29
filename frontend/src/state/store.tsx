import { createContext, useContext, useEffect, useReducer, Dispatch, ReactNode } from 'react';
import { setStoredSession } from '../conventions/session-storage';
import { Action } from './actions';
import { AppState, initialAppState, rootReducer } from './root';

const StateContext = createContext<AppState | null>(null);
const DispatchContext = createContext<Dispatch<Action> | null>(null);

/** App store: combined reducers behind context. Session persistence is an effect (reducers stay pure). */
export function StoreProvider({ children, preloaded }: { children: ReactNode; preloaded?: AppState }) {
  const [state, dispatch] = useReducer(rootReducer, undefined, () => preloaded ?? initialAppState());

  useEffect(() => { setStoredSession(state.session.session); }, [state.session.session]);

  // Dev-only test seam (e2e drives realtime events through the real reducers). Never in prod builds.
  useEffect(() => {
    if ((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV) {
      (window as unknown as { __inqiDispatch?: Dispatch<Action> }).__inqiDispatch = dispatch;
    }
  }, []);

  return (
    <DispatchContext.Provider value={dispatch}>
      <StateContext.Provider value={state}>{children}</StateContext.Provider>
    </DispatchContext.Provider>
  );
}

export function useAppState(): AppState {
  const s = useContext(StateContext);
  if (!s) throw new Error('useAppState must be used within <StoreProvider>');
  return s;
}

export function useAppDispatch(): Dispatch<Action> {
  const d = useContext(DispatchContext);
  if (!d) throw new Error('useAppDispatch must be used within <StoreProvider>');
  return d;
}

/** Select a slice of state (components select + dispatch; no logic in the view). */
export function useSelector<T>(selector: (s: AppState) => T): T {
  return selector(useAppState());
}
