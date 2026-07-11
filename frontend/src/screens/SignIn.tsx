import { CSSProperties, FormEvent, ClipboardEvent, KeyboardEvent, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AuthRole } from '@inqi/shared';
import { AuthState } from '../conventions/enums';
import { Route, navigate, readReturnTo, allowedReturnTo } from '../conventions/routes';
import { OTP_LENGTH, otpDigits, applyDigit, applyBackspace, applyPaste } from '../conventions/otp';
import { color, space, fontSize, fontWeight, radius, font } from '../theme/tokens';
import { authApi, ApiError } from '../api';
import { setStoredSession } from '../conventions/session-storage';
import { SonarMark } from '../ui';
import { useAppDispatch, useSelector } from '../state/store';
import { ActionType } from '../state/actions';

/** Prototype input palette: idle vs invalid field border (focus uses the brand green). */
const BORDER_IDLE = '#e3e2de';
const BORDER_INVALID = '#d99a6c';

/** FE-02 — signed-out entry: brand statement + two-step email sign-in (email → MFA code boxes). */
export function SignIn() {
  const dispatch = useAppDispatch();
  const authState = useSelector((s) => s.session.authState);
  const pendingEmail = useSelector((s) => s.session.pendingEmail);
  const error = useSelector((s) => s.session.error);
  const session = useSelector((s) => s.session.session);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [resent, setResent] = useState(false);

  const busy = authState === AuthState.SigningIn;
  // The code step shows once step 1 was accepted — including after a wrong-code error.
  const codeStep = pendingEmail !== null && (authState === AuthState.CodeSent || authState === AuthState.Error);

  // Redirect off Sign in once the session is COMMITTED to the store — driven by state,
  // not fired imperatively inside verifyCode. If we navigate before the dispatch commits,
  // the guarded destination (e.g. /admin) renders while the store still reads signed-out
  // and the route guard bounces us right back to /signin?returnTo=… (a commit race that
  // bit iOS Safari; desktop happened to win it). HP-24: resume the deep link we were
  // bounced from — but only where THIS role may go (a stale returnTo=/admin from a
  // previous operator session must not 403 a customer) — else the role-aware home.
  useLayoutEffect(() => {
    if (!session) return;
    const isAdmin = session.customer.role === AuthRole.Admin;
    const returnTo = allowedReturnTo({ returnTo: readReturnTo(), isAdmin });
    if (returnTo) window.location.hash = returnTo;
    else navigate({ route: isAdmin ? Route.Admin : Route.Dashboard });
  }, [session]);

  // The async glue (call api → dispatch result → route). No business logic here.
  async function requestCode() {
    if (!email || busy) return;
    dispatch({ type: ActionType.SignInStarted });
    try {
      await authApi.startEmail({ email });
      dispatch({ type: ActionType.CodeSent, email });
      setCode('');
      setResent(false);
    } catch (e) {
      dispatch({ type: ActionType.SignInFailed, message: e instanceof ApiError ? e.message : 'Sign-in failed. Please try again.' });
    }
  }

  async function verifyCode() {
    if (!pendingEmail || code.length !== OTP_LENGTH || busy) return;
    dispatch({ type: ActionType.SignInStarted });
    try {
      const sess = await authApi.verifyEmail({ email: pendingEmail, code });
      // Make the token readable synchronously (the api layer reads it for the Bearer
      // header) and commit the session. Navigation is handled by the redirect effect
      // above — once the store reflects the session — so the guarded destination never
      // renders signed-out and can't bounce back to Sign in.
      setStoredSession(sess);
      dispatch({ type: ActionType.SignedIn, session: sess });
    } catch (e) {
      dispatch({ type: ActionType.SignInFailed, message: e instanceof ApiError ? e.message : 'Sign-in failed. Please try again.' });
    }
  }

  async function resendCode() {
    if (!pendingEmail || busy) return;
    try {
      await authApi.startEmail({ email: pendingEmail });
      setResent(true);
      setCode('');
    } catch {
      setResent(false);
    }
  }

  const onEmailSubmit = (e: FormEvent) => { e.preventDefault(); void requestCode(); };
  const onCodeSubmit = (e: FormEvent) => { e.preventDefault(); void verifyCode(); };

  const buttonStyle = (enabled: boolean): CSSProperties => ({
    width: '100%', height: 52, borderRadius: 11, background: color.ink, color: color.onSolid,
    fontFamily: font.ui, fontSize: fontSize.lg, fontWeight: fontWeight.medium,
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
    cursor: enabled ? 'pointer' : 'not-allowed', opacity: enabled ? 1 : 0.55,
    border: 'none', transition: 'opacity .15s',
  });
  const spinner = (
    <span style={{ width: 17, height: 17, borderRadius: '50%', border: '2px solid rgba(255,255,255,.35)', borderTopColor: '#fff', animation: 'inqi-spin .7s linear infinite' }} />
  );

  return (
    <div style={{ minHeight: '70vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: space[10] }}>
      <div style={{ width: '100%', maxWidth: 392, textAlign: 'center' }}>
        {/* brand mark — the one place green leads. Sonar loader (design Variant B):
            the mark's heartbeat pings, and echo dots light up as the wave reaches them. */}
        <div data-testid="sonar-mark" style={{ display: 'flex', justifyContent: 'center', margin: `0 auto ${space[3]}px` }}>
          <SonarMark size={124} markSize={52} />
        </div>

        {!codeStep ? (
          <>
            <h1 style={{ fontSize: fontSize.h1, fontWeight: fontWeight.semibold, letterSpacing: '-.02em', margin: '0 0 9px' }}>One report. AI agents on it.</h1>
            <p style={{ fontSize: fontSize.lg, color: color.muted, lineHeight: 1.55, margin: '0 0 28px' }}>
              Ask inqi for anything. Agents research and reach out to real providers, then stream back a live, ranked report of your options.
            </p>
            <form onSubmit={onEmailSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 10, textAlign: 'left' }}>
              <EmailField value={email} onChange={setEmail} invalid={authState === AuthState.Error} />
              <button type="submit" disabled={!email || busy} data-testid="signin-button" style={buttonStyle(!!email && !busy)}>
                {busy ? <>{spinner}<span>Sending code…</span></> : <><span>Continue with email</span><span style={{ fontSize: 16 }}>→</span></>}
              </button>
            </form>
          </>
        ) : (
          <>
            <h1 style={{ fontSize: fontSize.h1, fontWeight: fontWeight.semibold, letterSpacing: '-.02em', margin: '0 0 9px' }}>Check your inbox</h1>
            <p style={{ fontSize: fontSize.lg, color: color.muted, lineHeight: 1.55, margin: '0 0 28px' }}>
              We sent a 6-digit code to <strong style={{ color: color.ink, fontWeight: fontWeight.medium }}>{pendingEmail}</strong>. Enter it below to continue.
            </p>
            <form onSubmit={onCodeSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 10, textAlign: 'left' }}>
              <CodeBoxes code={code} onChange={setCode} invalid={authState === AuthState.Error} />
              <button type="submit" disabled={code.length !== OTP_LENGTH || busy} data-testid="verify-button" style={buttonStyle(code.length === OTP_LENGTH && !busy)}>
                {busy ? <>{spinner}<span>Verifying…</span></> : <span>Verify &amp; continue</span>}
              </button>
            </form>
            {resent && <p data-testid="code-resent" style={{ fontSize: fontSize.sm, color: color.brand, margin: `${space[3]}px 0 0` }}>New code sent.</p>}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14, margin: '22px 0 0', fontSize: fontSize.base }}>
              <button type="button" onClick={() => void resendCode()} style={{ background: 'none', border: 'none', color: color.muted, fontWeight: fontWeight.medium, cursor: 'pointer', fontFamily: font.ui, fontSize: fontSize.base }}>Resend code</button>
              <span style={{ color: color.lineStrong }}>·</span>
              <button
                type="button"
                data-testid="change-email"
                onClick={() => { dispatch({ type: ActionType.SignedOut }); setCode(''); setResent(false); }}
                style={{ background: 'none', border: 'none', color: color.muted, fontWeight: fontWeight.medium, cursor: 'pointer', fontFamily: font.ui, fontSize: fontSize.base }}>
                Change email
              </button>
            </div>
          </>
        )}

        {authState === AuthState.Error && error && (
          <p data-testid="signin-error" style={{ color: color.warn, marginTop: space[3], fontSize: fontSize.sm, textAlign: 'left' }}>{error}</p>
        )}

        {!codeStep && (
          <>
            <p style={{ fontSize: fontSize.sm, color: color.subtle, margin: `${space[5]}px 0 0` }}>New here? We&rsquo;ll create your account automatically — no separate sign-up.</p>
            <p style={{ fontSize: fontSize.sm, color: color.subtle, margin: `${space[2]}px 0 0` }}>First report is free. No card required.</p>
          </>
        )}
      </div>
    </div>
  );
}

