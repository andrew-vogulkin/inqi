import { useState } from 'react';

const KEY = 'inqi.session';
export interface Session { token: string; customer: { id: string; email: string; role: string } }

export function getSession(): Session | null {
  try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; }
}
function setSession(s: Session | null) {
  if (s) localStorage.setItem(KEY, JSON.stringify(s)); else localStorage.removeItem(KEY);
}
export function authHeader(): Record<string, string> {
  const s = getSession();
  return s ? { authorization: `Bearer ${s.token}` } : {};
}

/**
 * Sign in. In production a real Google ID token is passed; in dev (AUTH_VERIFIER=stub)
 * pass `stub:<email>` so the keyless demo can exercise the full flow.
 */
export async function signIn(idToken: string): Promise<Session> {
  const res = await fetch('/api/auth/google', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ idToken }),
  });
  if (!res.ok) throw new Error(`sign-in failed (${res.status})`);
  const s = (await res.json()) as Session;
  setSession(s);
  return s;
}
export function signOut() { setSession(null); }

/** React hook over the stored session. */
export function useSession() {
  const [session, setState] = useState<Session | null>(getSession());
  return {
    session,
    signIn: async (idToken: string) => { setState(await signIn(idToken)); },
    signOut: () => { signOut(); setState(null); },
  };
}
