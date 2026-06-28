import { useEffect, useRef, useState } from 'react';
import { googleClientId, signIn } from './auth';

// Minimal shape of the Google Identity Services global we touch.
declare global { interface Window { google?: any } }

let gsiPromise: Promise<void> | null = null;
function loadGsi(): Promise<void> {
  if (window.google?.accounts?.id) return Promise.resolve();
  return (gsiPromise ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true; s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('failed to load Google Identity Services'));
    document.head.appendChild(s);
  }));
}

/**
 * Real "Sign in with Google" button wired to HP-10. When VITE_GOOGLE_CLIENT_ID is
 * set it renders the genuine GIS button → ID token → POST /api/auth/google. With no
 * client id (the keyless demo) it degrades to a stub email sign-in (AUTH_VERIFIER=stub).
 */
export function GoogleSignIn({ hint, onSignedIn }: { hint?: string; onSignedIn?: () => void }) {
  const clientId = googleClientId();
  const btnRef = useRef<HTMLDivElement>(null);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function complete(idToken: string) {
    try { setBusy(true); setErr(null); await signIn(idToken); onSignedIn?.(); }
    catch (e) { setErr(e instanceof Error ? e.message : 'sign-in failed'); }
    finally { setBusy(false); }
  }

  useEffect(() => {
    if (!clientId || !btnRef.current) return;
    let cancelled = false;
    loadGsi().then(() => {
      if (cancelled || !btnRef.current) return;
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: (resp: { credential: string }) => complete(resp.credential),
      });
      window.google.accounts.id.renderButton(btnRef.current, { theme: 'outline', size: 'large', text: 'signin_with' });
    }).catch((e: Error) => setErr(e.message));
    return () => { cancelled = true; };
  }, [clientId]);

  if (clientId) return (
    <div>
      <div ref={btnRef} />
      {busy && <p style={{ color: '#888' }}>Signing in…</p>}
      {err && <p style={{ color: '#c62828' }}>{err}</p>}
    </div>
  );

  // Keyless demo fallback.
  return (
    <div>
      <p style={{ color: '#888', fontSize: 13 }}>
        Dev sign-in — no <code>VITE_GOOGLE_CLIENT_ID</code> configured, so this uses the stub verifier.{hint ? ` (${hint})` : ''}
      </p>
      <input placeholder={hint ?? 'your email'} value={email} onChange={e => setEmail(e.target.value)} style={{ padding: 8, marginRight: 8 }} />
      <button onClick={() => complete(`stub:${email}`)} disabled={!email || busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      {err && <p style={{ color: '#c62828' }}>{err}</p>}
    </div>
  );
}

/** A login wall for the private views (customer dashboard, admin board). */
export function SignInGate({ title, hint }: { title: string; hint?: string }) {
  return (
    <section>
      <h2>{title}</h2>
      <GoogleSignIn hint={hint} />
    </section>
  );
}