/** Step-1 email field: prefix icon + focus ring per the prototype (52px row, warm border on error). */
function EmailField({ value, onChange, invalid }: { value: string; onChange: (v: string) => void; invalid: boolean }) {
  const [focused, setFocused] = useState(false);
  const border = focused ? color.brand : invalid ? BORDER_INVALID : BORDER_IDLE;
  return (
    <div style={{ display: 'flex', alignItems: 'center', height: 52, border: `1.5px solid ${border}`, borderRadius: 11, background: color.surface, padding: '0 15px', transition: 'border-color .15s' }}>
      <span aria-hidden style={{ color: color.subtle, fontSize: fontSize.lg, marginRight: 11 }}>✉</span>
      <input
        type="email" name="email" autoComplete="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="go"
        value={value} onChange={(e) => onChange(e.target.value)} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
        placeholder="you@example.com"
        style={{ flex: 1, border: 'none', outline: 'none', fontSize: fontSize.lg, fontFamily: font.ui, background: 'transparent', color: color.ink, height: '100%' }}
      />
    </div>
  );
}

/**
 * The 6-box MFA input. All keyboard/paste rules live in `conventions/otp` (pure,
 * unit-tested); this component only renders boxes and moves focus.
 */
function CodeBoxes({ code, onChange, invalid }: { code: string; onChange: (code: string) => void; invalid: boolean }) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const [focusedAt, setFocusedAt] = useState<number | null>(null);
  const digits = otpDigits(code);

  // Entering the code step: the first box takes focus so typing starts immediately.
  useEffect(() => { refs.current[0]?.focus(); }, []);

  const apply = ({ code: next, focusIndex }: { code: string; focusIndex: number | null }) => {
    onChange(next);
    if (focusIndex != null) {
      // Focus moves SYNCHRONOUSLY — a fast typist's next keystroke must land in the
      // next box; only the select waits for React to paint the new value.
      const el = refs.current[focusIndex];
      el?.focus();
      requestAnimationFrame(() => el?.select());
    }
  };
  const onKey = (i: number) => (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace') { e.preventDefault(); apply(applyBackspace({ code, index: i })); }
    else if (e.key === 'ArrowLeft' && i > 0) refs.current[i - 1]?.focus();
    else if (e.key === 'ArrowRight' && i < OTP_LENGTH - 1) refs.current[i + 1]?.focus();
  };
  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const edit = applyPaste({ text: e.clipboardData?.getData('text') ?? '' });
    if (edit) { e.preventDefault(); apply(edit); }
  };

  return (
    <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
      {digits.map((d, i) => {
        const border = focusedAt === i ? color.brand : invalid ? BORDER_INVALID : BORDER_IDLE;
        return (
          <input
            key={i}
            ref={(el) => { refs.current[i] = el; }}
            type="text" inputMode="numeric" pattern="[0-9]*"
            autoComplete={i === 0 ? 'one-time-code' : 'off'}
            data-testid={`otp-${i}`}
            aria-label={`Code digit ${i + 1}`}
            value={d}
            onChange={(e) => apply(applyDigit({ code, index: i, raw: e.target.value }))}
            onKeyDown={onKey(i)}
            onFocus={(e) => { setFocusedAt(i); e.currentTarget.select(); }}
            onBlur={() => setFocusedAt((cur) => (cur === i ? null : cur))}
            onPaste={onPaste}
            style={{
              width: 46, height: 58, border: `1.5px solid ${border}`, borderRadius: 11, textAlign: 'center',
              fontFamily: font.mono, fontSize: 26, fontWeight: fontWeight.semibold, color: color.ink,
              background: color.surface, outline: 'none', transition: 'border-color .15s',
            }}
          />
        );
      })}
    </div>
  );
}
