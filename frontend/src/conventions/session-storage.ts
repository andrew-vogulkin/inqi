import { AuthRole } from '@inqi/shared';

/** The persisted session (HP-10 sign-in result), the single source the api layer reads for the Bearer token. */
export interface StoredSession {
  token: string;
  customer: { id: string; email: string; name?: string | null; role: AuthRole };
}

const KEY = 'inqi.session';

export function getStoredSession(): StoredSession | null {
  try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; }
}

export function setStoredSession(session: StoredSession | null): void {
  if (session) localStorage.setItem(KEY, JSON.stringify(session));
  else localStorage.removeItem(KEY);
}
