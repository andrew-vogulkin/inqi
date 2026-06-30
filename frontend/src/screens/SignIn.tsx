import { useEffect, useRef, useState } from 'react';
import { AuthRole } from '@inqi/shared';
import { AuthState } from '../conventions/enums';
import { Route, navigate, hrefFor, readReturnTo } from '../conventions/routes';
import { googleClientId } from '../conventions/google';
import { color, space, fontSize, fontWeight, radius, font } from '../theme/tokens';
import { authApi, ApiError } from '../api';
import { Input } from '../ui';
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

/** FE-02 — signed-out entry: brand statement + Continue with Google (prototype: flat centered column). */
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
      // HP-24: resume the deep link the user was bounced from (notification links included),
      // else land on the role-aware home — operators to the console, customers to the dashboard.
      const returnTo = readReturnTo();
      if (returnTo) window.location.hash = returnTo;
      else navigate({ route: session.customer.role === AuthRole.Admin ? Route.Admin : Route.Dashboard });
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
      window.google.accounts.id.renderButton(btnRef.current, { theme: 'outline', size: 'large', text: 'continue_with', width: 340 });
    }).catch(() => dispatch({ type: ActionType.SignInFailed, message: 'Couldn’t load Google sign-in.' }));
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  const busy = authState === AuthState.SigningIn;

  return (
    <div style={{ minHeight: '70vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: space[10] }}>
      <div style={{ width: '100%', maxWidth: 380, textAlign: 'center' }}>
        {/* brand mark — the one place green leads */}
        <div style={{ width: 48, height: 48, borderRadius: radius.xl, background: color.brand, color: color.onSolid, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: fontWeight.bold, fontSize: 26, margin: `0 auto ${space[6]}px` }}>i</div>
        <h1 style={{ fontSize: fontSize.h1, fontWeight: fontWeight.semibold, letterSpacing: '-.02em', margin: `0 0 ${space[2]}px` }}>One inquiry. AI agents on it.</h1>
        <p style={{ fontSize: fontSize.lg, color: color.muted, lineHeight: 1.55, margin: `0 0 ${space[6]}px` }}>
          Ask inqi for anything. Agents research and reach out to real providers, then stream back a live, ranked report of your options.
        </p>

        {clientId ? (
          <>
            <div ref={btnRef} style={{ minHeight: 48, display: 'flex', justifyContent: 'center' }} data-testid="google-button" />
            {busy && <p style={{ color: color.muted, marginTop: space[2], fontSize: fontSize.sm }}>Signing you in…</p>}
          </>
        ) : (
          <div style={{ display: 'grid', gap: space[2] }}>
            <Input value={email} onChange={setEmail} placeholder="your email" />
            <button
              onClick={() => email && signIn(`stub:${email}`)}
              disabled={!email || busy}
              data-testid="signin-button"
              style={{
                width: '100%', height: 48, borderRadius: radius.md, background: color.ink, color: color.onSolid,
                fontFamily: font.ui, fontSize: fontSize.lg, fontWeight: fontWeight.medium,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 11,
                cursor: !email || busy ? 'not-allowed' : 'pointer', opacity: !email || busy ? 0.55 : 1,
                border: 'none', transition: 'opacity .15s',
              }}
            >
              {busy ? (
                <>
                  <span style={{ width: 17, height: 17, borderRadius: '50%', border: '2px solid rgba(255,255,255,.35)', borderTopColor: '#fff', animation: 'inqi-spin .7s linear infinite' }} />
                  <span>Signing in…</span>
                </>
              ) : (
                <>
                  <span style={{ width: 18, height: 18, background: '#fff', borderRadius: radius.sm, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: fontWeight.bold, color: color.ink, fontSize: fontSize.sm }}>G</span>
                  <span>Continue with Google</span>
                </>
              )}
            </button>
          </div>
        )}

        {authState === AuthState.Error && error && (
          <p data-testid="signin-error" style={{ color: color.danger, marginTop: space[3], fontSize: fontSize.sm }}>{error}</p>
        )}

        <p style={{ fontSize: fontSize.sm, color: color.subtle, margin: `${space[4]}px 0 0` }}>First report is free. No card required.</p>
        <p style={{ marginTop: space[2] }}>
          <a href={hrefFor({ route: Route.StyleGuide })} style={{ fontSize: fontSize.xs, color: color.subtle }}>styleguide</a>
        </p>
      </div>
    </div>
  );
}
