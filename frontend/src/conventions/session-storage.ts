import { AuthRole } from '@inqi/shared';

/** The persisted session (HP-10 sign-in result), the single source the api layer reads for the Bearer token. */
export interface StoredSession {
  token: string;
  customer: { id: string; email: string; name?: string | null; role: AuthRole };
}

const KEY = 'inqi.session';

/**
 * In-memory cache is the AUTHORITATIVE source the api layer reads, so the Bearer
 * token is live the instant sign-in completes — before the (async) persist effect
 * flushes and before the destination screen fires its first authed request. Without
 * this, `verifyCode`'s navigate races the persist effect: the first post-login fetch
 * goes out token-less → 401 → bounced back to Sign in (seen on iOS Safari). It also
 * keeps auth working when localStorage is unavailable (iOS private browsing throws).
 * `undefined` = not hydrated yet.
 */
let cache: StoredSession | null | undefined;

export function getStoredSession(): StoredSession | null {
  if (cache === undefined) {
    try { cache = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { cache = null; }
  }
  return cache ?? null;
}

export function setStoredSession(session: StoredSession | null): void {
  cache = session; // synchronous — the token is readable immediately, storage or not
  try {
    if (session) localStorage.setItem(KEY, JSON.stringify(session));
    else localStorage.removeItem(KEY);
  } catch {
    // Storage blocked (private mode / disabled): the in-memory cache still carries
    // the session for this tab, so the user stays signed in for the session.
  }
}
