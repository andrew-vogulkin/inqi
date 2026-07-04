import { CSSProperties, useState } from 'react';
import { AuthRole } from '@inqi/shared';
import { AuthState } from '../conventions/enums';
import { Route, navigate, hrefFor, readReturnTo } from '../conventions/routes';
import { color, space, fontSize, fontWeight, radius, font } from '../theme/tokens';
import { authApi, ApiError } from '../api';
import { Input } from '../ui';
import { useAppDispatch, useSelector } from '../state/store';
import { ActionType } from '../state/actions';

const CODE_LENGTH = 6;

/** FE-02 — signed-out entry: brand statement + two-step email sign-in (email → MFA code). */
export function SignIn() {
  const dispatch = useAppDispatch();
  const authState = useSelector((s) => s.session.authState);
  const pendingEmail = useSelector((s) => s.session.pendingEmail);
  const error = useSelector((s) => s.session.error);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');

  const busy = authState === AuthState.SigningIn;
  // The code step shows once step 1 was accepted — including after a wrong-code error.
  const codeStep = pendingEmail !== null && (authState === AuthState.CodeSent || authState === AuthState.Error);

  // The async glue (call api → dispatch result → route). No business logic here.
  async function requestCode() {
    if (!email || busy) return;
    dispatch({ type: ActionType.SignInStarted });
    try {
      await authApi.startEmail({ email });
      dispatch({ type: ActionType.CodeSent, email });
      setCode('');
    } catch (e) {
      dispatch({ type: ActionType.SignInFailed, message: e instanceof ApiError ? e.message : 'Sign-in failed. Please try again.' });
    }
  }

  async function verifyCode() {
    if (!pendingEmail || code.length !== CODE_LENGTH || busy) return;
    dispatch({ type: ActionType.SignInStarted });
    try {
      const session = await authApi.verifyEmail({ email: pendingEmail, code });
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

  const buttonStyle = (enabled: boolean): CSSProperties => ({
    width: '100%', height: 48, borderRadius: radius.md, background: color.ink, color: color.onSolid,
    fontFamily: font.ui, fontSize: fontSize.lg, fontWeight: fontWeight.medium,
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 11,
    cursor: enabled ? 'pointer' : 'not-allowed', opacity: enabled ? 1 : 0.55,
    border: 'none', transition: 'opacity .15s',
  });
  const spinner = (
    <span style={{ width: 17, height: 17, borderRadius: '50%', border: '2px solid rgba(255,255,255,.35)', borderTopColor: '#fff', animation: 'inqi-spin .7s linear infinite' }} />
  );

  return (
    <div style={{ minHeight: '70vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: space[10] }}>
      <div style={{ width: '100%', maxWidth: 380, textAlign: 'center' }}>
        {/* brand mark — the one place green leads */}
        <div style={{ width: 48, height: 48, borderRadius: radius.xl, background: color.brand, color: color.onSolid, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: fontWeight.bold, fontSize: 26, margin: `0 auto ${space[6]}px` }}>i</div>
        <h1 style={{ fontSize: fontSize.h1, fontWeight: fontWeight.semibold, letterSpacing: '-.02em', margin: `0 0 ${space[2]}px` }}>One report. AI agents on it.</h1>
        <p style={{ fontSize: fontSize.lg, color: color.muted, lineHeight: 1.55, margin: `0 0 ${space[6]}px` }}>
          Ask inqi for anything. Agents research and reach out to real providers, then stream back a live, ranked report of your options.
        </p>

        {!codeStep ? (
          <div style={{ display: 'grid', gap: space[2] }}>
            <Input value={email} onChange={setEmail} placeholder="your email" />
            <button onClick={requestCode} disabled={!email || busy} data-testid="signin-button" style={buttonStyle(!!email && !busy)}>
              {busy ? <>{spinner}<span>Sending code…</span></> : <span>Continue with email</span>}
            </button>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: space[2] }}>
            <p style={{ fontSize: fontSize.base, color: color.muted, margin: 0 }}>
              We sent a 6-digit code to <strong style={{ color: color.ink }}>{pendingEmail}</strong>. Enter it to sign in.
            </p>
            <Input value={code} onChange={(v) => setCode(v.replace(/\D/g, '').slice(0, CODE_LENGTH))} placeholder="6-digit code" />
            <button onClick={verifyCode} disabled={code.length !== CODE_LENGTH || busy} data-testid="verify-button" style={buttonStyle(code.length === CODE_LENGTH && !busy)}>
              {busy ? <>{spinner}<span>Verifying…</span></> : <span>Verify &amp; sign in</span>}
            </button>
            <button
              type="button"
              data-testid="change-email"
              onClick={() => { dispatch({ type: ActionType.SignedOut }); setCode(''); }}
              style={{ background: 'none', border: 'none', color: color.subtle, fontSize: fontSize.sm, cursor: 'pointer', fontFamily: font.ui }}>
              Use a different email
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
