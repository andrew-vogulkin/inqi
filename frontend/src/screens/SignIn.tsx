import { useEffect, useRef, useState } from 'react';
import { AuthState } from '../conventions/enums';
import { Route, navigate, hrefFor } from '../conventions/routes';
import { googleClientId } from '../conventions/google';
import { color, space, fontSize, fontWeight } from '../theme/tokens';
import { authApi, ApiError } from '../api';
import { Button, Card, Input } from '../ui';
import { useAppDispatch, useSelector } from '../state/store';
import { ActionType } from '../state/actions';

declare global { interface Window { google?: any } }

let gsiPromise: Promise<void> | null = null;
function loadGsi(): Promise<void> {
  if (window.google?.accounts?.id) return Promise.resolve();
  return (gsiPromise ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true; s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('failed to load Google sign-in'));
    document.head.appendChild(s);
  }));
}

/** FE-02 — the signed-out entry screen: brand statement + Continue with Google. */
export function SignIn() {
  const dispatch = useAppDispatch();
  const authState = useSelector((s) => s.session.authState);
  const error = useSelector((s) => s.session.error);
  const clientId = googleClientId();
  const btnRef = useRef<HTMLDivElement>(null);
  const [email, setEmail] = useState('');

  // The async glue (call api → dispatch result → route). No business logic here.
  async function signIn(idToken: string) {
    dispatch({ type: ActionType.SignInStarted });
    try {
      const session = await authApi.signInWithGoogle({ idToken });
      dispatch({ type: ActionType.SignedIn, session });
      navigate({ route: Route.Dashboard });
    } catch (e) {
      dispatch({ type: ActionType.SignInFailed, message: e instanceof ApiError ? e.message : 'Sign-in failed. Please try again.' });
    }
  }

  // Render the real Google Identity Services button when configured.
  useEffect(() => {
    if (!clientId || !btnRef.current) return;
    let cancelled = false;
    loadGsi().then(() => {
      if (cancelled || !btnRef.current) return;
      window.google.accounts.id.initialize({ client_id: clientId, callback: (r: { credential: string }) => signIn(r.credential) });
      window.google.accounts.id.renderButton(btnRef.current, { theme: 'outline', size: 'large', text: 'continue_with', width: 320 });
    }).catch(() => dispatch({ type: ActionType.SignInFailed, message: 'Couldn’t load Google sign-in.' }));
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  const busy = authState === AuthState.SigningIn;

  return (
    <div style={{ maxWidth: 420, margin: '0 auto', paddingTop: space[10] }}>
      <h1 style={{ fontSize: fontSize.h1, marginBottom: space[3] }}>Your AI does the legwork.</h1>
      <p style={{ color: color.muted, marginBottom: space[6] }}>
        Tell inqi what you're after. It researches, vets, and reaches out — then returns a live, ranked report you can trust.
      </p>

      <Card>
        {clientId ? (
          <div>
            <div ref={btnRef} style={{ minHeight: 44 }} data-testid="google-button" />
            {busy && <p style={{ color: color.muted, marginTop: space[2] }}>Signing you in…</p>}
          </div>
        ) : (
          <div style={{ display: 'grid', gap: space[2] }}>
            <p style={{ color: color.muted, fontSize: fontSize.sm, margin: 0 }}>
              Dev sign-in — no <code>VITE_GOOGLE_CLIENT_ID</code> set, so this uses the stub verifier.
            </p>
            <Input value={email} onChange={setEmail} placeholder="your email" />
            <Button full disabled={!email || busy} onClick={() => signIn(`stub:${email}`)}>
              {busy ? 'Signing in…' : 'Continue with Google'}
            </Button>
          </div>
        )}
        {authState === AuthState.Error && error && (
          <p data-testid="signin-error" style={{ color: color.danger, marginTop: space[3], fontSize: fontSize.sm }}>{error}</p>
        )}
      </Card>

      <p style={{ color: color.subtle, fontSize: fontSize.sm, textAlign: 'center', marginTop: space[4] }}>
        First report is free. No card required.
      </p>
      <p style={{ textAlign: 'center', marginTop: space[2] }}>
        <a href={hrefFor({ route: Route.StyleGuide })} style={{ fontSize: fontSize.xs, color: color.subtle }}>styleguide</a>
      </p>
    </div>
  );
}
