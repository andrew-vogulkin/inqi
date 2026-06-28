import { useEffect, useState } from 'react';

const KEY = 'inqi.session';
export interface Session { token: string; customer: { id: string; email: string; role: string } }

export function getSession(): Session | null {
  try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; }
}
function setSession(s: Session | null) {
  if (s) localStorage.setItem(KEY, JSON.stringify(s)); else localStorage.removeItem(KEY);
  emit(s); // notify every useSession() so the whole app re-renders on sign-in/out
}
export function authHeader(): Record<string, string> {
  const s = getSession();
  return s ? { authorization: `Bearer ${s.token}` } : {};
}

/** The Google OAuth client id, injected at build time. Absent → dev/keyless stub sign-in. */
export function googleClientId(): string | undefined {
  return (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_GOOGLE_CLIENT_ID || undefined;
}

/**
 * Sign in. In production a real Google ID token (the GIS `credential`) is passed;
 * in dev (AUTH_VERIFIER=stub) pass `stub:<email>` so the keyless demo can exercise
 * the full flow.
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

// Tiny pub-sub so sign-in from one component refreshes every useSession() consumer.
type Listener = (s: Session | null) => void;
const listeners = new Set<Listener>();
function emit(s: Session | null) { listeners.forEach(l => l(s)); }

/** React hook over the stored session; stays in sync across components. */
export function useSession() {
  const [session, setState] = useState<Session | null>(getSession());
  useEffect(() => { listeners.add(setState); return () => { listeners.delete(setState); }; }, []);
  return {
    session,
    signIn: async (idToken: string) => { await signIn(idToken); },
    signOut: () => { signOut(); },
  };
}
